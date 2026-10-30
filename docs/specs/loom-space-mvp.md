# 织界空间 MVP 实现规格

- 版本：0.2
- 日期：2026-10-31
- 状态：MVP 开发基线；本地实现与验收记录见部署文档，生产上线待评审
- 范围：为 EdgeOne Makers 部署准备的产品与技术规格；不是实现记录，也不构成上线或部署许可。

## 1. 目标与已选默认

让访客用自然语言定制自己的“织界空间”3D园林场景。官网现有官方廊亭、园林与熊猫作为只读母版保留；新增“创建我的空间”入口，创建个人副本。所有访客共用同一套 Three.js 渲染和编辑代码，只存取不同的 JSON 场景数据；不是每人一份部署。

MVP 不要求注册或登录，不接入 Supabase、数据库或外部用户系统。浏览器自动获得匿名访客身份。默认用 IndexedDB 保存本地草稿、EdgeOne Blob 保存私有不可变云端版本；不以 KV 或进程内存作为权限、并发锁、严格配额或强一致权威。Agent 使用服务端 allowlist 工具编辑场景数据，不执行用户代码。

### 1.1 实现前仓库基线（2026-10-30 已核对）

- `package.json` 是 ESM 项目，要求 Node.js 20+；页面是原生 HTML/CSS/JS，Three.js 0.180 以 vendored 模块提供；当前没有 React、Next 或 Vite 应用需要迁移。
- `npm run build` 执行 `scripts/build.mjs`：将 `web/` 复制到 `dist/`，再逐个压缩 JS/CSS，不打包模块；`npm run check` 是静态语法与资源检查。
- 当前母版入口为 `createPavilion()`（`web/scene/model.js`），返回 `root/building/ground/landscape/panda/materials/parameters/layout`。大量几何仍是硬编码，不能视为已有全参数化编辑器。
- `web/js/world.js` 已支持相机视角、开门、园林显示、自动旋转；WebGL2 不可用时切到简化 SVG 渲染。首页 iframe 的 `postMessage` 已检查 `event.origin` 与 `event.source`，新增消息不得削弱这两项校验。
- `web/scene/model.js` 仍有模块级共享材质与随机数状态。可编辑实例应改为实例级资源与可重放 seed；场景卸载/替换需释放几何、材质、纹理，避免内存泄漏。

以上是当前观察到的基线，不代表本规格中的个人空间、Agent、认证或云端存储已存在。

## 2. 产品边界

### 2.1 第一版必须可用

- 首页继续展示官方只读场景；从官网或独立场景页进入“创建我的空间”，始终保留官方母版，不直接覆盖它。
- 访客创建、命名、打开自己的副本；选定母版版本和有限材质预设，调整天空/时间/灯光与玻璃门状态。
- 从白名单组件中添加、删除、移动、旋转、缩放树木、长椅、园灯等；可调整视角。对象有稳定 ID，选中与变换可由鼠标/触控完成，也可由对话共同编辑。
- 支持撤销/重做、明确保存、恢复、JSON 导入/导出。离线更改保留为本地草稿；网络恢复后不得静默覆盖云端分支。
- 支持单独的“公开只读分享”动作。分享仅含白名单 `SceneDocument` 快照；没有访客 Cookie、owner ID、聊天记录或编辑凭证。只读分享不能恢复编辑权限。
- WebGL/SVG 简化模式与设备资源预算须明确告知能力限制。超限时拒绝或要求用户明确简化，不静默截断并保存损坏场景。

### 2.2 明确不做

- 注册/登录、跨浏览器或跨设备身份同步、账号认领、密码找回、付费/订阅。
- 实时多人协作、共享编辑权、冲突自动合并。
- 任意 JavaScript、插件、shell、源码编辑或 `eval`。
- 任意远程 URL、GLB/模型上传、模型生成或用户提供 HTML/CSS。
- 把 3D 物理场景解释成设备指令、Runtime 执行或真实世界动作。
- 普通场景编辑不使用远程 Coding 沙箱；若未来加入新组件代码生成，须另行设计隔离沙箱与安全评审。

### 2.3 主流程与页面状态

首页 → “创建我的空间” → 创建本地母版副本并尝试建立匿名会话 → 手动编辑 → 明确保存首个云端版本 → 手动/对话编辑、预览与撤销 → 明确保存 → 下次同浏览器继续打开。创建按钮只创建本地副本；所有云端保存均需用户明确点击，不自动发布。离线或云端不可用时仍可本地编辑，首次成功保存前不启用依赖云端空间绑定的 Agent。

编辑页以 3D 画布为主，提供组件/属性面板、对话区和保存/导出入口；移动端面板折叠。状态至少区分“本地草稿”“正在保存”“已保存”“尚未同步”“存在分支”以及 Agent 的“生成中”“待应用”“已应用”“已取消/结果未知”。不能用一个笼统的“成功”同时表示模型完成、场景已应用和云端已保存。

## 3. 拟议架构与代码边界

