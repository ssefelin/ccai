import './style.css';
import type { AgentEvent, ApprovalProposal, AskRequest, AskResponse, ChatMessage, ConfigResponse } from '../shared/api.ts';
import { readEvents } from './stream.ts';
import { stopLabels } from '../shared/api.ts';

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
const toolsView = document.querySelector<HTMLElement>('#tool-traces')!;
const progressView = document.querySelector<HTMLElement>('#progress')!;
const approvalPanel = document.querySelector<HTMLElement>('#approval-panel')!;
const approvalTitle = document.querySelector<HTMLElement>('#approval-title')!;
const approvalDiff = document.querySelector<HTMLElement>('#approval-diff')!;
const approvalBefore = document.querySelector<HTMLElement>('#approval-before')!;
const approvalAfter = document.querySelector<HTMLElement>('#approval-after')!;
const approvalStatus = document.querySelector<HTMLElement>('#approval-status')!;
const approve = document.querySelector<HTMLButtonElement>('#approve')!;
const reject = document.querySelector<HTMLButtonElement>('#reject')!;
const verificationView = document.querySelector<HTMLElement>('#verification')!;
const cancel = document.querySelector<HTMLButtonElement>('#cancel')!;
const policyMode = document.querySelector<HTMLSelectElement>('#policy-mode')!;
const roundLimit = document.querySelector<HTMLInputElement>('#round-limit')!;
const toolLimit = document.querySelector<HTMLInputElement>('#tool-limit')!;
const tokenLimit = document.querySelector<HTMLInputElement>('#token-limit')!;
let taskId: string | undefined;
cancel.addEventListener('click', async () => {
  if (!taskId || cancel.disabled) return;
  cancel.disabled = true;
  status.textContent = '已请求取消，等待后端停止结果…';
  try {
    const response = await fetch(`/api/tasks/${taskId}/cancel`, { method: 'POST', signal: AbortSignal.timeout(10000) });
    if (!response.ok) status.textContent = '任务可能已结束，等待最终结果…';
  } catch {
    status.textContent = '取消请求未送达，尚不能确认后端停止，可重试。';
    cancel.disabled = false;
  }
});
let pendingApproval: ApprovalProposal | undefined;
function showApproval(proposal: ApprovalProposal) {
  pendingApproval = proposal;
  approvalPanel.hidden = false;
  approvalTitle.textContent = proposal.action === 'edit' ? `确认修改 ${proposal.path}` : '确认运行 counter 加法测试';
  approvalDiff.textContent = proposal.diff;
  approvalBefore.textContent = proposal.before || '（此操作无修改前内容）';
  approvalAfter.textContent = proposal.after || '（此操作无修改后内容）';
  approvalStatus.textContent = '请审阅后确认或拒绝。两分钟内未操作会停止此次任务。';
  approve.textContent = proposal.action === 'edit' ? '确认写入' : '确认运行测试';
  approve.disabled = reject.disabled = false;
  approvalPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
async function decide(approved: boolean) {
  if (!pendingApproval || approve.disabled) return;
  const id = pendingApproval.id;
  approve.disabled = reject.disabled = true;
  try {
    const response = await fetch(`/api/approvals/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ approved }), signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error('确认请求已过期或提交失败。');
    if (pendingApproval?.id === id) {
      approvalStatus.textContent = approved ? '已确认，后端继续执行。' : '已拒绝，任务将停止。';
      pendingApproval = undefined;
      approvalPanel.hidden = true;
    }
  } catch (error) {
    if (pendingApproval?.id === id) {
      approvalStatus.textContent = error instanceof Error ? error.message : '提交失败';
      approve.disabled = reject.disabled = false;
    }
  }
}
approve.addEventListener('click', () => { void decide(true); });
reject.addEventListener('click', () => { void decide(false); });
const progress: string[] = [];
const requests: AgentEvent[] = [];
const toolResults: AgentEvent[] = [];
function showProgress(event: AgentEvent) {
  let text = '';
  if (event.type === 'task_started') {
    taskId = event.taskId; cancel.disabled = false;
    text = `任务开始：${event.policy.mode === 'read_only' ? '只读' : '逐次确认'}，最多${event.policy.maxRounds}轮、${event.policy.maxToolCalls}次工具，累计用量阈值${event.policy.maxTokens}`;
  } else if (event.type === 'model_start') {
    text = `第 ${event.round} 轮：等待模型决定下一步`;
    requests.push(event);
    modelView.textContent = JSON.stringify(requests.map(item => item.type === 'model_start' ? item.request : null), null, 2);
  } else if (event.type === 'model_result') text = `第 ${event.round} 轮：模型提出 ${event.toolCalls} 个工具调用`;
  else if (event.type === 'tool_start') text = `第 ${event.round} 轮：执行 ${event.name}，参数 ${event.arguments}`;
  else if (event.type === 'tool_result') {
    text = `第 ${event.round} 轮：${event.trace.name} ${event.trace.result.ok ? 'passed' in event.trace.result ? event.trace.result.passed ? '测试通过' : '测试失败' : '执行成功' : '执行失败'}`;
    toolResults.push(event);
    toolsView.textContent = JSON.stringify(toolResults.map(item => item.type === 'tool_result' ? item.trace : null), null, 2);
  } else if (event.type === 'approval_required') {
    text = `第 ${event.round} 轮：等待你确认${event.proposal.action === 'edit' ? '修改' : '测试'}`;
    showApproval(event.proposal);
  } else text = `停止：${stopLabels[event.reason]}`;
  progress.push(text);
  progressView.textContent = progress.join('\n');
  status.textContent = text;
}
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
  toolsView.textContent = '尚未调用工具。';
  progress.length = requests.length = toolResults.length = 0;
  progressView.textContent = '尚未开始。';
  verificationView.textContent = '尚未运行测试。';
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
  const body: AskRequest = { messages: [...(includeHistory.checked ? messages : []), current], policy: {
    mode: policyMode.value as 'read_only' | 'confirm', maxRounds: Number(roundLimit.value), maxToolCalls: Number(toolLimit.value), maxTokens: Number(tokenLimit.value),
  } };
  requestView.textContent = JSON.stringify(body, null, 2);
  responseView.textContent = '等待响应…';
  modelView.textContent = '等待后端返回组装后的模型请求…';
  toolsView.textContent = '等待结果…';
  progress.length = requests.length = toolResults.length = 0;
  progressView.textContent = '任务已提交…';
  verificationView.textContent = '等待本次验证结果…';
  approvalPanel.hidden = true;
  answer.textContent = '等待回答…';
  metrics.textContent = '';
  status.textContent = '请求已发送，等待后端处理…';
  submit.disabled = true;
  clear.disabled = includeHistory.disabled = true;
  submit.textContent = '等待回答…';
  policyMode.disabled = roundLimit.disabled = toolLimit.disabled = tokenLimit.disabled = true;
  taskId = undefined; cancel.disabled = true;
  try {
    const response = await fetch('/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(615000),
    });
    if (!response.ok) {
      const data = await response.json();
      responseView.textContent = JSON.stringify(data, null, 2);
      throw new Error(data.error || '请求失败');
    }
    if (!response.body) throw new Error('浏览器未收到进度流。');
    let result: AskResponse | undefined;
    for await (const event of readEvents(response.body)) {
      if (event.type === 'result') result = event.result;
      else showProgress(event);
    }
    if (!result) throw new Error('连接已中断，未收到最终结果。');
    responseView.textContent = JSON.stringify(result, null, 2);
    modelView.textContent = JSON.stringify(result.modelRequests, null, 2);
    toolsView.textContent = result.toolTraces.length ? JSON.stringify(result.toolTraces, null, 2) : '本次模型直接回答，未调用工具。';
    // 只有成功的完整问答进入历史。失败时保留输入，便于重试。
    if (result.stopReason === 'completed') {
      messages.push(current, { role: 'assistant', content: result.answer });
      renderMessages();
      if (prompt.value.trim() === text) prompt.value = '';
    }
    answer.textContent = result.answer; // 以文本显示，避免把模型输出作为 HTML 执行。
    verificationView.textContent = result.verification === 'passed' ? '验证证据：固定加法测试通过。'
      : result.verification === 'failed' ? '验证证据：测试失败，尚未修复。'
      : result.verification === 'stale' ? '代码已修改，尚未完成新的测试验证。' : '本次未运行测试。';
    metrics.textContent = `模型：${result.model} · 后端耗时：${result.durationMs} ms · ` +
      (result.usage ? `输入 ${result.usage.inputTokens} / 输出 ${result.usage.outputTokens} / 总计 ${result.usage.totalTokens} tokens` : '演示模式，无模型 token 用量');
    status.textContent = `${stopLabels[result.stopReason]} · ${result.rounds} 轮模型请求 · ${result.toolTraces.length} 次工具执行`;
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : '请求失败，请重试';
    answer.textContent = '本次未获得回答。';
    // 保留已收到的实时轨迹，便于定位连接中断发生在哪一轮。
    if (responseView.textContent === '等待响应…') responseView.textContent = status.textContent;
  } finally {
    pendingApproval = undefined;
    approvalPanel.hidden = true;
    taskId = undefined; cancel.disabled = true;
    policyMode.disabled = roundLimit.disabled = toolLimit.disabled = tokenLimit.disabled = false;
    submit.disabled = false;
    clear.disabled = includeHistory.disabled = false;
    submit.textContent = '发送问题';
  }
});

void loadConfig();
renderMessages();
