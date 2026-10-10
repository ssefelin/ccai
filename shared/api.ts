// 前后端共享协议；类型只在开发时检查，不能替代运行时输入校验。
export type Mode = 'demo' | 'openai' | 'deepseek';
export interface ChatMessage { role: 'user' | 'assistant'; content: string }
export interface AskRequest { messages: ChatMessage[] }
export interface ModelRequest {
  model: string;
  instructions: string;
  input: ChatMessage[];
  max_output_tokens: number;
  store: false;
  reasoning?: { effort: 'none' };
}
export interface AskResponse {
  answer: string;
  mode: Mode;
  model: string;
  durationMs: number;
  usage: { inputTokens: number; outputTokens: number; totalTokens: number } | null;
  modelRequest: ModelRequest;
}
export interface ConfigResponse { mode: Mode; model: string; ready: boolean }