```text
浏览器
  ├─ 官方只读页：现有 Three.js 母版
  └─ 个人编辑页：同一渲染器 + SceneDocument reducer/validator
       ├─ IndexedDB：当前草稿、撤销历史、待恢复状态（不存认证凭证）
       └─ 同源 API（HttpOnly Cookie）
            ├─ session / spaces / revisions / shares
            ├─ agents/space-designer/index.ts（Typed allowlist + SSE）
            └─ EdgeOne Blob（私有不可变版本、只读分享快照）
```

建议先复用现有静态构建路径，新增 `web/create.html`、`web/editor.css`、`web/js/editor/` 与 `web/js/agent-client.js`；将 EdgeOne handler 放在仓库根部 `agents/space-designer/index.ts` 及经运行时确认的 `cloud-functions/`/服务端模块中。`scripts/build.mjs` 目前只复制 `web/`，不得将服务端 handler、凭证或配置密钥放进 `dist/`。EdgeOne 的 `agents.framework`、SDK、函数路由和构建字段必须按最终选定 SDK 的官方配置确定，本规格不虚构其值。

运行时职责：普通业务 API 使用可运行 Blob Node SDK 的 Node Cloud Functions；Agent 使用 Makers Agents 运行时。`agents/space-designer/index.ts` 按文件路由约定对应 `/space-designer`，不是自动对应嵌套的 `/api/v1/.../agent/turns`。MVP 直接向该同源入口 POST 并读取 SSE；鉴权与资源校验必须在 Agent handler 自身执行，不能只保护业务 API 后留下可绕过的原生入口。默认不采用“先返回 202、再在请求结束后继续执行”的后台任务设计。

所有场景操作先经同一份版本化 schema、白名单 reducer 与渲染适配层。编辑器不能直接修改官网母版的共享对象，也不能因视图模式或渲染器差异改变持久化语义。

## 4. 场景数据契约

### 4.1 `SceneDocument` 约束

- `schemaVersion` 必须可迁移；`template.id/version` 和材质注册表版本固定引用已发布资源。升级母版不暗中改变已保存副本。
- 坐标以米为单位、`+Y` 向上；角度用弧度；相机、对象与 seed 序列化。对象使用稳定 ID，不能以数组位置作身份。
- 仅允许已注册的 `assetId`、`materialId`、环境 preset、门状态和相机参数。禁止任意 URL、着色器、函数、文件路径或可执行文本。
- 母版另行发布稳定的可编辑 `targetId + materialSlot` 注册表；`templateOverrides` 只能覆写这些目标的材质，不能删除或改写母版几何。个人添加物件使用 `objects[].materialId`；两者都需验证目标与材质兼容性，不按 Three.js 子对象数组下标定位。
- 校验所有数值为有限值，并限制坐标、旋转、缩放、灯光、对象数和字符串长度。建议上限：SceneDocument UTF-8 JSON 256 KiB、个人物件 256 个、单次 Agent 提案 32 个操作；这些是待性能验证的产品上限，不是平台配额。
- 服务器与客户端都按 schema 校验；未知字段默认拒绝。输入大小须在 JSON 解析前按 UTF-8 字节数限制。Edge Functions 文档的请求体上限标为 1 MB，KV value 上限标为 25 MB；存储值上限不等于 HTTP 请求体上限。Node Cloud Functions/Agents 另按对应运行时限制核验；应用层仍执行更小的产品上限。

### 4.2 合法完整示例

以下 JSON 仅表示个人场景文档；owner、space、revision、对话和访问凭证由 API/版本封套处理，不进入文档：

```json
{
  "schemaVersion": 1,
  "documentId": "scene_7d82af5e",
  "title": "午后竹影",
  "template": {
    "id": "official-pavilion-garden",
    "version": "1.0.0"
  },
  "units": "meters",
  "upAxis": "+Y",
  "seed": 4917,
  "registries": {
    "templates": "loom-templates@1",
    "materials": "loom-materials@1",
    "assets": "loom-garden-assets@1"
  },
  "templateOverrides": [
    {
      "targetId": "pavilion.frame",
      "materialSlot": "surface",
      "materialId": "metal.graphite"
    }
  ],
  "environment": {
    "skyPreset": "soft-afternoon",
    "timeOfDay": 15.5,
    "sunIntensity": 1.2,
    "ambientIntensity": 0.8,
    "doorState": "open",
    "landscapeVisible": true
  },
  "camera": {
    "position": [18.0, 12.0, 24.0],
    "target": [0.0, 1.5, 0.0],
    "fovDegrees": 40
  },
  "objects": [
    {
      "id": "obj_01J9BAMBOO7H2K4M",
      "assetId": "garden.bamboo-cluster",
      "name": "入口竹丛",
      "transform": {
        "position": [7.0, 0.0, 4.0],
        "rotation": [0.0, 0.35, 0.0],
        "scale": [1.0, 1.0, 1.0]
      },
      "materialId": "leaf.deep-green"
    },
    {
      "id": "obj_01J9BENCH7H2K4M",
      "assetId": "garden.bench.wood",
      "name": "廊下长椅",
      "transform": {
        "position": [-3.0, 0.0, 8.0],
        "rotation": [0.0, 1.5707963, 0.0],
        "scale": [1.0, 1.0, 1.0]
      },
      "materialId": "wood.warm-oak"
    }
  ]
}
```

