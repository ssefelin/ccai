import { lstat, open, realpath, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ToolTrace } from '../shared/api.ts';
import type { FunctionTool } from 'openai/resources/responses/responses';

const practiceRoot = fileURLToPath(new URL('../practice/', import.meta.url));
export const readFileTool: FunctionTool = {
  type: 'function', name: 'read_file',
  description: '读取 practice 练习目录下的 UTF-8 文本文件。参数为相对路径，例如 math.ts。不能读取其他目录。',
  parameters: { type: 'object', properties: { path: { type: 'string', description: '练习目录内的相对文件路径' } }, required: ['path'], additionalProperties: false },
  strict: true,
};

// 目录约束属于后端执行策略，不能只交给提示词。
export async function readPracticeFile(value: unknown, root = practiceRoot): Promise<ToolTrace['result']> {
  try {
    if (typeof value !== 'string' || !value || value.length > 200 || /[:\x00]/.test(value)) throw new Error('需要有效的相对文件路径。');
    const parts = value.replaceAll('\\', '/').split('/');
    if (parts.some(part => !part || part.startsWith('.') || !/^[\p{L}\p{N}_ .-]+$/u.test(part))) throw new Error('只允许练习目录内的相对路径，不允许隐藏文件或路径穿越。');
    if (!/\.(ts|js|cpp|cs|c|h|hpp|md|txt|json)$/i.test(value)) throw new Error('仅允许读取支持的文本文件类型。');
    if ((await lstat(root)).isSymbolicLink()) throw new Error('练习目录不能是符号链接。');
    const canonicalRoot = await realpath(root);
    let candidate = canonicalRoot;
    for (const part of parts) {
      candidate = path.join(candidate, part);
      if ((await lstat(candidate)).isSymbolicLink()) throw new Error('不允许读取符号链接或目录链接。');
    }
    const actual = await realpath(candidate);
    const relative = path.relative(canonicalRoot, actual);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('文件必须位于练习目录内。');
    const handle = await open(actual, 'r');
    try {
      if (!(await handle.stat()).isFile()) throw new Error('路径必须指向普通文件。');
      // 有界读取：避免把任意大的工具输出塞进上下文。
      const buffer = Buffer.alloc(16385);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      if (bytesRead > 16384) throw new Error('文件超过 16 KiB，请使用较小的练习文件。');
      const content = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, bytesRead));
      return { ok: true, path: parts.join('/'), content };
    } finally { await handle.close(); }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    const message = code ? (code === 'ENOENT' ? '练习文件不存在。' : '无法读取练习文件。')
      : error instanceof TypeError ? '文件必须是 UTF-8 文本。'
      : error instanceof Error ? error.message : '读取失败。';
    return { ok: false, error: message };
  }
}

export const listFilesTool: FunctionTool = {
  type: 'function', name: 'list_files',
  description: '列出 practice/ 内可读取的文本文件相对路径，不读取内容。无需参数。',
  parameters: { type: 'object', properties: {}, additionalProperties: false }, strict: true,
};

export async function listPracticeFiles(root = practiceRoot): Promise<ToolTrace['result']> {
  try {
    if ((await lstat(root)).isSymbolicLink()) return { ok: false, error: '练习目录不能是符号链接。' };
    const canonicalRoot = await realpath(root);
    const files: string[] = [];
    let visited = 0, truncated = false;
    async function visit(directory: string, depth: number) {
      if (depth > 4 || visited >= 100 || files.length >= 100) { truncated = true; return; }
      visited++;
      const actual = await realpath(directory);
      const relative = path.relative(canonicalRoot, actual);
      if (relative.startsWith('..') || path.isAbsolute(relative)) return;
      const entries = await readdir(actual, { withFileTypes: true });
      entries.sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        if (files.length >= 100) { truncated = true; break; }
        if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
        const full = path.join(actual, entry.name);
        if ((await lstat(full)).isSymbolicLink()) continue;
        if (entry.isDirectory()) await visit(full, depth + 1);
        else if (entry.isFile() && /\.(ts|js|cpp|cs|c|h|hpp|md|txt|json)$/i.test(entry.name)) files.push(path.relative(canonicalRoot, full).split(path.sep).join('/'));
      }
    }
    await visit(canonicalRoot, 0);
    return { ok: true, files, truncated };
  } catch { return { ok: false, error: '无法列出练习文件。' }; }
}

export async function executeReadCall(callId: string, name: string, args: string): Promise<ToolTrace> {
  let result: ToolTrace['result'];
  if (name !== 'read_file' && name !== 'list_files') result = { ok: false, error: '工具不存在。' };
  else {
    try {
      const parsed = JSON.parse(args);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
      if (name === 'list_files') {
        if (Object.keys(parsed).length) throw new Error();
        result = await listPracticeFiles();
      } else {
        if (Object.keys(parsed).some(key => key !== 'path')) throw new Error();
        result = await readPracticeFile(parsed.path);
      }
    } catch { result = { ok: false, error: '工具参数格式无效。read_file 仅允许 path，list_files 使用空对象。' }; }
  }
  return { callId, name, arguments: args, result };
}
