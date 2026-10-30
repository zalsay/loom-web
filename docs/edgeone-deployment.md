# 织界空间：EdgeOne 部署与验收

本文件描述已实现代码的部署准备步骤；不表示已经创建项目、写入实际 Blob、绑定域名或调用真实模型。公开部署和付费调用需另行授权。产品边界见 [MVP Spec](specs/loom-space-mvp.md)。

## 1. 运行边界

- 原生 HTML/CSS/ESM + vendored Three.js；`npm run build` 只复制/压缩 `web/` 到 `dist/`。
- `cloud-functions/api/v1/[[default]].js` 处理 `/api/v1/*`，使用 Node Cloud Functions。
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