文档中的 `documentId` 不是身份凭证；权限只由服务端验证的 Cookie 决定。官方模型与熊猫资源的来源、品牌展示和许可须保持现状并在组件注册表中注明；保存个人副本不转移或扩大资源许可。

## 5. 匿名身份与 Web 安全

### 5.1 凭证生命周期

首次同源 bootstrap 时，服务端生成密码学随机 visitor ID，并签发带过期时间的签名凭证。生产 Cookie 名为 `__Host-loom-visitor`，必须 `HttpOnly; Secure; SameSite=Lax; Path=/` 且没有 `Domain`；签名密钥只来自服务端 Secret，支持密钥版本/轮换。JS 不可读 Cookie；API 不返回凭证内容。凭证格式只是建议，签名算法与密钥管理须经实现评审。

不采集浏览器指纹，也不把 IP 地址作为身份或云端空间归属；边缘限流如需网络信号，须作为独立反滥用控制评估，不能用于恢复 visitor ID。

本地明文 HTTP 开发必须与生产隔离：仅在精确的 localhost 开发 origin 和非 production 构建启用独立 Cookie 名、独立密钥与 Secure=false；生产配置缺少 Secure/密钥时启动失败，禁止自动降级。浏览器支持不满足安全 bootstrap 互斥要求时只提供本地编辑/导出，不开放云端写入。

签发时强制设置并在浏览器验收 Cookie 属性；请求中的 `Cookie` 头不携带原始属性，服务端只验证凭证签名、到期和 owner 范围。访客 ID 只从验证后的 Cookie 派生；请求体中的 `userId`/`ownerId` 一律拒绝，任何客户端传入的 `spaceId`、`conversationId` 或 `revisionId` 都必须在当前 owner 命名空间内重新验证，绝不据其决定归属。不同 owner 的不存在与无权访问返回相同 404。

个人 API、Agent/SSE 和导入/导出响应均设置 `Cache-Control: no-store`；不做含 Cookie 的 CDN 缓存。凭证不得进入 URL、分享链接、日志、异常追踪、`postMessage`、DOM、IndexedDB、localStorage、Agent 提示词或客户端可读存储。`postMessage` 仅允许白名单消息，并继续校验精确 `origin` 和 `source`。

所有写接口仅接受预期 HTTPS 同源 Origin，核验 Fetch Metadata；跨源 CORS 默认关闭。浏览器写请求必须带 JSON 和自定义请求头，拒绝不符合策略的简单跨站表单请求；Cookie 的 SameSite 不能替代 Origin 校验。服务端日志过滤 `Cookie`/`Set-Cookie`/Authorization 等头与用户 prompt。

### 5.2 用户可见限制

- 同一浏览器 profile、同一生产 host 共用匿名身份；不同浏览器/设备不会自动同步。Cookie host-only，端口不是隔离边界。
- 清除 Cookie、签名过期、浏览器 profile 丢失或生产 hostname 改变后，服务端不能识别原 owner。仅凭本地 visitor ID 或只读 share 不能认领旧云端空间；用户可用本地导出文件在新身份下创建副本。
- 无痕窗口结束通常会清除其本地数据。IndexedDB 可能受配额、用户清理或浏览器回收影响；导出是用户备份，不宣称浏览器存储永久可靠。
- 正式上线前必须确定唯一 canonical HTTPS hostname，并先完成 www/apex 等域名重定向。跨 host 迁移导致 Cookie 边界变化时，按不可恢复处理，不作静默身份迁移。

## 6. EdgeOne API 草案

所有 `/api/v1` 私有路由均为同源，校验 Cookie、owner 与资源上限；写请求额外校验 Origin/Fetch Metadata，普通同源 GET 不假设一定带 Origin 头。JSON 响应 no-store。下表是拟议契约，不代表仓库已有 API。

