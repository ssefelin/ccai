import './style.css';
import type { AskRequest, AskResponse, ChatMessage, ConfigResponse } from '../shared/api.ts';

// DOM 是浏览器暴露的页面对象；这些引用相当于拿到页面控件的句柄。
const form = document.querySelector<HTMLFormElement>('#question-form')!;
const prompt = document.querySelector<HTMLTextAreaElement>('#prompt')!;
const submit = document.querySelector<HTMLButtonElement>('#submit')!;
const status = document.querySelector<HTMLElement>('#status')!;
const answer = document.querySelector<HTMLElement>('#answer')!;
const metrics = document.querySelector<HTMLElement>('#metrics')!;
const requestView = document.querySelector<HTMLElement>('#request')!;
const responseView = document.querySelector<HTMLElement>('#response')!;
const modelView = document.querySelector<HTMLElement>('#model-request')!;
const clear = document.querySelector<HTMLButtonElement>('#clear')!;
const includeHistory = document.querySelector<HTMLInputElement>('#include-history')!;
const messageList = document.querySelector<HTMLElement>('#messages')!;
const sessionView = document.querySelector<HTMLElement>('#session')!;

// 状态归当前页面所有。会话 ID 只是观察用标签，不是后端存储键或身份凭证。
let sessionId = crypto.randomUUID();
let messages: ChatMessage[] = [];
function renderMessages() {
  sessionView.textContent = `会话 ${sessionId} · 已完成 ${messages.length / 2} 轮`;
  messageList.replaceChildren();
  if (!messages.length) messageList.textContent = '还没有消息。';
  for (const message of messages) {
    const article = document.createElement('article');
    article.className = `message ${message.role}`;
    const label = document.createElement('strong');
    label.textContent = message.role === 'user' ? '你' : '助手';
    const content = document.createElement('pre');
    content.textContent = message.content;
    article.append(label, content);
    messageList.append(article);
  }
}
clear.addEventListener('click', () => {
  if (submit.disabled) return;
  messages = [];
  sessionId = crypto.randomUUID();
  renderMessages();
  prompt.value = '';
  answer.textContent = '回答会显示在这里。';
  metrics.textContent = '';
  requestView.textContent = responseView.textContent = modelView.textContent = '尚未发送';
  status.textContent = '会话已清空。下一次请求没有历史消息。';
});

async function loadConfig() {
  const mode = document.querySelector<HTMLElement>('#mode')!;
  try {
    const response = await fetch('/api/config');
    if (!response.ok) throw new Error('后端暂时不可用');
    const config: ConfigResponse = await response.json();
    mode.textContent = config.mode === 'demo'
      ? '演示模式：返回固定演示内容，不调用模型、不产生模型费用。'
      : `模型模式：${config.model || '未配置'}${config.ready ? '' : '，请先配置 .env 并重启后端'}`;
  } catch {
    mode.textContent = '无法连接后端，请确认应用已启动。';
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault(); // 阻止表单默认刷新页面，由我们发送 HTTP 请求。
  const text = prompt.value.trim();
  if (!text || submit.disabled) return;
  const current: ChatMessage = { role: 'user', content: text };
  const body: AskRequest = { messages: [...(includeHistory.checked ? messages : []), current] };
  requestView.textContent = JSON.stringify(body, null, 2);
  responseView.textContent = '等待响应…';
  modelView.textContent = '等待后端返回组装后的模型请求…';
  answer.textContent = '等待回答…';
  metrics.textContent = '';
  status.textContent = '请求已发送，等待后端处理…';
  submit.disabled = true;
  clear.disabled = includeHistory.disabled = true;
  submit.textContent = '等待回答…';
  try {
    const response = await fetch('/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(70000),
    });
    const data = await response.json();
    responseView.textContent = JSON.stringify(data, null, 2);
    if (!response.ok) throw new Error(data.error || '请求失败');
    const result = data as AskResponse;
    modelView.textContent = JSON.stringify(result.modelRequest, null, 2);
    // 只有成功的完整问答进入历史。失败时保留输入，便于重试。
    messages.push(current, { role: 'assistant', content: result.answer });
    renderMessages();
    if (prompt.value.trim() === text) prompt.value = '';
    answer.textContent = result.answer; // 以文本显示，避免把模型输出作为 HTML 执行。
    metrics.textContent = `模型：${result.model} · 后端耗时：${result.durationMs} ms · ` +
      (result.usage ? `输入 ${result.usage.inputTokens} / 输出 ${result.usage.outputTokens} / 总计 ${result.usage.totalTokens} tokens` : '演示模式，无模型 token 用量');
    status.textContent = `完成。本次发送 ${body.messages.length} 条消息；可切换历史开关比较上下文。`;
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : '请求失败，请重试';
    answer.textContent = '本次未获得回答。';
    modelView.textContent = '请求失败，未获得后端确认的模型输入。';
    if (responseView.textContent === '等待响应…') responseView.textContent = status.textContent;
  } finally {
    submit.disabled = false;
    clear.disabled = includeHistory.disabled = false;
    submit.textContent = '发送问题';
  }
});

void loadConfig();
renderMessages();
