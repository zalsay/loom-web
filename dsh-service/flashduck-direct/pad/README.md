# Pad：把 `duck_look` 作为工具返回给模型

这是宿主适配代码，不是按钮界面，也不是放到 Pad 文件系统就会自动注册的插件。把 [函数描述](./duck_look.json) 注册到**受信任的** Pad 原生工具注册表/模型宿主，将 `duck_look` 分发给 [trusted_host.lua](./trusted_host.lua)。模型只有 `direction: left | slight_left | center | slight_right | right` 一项输入，没有供其选择的 URL、凭据、设备 ID、角度或持续时间。Lua 端再次校验，不依赖模型遵守 schema。

```lua
-- 启动时：模块和配置由宿主安装；token 不进入模型上下文、launcher 参数、日志或公开 App 包。
local client = require('duck_look').bind(FIXED_BRIDGE_HTTPS, PAD_BEARER, BOUND_DUCK_ID)
local host = require('trusted_host').bind(client)
-- 处理模型工具调用：arguments 是 JSON 字符串或已解析对象。ctx 不来自模型。
-- dispatch_id 是宿主为这次调用持久化的唯一 ID（1–64 位字母数字、_、-）。
local ctx = {requestId=dispatch_id}
local result = host.invoke('duck_look', arguments, ctx)
-- 把 result 作为这次 tool_call 的结构化结果写回对话；若 SDK 要求字符串则 json.encode(result)。
-- accepted/未知送达时由宿主限次查询；复用原 args 和 ctx，不再 POST：
-- local current = host.poll('duck_look', arguments, ctx)
```

- [Lua 客户端](./duck_look.lua) 使用官方 `capability.call('http_request', ...)`，只请求绑定网关的 `POST /v1/duck/look` 和 `GET /v1/duck/look/:requestId`。配置能力 allowlist 时仅开放该 HTTPS 网关；明文 HTTP 仅接受显式本机回环测试地址。凭据由宿主管理，浏览器验证只使用占位符。
- 成功返回例如 `{"ok":true,"duckId":"duck-demo","requestId":"example-1","direction":"left","status":"command_finished","mode":"simulation","motionVerified":false}`。`ok:true` 表示收到可解析且与原请求绑定的协议回包；动作失败会保留 `status:"failed"`。`accepted` 只代表受理，`command_finished` 只代表控制指令报告结束，不代表已观测到所需姿态。`center` 是正常回中命令，不是硬实时急停。
- 校验/HTTP/传输错误返回 `ok:false` 和机器可读 `error`。不返回未筛选的设备字符串或 token。对超时、`unknown`、回包损坏等，不自动重发，也不要生成新 ID 重试。宿主应将工具调用 ID 与原参数、requestId 绑定，重复投递走查询而非启动新动作。

可选扫描工具：`trusted_host.bind(client, require('duck_scan').bind(client, scanHost))`。单次巡视必须由受信宿主提供跨控制者的独占许可、意图去重、持续检查授权、单调时钟和 worker 等待；这些不是 Lua 工具自动获得的系统权限。取消不会中止已启动的单步，也不会强行归中。

## 实测及复跑

```sh
# 从仓库根运行；本次直接复用了之前模拟验证留下的资产、Playwright 和桌面 Chrome。
# 若在新检出缺少 .runtime，先运行 sh dsh-service/flashduck-sim/download.sh。
node dsh-service/flashduck-direct/pad/verify.mjs             # 21 次 WASM 应用执行
node dsh-service/flashduck-direct/pad/verify.mjs --loopback  # 加 2 次真实网关响应的 Lua 解析
```

[实测输出](./verification.txt)与[测试驱动](./verify.mjs)。Playwright 在独立 Chrome 中嵌入[官方 ESP-Claw GUI](https://simulator.esp-claw.com/) 的 HTML/JS/WASM/data，加载前核对既有[四个 SHA-256](../../flashduck-sim/runtime.sha256)。真实 WASM 执行模型分发器和 Lua 客户端；HTTP 能力使用官方 fixture，另有一例由测试层注入传输故障。非法输入不发 HTTP；左右和回中、受理/结束/未知/失败、超时不重试、身份/模式/动作证据边界均有断言。

`--loopback` 仅在 `127.0.0.1` 临时端口启动本项目实际网关与其模拟鸭。Node 重放 WASM 生成的方法、URL、正文和 Content-Type，将占位 Bearer 换成本次网关的一次性 token；将真实 POST/GET 回包注入 WASM，由同一个 Lua host 再解析。**不是 WASM 直连网关；没有运行 LLM、安装到 Pad、连接实鸭、部署或观测机械运动。**