| 方法与路径                                                  | 请求 / 成功响应                                                                                                                                  | 权限与幂等边界                                                                                                                                                                                                                          | 主要失败                                                     |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `GET /api/v1/session`                                       | 返回 `{state: "ready"}` 或 `{state: "bootstrap_required"}`，不返回 visitor ID                                                                    | 只读；无 Cookie 时不创建身份                                                                                                                                                                                                            | 503 配置错误                                                 |
| `POST /api/v1/session/bootstrap`                            | 空 JSON；成功后设置 HttpOnly Cookie，仅回 `{state: "ready", expiresAt}`                                                                          | 同源；有效 Cookie 不轮换 owner。首访由同 origin Web Lock 串行化；锁内先 GET session，只在确实缺失时 bootstrap，完成后才开放云端写；不支持锁时先提供本地模式                                                                             | 403 Origin；503 签名配置错误                                 |
| `GET /api/v1/spaces`                                        | 分页列出当前 owner 下由不可变版本推导出的空间与分支摘要                                                                                          | 仅 Cookie owner；Blob strong list/read；不以 KV 作权限判断                                                                                                                                                                              | 401、404、503                                                |
| `PUT /api/v1/spaces/{spaceId}/revisions`                    | `{saveAttemptId, parentRevisionId, scene}`；返回持久化确认的 `revisionId`、父版本和当时观察到的 sibling 摘要                                     | owner Cookie；客户端为新副本生成随机 128-bit 以上的 spaceId；首版 `parentRevisionId:null` 在当前 owner 下初始化空间，后续父版本必须属于同 owner/space。相同规范化 payload + attempt ID 得相同键；不同 payload 不覆盖。不是 exactly-once | 400 schema；401；404 parent；409 incompatible；413；429；503 |
| `GET /api/v1/spaces/{spaceId}/revisions`                    | 分页列出不可变版本与 parent 关系                                                                                                                 | 当前 owner；strong list/read；列表是观测快照，不是锁                                                                                                                                                                                    | 401、404、503                                                |
| `GET /api/v1/spaces/{spaceId}/revisions/{revisionId}`       | 返回经 schema 校验的 SceneDocument 与 parent metadata                                                                                            | 当前 owner；不得按客户端 revision ID 跨 owner 读取                                                                                                                                                                                      | 401、404、503                                                |
| `POST /api/v1/spaces/{spaceId}/shares`                      | `{revisionId, shareAttemptId}`；返回 `{shareId, url, revisionId}`                                                                                | 需明确用户点击；只复制已保存版本；按固定 payload 推导 share key 可安全重试；Agent 无调用权                                                                                                                                              | 401、404、409；预算/频率限制                                 |
| `DELETE /api/v1/spaces/{spaceId}/shares/{shareId}`          | 返回 `{revoked:true}`                                                                                                                            | 当前 owner 的私有 share 绑定校验；写入不可逆撤销标记，重复撤销安全；重新分享产生新 shareId                                                                                                                                              | 401、404、503                                                |
| `GET /api/v1/public/spaces/{shareId}`                       | 返回仅含白名单 SceneDocument 的只读快照                                                                                                          | 公开只读；`shareId` 是公开定位符，不是编辑凭证；无 owner/chat/cookie 字段                                                                                                                                                               | 404、410                                                     |
| `POST /api/v1/spaces/{spaceId}/agent/sessions`              | 创建平台支持的对话并返回 `conversationId`                                                                                                        | 当前 owner；服务端保存其与 owner/space 的绑定。重试可能创建未使用会话，不声称 exactly-once                                                                                                                                              | 401、404、429、503                                           |
| `POST /space-designer`                                      | `Makers-Conversation-Id` 请求头 + `{action:"start", spaceId, turnId, editorSessionId, baseDraftVersion, draftScene, prompt}`；返回本请求内的 SSE | 当前 owner；检查 owner-space-conversation 绑定、完整草稿 schema 与费用闸门；turnId 在客户端生成并在发送前持久化；不自动重发启动请求                                                                                                     | 400；401；404；409 known-duplicate/mismatch；413；429；503   |
| `GET /api/v1/spaces/{spaceId}/agent/turns/{turnId}/events`  | SSE 事件流，支持 `Last-Event-ID`；断线后从游标继续                                                                                               | 当前 owner；按 `(turnId,eventId)` 去重；不触发新模型调用                                                                                                                                                                                | 401、404、410 replay unavailable                             |
| `GET /api/v1/spaces/{spaceId}/agent/turns/{turnId}`         | 返回可恢复状态与最近事件游标，不回传凭证                                                                                                         | 当前 owner；turn 绑定必须匹配此 space/conversation                                                                                                                                                                                      | 401、404、410 replay unavailable                             |
| `POST /api/v1/spaces/{spaceId}/agent/turns/{turnId}/ack`    | `{proposalId, editorSessionId, baseDraftVersion, appliedDraftVersion, outcome:"scene_applied"}`                                                  | 当前 owner；只接受与该 turn 已签发提案相符的 ack；相同 ack 重放安全，不同 ack 冲突                                                                                                                                                      | 401、404、409 stale/mismatch                                 |
| `POST /api/v1/spaces/{spaceId}/agent/turns/{turnId}/cancel` | `{}`；回 `{cancelRequested:true}`                                                                                                                | 当前 owner；取消是 best-effort，已产生的供应商费用仍计入成本                                                                                                                                                                            | 401、404、409、503                                           |

`spaceId`、`conversationId`、`revisionId` 和 `turnId` 都不是凭证。EdgeOne `Makers-Conversation-Id` 需使用 6–36 个字母/数字/`-_.` 字符；直接使用符合格式的 UUID v4（36 字符），不要加 `conv_` 前缀导致超长。所有 ID 仅用于定位，再由当前 Cookie 的 owner 范围校验。

### 6.1 保存键与幂等边界

客户端为一次有意保存生成随机 128-bit `saveAttemptId`，重试时保持不变。服务端校验并规范化 SceneDocument 后，用固定键序、有限数值的规范 JSON 序列化；revision key 由 `saveAttemptId + SHA-256(parentRevisionId, canonicalScene)` 派生。版本 envelope 不包含每次重试都会变化的服务端时间戳。完全相同的重试写入相同字节/键；同 attempt ID 但内容不同产生不同版本键，绝不可覆盖旧内容。

这只让同一规范化 payload 的重试具有内容寻址安全性；新 attempt 可能产生内容相同的额外 revision，跨设备重复请求不是 exactly-once。调用方不得收到成功响应，除非 Blob API 已确认目标不可变对象持久化；若平台 `put` 会对已有键静默覆盖而无法保证同键字节相同，先改用 `saveAttemptId` 外加完整 hash 的键并确认编码路径，再开放写入。

