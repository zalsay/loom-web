# DSH Farm Lab Service

本目录用于落盘“农场 AI-lab”在 DeepSeek Harness 中的服务端设计、可测试核心模块和后续 DSH 适配代码。

当前状态：**核心模块与文档，尚未安装为 DSH bundle，也未接入真实 ASR、声纹模型或生产存储。**

## 范围

目标链路：

```text
共享孩子端 PWA
  -> 设备会话
  -> 声明孩子身份
  -> 录音质量检查
  -> 声纹验证
  -> DSH speechToText / SenseVoice 转写
  -> 孩子确认转写
  -> Farm Gateway 入队
  -> 唯一 Farm Agent 自主处理
  -> 安全策略检查
  -> 对应孩子读取回答
```

本目录第一版提供：

- 公平队列、问题租约、幂等领取和过期重排
- 声纹模板注册、1:1 验证和 1:N 候选判定
- ASR 前置音频质量规则
- 预先允许的活动目录和确定性安全兜底
- Gateway 的“声纹 + ASR + 确认 + 入队 + 发布”状态机
- Agent 唤醒合并器
- 上述模块的 Node 单元测试
- DSH 接入、语音链路、安全隐私和 MVP 文档

## 目录

```text
dsh-service/
  docs/
    architecture.md
    voice-pipeline.md
    safety-and-privacy.md
    mvp.md
  src/
    agent-waker.js
    gateway.js
    index.js
    policy.js
    queue.js
    voice.js
  test/
    agent-waker.test.mjs
    gateway.test.mjs
    policy.test.mjs
    queue.test.mjs
    voice.test.mjs
```

## 测试

```sh
node --test dsh-service/test/*.test.mjs
```

## 下一步

1. 把 `src/gateway.js` 接到 DSH 自建 Web 路由和设备认证。
2. 用 `ctx.speechToText.resolve()` / `ctx.speechToText.transcribe()` 替换测试中的转写器接口。
3. 增加本地说话人 embedding Worker，并固定模型版本、校验和与阈值配置。
4. 用 `ctx.storageDomain` 持久化 children、plots、cases、voiceProfiles 和 challenges。
5. 通过唯一 Farm Agent 的 `followup()` 驱动队列，并仅在专用 preset 中挂载 `farm_claim`、`farm_answer`、`farm_observe` 工具。
6. 完成共享设备、声纹拒绝、防重放、并发公平性和跨孩子串号验收后，再安装 bundle。

接入边界见 [DSH 架构](docs/architecture.md)，语音链路见 [语音与声纹](docs/voice-pipeline.md)。
