import OpenAI from 'openai';
import type { AskResponse, ConfigResponse, Mode } from '../shared/api.ts';

export function getConfig(): ConfigResponse {
  const mode: Mode = process.env.LLM_MODE === 'openai' ? 'openai' : 'demo';
  return {
    mode,
    model: mode === 'demo' ? 'demo（固定响应）' : process.env.OPENAI_MODEL || '',
    ready: mode === 'demo' || Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_MODEL),
  };
}

export async function askModel(prompt: string): Promise<AskResponse> {
  const started = performance.now();
  const config = getConfig();
  if (config.mode === 'demo') {
    return {
      answer: `这是固定的演示响应，并非 LLM 生成的答案。\n\n后端收到的问题：\n${prompt}\n\n你已经走通：页面提交 → HTTP POST /api/ask → 后端处理 → JSON 响应 → 页面更新。\n配置 .env 中的模型模式、API 密钥和模型名称后，可获得真实模型回答。`,
      mode: 'demo', model: config.model, durationMs: Math.round(performance.now() - started), usage: null,
    };
  }
  if (!config.ready) throw new Error('请在 .env 配置 OPENAI_API_KEY 和 OPENAI_MODEL，然后重启应用。');
  // 密钥只在 Node.js 后端读取，绝不传给浏览器。
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 60000, maxRetries: 0 });
  // 第一步每次只发送本次问题；没有历史、工具或循环。
  const response = await client.responses.create({
    model: config.model,
    instructions: '你是一位耐心的软件开发老师。用中文清楚解释问题；用户有 C++ 项目经验，正在学习 Web 和 Agent 原理。',
    input: prompt,
    max_output_tokens: 2048,
    store: false,
  });
  if (response.status !== 'completed') throw new Error('模型未完成回答，可能达到输出上限，请缩短问题后重试。');
  if (!response.output_text) throw new Error('模型没有返回文本回答，请重试。');
  return {
    answer: response.output_text, mode: config.mode, model: response.model,
    durationMs: Math.round(performance.now() - started),
    usage: response.usage ? {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      totalTokens: response.usage.total_tokens,
    } : null,
  };
}