## 7. Agent 请求与应用确认协议

Agent 入口是 `agents/space-designer/index.ts`。它只调用 schema 化的操作：`set_environment`、`set_material`、`add_object`、`move_object`、`remove_object`、`set_camera`。工具字段类型、资产 ID、范围和操作数均在服务端校验。模型只生成候选操作，不接触 shell、文件系统、源码、数据库或浏览器 DOM；不使用 `eval`。前端任意 HTML、导入文本与对象名称都视为不可信数据而非系统指令。

每次 turn 以经校验的 `draftScene` 为事实来源，不能只读取上一次云端 revision 或相信历史聊天。服务端计算规范化草稿 hash 并关联 `editorSessionId + baseDraftVersion`；`editorSessionId` 为编辑器实例随机 ID，不是权限凭证。后续 proposal、ack 和前端检查都带这两个字段，避免不同标签页恰好使用同一版本计数时串用结果。场景中可见文字仅作数据；给模型的上下文可裁剪为确定性摘要，但必须保留受影响目标的稳定 ID 与当前属性。

| 操作              | 最小参数与限制                                                                                                  |
| ----------------- | --------------------------------------------------------------------------------------------------------------- |
| `set_environment` | `patch` 为 environment 允许字段的子集；门状态也在此；未提供字段保持不变                                         |
| `set_material`    | `target` 为 `{kind:"template", targetId, materialSlot}` 或 `{kind:"object", objectId}`，外加兼容的 `materialId` |
| `add_object`      | 完整 `objects[]` 条目；ID 必须未使用，资产与材质来自注册表                                                      |
| `move_object`     | `objectId` 与完整 `transform`；只操作个人物件，不修改母版几何                                                   |
| `remove_object`   | 已存在的个人 `objectId`；不能移除母版目标                                                                       |
| `set_camera`      | 完整 camera 对象；位置、target、fov 必须在允许范围                                                              |

示例 SSE（省略心跳）；SSE 正常结束只代表服务端流结束，不代表前端场景已更新：

```text
id: 9b2d4b6e-30ea-4b11-bf17-2f5c4a82d61a:3
event: proposal
data: {"turnId":"9b2d4b6e-30ea-4b11-bf17-2f5c4a82d61a","proposalId":"pr_4f2c","editorSessionId":"ed_7b31","baseDraftVersion":12,"operations":[{"op":"set_environment","patch":{"skyPreset":"soft-afternoon","timeOfDay":15.5}},{"op":"add_object","id":"obj_new_bamboo_02","assetId":"garden.bamboo-cluster","name":"新竹丛","transform":{"position":[8,0,4],"rotation":[0,0.35,0],"scale":[1,1,1]},"materialId":"leaf.deep-green"}]}

id: 9b2d4b6e-30ea-4b11-bf17-2f5c4a82d61a:4
event: proposal_ready
data: {"turnId":"9b2d4b6e-30ea-4b11-bf17-2f5c4a82d61a","proposalId":"pr_4f2c","editorSessionId":"ed_7b31","baseDraftVersion":12}
```

前端必须对整个 operation batch 做 schema、资产、数值、数量、ID 唯一性和当前编辑实例/版本校验；以一个 reducer transaction 应用，或完全拒绝。成功后形成可撤销的一条历史记录并递增 `draftVersion`，然后发送对应 ack。只有本地 reducer 确认成功且对应 `turnId + proposalId + editorSessionId + baseDraftVersion` 全部匹配时，界面才可表述“已应用”；服务端仅在收到匹配 ack 后记录已应用。ack 网络失败不回滚已完成的本地操作，提示“已应用，确认待同步”并安全重试 ack。模型文本、工具调用或 SSE 完结不能代替应用确认。默认 Agent 可修改本地草稿但不能保存、分享或发布；保存仍需用户明确点击。

默认在完整提案 `proposal_ready` 后自动预览到本地草稿，允许一键撤销；不逐个应用仍在生成中的操作。前端每个活动 turn 最多应用一个完整提案，应用后重放或额外提案均忽略。SSE 事件应先持久化再发出；示例中的序号 ID 仅用于说明，实际 ID 必须带执行实例唯一部分或使用等价的全局唯一事件 ID，不能让并发执行覆盖已确认事件。

```json
{
  "turnId": "9b2d4b6e-30ea-4b11-bf17-2f5c4a82d61a",
  "proposalId": "pr_4f2c",
  "editorSessionId": "ed_7b31",
  "baseDraftVersion": 12,
  "appliedDraftVersion": 13,
  "outcome": "scene_applied"
}
```

如果用户手动编辑已使 `draftVersion` 改变，迟到提案整批拒绝，不自动 rebase、不覆盖手动修改；提示用户重新提出需求。单个编辑器实例最多一个活动 turn，Stop 会取消本地流并向服务端请求停止；迟到事件按 `(turnId,eventId)` 去重并忽略过期 turn。不同标签页使用独立 editorSessionId/conversation，不能假定平台会话亲和路由或进程锁提供全局串行化；并发运行的费用由全局预算门禁约束，提案不能跨实例应用。

