# FlashDuck：在 ESP-Claw 官方 Web 模拟器执行 Pad Lua 客户端

**结果：** 2026-11-25 在独立的本机 Chrome 158.0.8127.88 上执行。16 个用例均从官方 WASM 正常退出，原始输出见 [verification.txt](./verification.txt)。没有连接 Pad 或实体鸭，没有运行模型或舵机。运行时资产下载自[官方模拟器](https://simulator.esp-claw.com/)，不在仓库中重新分发。

## 复跑

从仓库根运行。需要 Node.js 22+、本仓库安装好的 Playwright 依赖、Chrome、curl 和 shasum。默认使用 Chrome 稳定版；若需其他 Chromium，可设 `CHROME_PATH=/absolute/path/to/chrome`。

```sh
sh dsh-service/flashduck-sim/download.sh             # 首次下载，约 9 MiB；有已校验缓存可跳过
node dsh-service/flashduck-sim/verify.mjs            # 仅官方 WASM/HTTP fixtures，13 个用例
node dsh-service/flashduck-sim/verify.mjs --loopback # 再做真实回环契约重放，共 16 个
```

若下载需要代理，给 curl 设置本机已有的 `HTTPS_PROXY`。官网更新资产时哈希校验会失败：不要直接替换哈希，应先确认来源、版本变化并重审契约。生产网页未声明构建 commit；[runtime.sha256](./runtime.sha256) 指纹标识实测版本，下列源码 commit 仅作接口依据。

## 三层证据

1. **真实执行：** Playwright 用临时端口将官方 HTML/JS/WASM/data 原样加载；按照[官方页面的嵌入协议](https://github.com/espressif/esp-claw/blob/50072775cfa20d7ce25a9b27591d9d7c8b9dbab5/pages/simulator/src/runtime-host.ts)挂载 Lua 文件、执行并检查 Lua 成功标记与 WASM 退出码，不是 JS 翻译或自写 Lua 解释器。
2. **模拟传输：** Lua 断言实际生成的 HTTP 方法、固定 URL、Bearer、JSON 字段，再调用原始 `capability.call('http_request', …)`。按[官方约定](https://github.com/espressif/esp-claw/blob/50072775cfa20d7ce25a9b27591d9d7c8b9dbab5/pages/simulator/README.md)配置 HTTP mock，没有把 WASM 的 mock 回包说成实际联网。覆盖左右转头、请求回中、步行被禁、401、非法 JSON、回包 ID 不符、未知/失败状态、GET、越权字段和不实动作确认。
3. **真实回环：** `--loopback` 只在 `127.0.0.1` 启动本项目网关与模拟 WebSocket 鸭端，端口、凭据和请求 ID 每次随机。Node 用 Lua 生成的 URL、方法、body 和 content type 重放；Bearer 改用该网关的一次性凭据。POST **202 accepted**，GET **200 replied**；拒绝 `walk_step` 为 **403 walk_disabled**，模拟鸭端累计仅收到一个消息帧。真实 HTTP 回包再通过官方 mock 注入 Lua 解析。不是 WASM→网关的直连，也不是硬件/模型/姿态反馈验证。

## 在 Pad 侧使用

[client.lua](./client.lua) 暴露 `bind(origin, token, duck_id)`。三项由受信任的安装配置注入，不来自模型。正式部署应使用有 TLS 的固定 HTTPS bridge，让 `http_request` 的 allowlist 仅允许该 bridge；不要把 token 放进 launcher 参数、日志或公开 App 包。示例：

```lua
local client = require('client').bind(TRUSTED_BRIDGE, STATION_TOKEN, 'duck-1')
-- 来自受信任调度器的唯一 ID；不要因超时生成新 ID 重发。
local cmd = {action='look_left', requestId='demo-0001', duckId='duck-1'}
local row, err = client.submit(cmd)
-- row.status == 'accepted' 表示已收单。稍后由 UI 定时器限次查询：
local current, poll_err = client.status(cmd)  -- GET，无 body，绝不重新 POST
```

客户端按[官方设备 HTTP 能力](https://github.com/espressif/esp-claw/blob/50072775cfa20d7ce25a9b27591d9d7c8b9dbab5/components/claw_capabilities/cap_http_request/skills/cap_http_request/SKILL.md)解包 `HTTP <status>\n<body>`；调用约定为 `ok, out, err`。只接受绑定 duck、白名单动作、合规 requestId，拒绝额外字段。响应校验 requestId/duckId/action、mode 和 `motionVerified=false`。`replied` 仅表示收到鸭端文字回复，`stop` 是普通回中请求而非硬实时急停；`unknown`/发送超时不能当作未送达或触发自动重试。网关默认禁用 `walk_step`，本测试不打开它。
