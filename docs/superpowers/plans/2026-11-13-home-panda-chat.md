# 首页熊猫与 Makers 对话实施计划

**目标：** 首页右下角使用现有 3D 熊猫，以跳跃、转圈和头顶欢迎语邀请对话；点击后在左上方打开半透明聊天窗。

**架构：** 沿用原生 HTML/CSS/JS、Three.js 熊猫模型、已有 SSE 解析器和签名访客会话。新增原生 `agents/guide/index.ts` 入口，经现有服务端的身份、来源、限流和请求大小检查后，访问 Makers 模型网关及平台会话存储。空间设计助手接口保持原有用途。

**约束：** 保留已有未提交修改；密钥仅在服务端；发送不自动重试；中断不能伪装成完整回答；主 Agent 审查；本次不提交、推送、部署或调用付费模型。

1. 增加服务端回归测试，覆盖流式输出、会话隔离、错误、取消、缺失配置和现有鉴权边界；先确认失败。
2. 实现 `server/home-chat.mjs`，在 `server/app.mjs` 复用既有边界；本地服务只提供开发用会话存储适配器，生产使用 `context.store`。同步环境变量及接入文档。
3. 增加浏览器交互测试，覆盖打开/关闭、流式聊天、停止/错误、窄屏、减少动画、沉浸场景与 WebGL 降级；先确认失败。
4. 实现首页聊天 UI 和独立熊猫渲染模块。复用现有模型与跳跃控制器，补齐生命周期、键盘焦点、移动端和欢迎语。
5. 执行聚焦 Node/浏览器测试、源码检查、构建、格式检查和截图；主 Agent 检查最终差异。平台鉴权、存储与网关真实联调需要目标 Makers 环境，单独说明验证范围。

官方依据：[Agents](https://pages.edgeone.ai/zh/document/agents-quick-start)、[会话存储](https://pages.edgeone.ai/zh/document/agents-conversation-storage)、[模型网关](https://pages.edgeone.ai/zh/document/models)。