`Makers-Conversation-Id` 的会话持久化不自动授权 owner。每次 turn 都需用已验证 Cookie 查找私有绑定 `{owner, spaceId, conversationId}`；从客户端重放别人的会话 ID 必须 404。`context.store` 可用于跨实例恢复对话上下文，但不能当 owner 验证或分布式锁。SSE 用稳定事件 ID 支持断线游标；客户端按 ID 去重，超时查询 turn 状态并可继续读取事件。状态/事件恢复必须跨实例实测；若历史不可恢复，返回明确 `replay_unavailable` 并保留本地草稿，不得重跑一笔可能计费的 turn。对话内容的 Agent 平台保留/删除策略需安全评审并披露。

Turn 启动请求不因网络超时自动重发。`turnId` 是客户端生成的随机非凭证 ID；已观察到的重复 ID 校验原始 request hash，返回已有状态/结果或明确冲突。Blob 先读后写、KV、进程锁或单独一个 Idempotency-Key 都不提供跨实例 exactly-once，因此 MVP 不承诺模型只计费一次。没有经验证的供应商幂等原语时，并发恶意重复仍可能运行，须被独立费用闸门兜底。未知状态只查询状态/事件；允许用户在明确获知可能重复计费后发起一个新 turn，不自动猜测失败后重跑。

模型供应商与具体模型未定，做可替换 provider adapter；不在规格中写死 SDK、模型名或未验证的结构化输出保证。输出永远由服务端 schema 校验；Agent 失败、超时、取消或无效输出都不能被呈现为已应用。

## 8. 草稿、保存版本、分享状态与冲突恢复

```text
本地草稿 (draftVersion)
  ├─ Agent/手动编辑 → 可撤销的新 draftVersion
  ├─ 明确保存 → Blob 不可变 revision(parentRevisionId)
  └─ 明确发布已保存 revision → 独立只读 snapshot(shareId)
```

- `draftVersion` 是浏览器编辑器内单调递增计数，不等于云端 revision。IndexedDB 保存草稿和撤销栈；没有 IndexedDB 时显示醒目告警，提供立即导出；不得声称本地已安全保存。
- 云端 revision 只在持久化确认后显示“已保存”。网络失败、超时或 Blob 错误显示“尚未同步”；保留本地草稿并允许导出/稍后重试。保存失败时不得推进 `savedRevision`。
- 不可变 revision 通过 `parentRevisionId` 形成分支。两个标签页基于同一父版本保存时，两者可以各自成功；list/strong read 可在之后发现 siblings，但不是原子检测，也不证明“全局最新”。任何版本都不能仅因时间较新而自动覆盖/胜出。
- 若发现 sibling，明确显示分支与父版本；MVP 由用户选择继续编辑某个分支或导出，不自动合并。离线草稿恢复时先显示本地与当前云端分支；不得把本地草稿直接写成覆盖云端 head。
- 分享只发布用户选中的已保存 revision 快照；草稿变更不会静默改变分享。分享权限只有只读。撤销分享后，服务端应在公开读取路径确认撤销状态；撤销传播边界需根据存储/缓存实测。
- 导入文件先做大小与 schema 校验，再进入新本地 draft；不得把导入 ID 当 owner、conversation 或可信资源 URL。恢复旧版本通过新草稿打开，而不是原位改写旧 revision。

## 9. 存储接口边界

### 9.1 默认 Blob 布局

建议在私有 Blob 命名空间中按服务端 owner 隔离：

```text
private/v1/{ownerId}/spaces/{spaceId}/revisions/{revisionId}.json
private/v1/{ownerId}/spaces/{spaceId}/shares/{shareId}.json
private/v1/{ownerId}/conversations/{conversationId}.json
private/v1/{ownerId}/agent-turns/{turnId}/events/{eventId}.json
public/v1/shares/{shareId}/{revisionId}.json
public/v1/shares/{shareId}/revoked.json
```

路径只是部署草案，不得将容器设为可直接匿名列举/读写。Owner 只能取自已验证 Cookie。无可变 head 的情况下通过 owner prefix 分页列出 revision 推导空间；若实测平台 API 不支持可靠分页/前缀 list，则先重新评审目录方案，不以一个无 CAS 的共享 index 假装可并发安全。可选 `head` 仅为可重建提示，不作权威状态。

`public/` 是对象键前缀，不代表公开桶权限；快照由只读 API 返回。shareId 使用高熵不可预测值（可由服务端 HMAC 对 owner/space/revision/shareAttemptId 派生，至少 128 bit），私有 share 绑定供 owner 撤销鉴权；公开 JSON 不含该绑定。公开读取默认 no-store，并强读撤销标记后再返回快照；撤销不能收回他人已下载或另行复制的内容。

EdgeOne Blob 文档描述 strong reads/list，但没有给出事务/CAS 保证。固定 Node SDK 0.0.18 源码中的 `onlyIfNew` 已用于单键条件创建，并在条件失败后强读校验字节；其实际部署语义仍须 staging 验证。先读 baseVersion 再 put、进程锁、KV 计数或最后写入者胜出都不能解决多实例并发。MVP 保存用随机高熵 attempt ID + 完整 payload hash 构造不可变键；强读/list 用于读取和事后分支发现，不原子拒绝兄弟版本。任何需要原子“唯一 head”、精确配额或跨实例唯一任务的能力，只有平台文档或实测证明原子原语后才可依赖。

