# 农场赛博鸭：Pad → 场地桥 → DuckClaw

此目录是 Loom 原创的单工位协议适配原型，不包含厂商固件、动作程序或模型权重。默认仅运行于本机模拟环境。目标为 FlashDuck 的 **DuckClaw 版**，不是语音互动版，也不将 Pad 上的 ESP-Claw 与鸭子上的 DuckClaw 当作同一套软件。

若需要 Pad Agent **直接控制脖子**且不依赖鸭端模型，使用独立的[直控专用固件、网关与 Pad 工具](../flashduck-direct/README.md)；本目录继续适配原厂聊天固件，不会自动切换控制模式。

## 上游、协议与授权

- [官方 FlashDuck 指南](https://shanmaotech.cn/flashduck/)：二选一固件；DuckClaw **CC BY-NC-SA 4.0**，语音版另行授权。**收费 AILab 或商业农场使用 DuckClaw 前，请取得权利人许可或另选许可相容的固件。** 本适配器独立实现通信不等于厂商授予商业使用权。
- 核验的 [DuckClaw WS 源码](https://github.com/FlashCat-Jordan/Flashduck/blob/9d4316e3f1f7ef693be4d62f4b1aa020a3daedf4/firmware/duckclaw/main/gateway/ws_server.c)、[内部动作工具](https://github.com/FlashCat-Jordan/Flashduck/blob/9d4316e3f1f7ef693be4d62f4b1aa020a3daedf4/firmware/duckclaw/main/tools/tool_otto.c)、[Agent 循环与自动情绪动作](https://github.com/FlashCat-Jordan/Flashduck/blob/9d4316e3f1f7ef693be4d62f4b1aa020a3daedf4/firmware/duckclaw/main/agent/agent_loop.c)。桥作客户端连接固定 LAN IP 的 `ws://<duck>:18789/ws`，发送 `{type:"message",chat_id,content}`；收到匹配 chat_id 的 `response` 才算鸭端回复，`token` 不是确认。注册的自有 WebSocket 不承载小智 MCP、设备动作 RPC 或物理 ACK。每个请求使用独立短 chat_id，不夹带孩子原话、身份、记忆或其他私有内容。

## Pad 或 Agent 如何调用

模型工具描述见 `duck_action.tool.json`。PadUI 上手动操作也可以使用同一个业务接口；工具本身不依赖 UI。受信宿主注入工位 `duckId`、服务地址、短时会话凭证和每个意图一个稳定 `requestId`；模型只提议 `action`。`../flashduck-sim/client.lua` 是可测试的 Lua 客户端；不是已刷机或已热注册的工具。生产固件须在原生绑定里保管凭证、校验工位/人员授权，不能让动态脚本或模型自由指定 URL、访问令牌或生成任意动作文本。

**POST** `/v1/duck/commands`，`Authorization: Bearer <station token>`，`Content-Type: application/json`，仅接受以下三个字段：

```json
{"duckId":"duck-1","requestId":"intent-0001","action":"look_left"}
```

- `look_left` / `look_right`：请求原地转头一次；`walk_step`：请求向前一步，网关默认拒绝，需额外开关；`stop`：请求后续回中，**不是急停**，不会抢占执行中指令。没有跳跃、连续步态、自由文本或原始舵机角度入口。
- `202 accepted` = 桥已登记，未证明送达。**GET** `/v1/duck/commands/intent-0001` 使用相同授权读取；`replied` = 鸭端 Agent 有最终文本（包括拒绝或报错），`failed` = 建连前失败，`unknown` = 发送后不能确定。`motionVerified` 始终为 false。不要自动补发动作。
- 同一凭证仅能访问为一个工位配置的一只鸭。重复 ID 与同内容返回已有记录；同 ID 不同内容 409；忙碌 409，冷却中 429。结果不明时锁定后续动作，须成人检查后手动重新开场。不支持断电后的命令去重：重启后不能重放上一场的命令。记录达到会话上限后拒绝新指令。没有实际运动反馈或物理优先停机能力，不作为自主导航、安全联锁或无人值守控制器。

## 本机运行（未改动公网 DSH）

需要 Node 22+、本项目锁定的 Playwright 开发依赖。运行：

```sh
export LOOM_DUCK_TOKEN="$(openssl rand -hex 32)"
node dsh-service/flashduck/serve.mjs
# 另一终端使用同一临时令牌；GET 只读，不会重发动作。
curl -sS http://127.0.0.1:8795/v1/duck/commands -H "Authorization: Bearer $LOOM_DUCK_TOKEN" -H 'Content-Type: application/json' -d '{"duckId":"duck-1","requestId":"try-1","action":"look_left"}'
curl -sS http://127.0.0.1:8795/v1/duck/commands/try-1 -H "Authorization: Bearer $LOOM_DUCK_TOKEN"
```

默认后端是只回文本的本机 WebSocket 替身；不发现或访问真实设备。桥只监听 loopback；现场 Pad 需在场地可信网络内经 HTTPS/设备认证代理连接，不能把桌面模拟令牌放入实际脚本。真实硬件适配通过 `DUCK_MODE=hardware`、`DUCK_ARM=supervised`、`DUCK_LAN_IP` 加固定私网地址显式开启；这不是配网、认证或位置证明。只对合法授权、隔离的测试台开放。DuckClaw 需自行配置模型，不要暴露其原厂聊天或配置端口。停止服务或断开 WebSocket 均不能停止鸭端已收到的动作。首次机械测试需成人可立即切断动力、封闭空场、先检查舵机校准。即使网关禁用走路，上游模型和情绪系统仍可能产生未请求的动作；需确定性约束或物理完成 ACK 的场合，先在固件执行器侧实现动作边界和独立急停。

## 验证

`node --test dsh-service/test/*.test.mjs` 包含 Pad HTTP → 桥 → 真实回环 WebSocket → 鸭端协议替身的测试和错误路径。乐鑫官方 Web 模拟器验证位于 `../flashduck-sim/`；其 Lua 能力执行与浏览器网络模拟的边界应与 ESP32-S3 的机械实测分开报告。
