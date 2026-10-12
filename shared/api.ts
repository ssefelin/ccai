// 前后端共享协议；类型只在开发时检查，不能替代运行时输入校验。
export type Mode = 'demo' | 'openai' | 'deepseek';
export interface ChatMessage { role: 'user' | 'assistant'; content: string }
export interface AskRequest { messages: ChatMessage[] }
import type { FunctionTool, ResponseInputItem } from 'openai/resources/responses/responses';
export interface ModelRequest {
  model: string;
  instructions: string;
  input: ChatMessage[] | ResponseInputItem[];
  max_output_tokens: number;
  store: false;
  reasoning?: { effort: 'none' };
  tools?: FunctionTool[];
  tool_choice?: 'auto' | 'none';
  parallel_tool_calls?: false;
}
export interface ToolTrace {
  callId: string;
  name: string;
  arguments: string;
  result: { ok: true; path: string; content: string } | { ok: true; files: string[]; truncated: boolean }
    | { ok: true; path: string; applied: true }
    | { ok: true; suite: string; passed: boolean; exitCode: number | null; output: string }
    | { ok: false; error: string; approvalDenied?: boolean };
}
export interface ApprovalProposal {
  id: string;
  action: 'edit' | 'test';
  path: string;
  before: string;
  after: string;
  diff: string;
}
export type StopReason = 'completed' | 'max_rounds' | 'error';
export type AgentEvent =
  | { type: 'model_start'; round: number; request: ModelRequest }
  | { type: 'model_result'; round: number; toolCalls: number }
  | { type: 'tool_start'; round: number; name: string; arguments: string }
  | { type: 'tool_result'; round: number; trace: ToolTrace }
  | { type: 'approval_required'; round: number; proposal: ApprovalProposal }
  | { type: 'stop'; round: number; reason: StopReason; message: string };
export type StreamEvent = AgentEvent | { type: 'result'; result: AskResponse };
export interface AskResponse {
  answer: string;
  mode: Mode;
  model: string;
  durationMs: number;
  usage: { inputTokens: number; outputTokens: number; totalTokens: number } | null;
  modelRequest: ModelRequest;
  modelRequests: ModelRequest[];
  toolTraces: ToolTrace[];
  events: AgentEvent[];
  rounds: number;
  stopReason: StopReason;
  verification: 'not_run' | 'passed' | 'failed' | 'stale';
}
export interface ConfigResponse { mode: Mode; model: string; ready: boolean }