### 9.2 IndexedDB 与 KV

- IndexedDB 保存用户本地草稿、所选分支、撤销历史、待恢复 turn ID 与事件游标；绝不存 visitor 签名 Cookie、服务端密钥或可用于云端鉴权的 bearer secret。处理配额/eviction，给出导出入口。
- KV 仅可选作最终一致的非敏感偏好或可重建缓存。EdgeOne 文档说明 KV 属于 Edge Functions、跨节点最终一致，旧值最长可见约 60 秒；它不能承载 owner ACL、会话唯一锁、并发 head 或硬配额。
- 默认不加数据库。若未来需求需要原子唯一约束、强一致配额、账号找回或实时协作，应另立方案评审，不在本期暗中引入。

## 10. 部署配置草案与滥用防护

- EdgeOne Makers 项目继续以当前静态构建产物 `dist/` 发布；根级 `agents/` 与函数代码走平台函数/Agent 构建入口，不复制进 `dist/`。`buildCommand`、`installCommand`、`outputDirectory` 可按 EdgeOne JSON 文档配置为 `npm run build`、`npm ci`、`dist`；不要在未选 SDK 前填 `agents.framework` 等猜测值。
- Secrets 使用 EdgeOne 服务端环境配置；禁止放入 git、浏览器 bundle、错误页或 build 输出。生产拒绝缺失/弱签名密钥、非 HTTPS canonical origin、无安全 Cookie、宽松 CORS 或可公开写入的 Blob 配置。
- 不混用 Edge Functions、Node Cloud Functions 与 Agents 的运行时配额；Edge Functions 文档请求体上限标为 1 MB，部署前复核选定运行时的体积/时间/内存限制。应用层将 SceneDocument 限为 256 KiB，并对 prompt、operation 数、字符串与流持续时间单独限额。Agent 模型只接收需要的场景摘要；平台可能保存对话和追踪，不能声称默认不留存，需按实际配置披露并最小化。
- 匿名 Cookie 可删除重建，单 visitor 配额只能软防护，不能阻止有意规避。需要入口/路由限流、单任务并发限制、输入输出 token 上限、超时和取消；失败/超时/取消也按供应商账单可能计费。
- 公开 Agent 写入口上线前，必须有已验证可执行的供应商预算闸门或可靠原子预算预留/拒绝机制，并有告警与熔断。不可用 KV 最终一致计数声称全站硬预算；没有可靠费用闸门时关闭 Agent 写 API，手动编辑/保存与只读官网/分享可单独验收发布。

## 11. 分阶段交付与验收

### 阶段 A：数据与渲染底座

- 抽出版本化 SceneDocument validator、默认母版注册表、稳定对象 ID、实例级可重放 seed；可在编辑实例中还原官方母版，不改变首页只读展示。
- 编辑器 reducer 一次性验证/应用一组操作；撤销/重做；组件白名单与预算；卸载时释放资源。
- 验收：同 seed 重建结果稳定；无效/越界/未知资源拒绝且不部分应用；原页面现有门/视角/园林展示继续工作；WebGL2 与简化模式都不静默保存错误状态。

### 阶段 B：匿名、本地编辑与导入导出

- 同源 session bootstrap、生产 Cookie 和 Origin 防护；跨标签页 bootstrap 串行化；IndexedDB 草稿/撤销/恢复；JSON 导入/导出与用户可见失败提示。
- 验收：请求体伪造 owner/跨空间 ID 无效；清除/过期 Cookie 后显示新匿名空间并说明旧云端不能找回；IDB 不可用时错误可见、可导出且不会显示已保存。

### 阶段 C：Blob 私有版本与分享

- 私有 owner prefix、schema 校验、内容寻址不可变 revisions、strong list/read、兄弟分支提示；只读分享快照和撤销路径。
- 验收：same payload retry 保留相同 bytes/key；不同 payload 不覆盖；并发同 parent 保存均不丢已确认版本，能在之后发现 sibling；缓存/403/404/超时不泄漏跨 owner 内容；分享仅含白名单 JSON 且不可编辑。

### 阶段 D：Agent 草稿编辑

- 确定并评审可替换 provider adapter；类型化 allowlist 工具；SSE 游标/去重/取消；proposal 与 `scene_applied` ack；owner-space-conversation 绑定、平台内容保留说明与可靠费用闸门。
- 验收：当前未保存草稿可被正确编辑；不同编辑实例不串提案；无效/迟到提案不更改草稿；手动编辑不丢；Agent 不能保存/发布；断流后不自动重跑计费请求；超限费用闸门 fail-closed。若预算无法可靠保障，阶段 D 不上线，A–C 的只读/编辑/保存能力仍可独立评审发布。

## 12. 验证矩阵（默认不使用 Chrome）

