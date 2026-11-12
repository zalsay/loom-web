# DSH 接入架构

## 1. 组件边界

```text
共享孩子端 PWA
  |  站点设备 Cookie + 孩子声明 + WAV
  v
Farm Gateway（DSH Host 插件）
  |-- 设备认证与限流
  |-- 声纹验证模块
  |-- speechToText 调用
  |-- 转写确认凭证
  |-- 公平队列与租约
  |-- 安全活动策略
  |-- Agent 唤醒合并
  |
  +--> 唯一 Farm Agent Session
  |      |-- farm_claim
  |      |-- farm_answer
  |      `-- farm_observe
  |
  `--> 孩子 SSE / 长轮询
```

Gateway 和 Agent 是两个职责不同的部件。Gateway 不负责回答农业问题，Agent 不负责身份认证、音频处理或队列公平性。

## 2. 推荐插件拆分

| 部件                  | 类型                   | 职责                                                |
| --------------------- | ---------------------- | --------------------------------------------------- |
| `farm-gateway`        | Host plugin            | 设备认证、Web 路由、语音编排、队列和 Agent 生命周期 |
| `farm-voiceprint`     | Host 私有模块或 Worker | 声纹建档、embedding、相似度与质量判定               |
| `farm-agent-tools`    | Preset plugin          | 只向 Farm Lab preset 注册队列工具和系统提示         |
| `farm-child-pwa`      | 独立静态页面           | 共享设备录音、身份选择、转写确认和回答展示          |
| `farm-operator-panel` | Client plugin          | DSH 内的队列、设备、声纹建档和异常观察              |

孩子端不是 DSH Conversation View。`conversation.view` 适合 owner 的运维页面，不适合作为共享儿童入口。

## 3. DSH Service 映射

| 能力                       | DSH 接口                                      |
| -------------------------- | --------------------------------------------- |
| 持久化案卷、租约和声纹模板 | `ctx.storageDomain.open()`                    |
| 孩子端 Gateway HTTP/SSE    | `ctx.webServer.register()`                    |
| 本地 ASR                   | `ctx.speechToText.resolve()` / `transcribe()` |
| 唯一 Farm Agent            | `ctx.agents.create()` / `resume()`            |
| 唤醒 Agent                 | `Agent.followup()`                            |
| Agent 运行状态             | `agent/status`                                |
| Farm 工具                  | `ctx.tools.register()`，只在专用 preset 挂载  |
| Farm 提示词                | `ctx.systemPrompt.section()` / `context()`    |
| 运维 UI                    | `conversation.view` 或 `settings.plugins.tab` |

默认 ASR 可复用实验性的 SenseVoice 本地 Provider。`speechController` 的 Remote 接口属于 DSH owner 客户端，孩子端 PWA 不应直接调用；Gateway 在 Host 内调用 `speechToText`。

## 4. 唯一 Agent

Gateway 创建或恢复一个稳定的 Farm Session：

```text
Agent preset: farm-lab
Session: 固定且长期保留
```

Gateway 不按孩子创建 Agent，也不使用 Agent Teams。入队时只发送不包含孩子原文的唤醒消息：

```js
agent.followup({
  content: [{ type: 'text', text: '处理农场网关队列。' }],
  source: { kind: 'farm-gateway' },
});
```

Agent 随后调用 `farm_claim` 获取带租约的结构化案卷。孩子原文只能作为工具结果中的不可信数据出现，不能拼进 Gateway 的唤醒提示。

## 5. 队列泵

`src/agent-waker.js` 采用合并唤醒：

- Agent 空闲：立即请求一次处理。
- Agent 正在运行：只记录 `pending`，不再叠加 followup。
- Agent 从 running 回到 idle：如果仍有 pending 或队列非空，再唤醒一次。
- 入队可做 3～5 秒 debounce，使一批语音问题合并到一个 turn。

不要轮询 `agent/status`，应监听事件。单 turn 内可用 `farm_claim` 循环领取，直到空队列或达到批次上限。

## 6. 持久化建议

```text
children      childId, displayCode, active, deviceBinding
plots         plotId, childId, gridLabel
cases         caseId, childId, question, status, lease, answer, observations
voiceProfiles childId, embeddings, modelVersion, threshold, consentVersion
challenges    challengeId, deviceSessionId, childId, phrase, expiresAt
activities    activityId, title, mode, limits, version
```

当前 DSH storage domain 没有跨表事务。`cases` 应是单条聚合记录，领取、回答和观察都只更新对应 case；不要设计成问题、答案和观察必须同时写入的跨表事务。

## 7. 安全边界

- Gateway 使用自己的设备 Cookie，不把 DSH owner Cookie 当孩子身份。
- 反向代理只向孩子网络公开 `/farm-gateway/*` 和 `/farm-child/*`。
- 孩子文本和转写都是不可信输入。
- Agent 无 shell、文件编辑、设备控制或任意 Web 访问能力。
- Agent 只能引用预置活动目录。
- 紧急输入绕过普通队列并走固定安全响应。
- 原始音频不进入 Session event 或 attachment，默认完成 ASR/声纹处理后丢弃。
