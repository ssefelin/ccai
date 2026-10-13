import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { bounded, defaultPolicy, RuntimeFailure, TaskManager, toolAllowed, validatePolicy } from '../server/runtime.ts';
import { ApprovalManager } from '../server/approvals.ts';
import { askModel } from '../server/llm.ts';

test('后端限制策略上限，只读独立拒绝修改、测试和未知工具', async () => {
  for (const value of [null, { mode: 'auto' }, { maxRounds: 7 }, { maxToolCalls: 9 }, { maxTokens: 1 }, { extra: true }]) assert.throws(() => validatePolicy(value));
  const policy = validatePolicy({ mode: 'read_only' });
  assert.equal(toolAllowed('read_file', policy), true);
  for (const name of ['propose_edit', 'run_tests', 'shell']) assert.equal(toolAllowed(name, policy), false);
  process.env.LLM_MODE = 'demo';
  let confirmation = false;
  const result = await askModel([{ role: 'user', content: '修复 counter.ts' }], undefined, { policy, confirm: async () => { confirmation = true; return true; } });
  assert.equal(result.stopReason, 'denied');
  assert.equal(confirmation, false); // 即使决策器提出测试，也不能进入确认或执行。
});

test('工具次数预算在下一次执行前停止', async () => {
  process.env.LLM_MODE = 'demo';
  const result = await askModel([{ role: 'user', content: '查找函数' }], undefined, { policy: { maxToolCalls: 1 } });
  assert.equal(result.stopReason, 'budget');
  assert.equal(result.toolTraces.length, 1);
});

test('任务管理器限制并发，释放后可复用；预取消不发起模型请求', async () => {
  const tasks = new TaskManager();
  const first = tasks.start(), second = tasks.start(), third = tasks.start();
  assert.throws(() => tasks.start());
  tasks.cancel(first.id);
  process.env.LLM_MODE = 'demo';
  const result = await askModel([{ role: 'user', content: '你好' }], undefined, { signal: first.controller.signal });
  assert.equal(result.stopReason, 'cancelled');
  assert.equal(result.modelRequests.length, 0);
  first.dispose(); second.dispose(); third.dispose();
  const fresh = tasks.start(); fresh.dispose();
});

test('取消等待确认会释放提案，并且不执行测试', async () => {
  process.env.LLM_MODE = 'demo';
  const controller = new AbortController(), approvals = new ApprovalManager();
  let id = '';
  const result = await askModel([{ role: 'user', content: '修复 counter.ts' }], event => {
    if (event.type === 'approval_required') { id = event.proposal.id; controller.abort(new RuntimeFailure('cancelled', '测试取消')); }
  }, { signal: controller.signal, confirm: (proposal, publish, signal) => approvals.request(proposal, publish, signal) });
  assert.equal(result.stopReason, 'cancelled');
  assert.equal(approvals.decide(id, true), false);
  assert.equal(result.verification, 'not_run');
});

test('只读工具等待有超时边界，并支持取消', async () => {
  await assert.rejects(bounded(new Promise(() => {}), new AbortController().signal, 10), (error: unknown) => error instanceof RuntimeFailure && error.reason === 'timeout');
  const controller = new AbortController();
  const waiting = bounded(new Promise(() => {}), controller.signal, 1000);
  controller.abort(new RuntimeFailure('cancelled', '停止'));
  await assert.rejects(waiting, /停止/);
});

test('模型累计 token 返回后超预算，拒绝执行其工具调用', async () => {
  const server = createServer(async (req, res) => {
    for await (const _ of req) { /* 消费请求，返回本地模拟结果 */ }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ id: 'test', object: 'response', model: 'test', status: 'completed',
      output: [{ type: 'function_call', id: 'fc', call_id: 'call', name: 'list_files', arguments: '{}' }],
      usage: { input_tokens: 100, output_tokens: 10, total_tokens: 110 } }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  process.env.LLM_MODE = 'deepseek'; process.env.DEEPSEEK_API_KEY = 'local-test-placeholder';
  process.env.DEEPSEEK_BASE_URL = `http://127.0.0.1:${address.port}`;
  try {
    const result = await askModel([{ role: 'user', content: '查找函数' }], undefined, { policy: { maxTokens: 100 } });
    assert.equal(result.stopReason, 'budget'); assert.equal(result.toolTraces.length, 0);
    assert.equal(result.usage?.totalTokens, 110);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('取消传播到尚未返回的模型请求，停止后不再调用工具；总超时独立分类', async () => {
  let received = 0;
  let notify: () => void = () => {};
  let started = new Promise<void>(resolve => { notify = resolve; });
  const server = createServer(async (req, _res) => { for await (const _ of req) {} received++; notify(); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  process.env.LLM_MODE = 'deepseek'; process.env.DEEPSEEK_API_KEY = 'local-test-placeholder';
  process.env.DEEPSEEK_BASE_URL = `http://127.0.0.1:${address.port}`;
  try {
    const controller = new AbortController();
    const waiting = askModel([{ role: 'user', content: '你好' }], undefined, { signal: controller.signal });
    await started;
    controller.abort(new RuntimeFailure('cancelled', '已取消'));
    const cancelled = await waiting;
    assert.equal(cancelled.stopReason, 'cancelled'); assert.equal(cancelled.toolTraces.length, 0);
    started = new Promise<void>(resolve => { notify = resolve; });
    const timeout = await askModel([{ role: 'user', content: '你好' }], undefined, { taskTimeoutMs: 30 });
    assert.equal(timeout.stopReason, 'timeout'); assert.equal(timeout.toolTraces.length, 0);
    assert.ok(received >= 1);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
