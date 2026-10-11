# ccai
ccai coding agent i

## 学习入口

当前进入第 4 步：Agent Loop。

- [八步学习路线](./LEARNING_ROADMAP.md)
- [第一步思考题（对应之前的独立问答版本）](./STEP_01_QUESTIONS.md)
- [第二步讲解、实验与思考题](./STEP_02_CONTEXT.md)
- [第三步工具调用讲解、实验与思考题](./STEP_03_TOOLS.md)
- [第四步循环、SSE 与思考题](./STEP_04_LOOP.md)

### 启动与验证

需要 Node.js 24+。在根目录执行 `npm install`、`npm run dev`，打开 http://127.0.0.1:3000 。也可以使用 pnpm 对应命令。

默认演示模式不调用模型。真实模式按 `.env.example` 创建本地 `.env`，设置 `LLM_MODE=openai`、`OPENAI_API_KEY` 和账号可访问的 `OPENAI_MODEL`，重启后端。密钥只保存在后端，真实调用可能产生费用。

### 使用 DeepSeek（无需新增依赖）

在根目录创建或编辑 `.env`，只需设置：

```dotenv
LLM_MODE=deepseek
DEEPSEEK_API_KEY=填写你的DeepSeek密钥
DEEPSEEK_MODEL=deepseek-flash
```

使用已有 Node.js 直接启动，并加载配置：

```powershell
cd D:\dev\ccai
node --env-file-if-exists=.env --experimental-strip-types server/index.ts
```

打开 http://127.0.0.1:3000 。配置变更后需重启；按 Ctrl+C 停止。若终端之前手动设置过 `LLM_MODE`，该环境变量会优先于 `.env`，可在新终端启动或移除对应终端变量。

默认服务地址为 `https://api.deepseek.com`，可通过 `DEEPSEEK_BASE_URL` 覆盖。模型名称按当前官方文档设置，也可改为账号可访问的模型。原有 `demo` 和 `openai` 模式保留。

复用现有 SDK 的 Responses 调用、消息数组和用量展示，DeepSeek 模式显式关闭思考模式以适应当前输出预算。[DeepSeek 官方 Responses 文档](https://api-docs.deepseek.com/api/create-response/)。

`npm run check` 检查类型，`npm test` 运行离线上下文测试（仅模拟模型服务），`npm run build` 构建页面，`npm start` 提供构建后的应用。前端改动通常自动刷新，后端改动需重启。

### 当前数据流

浏览器历史 → POST /api/ask → 校验上下文 → 模型决定行动 → 列文件/读文件 → 工具结果加入上下文 → 下一轮模型请求 → 完成、达到上限或失败。

当前接口使用 `{ messages: [{ role, content }] }`。`modelRequests` 展示模型请求，`toolTraces` 展示工具参数与结果，`events` 是进度记录；`rounds` 和 `stopReason` 表示轮数与停止原因。`modelRequest` 保留第一次请求。会话只在页面内存中，刷新会清空。最多 6 轮、总等待 3 分钟；没有写文件、执行测试或持久任务。

页面以 SSE 实时接收任务事件；普通调用仍返回 JSON。流开始后的错误由最终结果表达，即使 HTTP 状态为 200，也需要检查 stopReason。

练习提示：发送“找出练习目录里处理名称的函数并解释”。你可以把小型练习文本文件放在 practice/，不需要粘贴内容。不要在练习目录放密钥或私密文件。
