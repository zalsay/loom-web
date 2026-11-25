# FlashDuck：Pad Agent 确定性颈部控制（v1）

**用途**：Pad Agent 或经授权的人选一个方向，鸭端只对脖子输出有限的 PWM 轨迹，不请求鸭端模型，也不把一段聊天文字当作动作命令。此版不开放步态、其余五个舵机、任意角度、原始 PWM 或动作脚本。不是物理闭环定位器或急停系统。

## 与原有聊天版的区别

原来的 [DuckClaw 聊天适配](../flashduck/README.md) 不变。新接口的鸭端是**独立编译的直控专用镜像**，不是在原厂聊天固件运行时追加一个公开 URL。两种能力保留在不同固件里；同一台鸭同一时刻不会既开 `/ws` 与自动情绪动作，又让 Pad 写同一个舵机。不能用新网关去控制没有安装直控镜像的鸭。只在固定版本的[上游工程](https://github.com/FlashCat-Jordan/Flashduck/tree/9d4316e3f1f7ef693be4d62f4b1aa020a3daedf4/firmware/duckclaw)旁生成新项目，不覆盖原始源码。DuckClaw 使用 CC BY-NC-SA 4.0，商业场地使用前请确认授权。

## 两段接口

| 调用方 | 协议 | 约束 |
| --- | --- | --- |
| Pad → 场地网关 | `POST /v1/duck/look`，JSON `{duckId,requestId,direction}`；`GET /v1/duck/look/:requestId` 只读 | `direction` 支持 `left`、`slight_left`、`center`、`slight_right`、`right`。微调是当前侧端点与校准中位之间的半程位置，不是每次累加；该侧距离不足 2° 时拒绝微调。Agent 只选择方向，工具宿主提供绑定和稳定请求 ID。网关只监听 loopback；真实 Pad 需受保护的现场代理和设备认证，不能直连裸 HTTP 公网。 |
| 网关 → 鸭 | 先 `GET /control/v1/status`，后 `POST /control/v1`；`GET /control/v1/status?id=...` 查询 | 独立设备凭证、指定私网 IP、选定的本机校准范围、颈部专用、固定过渡时间 700ms。命令绑定本次开机 `sessionId` 以及设备 uptime 的短期截止时间。每次启动须现场确认居中、解锁才允许动作。 |

`accepted` 表示命令已受理，`command_finished` 表示固件按轨迹发完控制输出；没有位置传感器，**`motionVerified` 始终为 `false`**。同一个意图重试查询，不自动重发动作。网络中断、跨重启或结果无法核实时为 `unknown`，保持锁定并由现场人员核查。停止进程、断开网络、回中指令都不是断动力。

## 一次左右巡视（Pad 工具）

`duck_look` 是单次定位；`duck_scan({})` 是可选的 Pad 工具，以「小幅左 → 小幅右 → 回中」执行一遍，没有自由序列、无限循环、步行或摄像能力。两侧各停留约 300 ms 后才启动下一段。子步骤用独立、稳定的请求 ID，只有读到 `command_finished` 才前进。不确定、网络错误或授权取消时不再发下一段（包括回中），已经开始的一段可能仍会完成。不能把左右巡视当作视觉识别或已找到充电座。

接入真 Pad 的工具宿主必须在单只鸭范围内独占这次扫描（含普通转头和其他控制者），为每个意图提供不可重放的授权、单调时钟和可取消的 worker 等待。当前 USB/HTTP 固件协议不变，未额外提供跨 Pad 的扫描租约；没有配套宿主就只启用单步工具。

## 初版验证记录（2026-11-25）

- 在干净的固定上游上生成独立工程，用官方 `espressif/idf:v6.0.1`（镜像摘要 `sha256:efc19fae2f52fc6873630c668da26aa834139a063b5fb73a46ebc0dbd217b587`）成功交叉编译 `esp32s3`。确认实际生效 USB Serial/JTAG 控制台、无 bootloader 日志；本次 app 二进制 SHA-256 为 `f91d3653322a44591fdf8bfaffe10b232f5474fe4119d2f50deb5436fc72524d`，不同构建时间不保证字节一致。
- 固件 C 主机逻辑与离线配置测试通过；服务 39/39 项通过；Pad 的乐鑫官方 WASM 20/20 次执行通过，其中 2 次将 Node 回环 HTTP 的实际响应交给 Lua 校验。WASM 本身使用模拟网络，不是连真鸭或测试机械行程。未执行烧录、下发实体动作或公网部署。

## 工作站模拟（不依赖实物）

推荐 Node 22+。从仓库根目录运行；只需启动模拟 CLI 即可自行调用 HTTP，自动验证另起临时端口，不需要 CLI 同时运行：

```sh
DUCK_PAD_TOKEN="$(openssl rand -hex 32)" node dsh-service/flashduck-direct/serve.mjs
node --test dsh-service/test/*.test.mjs dsh-service/flashduck-direct/test/*.test.mjs
# 若尚无官方 WASM 资产，先运行 sh dsh-service/flashduck-sim/download.sh
node dsh-service/flashduck-direct/pad/verify.mjs --loopback
```

[Pad Agent 工具与模拟器验证](pad/README.md) · [网关实现](bridge.mjs) · [鸭端固件、编译与授权配置](firmware/README.md)。所有测试都不得依赖真机移动。真机验收需要已核准的样机、机械范围和可立即切断舵机动力的成人；先在不接舵机的条件下验证 GPIO7 的波形、其余脚没有 PWM，再在台架上检查脖子方向和其余关节静止。网络身份和设备凭证必须分开，不使用 DSH 管理令牌。
