import { randomUUID } from 'node:crypto';
import type { StopReason, TaskPolicy } from '../shared/api.ts';

export const defaultPolicy: TaskPolicy = { mode: 'confirm', maxRounds: 6, maxToolCalls: 8, maxTokens: 16000 };
export function validatePolicy(value: unknown): TaskPolicy {
  if (value === undefined) return { ...defaultPolicy };
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('策略必须是对象。');
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => !Object.hasOwn(defaultPolicy, key))) throw new Error('策略字段无效。');
  const result = { ...defaultPolicy, ...input } as TaskPolicy;
  if (!['read_only', 'confirm'].includes(result.mode)) throw new Error('权限模式无效。');
  for (const [name, low, high] of [['maxRounds', 1, 6], ['maxToolCalls', 1, 8], ['maxTokens', 100, 16000]] as const) {
    if (!Number.isInteger(result[name]) || result[name] < low || result[name] > high) throw new Error(`${name} 超出允许范围 ${low}–${high}。`);
  }
  return result;
}
export function toolAllowed(name: string, policy: TaskPolicy): boolean {
  return ['read_file', 'list_files'].includes(name) || policy.mode === 'confirm' && ['propose_edit', 'run_tests'].includes(name);
}
export class RuntimeFailure extends Error {
  reason: StopReason;
  constructor(reason: StopReason, message: string) { super(message); this.reason = reason; }
}
export async function bounded<T>(operation: Promise<T>, signal: AbortSignal, milliseconds: number): Promise<T> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const cancel = () => finish(() => reject(signal.reason));
    const finish = (action: () => void) => { clearTimeout(timer); signal.removeEventListener('abort', cancel); action(); };
    const timer = setTimeout(() => finish(() => reject(new RuntimeFailure('timeout', '读取工具超过等待上限。'))), milliseconds);
    signal.addEventListener('abort', cancel, { once: true });
    operation.then(value => finish(() => resolve(value)), error => finish(() => reject(error)));
  });
}
export class TaskManager {
  private active = new Map<string, AbortController>();
  start() {
    if (this.active.size >= 3) throw new Error('已有3个任务运行，请先取消或等待完成。');
    const id = randomUUID(), controller = new AbortController();
    this.active.set(id, controller);
    return { id, controller, dispose: () => this.active.delete(id) };
  }
  cancel(id: string) {
    const controller = this.active.get(id);
    if (!controller) return false;
    controller.abort(new RuntimeFailure('cancelled', '用户已取消任务。已完成的文件修改不会撤销。'));
    return true;
  }
}
export const tasks = new TaskManager();