| 层级            | 场景                                                                                                                          | 通过标准                                                                                                            |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 单元            | SceneDocument 正常/未知字段/重复 ID/NaN/Infinity/越界/错误 asset；所有操作批次合法与非法                                      | 非法批次原子拒绝，不产生部分场景；合法值 round-trip 稳定                                                            |
| 单元            | seed 重放、模板升级、材质/资源 registry 不兼容、Three 资源卸载                                                                | 旧版本显式迁移；不静默换资产；创建/销毁循环无持续资源增长                                                           |
| API 集成        | 无 Cookie、签名错误、过期、伪造 owner、跨 owner space/revision/conversation、跨源 Origin、缺失/恶意 Fetch Metadata            | 写请求拒绝；跨 owner 统一 404；凭证不在响应/日志/URL                                                                |
| 存储集成        | 同 payload 重试、同 attempt 不同 payload、同 parent 并发保存、list 分页、读写超时、Blob 不可用                                | 不覆盖或丢弃任何确认版本；只将持久化成功显示为已保存；兄弟版本稍后可发现，不宣称原子冲突锁                          |
| 浏览器          | Firefox 与 Safari/WebKit；支持的桌面/移动设备；离线编辑、两个标签页、首访 bootstrap、Cookie 清除、无痕退出、IDB 配额/不可用   | bootstrap 不产生会被后续 Set-Cookie 夺走的云端归属；恢复/导出告警准确；同 host 行为一致；不以 Chrome 作为默认验收器 |
| 交互            | WebGL2 与 SVG fallback；大场景/低资源预算；手动编辑与 Agent 迟到提案交错；撤销重做                                            | 降级明确；超限拒绝/提示；变更可回滚；官方母版从未被个人编辑污染                                                     |
| Agent           | 未保存草稿、无效工具输出、超时、断流、重复 SSE、刷新重连、Stop 后迟到事件、多标签并发、费用耗尽                               | 不自动重跑未知计费 turn；按 event ID 去重；stale/跨编辑实例 proposal 不应用；无可靠预算门禁时 API fail-closed       |
| EdgeOne staging | 确认函数与 Agent 在多实例/冷启动下工作；并发同一 owner/不同 owner；Blob 强读写/list；Cookie/secret/响应缓存；函数体积、流时限 | 至少两实例压力/故障注入通过；部署目录不含 server secret；域名/HTTPS/Cookie 与预算门禁可现场核验                     |

## 13. 发布门禁与待决定事项

以下项目在实现前或对应阶段发布前关闭；未关闭时不得把相应能力宣称为可用：

1. 最终 canonical hostname、HTTPS 与开发域名；安全 Cookie 在 EdgeOne Makers 上的实际 Set-Cookie 与跨标签首次 bootstrap 行为。
2. EdgeOne Blob SDK 版本、私有访问配置、对象键长度/字符约束、分页、put 成功与 `onlyIfNew` 条件失败语义；不从单键条件创建推导 CAS/事务。保存 acknowledgement 的持久化依据须有平台说明与 staging 故障测试。
3. Agent SDK/provider、内容留存/删除政策、可恢复对话状态与跨实例事件 replay；原生 `/space-designer` 的 Cookie/Origin 鉴权、SSE 生命周期及 Stop 行为。幂等与并发能力须实测并写明边界，不假设 exactly-once。
4. 全局模型费用预算闸门、入口限流和超限熔断。KV 最终一致不合格；没有可靠费用控制，Agent 写入口保持关闭。
5. Three/WebGL/SVG 下母版可编辑参数清单、默认组件与材质白名单、对象/文档大小上限、熊猫与品牌素材许可、移动端性能预算。
6. 公开 share 的链接可发现性、撤销传播时限、匿名滥用与隐私告知；分享是公开读取，不得误导为私密分享。
7. 访问/错误日志字段、数据保留周期、对话与事件状态的最小保存策略；供应商可能对已取消任务计费且不保证停止，界面须明确。

本规格仅给出可评审的默认方案；未实现、未在 EdgeOne staging 验证的功能仍为计划项。文档获批不等同于实现批准、生产写入许可、发布、域名切换或部署授权。

## 14. 官方资料（部署前复核）

- [EdgeOne Agents](https://pages.edgeone.ai/zh/document/agents)：Agents/函数能力与会话运行模型。
- [EdgeOne Agents 快速开始](https://pages.edgeone.ai/zh/document/agents-quick-start)：handler 入口与 `Makers-Conversation-Id` 格式。
- [EdgeOne Agent 会话存储](https://pages.edgeone.ai/zh/document/agents-conversation-storage)：`context.store` 跨实例持久化；它不代替应用 owner 授权。
- [EdgeOne Blob Storage](https://pages.edgeone.ai/zh/document/blob-storage)：Node SDK、strong read/list；不据此推导 CAS 或事务。
- [EdgeOne KV Storage](https://pages.edgeone.ai/zh/document/kv-storage)：最终一致性与 KV 范围限制。
- [Edge Functions](https://pages.edgeone.ai/zh/document/edge-functions)：请求体限制与函数运行边界。
- [EdgeOne JSON 配置](https://pages.edgeone.ai/zh/document/edgeone-json)：构建与输出目录字段；Agent framework 值按选定 SDK 决定。
- [MDN：Cookie 安全实践](https://developer.mozilla.org/en-US/docs/Web/Security/Practical_implementation_guides/Cookies)。
- [MDN：浏览器存储配额与回收](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria)。
