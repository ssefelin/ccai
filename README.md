# ccai
ccai coding agent i

## 学习入口

当前进入第 2 步：多轮消息上下文。

- [八步学习路线](./LEARNING_ROADMAP.md)
- [第一步思考题（对应之前的独立问答版本）](./STEP_01_QUESTIONS.md)
- [第二步讲解、实验与思考题](./STEP_02_CONTEXT.md)

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

浏览器内存中的历史 → 选择携带历史或只发送新问题 → POST /api/ask → 后端校验角色、顺序和大小 → 添加固定指令 → 单次模型调用 → 成功问答加入页面历史。

当前接口使用 `{ messages: [{ role, content }] }`，取代第一步的 `{ prompt }`。会话 ID 只作页面标签；后端不保存会话，刷新会清空。不包含工具、Agent Loop 或持久化存储。
