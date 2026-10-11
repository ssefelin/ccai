import express from 'express';
import { fileURLToPath } from 'node:url';
import { askModel, getConfig } from './llm.ts';
import { validateMessages } from './context.ts';

const app = express();
const port = Number(process.env.PORT || 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT 必须是 1–65535 之间的整数');
app.use(express.json({ limit: '512kb' }));

app.get('/api/config', (_request, response) => { response.json(getConfig()); });

app.post('/api/ask', async (request, response) => {
  // HTTP 输入来自外部，不能因为 TypeScript 有类型就信任它。
  let messages;
  try {
    messages = validateMessages(request.body?.messages);
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : '消息格式无效。' });
    return;
  }
  // 浏览器选择 SSE：一个 POST 请求逐条接收进度；普通 API 调用仍可取 JSON。
  if (request.get('Accept')?.includes('text/event-stream')) {
    response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    response.setHeader('Cache-Control', 'no-cache');
    response.setHeader('X-Accel-Buffering', 'no');
    response.flushHeaders();
    const send = (data: unknown) => {
      if (!response.destroyed && !response.writableEnded) response.write(`data: ${JSON.stringify(data)}\n\n`);
    };
    const heartbeat = setInterval(() => {
      if (!response.destroyed && !response.writableEnded) response.write(': ping\n\n');
    }, 15000);
    try {
      const result = await askModel(messages, send);
      send({ type: 'result', result });
    } finally {
      clearInterval(heartbeat);
      response.end();
    }
    return;
  }
  try {
    response.json(await askModel(messages));
  } catch (error) {
    // 不把第三方错误详情或密钥输出到页面。
    const config = getConfig();
    const message = !config.ready ? `请在 .env 配置 ${config.mode === 'deepseek' ? 'DEEPSEEK_API_KEY' : 'OPENAI_API_KEY 和 OPENAI_MODEL'}，然后重启应用。`
      : error instanceof Error && error.message.startsWith('模型') ? error.message
      : '模型请求失败，请检查后端网络、API 密钥、模型访问权限或额度。';
    response.status(502).json({ error: message });
  }
});
app.use('/api', (_request, response) => { response.status(404).json({ error: '接口不存在。' }); });

if (process.argv.includes('--production')) {
  app.use(express.static(fileURLToPath(new URL('../dist/', import.meta.url))));
} else {
  // Vite 负责把浏览器 TypeScript 转为 JavaScript，并在开发时刷新页面。
  const { createServer } = await import('vite');
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'spa' });
  app.use(vite.middlewares);
}

const errorHandler: express.ErrorRequestHandler = (error, _request, response, _next) => {
  const tooLarge = error?.type === 'entity.too.large';
  response.status(tooLarge ? 413 : 400).json({ error: tooLarge ? '请求内容太大。' : '请求格式无效，请发送 JSON。' });
};
app.use(errorHandler);
app.listen(port, '127.0.0.1', () => {
  console.log(`Agent Web Lab: http://127.0.0.1:${port} (${getConfig().mode})`);
});
