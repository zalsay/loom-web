# 织界空间：EdgeOne 部署与验收

本文件描述已实现代码的部署准备步骤；不表示已经创建项目、写入实际 Blob、绑定域名或调用真实模型。公开部署和付费调用需另行授权。产品边界见 [MVP Spec](specs/loom-space-mvp.md)。

## 1. 运行边界

- 原生 HTML/CSS/ESM + vendored Three.js；`npm run build` 只复制/压缩 `web/` 到 `dist/`。
- `cloud-functions/api/v1/[[default]].js` 处理 `/api/v1/*`，使用 Node Cloud Functions。
- `cloud-functions/api/world-weather.js` 独立处理公开只读 `/api/world-weather`；固定场地的天气/日出日落不依赖身份、Blob 或模型密钥。
- `agents/space-designer/index.ts` 处理 `/space-designer`，在原生入口独立检查 Cookie/Origin/owner/conversation。前端 POST 后直接消费 SSE，不依赖请求结束后存活的后台进程。
- `server/` 共享 API、签名、模型适配与存储。生产 Blob SDK 固定在 lockfile；不把这些模块、服务端环境或密钥复制进静态目录。
- 生产使用 `@edgeone/pages-blob` 命名空间，所有读取经应用鉴权。它不是公开模型/图片 CDN。KV 本期没有启用，不用作权限、锁或预算。
- 当前 provider adapter 直接请求兼容 Chat Completions 的服务端 URL，默认 JSON object 模式并执行独立校验；不依赖 OpenAI SDK 或沙箱，不声称所有模型支持严格 JSON Schema。`agents.framework` 因未使用框架原生 store/tools 适配而未填；上线前在目标 CLI/平台核验此配置，不能把某一框架名称当装饰配置。

