import { lstat, open, realpath } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { execFile } from 'node:child_process';
import type { FunctionTool } from 'openai/resources/responses/responses';
import type { ApprovalProposal, ToolTrace } from '../shared/api.ts';

const root = fileURLToPath(new URL('../practice/', import.meta.url));
const suite = fileURLToPath(new URL('../practice-tests/counter.test.ts', import.meta.url));
type Confirm = (proposal: Omit<ApprovalProposal, 'id'>) => Promise<boolean>;
export const editTool: FunctionTool = {
  type: 'function', name: 'propose_edit', description: '提出 counter.ts 的完整替换内容。页面先展示差异并请求用户确认，确认后才写入；仅能修改 counter.ts。',
  parameters: { type: 'object', properties: { path: { type: 'string', enum: ['counter.ts'] }, content: { type: 'string' } }, required: ['path', 'content'], additionalProperties: false }, strict: true,
};
export const testTool: FunctionTool = {
  type: 'function', name: 'run_tests', description: '经用户确认后运行固定 counter 加法测试，返回是否通过、退出码和测试输出。无需参数，不支持任意命令。',
  parameters: { type: 'object', properties: {}, additionalProperties: false }, strict: true,
};

// 展示包含公共上下文的行差异；全文也会在确认面板中显示。
export function lineDiff(before: string, after: string): string {
  const oldLines = before.split('\n'), newLines = after.split('\n');
  let prefix = 0, suffix = 0;
  while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) prefix++;
  while (suffix < oldLines.length - prefix && suffix < newLines.length - prefix && oldLines.at(-1 - suffix) === newLines.at(-1 - suffix)) suffix++;
  return ['--- counter.ts（原）', '+++ counter.ts（新）', ...oldLines.slice(Math.max(0, prefix - 1), prefix).map(line => ' ' + line),
    ...oldLines.slice(prefix, oldLines.length - suffix).map(line => '-' + line),
    ...newLines.slice(prefix, newLines.length - suffix).map(line => '+' + line),
    ...newLines.slice(newLines.length - suffix, newLines.length - suffix + 1).map(line => ' ' + line)].join('\n');
}
async function targetPath(practice = root) {
  if ((await lstat(practice)).isSymbolicLink()) throw new Error('练习目录不能是链接。');
  const candidate = path.join(practice, 'counter.ts');
  if ((await lstat(candidate)).isSymbolicLink()) throw new Error('修改目标不能是链接。');
  const base = await realpath(practice), actual = await realpath(candidate);
  if (path.relative(base, actual) !== 'counter.ts') throw new Error('修改目标必须在练习目录内。');
  return actual;
}
export async function applyProposal(value: unknown, confirm: Confirm, practice = root): Promise<ToolTrace['result']> {
  const args = value as { path?: unknown; content?: unknown };
  if (!args || args.path !== 'counter.ts' || Object.keys(args).some(key => !['path', 'content'].includes(key)) || typeof args.content !== 'string' || !args.content.trim() || Buffer.byteLength(args.content) > 16384) {
    return { ok: false, error: '仅允许修改 counter.ts，内容须为不超过16 KiB的非空文本。' };
  }
  try {
    const target = await targetPath(practice);
    const handle = await open(target, 'r');
    let before: string;
    try {
      if (!(await handle.stat()).isFile() || (await handle.stat()).size > 16384) throw new Error('目标不是小型普通文件。');
      before = await handle.readFile('utf8');
    } finally { await handle.close(); }
    if (before === args.content) return { ok: false, error: '内容没有变化，无需修改。' };
    const approved = await confirm({ action: 'edit', path: 'counter.ts', before, after: args.content, diff: lineDiff(before, args.content) });
    if (!approved) return { ok: false, error: '修改被拒绝、确认超时或连接已断开。', approvalDenied: true };
    if (await targetPath(practice) !== target) return { ok: false, error: '目标路径发生变化，请重新提出修改。' };
    const writer = await open(target, 'r+');
    try {
      if (!(await writer.stat()).isFile() || (await writer.stat()).size > 16384 || await writer.readFile('utf8') !== before) return { ok: false, error: '文件已被其他操作修改，请重新读取并提出修改。' };
      const bytes = Buffer.from(args.content);
      // readFile 已移动文件位置；从位置0覆盖，而不是在末尾追加。
      await writer.write(bytes, 0, bytes.length, 0);
      await writer.truncate(bytes.length);
      await writer.sync();
    } finally { await writer.close(); }
    return { ok: true, path: 'counter.ts', applied: true };
  } catch { return { ok: false, error: '无法安全写入 counter.ts，请检查文件与目录。' }; }
}

export async function runPracticeTests(confirm: Confirm, signal: AbortSignal, practice = root, testSuite = suite): Promise<ToolTrace['result']> {
  try {
    await targetPath(practice);
    if (!await confirm({ action: 'test', path: 'counter.ts', before: '', after: '', diff: '运行固定测试：正数、负数、零的加法。测试会执行 counter.ts，最长10秒。' })) return { ok: false, error: '测试被拒绝、确认超时或连接已断开。', approvalDenied: true };
    const target = await targetPath(practice);
    const result = await new Promise<{ passed: boolean; exitCode: number | null; output: string }>(resolve => {
      // 固定命令与测试路径；不继承模型密钥，也不允许子进程写文件或启动其他进程。
      execFile(process.execPath, ['--permission', `--allow-fs-read=${path.dirname(target)}`, `--allow-fs-read=${path.dirname(testSuite)}`,
        `--allow-fs-read=${fileURLToPath(new URL('../package.json', import.meta.url))}`,
        '--experimental-strip-types', '--input-type=module', '--eval', `await import(${JSON.stringify(pathToFileURL(testSuite).href)})`],
        { windowsHide: true, timeout: 10000, maxBuffer: 16384, signal,
          env: { SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP } },
        (error, stdout, stderr) => resolve({ passed: !error, exitCode: error ? typeof error.code === 'number' ? error.code : null : 0,
          output: (stdout + stderr).slice(0, 16000) || (error ? '测试进程未正常结束（超时、输出过大或取消）。' : '测试通过。') }));
    });
    return { ok: true, suite: 'counter 加法测试', ...result };
  } catch { return { ok: false, error: '无法运行固定测试。' }; }
}
