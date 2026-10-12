import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { readPracticeFile, executeReadCall, listPracticeFiles } from '../server/tools.ts';
import { askModel } from '../server/llm.ts';

test('只读边界：有效文本、路径穿越、绝对路径、隐藏文件、缺失文件和大小限制', async () => {
  const fixture = await mkdtemp(path.join(tmpdir(), 'ccai-tools-'));
  try {
    await writeFile(path.join(fixture, 'small.ts'), 'export const value = 1;');
    await writeFile(path.join(fixture, 'RoomFlow.cs'), 'public class RoomFlow {}');
    const listing = await listPracticeFiles(fixture);
    assert.ok(listing.ok && 'files' in listing && listing.files.includes('RoomFlow.cs'));
    assert.equal((await readPracticeFile('RoomFlow.cs', fixture)).ok, true);
    // 同一进程中新增文件，下一次列出/读取应立即可见。
    await writeFile(path.join(fixture, 'AddedLater.cs'), 'public class AddedLater {}');
    const updated = await listPracticeFiles(fixture);
    assert.ok(updated.ok && 'files' in updated && updated.files.includes('AddedLater.cs'));
    assert.equal((await readPracticeFile('AddedLater.cs', fixture)).ok, true);
    await writeFile(path.join(fixture, 'large.ts'), 'x'.repeat(16385));
    await writeFile(path.join(fixture, 'invalid.txt'), Buffer.from([0xff]));
    const valid = await readPracticeFile('small.ts', fixture);
    assert.equal(valid.ok, true);
    if (valid.ok) assert.equal(valid.content, 'export const value = 1;');
    for (const filename of ['../README.md', '..\\README.md', '/README.md', 'C:\\secret.txt', '.env', 'large.ts', 'invalid.txt', 'missing.ts']) {
      assert.equal((await readPracticeFile(filename, fixture)).ok, false, filename);
    }
  } finally { await rm(fixture, { recursive: true, force: true }); }
});

test('拒绝目录链接逃逸和符号链接练习根目录', async () => {
  const fixture = await mkdtemp(path.join(tmpdir(), 'ccai-links-'));
  try {
    const root = path.join(fixture, 'practice');
    const outside = path.join(fixture, 'outside');
    await mkdir(root); await mkdir(outside);
    await writeFile(path.join(outside, 'secret.txt'), 'outside');
    await symlink(outside, path.join(root, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
    assert.equal((await readPracticeFile('escape/secret.txt', root)).ok, false);
    const linkedRoot = path.join(fixture, 'linked');
    await symlink(root, linkedRoot, process.platform === 'win32' ? 'junction' : 'dir');
    assert.equal((await readPracticeFile('anything.ts', linkedRoot)).ok, false);
  } finally { await rm(fixture, { recursive: true, force: true }); }
});

test('工具执行拒绝未知名称、错误 JSON 和额外参数', async () => {
  for (const [name, args] of [['shell', '{}'], ['read_file', '{'], ['read_file', '{"path":"math.ts","other":1}']]) {
    assert.equal((await executeReadCall('test', name, args)).result.ok, false);
  }
});

test('演示链路模拟决策但真实读取 math.ts，越界失败也有轨迹', async () => {
  process.env.LLM_MODE = 'demo';
  const result = await askModel([{ role: 'user', content: '请读取并解释 math.ts' }]);
  assert.equal(result.toolTraces[0].result.ok, true);
  assert.equal(result.modelRequests.length, 2);
  assert.match(JSON.stringify(result.modelRequests[1].input), /function_call_output/);
  const denied = await askModel([{ role: 'user', content: '读取 ../README.md' }]);
  assert.equal(denied.toolTraces[0].result.ok, false);
});

test('模型循环：调用 ID 匹配、工具结果回传、后续仍可调用工具并累计用量', async () => {
  const requests: any[] = [];
  const mock = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    requests.push(JSON.parse(body));
    const output = requests.length === 1
      ? [{ type: 'function_call', id: 'fc-test', call_id: 'call-test', name: 'read_file', arguments: '{"path":"math.ts"}' }]
      : [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '函数执行除法。', annotations: [] }] }];
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ id: `mock-${requests.length}`, object: 'response', status: 'completed', model: 'test', output,
      usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } }));
  });
  await new Promise<void>(resolve => mock.listen(0, '127.0.0.1', resolve));
  const address = mock.address();
  assert.ok(address && typeof address !== 'string');
  process.env.LLM_MODE = 'deepseek';
  process.env.DEEPSEEK_API_KEY = 'local-test-placeholder';
  process.env.DEEPSEEK_BASE_URL = `http://127.0.0.1:${address.port}`;
  try {
    const result = await askModel([{ role: 'user', content: '解释 math.ts' }]);
    assert.equal(requests.length, 2);
    assert.equal(requests[0].tools[0].name, 'read_file');
    assert.equal(requests[1].tool_choice, 'auto');
    assert.equal(requests[1].tools.length, 4);
    const output = requests[1].input.find((item: any) => item.type === 'function_call_output');
    assert.equal(output.call_id, 'call-test');
    assert.match(JSON.parse(output.output).content, /return a \/ b/);
    assert.deepEqual(result.modelRequests, requests);
    assert.equal(result.answer, '函数执行除法。');
    assert.equal(result.usage?.totalTokens, 30);
  } finally { await new Promise<void>((resolve, reject) => mock.close(error => error ? reject(error) : resolve())); }
});