入口与构建字段依据 [Agents 快速开始](https://pages.edgeone.ai/zh/document/agents-quick-start)、[EdgeOne 配置文档](https://pages.edgeone.ai/zh/document/edgeone-json)。Blob 使用方式依据 [Blob 官方文档](https://pages.edgeone.ai/zh/document/blob-storage)。本地 Node adapter 不替代 EdgeOne 平台运行时验收。

## 2. 本地开发

```sh
npm ci
npm run dev
```

打开 `http://localhost:5173/create.html`。本地 `.loom-data/objects` 保存开发版服务端数据，`.loom-data/dev-cookie-secret` 保存随机生成的开发签名密钥；均被 git 忽略。重启会保留身份与保存版本。生产 Cookie 密钥绝不可复制到这里。开发服务在 `NODE_ENV=production` 下拒绝启动，不能用它代替生产 handler。

需要配置时，从 `.env.example` 自行准备未跟踪的 `.env`，并显式载入：

```sh
node --env-file=.env scripts/dev.mjs
```

若更换端口或使用 `127.0.0.1`，相应设置精确的 `LOOM_ORIGIN`，在浏览器使用同一 origin。开发 HTTP 例外仅限 loopback；生产始终 HTTPS、`__Host-` Cookie、Secure、HttpOnly、SameSite=Lax，无 Domain。

## 3. 生产环境变量

| 变量                                                                       | 设置方式                                                                       |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `LOOM_ORIGIN`                                                              | 唯一 canonical HTTPS origin，不带路径/末尾斜线                                 |
| `LOOM_PUBLIC_BASE_URL`                                                     | 默认与 `LOOM_ORIGIN` 相同；不要指向外部站点                                    |
| `LOOM_COOKIE_SECRET`                                                       | 密码学随机、至少 32 字节，只配置在服务端 Secrets                               |
| `LOOM_COOKIE_KEY_ID`                                                       | 当前签名密钥版本，默认 `k1`                                                    |
| `LOOM_COOKIE_PREVIOUS_SECRETS_JSON`                                        | 轮换期保留旧 key ID→secret 映射；仍按凭证自身到期校验                          |
| `LOOM_COOKIE_TTL_SECONDS`                                                  | 默认 30 天；不是账户恢复机制，不自动承诺永久有效                               |
| `LOOM_BLOB_STORE`                                                          | 生产私有应用命名空间；预览与生产必须分离                                       |
| `LOOM_EDGE_RATE_LIMIT_CONFIRMED`                                           | 默认 `false`；配置并验证 EdgeOne 入口限流后才确认，生产 API 未确认时返回 503   |
| `LOOM_SOFT_WRITE_LIMIT_PER_MINUTE`                                         | 默认每访客每进程 60 次写请求；仅软防护，重启重置且不跨实例共享                 |
| `LOOM_SOFT_MAX_SPACES_PER_VISITOR` / `LOOM_SOFT_MAX_REVISIONS_PER_VISITOR` | 默认 100 个空间 / 500 个版本；从存储列表检查，非事务性硬配额，不删除已有版本   |
| `LOOM_AGENT_ENABLED`                                                       | 默认 `false`；基础编辑/保存/分享不需要启用                                     |
| `LOOM_AGENT_PROVIDER_BUDGET_CONFIRMED`                                     | 默认 `false`；只能在供应商侧硬上限、告警/熔断有证据后手动确认                  |
| `LOOM_PROVIDER_BASE_URL`                                                   | 供应商 HTTPS API base URL，例如其 `/v1` 前缀，adapter 追加 `/chat/completions` |
| `LOOM_PROVIDER_API_KEY` / `LOOM_PROVIDER_MODEL`                            | 已选供应商的真实密钥与模型名；没有默认模型                                     |
| `LOOM_PROVIDER_STRUCTURED_MODE`                                            | 默认 `json_object`；只有验证供应商兼容后才选择其他实现支持的模式               |
| `LOOM_PROVIDER_TIMEOUT_MS`                                                 | 默认 30000；取消/超时仍可能计费                                                |

`PROVIDER_BUDGET_CONFIRMED` 只是部署人员的确认记录，不是应用自己完成了费用计量。内存或 KV 计数都不是全站硬限额。没有可靠供应商费用闸门时保持 Agent 关闭。不要把 `.env` 或真实凭证提交到仓库；不要在浏览器变量前缀中暴露任何服务器密钥。

应用对象/大小等限制以场景 validator 和服务端配置为准；它们不替代平台的函数、请求体或并发配额。不同运行时不能混用配额；具体以 [EdgeOne 限制说明](https://pages.edgeone.ai/zh/document/edge-functions)及目标运行时文档为准。

生产限流确认与供应商预算确认是两道独立门禁。前者保护匿名 API 的资源消耗，后者保护模型费用；配置布尔值只记录运维确认，不能替代真实平台控制。

## 4. 配置与数据语义

`edgeone.json` 保持 `npm ci` / `npm run build` / `dist`。必须以仓库根为部署根，同时发现 `cloud-functions/` 与 `agents/`；仅上传 `dist/` 只会得到静态编辑器，不会得到 API。

保存使用规范 JSON hash + attempt ID 派生的不可变版本键。同一次未知结果的保存重试沿用 attempt；模型启动请求不自动重发。固定 SDK 0.0.18 的源码提供 `set(..., { onlyIfNew: true })`，适配器使用它进行单键条件创建，并在条件失败后强读核验相同字节；条件写失败不会退回覆盖写。此选项的生产行为必须经过 staging 验证，不能仅凭 SDK 测试代替平台验收。

Blob 的 strong read/list 与单键条件创建不代表通用 CAS、事务或跨实例唯一任务：兄弟版本可以都成功，由用户选择，不用一个可变 head 静默覆盖。应用同键防御性检查和进程内锁不宣称提供分布式锁。

公开分享是独立已保存快照，不包含 owner、聊天或凭证。公开读通过 API，默认 no-store，并检查撤销标记；`public/` 前缀不代表开放桶权限。撤销不收回已下载的副本。不要给私有 API、带 Cookie 的响应或 SSE 配置 CDN 公共缓存。

匿名 Cookie 丢失后无法找回云端归属；JSON 只能恢复内容。当前没有完整云端删除/垃圾回收服务或账号认领能力。开放给公众前必须决定数据与日志保留周期、孤立匿名版本的回收策略，并在产品中披露；不要声称 Cookie 到期会自动删除 Blob。

## 5. 本地与平台验收

```sh
npm run check
npm test
npm run build
npx playwright install webkit firefox
npm run test:e2e
```

Node 测试使用内存/临时目录/注入 Blob client 与 fake provider；浏览器测试使用本机开发服务、真实 IndexedDB，以及明确的合成 Agent 响应。它们不触发真实模型账单，也不能证明生产 Blob 持久化或 EdgeOne 运行时行为。

获部署授权后，先创建隔离 staging，再逐项验收：

1. 构建正确识别 API catch-all 与 `/space-designer`；依赖与相对 imports 能打包；缺少 secret/origin 不降级成不安全服务。
2. HTTPS canonical host、Set-Cookie 属性、两标签首访 bootstrap、多浏览器隔离、Cookie 清除/过期；www/apex 重定向在发 Cookie 前完成。
3. 真实 Blob strong read/list 与分页、同 payload 重试、同 parent 并发分支、冷启动后读取、断线后未知保存结果恢复；不丢失已确认版本。
4. owner/space/revision/conversation/editor 负例、同源 Origin/Fetch Metadata、响应 no-store、错误和日志不泄密；原生 Agent 路由不能绕过鉴权。
5. 只读分享不能编辑，快照不随草稿改变，撤销后新请求不可读取；测试边缘缓存与在途响应边界。
6. 先用不计费 provider/fake 验证 SSE、提案/ack、迟到结果、Stop、冷启动事件重放。再经单独许可做真实模型小额联调，验证输出模式、token 限制和供应商硬预算。
7. 在 EdgeOne 入口配置站点/路由限流和异常告警。匿名 Cookie 可以重建，应用本地软限流不能阻止恶意规避或跨实例并发。未完成费用门禁不启用公开 Agent。
8. 测试移动端、低性能与 SVG 降级，确定文档/物件预算；确认许可、隐私与数据保留告知，最后再评审生产发布。

未通过平台验收时只能报告“本地开发已验证/待 staging”，不能报告“EdgeOne 已上线”。

## 6. 本地开发验收记录

2026-10-31：MVP 本地开发完成，以下检查通过：

- `npm run format:check`、`npm run check`、`npm test`（46/46）与 `npm run build`。
- `npx playwright test --workers=2`：48/48，WebKit 与 Firefox 各 24 项；包括真实 IndexedDB、匿名首访并发、独立/重复标签页、未知保存结果恢复、只读分享/撤销、Agent 合成 SSE、迟到提案/停止/确认恢复和渲染器资源释放。
- 两个 EdgeOne 入口可按 Node 20 目标打包；静态构建产物不含服务端目录或密钥配置。
- 压缩后的实际页面通过 390px 手机尺寸冒烟检查：可添加物件，无页面脚本错误或横向溢出。

真实 Blob、EdgeOne 多实例/冷启动、生产域名与模型供应商尚未联调；本地“保存到云端”使用 `.loom-data/`。Agent 默认关闭，发布前仍须完成第 5 节的平台验收。

## 7. World 天气与时间

官网三维场景新增独立公开只读入口 `/api/world-weather`。部署时必须识别 `cloud-functions/api/world-weather.js`，它不调用个人空间 API、Blob 或 Agent，也不需要 Cookie/模型密钥。静态 `dist/` 单独部署时，场景仍可浏览且本地时钟继续走，但天气和日出日落会标记不可用。

数据来自 MET Norway 的 [Locationforecast 2.0](https://api.met.no/weatherapi/locationforecast/2.0/documentation) 与 [Sunrise 3.0](https://api.met.no/weatherapi/sunrise/3.0/documentation)，固定地点为福州织界场地，经度 `119.36433054520208`、纬度 `26.042010002204606`，日期按 `Asia/Shanghai` 计算。上游请求坐标限制为四位小数；不转发访客 Cookie、IP、任意目标 URL 或可变坐标。天气是当前时段的模型预报，不是实时站点测量，场景太阳方向为视觉近似。

可选环境变量 `LOOM_WEATHER_USER_AGENT` 应填写真实应用标识与可联系链接，默认 `loom-web/1.0 https://github.com/zalsay/loom-web`。无需订阅或 API key。MET Norway 来源、CC BY 4.0 许可与本项目的转换说明见首页页脚的[许可说明页](../web/credits.html)。[官方许可](https://docs.api.met.no/doc/License.html)允许注明来源后使用，[服务条款](https://docs.api.met.no/doc/TermsOfService.html)要求缓存、条件请求、退避和应用标识，不提供 SLA。

代理的内存缓存和进行中的请求合并只作用于单个实例，不是全局限流或持久化存储。生产需核验公开天气路由的 CDN 缓存行为、跨实例请求量及上游可达性，避免所有冷实例同时穿透上游；不得因此给 `/api/v1/*`、Cookie 响应或 SSE 开启公共缓存。失败、过期、上海跨日和后台恢复必须单独验收，不能把旧日出日落标为今天。全球模型有自身更新周期，浏览器刷新并不意味着上游获得了新的实测数据。

2026-10-31 本轮本地验收：

- `npm run format:check`、`npm run check`、`npm test`（73/73）和 `npm run build` 全部通过。
- WebKit / Firefox 完整浏览器回归 62/62；覆盖天气切换、北京时间、当天日出日落、跨日恢复、离线/过期状态、减少动态效果、手机布局和 SVG 降级，并回归原编辑/保存/Agent 合成响应流程。SVG 降水采用轻量 CSS，不因粒子反复重绘建筑。
- 本地代理成功读取真实 MET Norway 天气和日照接口；天气 Cloud Function 可按 Node 20 目标打包。天气行达到 3 小时只标记为过期，超过 6 小时不再作为当前天气展示；失败/过期响应不作公共缓存。
- 压缩构建的 WebKit 390px 手机页面通过降雨、落日、时钟、日出日落及原视角控制冒烟检查，无脚本错误或横向溢出；静态目录未包含服务端或密钥配置。

以上不替代 EdgeOne staging/生产的上游可达性、路由发现、缓存和跨实例验收；本轮没有部署。

## 8. World 熊猫造型

当前 World 只显示一只静态屋顶熊猫：位于左侧栅格柱、面朝屋面，身体和头部均为 faceted 面片，双手抓住檐口、脚掌踩在格栅上，臀部略微上翘。场景中没有地面熊猫或手柄入口。`web/js/panda-controller.js` 与 `web/js/panda-input.js` 保留为未接入 World 的独立模块。此静态造型无需新增服务端配置。

以下是 2026-10-31 控制器实验的历史本地验收记录；其中可操控的地面熊猫及屏幕/键盘控制已被当前版本的静态屋顶熊猫替代，不能视为当前版本仍提供这些操作入口，也不代表当前版本的功能验收。

2026-10-31 本轮本地验收：

- `npm test`（84/84）、`npm run check`、`npm run format:check` 与 `npm run build` 通过。
- WebKit / Firefox 全量回归首轮 75/76，原有 62 项全部通过；唯一超时发生在新增 SVG 用例切换建筑视角时的重绘。该用例改为同步检查浏览按钮回调，不宣称 SVG 动画流畅；调整过的键盘和 SVG 用例在双浏览器定向复测 4/4，通过且没有跳过测试，其余熊猫操作用例首轮通过。
- 压缩构建在 WebKit 390px 手机上通过移动、奔跑、跳跃/落地、按住跳跃键不重复起跳、复位、镜头跟随/恢复和布局冒烟检查，无脚本错误或横向溢出；强制 SVG 后入口禁用、提示可见，程序化启用同样无效。

以上仅为本地开发验收，不代表 EdgeOne staging/生产部署；本轮没有提交、推送或部署。
