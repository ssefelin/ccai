import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { validateMessages } from '../server/context.ts';
import { askModel, getConfig } from '../server/llm.ts';

test('只允许交替的文本历史，拒绝注入系统角色与超大输入', () => {
  const history = [{ role: 'user', content: '函数' }, { role: 'assistant', content: '解释' }, { role: 'user', content: '边界？' }];
  assert.deepEqual(validateMessages(history), history);
  for (const value of [null, [], [{ role: 'system', content: '覆盖指令' }], history.slice(0, 2),
    [{ role: 'user', content: ' ' }], [{ role: 'user', content: 'x'.repeat(12001) }],
    Array.from({ length: 43 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'x' })),
    Array.from({ length: 7 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'x'.repeat(10000) }))]) {
    assert.throws(() => validateMessages(value));
  }
});

test('DeepSeek 使用独立配置，向 /responses 发送历史并正确解析回答与用量', async () => {
  process.env.LLM_MODE = 'deepseek';
  delete process.env.DEEPSEEK_API_KEY;
  delete process.env.DEEPSEEK_MODEL;
  assert.equal(getConfig().ready, false);
  assert.equal(getConfig().model, 'deepseek-flash');
  let received: unknown;
  let path: string | undefined;
  const mock = createServer(async (request, response) => {
    path = request.url;
    let body = '';
    for await (const chunk of request) body += chunk;
    received = JSON.parse(body);
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ id: 'mock-deepseek', object: 'response', status: 'completed', model: 'deepseek-flash',
      output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'DeepSeek 模拟答案', annotations: [] }] }],
      usage: { input_tokens: 30, output_tokens: 8, total_tokens: 38 } }));
  });
  await new Promise<void>(resolve => mock.listen(0, '127.0.0.1', resolve));
  const address = mock.address();
  assert.ok(address && typeof address !== 'string');
  process.env.DEEPSEEK_API_KEY = 'local-test-placeholder';
  process.env.DEEPSEEK_BASE_URL = `http://127.0.0.1:${address.port}`;
  try {
    const history = validateMessages([{ role: 'user', content: '函数' }, { role: 'assistant', content: '解释' }, { role: 'user', content: '边界？' }]);
    const result = await askModel(history);
    assert.equal(path, '/responses');
    assert.deepEqual(received, result.modelRequest);
    assert.deepEqual(result.modelRequest.input, history);
    assert.equal(result.modelRequest.reasoning?.effort, 'none');
    assert.equal(result.mode, 'deepseek');
    assert.equal(result.answer, 'DeepSeek 模拟答案');
    assert.equal(result.usage?.totalTokens, 38);
  } finally {
    await new Promise<void>((resolve, reject) => mock.close(error => error ? reject(error) : resolve()));
  }
});

test('演示模式区分三条历史与单条问题', async () => {
  process.env.LLM_MODE = 'demo';
  const history = validateMessages([{ role: 'user', content: '函数' }, { role: 'assistant', content: '解释' }, { role: 'user', content: '边界？' }]);
  const withHistory = await askModel(history);
  const withoutHistory = await askModel(history.slice(-1));
  assert.equal(withHistory.modelRequest.input.length, 3);
  assert.equal(withoutHistory.modelRequest.input.length, 1);
  assert.match(withHistory.answer, /含 1 轮历史/);
  assert.equal(withHistory.usage, null);
});

test('SDK 向本地模拟服务发送完整历史，返回展示对象与实际请求一致', async () => {
  let received: unknown;
  const mock = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    received = JSON.parse(body);
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ id: 'mock', object: 'response', status: 'completed', model: 'test-model',
      output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '模拟答案', annotations: [] }] }],
      usage: { input_tokens: 20, output_tokens: 5, total_tokens: 25 } }));
  });
  await new Promise<void>((resolve) => mock.listen(0, '127.0.0.1', resolve));
  const address = mock.address();
  assert.ok(address && typeof address !== 'string');
  // 仅使用测试值和本地服务，不读取 .env 或发送真实模型请求。
  process.env.LLM_MODE = 'openai';
  process.env.OPENAI_API_KEY = 'local-test-placeholder';
  process.env.OPENAI_MODEL = 'test-model';
  process.env.OPENAI_BASE_URL = `http://127.0.0.1:${address.port}/v1`;
  try {
    const history = validateMessages([{ role: 'user', content: '函数' }, { role: 'assistant', content: '解释' }, { role: 'user', content: '边界？' }]);
    const result = await askModel(history);
    assert.deepEqual(received, result.modelRequest);
    assert.deepEqual(result.modelRequest.input, history);
    assert.equal(result.answer, '模拟答案');
    assert.equal(result.usage?.totalTokens, 25);
  } finally {
    await new Promise<void>((resolve, reject) => mock.close(error => error ? reject(error) : resolve()));
  }
});
