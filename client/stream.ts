import type { StreamEvent } from '../shared/api.ts';

// HTTP 数据块可能切在 JSON 或中文字符中间，不能把每块直接当成一条事件。
export async function* readEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<StreamEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      pending += done ? decoder.decode() : decoder.decode(value, { stream: true });
      let boundary;
      while ((boundary = pending.indexOf('\n\n')) >= 0) {
        const frame = pending.slice(0, boundary);
        pending = pending.slice(boundary + 2);
        const data = frame.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
        if (data) yield JSON.parse(data) as StreamEvent;
      }
      if (done) break;
    }
    if (pending.trim()) throw new Error('进度流未完整结束，请重试。');
  } finally { reader.releaseLock(); }
}
