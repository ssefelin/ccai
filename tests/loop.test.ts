import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { askModel } from '../server/llm.ts';
import { listPracticeFiles } from '../server/tools.ts';
import { readEvents } from '../client/stream.ts';
import type { AgentEvent } from '../shared/api.ts';

async function withModel(script: (round: number, request: any) => any[], run: (requests: any[]) => Promise<void>) {
  const requests: any[] = [];
  const server = createServer(async (req, res) => {
    let raw = '';
    for await (const part of req) raw += part;
    const request = JSON.parse(raw);
    requests.push(request);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ id: `r${requests.length}`, object: 'response', status: 'completed', model: 'test',
      output: script(requests.length, request), usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  process.env.LLM_MODE = 'deepseek';
  process.env.DEEPSEEK_API_KEY = 'local-test-placeholder';
  process.env.DEEPSEEK_BASE_URL = `http://127.0.0.1:${address.port}`;
  try { await run(requests); }
  finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}
const call = (round: number, name: string, args = '{}') => [{ type: 'function_call', id: `fc${round}`, call_id: `call${round}`, name, arguments: args }];
const answer = [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '找到了名称函数。', annotations: [] }] }];

test('根据列出结果读取文件，再结束任务，事件早于最终结果', async () => {
  await withModel((round, request) => {
    if (round === 1) return call(round, 'list_files');
    if (round === 2) {
      const output = request.input.find((item: any) => item.type === 'function_call_output');
      assert.ok(JSON.parse(output.output).files.includes('text.ts'));
      return call(round, 'read_file', '{"path":"text.ts"}');
    }
    assert.match(JSON.stringify(request.input), /normalizeName/);
    return answer;
  }, async requests => {
    const events: AgentEvent[] = [];
    const result = await askModel([{ role: 'user', content: '查找名称处理函数' }], event => events.push(event));
    assert.equal(result.stopReason, 'completed');
    assert.equal(result.rounds, 3);
    assert.deepEqual(result.toolTraces.map(trace => trace.name), ['list_files', 'read_file']);
    assert.equal(result.usage?.totalTokens, 45);
    assert.deepEqual(result.modelRequests, requests);
    assert.equal(events[0].type, 'model_start');
    assert.equal(events.at(-1)?.type, 'stop');
    assert.ok(events.some(event => event.type === 'tool_result' && event.round === 1));
    assert.equal(requests[0].input.length, 1); // 之前请求的快照没有被后续追加污染。
  });
});

test('反复调用受轮数约束，最后一轮不执行工具，不伪装为完成', async () => {
  await withModel(round => call(round, 'list_files'), async requests => {
    const result = await askModel([{ role: 'user', content: '循环查找' }], undefined, { maxRounds: 3 });
    assert.equal(requests.length, 3);
    assert.equal(result.stopReason, 'max_rounds');
    assert.equal(result.toolTraces.length, 2);
    assert.match(result.answer, /尚未完成/);
  });
});

test('读取失败成为上下文，模型可在下一轮改用有效路径', async () => {
  await withModel((round, request) => {
    if (round === 1) return call(round, 'read_file', '{"path":"missing.ts"}');
    if (round === 2) {
      const output = request.input.find((item: any) => item.type === 'function_call_output');
      assert.equal(JSON.parse(output.output).ok, false);
      return call(round, 'read_file', '{"path":"text.ts"}');
    }
    return answer;
  }, async () => {
    const result = await askModel([{ role: 'user', content: '查找函数' }]);
    assert.equal(result.stopReason, 'completed');
    assert.deepEqual(result.toolTraces.map(trace => trace.result.ok), [false, true]);
  });
});

test('无效工具被后端拒绝，仍有停止事件并保留轨迹', async () => {
  await withModel(round => round === 1 ? call(round, 'shell') : [], async () => {
    const result = await askModel([{ role: 'user', content: '测试错误' }]);
    assert.equal(result.toolTraces[0].result.ok, false);
    assert.equal(result.stopReason, 'denied');
    assert.equal(result.events.at(-1)?.type, 'stop');
  });
});

test('SSE 解析支持逐字节中文、多个事件和心跳注释', async () => {
  const payload = new TextEncoder().encode(': ping\n\ndata: {"type":"stop","round":1,"reason":"completed","message":"中文完成"}\n\n');
  const stream = new ReadableStream<Uint8Array>({ start(controller) { for (const byte of payload) controller.enqueue(Uint8Array.of(byte)); controller.close(); } });
  const events = [];
  for await (const event of readEvents(stream)) events.push(event);
  assert.deepEqual(events, [{ type: 'stop', round: 1, reason: 'completed', message: '中文完成' }]);
});

test('列文件返回相对路径，演示模式走同一个三轮循环', async () => {
  const listing = await listPracticeFiles();
  assert.ok(listing.ok && 'files' in listing);
  if (listing.ok && 'files' in listing) assert.ok(listing.files.includes('text.ts'));
  process.env.LLM_MODE = 'demo';
  const result = await askModel([{ role: 'user', content: '查找函数' }]);
  assert.equal(result.rounds, 3);
  assert.equal(result.stopReason, 'completed');
});
