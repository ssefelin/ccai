// 前后端共享协议；类型只在开发时检查，不能替代运行时输入校验。
export type Mode = 'demo' | 'openai';
export interface AskRequest { prompt: string }
export interface AskResponse {
  answer: string;
  mode: Mode;
  model: string;
  durationMs: number;
  usage: { inputTokens: number; outputTokens: number; totalTokens: number } | null;
}
export interface ConfigResponse { mode: Mode; model: string; ready: boolean }
