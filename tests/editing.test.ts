import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { applyProposal, runPracticeTests } from '../server/editing.ts';
import { ApprovalManager } from '../server/approvals.ts';

test('确认 ID 只处理一次，拒绝与断线均释放等待', async () => {
  const manager = new ApprovalManager();
  let id = '';
  const waiting = manager.request({ action: 'edit', path: 'counter.ts', before: 'old', after: 'new', diff: '-old\n+new' }, proposal => { id = proposal.id; }, new AbortController().signal);
  assert.ok(id);
  assert.equal(manager.decide(id, false), true);
  assert.equal(await waiting, false);
  assert.equal(manager.decide(id, true), false);
  const controller = new AbortController();
  const aborted = manager.request({ action: 'test', path: 'counter.ts', before: '', after: '', diff: 'test' }, () => {}, controller.signal);
  controller.abort();
  assert.equal(await aborted, false);
});

test('拒绝不写入、变更冲突不覆盖、确认后准确替换短文件', async () => {
  const fixture = await mkdtemp(path.join(tmpdir(), 'ccai-edit-'));
  try {
    const target = path.join(fixture, 'counter.ts');
    await writeFile(target, 'old long content');
    assert.equal((await applyProposal({ path: '../outside.ts', content: 'x' }, async () => true, fixture)).ok, false);
    const rejected = await applyProposal({ path: 'counter.ts', content: 'new' }, async proposal => {
      assert.match(proposal.diff, /-old long content/); return false;
    }, fixture);
    assert.equal(rejected.ok, false);
    assert.equal(await readFile(target, 'utf8'), 'old long content');
    const conflict = await applyProposal({ path: 'counter.ts', content: 'new' }, async () => { await writeFile(target, 'user edit'); return true; }, fixture);
    assert.equal(conflict.ok, false);
    assert.equal(await readFile(target, 'utf8'), 'user edit');
    const applied = await applyProposal({ path: 'counter.ts', content: 'new' }, async () => true, fixture);
    assert.equal(applied.ok, true);
    assert.equal(await readFile(target, 'utf8'), 'new');
  } finally {
    assert.equal(path.dirname(path.resolve(fixture)), path.resolve(tmpdir()));
    await rm(fixture, { recursive: true, force: true });
  }
});

test('真实固定测试在隔离练习中先失败，确认修复后通过，不改用户练习', async () => {
  const fixture = await mkdtemp(path.join(tmpdir(), 'ccai-verify-'));
  try {
    const practice = path.join(fixture, 'practice'), tests = path.join(fixture, 'practice-tests');
    await mkdir(practice); await mkdir(tests);
    await writeFile(path.join(practice, 'counter.ts'), 'export function add(a: number,b: number){return a-b;}');
    const suite = path.join(tests, 'counter.test.ts');
    await writeFile(suite, 'import {test} from "node:test"; import assert from "node:assert/strict"; import {add} from "../practice/counter.ts"; test("sum",()=>assert.equal(add(2,3),5));');
    const baseline = await runPracticeTests(async () => true, AbortSignal.timeout(15000), practice, suite);
    assert.ok(baseline.ok && 'passed' in baseline && !baseline.passed);
    if (baseline.ok && 'output' in baseline) assert.match(baseline.output, /AssertionError/);
    await applyProposal({ path: 'counter.ts', content: 'export function add(a: number,b: number){return a+b;}' }, async () => true, practice);
    const verified = await runPracticeTests(async () => true, AbortSignal.timeout(15000), practice, suite);
    assert.ok(verified.ok && 'passed' in verified && verified.passed);
    const denied = await runPracticeTests(async () => false, AbortSignal.timeout(15000), practice, suite);
    assert.equal(denied.ok, false);
  } finally {
    assert.equal(path.dirname(path.resolve(fixture)), path.resolve(tmpdir()));
    await rm(fixture, { recursive: true, force: true });
  }
});
