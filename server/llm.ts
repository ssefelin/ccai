import OpenAI from 'openai';
import type { AskResponse, ChatMessage, ConfigResponse, Mode, ModelRequest } from '../shared/api.ts';

export function getConfig(): ConfigResponse {
  const mode: Mode = process.env.LLM_MODE === 'deepseek' ? 'deepseek'
    : process.env.LLM_MODE === 'openai' ? 'openai' : 'demo';
  const model = mode === 'deepseek' ? process.env.DEEPSEEK_MODEL || 'deepseek-flash'
    : process.env.OPENAI_MODEL || '';
  const ready = mode === 'deepseek' ? Boolean(process.env.DEEPSEEK_API_KEY)
    : Boolean(process.env.OPENAI_API_KEY && model);
  return {
    mode,
    model: mode === 'demo' ? 'demo（固定响应）' : model,
    ready: mode === 'demo' || ready,
  };
}

export async function askModel(messages: ChatMessage[]): Promise<AskResponse> {
  const started = performance.now();
  const config = getConfig();
  // 展示与发送使用同一个对象，便于核对真实上下文；不包含密钥。
  const modelRequest: ModelRequest = {
    model: config.model,
    instructions: '你是一位耐心的软件开发老师。用中文清楚解释问题；用户有 C++ 项目经验，正在学习 Web 和 Agent 原理。',
    input: messages,
    max_output_tokens: 2048,
    store: false,
    // 当前教学只需要文本回答；DeepSeek 关闭思考模式，避免推理耗尽输出预算。
    ...(config.mode === 'deepseek' ? { reasoning: { effort: 'none' as const } } : {}),
  };
  if (config.mode === 'demo') {
    return {
      answer: `这是程序生成的演示响应，不是模型回答。\n本次收到 ${messages.length} 条消息（含 ${(messages.length - 1) / 2} 轮历史）。\n最新问题：${messages.at(-1)!.content.slice(0, 300)}\n首条用户消息：${messages[0].content.slice(0, 300)}\n可展开下方模型请求查看完整上下文。演示仅证明消息传递，不能证明模型理解了历史。`,
      mode: 'demo', model: config.model, durationMs: Math.round(performance.now() - started), usage: null, modelRequest,
    };
  }
  if (!config.ready) throw new Error('请在 .env 配置当前模型服务的密钥和模型名称，然后重启应用。');
  // 密钥只在 Node.js 后端读取，绝不传给浏览器。
  const client = new OpenAI({
    apiKey: config.mode === 'deepseek' ? process.env.DEEPSEEK_API_KEY : process.env.OPENAI_API_KEY,
    ...(config.mode === 'deepseek' ? { baseURL: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com' } : {}),
    timeout: 60000, maxRetries: 0,
  });
  // 每次显式发送选定历史，不使用服务端会话或 previous_response_id。
  const response = await client.responses.create(modelRequest);
  if (response.status !== 'completed') throw new Error('模型未完成回答，可能达到输出上限，请缩短问题后重试。');
  if (!response.output_text) throw new Error('模型没有返回文本回答，请重试。');
  return {
    answer: response.output_text, mode: config.mode, model: response.model,
    durationMs: Math.round(performance.now() - started),
    modelRequest,
    usage: response.usage ? {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      totalTokens: response.usage.total_tokens,
    } : null,
  };
}
