import type { ChatMessage } from '../shared/api.ts';

// 校验网络输入，只允许用户/助手交替，且最后一条必须是本次用户问题。
export function validateMessages(value: unknown): ChatMessage[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 41 || value.length % 2 === 0) {
    throw new Error('消息须以用户问题开始和结束，最多 41 条。请清空会话后重试。');
  }
  let total = 0;
  const messages = value.map((item, index): ChatMessage => {
    const expectedRole = index % 2 === 0 ? 'user' : 'assistant';
    if (!item || item.role !== expectedRole || typeof item.content !== 'string' ||
        !item.content.trim() || item.content.length > 12000) {
      throw new Error('消息必须由 user/assistant 交替组成，每条包含 1–12000 个字符。');
    }
    total += item.content.length;
    return { role: expectedRole, content: item.content };
  });
  if (total > 60000) throw new Error('上下文超过 60000 个字符，请关闭携带历史或清空会话。');
  return messages;
}
