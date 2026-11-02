# Loom OS Website

面向 [Loom OS](https://github.com/zalsay/loom-os) 的中文官网。原生 HTML / CSS / JavaScript，首页包含 Three.js 建筑空间，可展开为全屏交互场景。

## 本地运行

需要 Node.js 20.18 或更新版本。所有 3D 浏览器依赖已随源码提供，不依赖 CDN；云端 SDK 与开发测试依赖通过 npm 安装。

```sh
git clone https://github.com/zalsay/loom-web.git
cd loom-web
npm ci
npm run dev
```

打开 `http://localhost:5173`。请通过 HTTP 访问，不要直接双击 HTML。

```sh
npm run check   # JavaScript 语法与静态资源引用检查
npm test        # 场景、历史、身份、API、存储与 Agent 测试（不调用真实模型）
npm run build   # 生成 dist/，并压缩其中的 JS 和 CSS（需先 npm install）
npm run preview # 预览 dist/，默认端口 5173
```

源码统一用 Prettier 排版（配置见 `.prettierrc.json`，`web/vendor/` 不参与）。修改代码前先运行一次 `npm install`：

```sh
npm run format        # 格式化全部源码
npm run format:check  # 只检查，不改文件
```

可通过 `PORT=8080 npm run dev` 指定端口。开发服务器默认只允许本机访问；要用同一局域网的手机测试静态页面，运行 `HOST=0.0.0.0 npm run dev`。匿名写 API 的明文开发例外仅限精确 localhost origin；从手机使用完整云端功能应使用获授权的 HTTPS 预发布环境。仅官网展示可作为静态站部署；个人空间 API 与 Agent 需要 EdgeOne 全栈部署，不能只上传 `dist/`。仓库不自动修改 GitHub Pages、绑定域名或发起部署。

## 结构

```text
web/
  index.html           官网内容与项目文档链接
  styles.css           响应式样式
  js/home.js           能力示意、代码页签、复制、导航与 3D 入口
  world.html           可独立访问的 3D 场景
  world.css            场景控件样式
  js/world.js          渲染、视角、玻璃门与景观交互
  create.html          个人空间编辑器与公开只读快照查看器
  editor.css           编辑器布局、属性面板与移动端切换
  js/editor/           场景契约、撤销历史、IndexedDB、渲染和编辑 UI
  js/agent-client.js   不自动重发的 SSE 客户端
  scene/model.js       白色弧形廊亭与园林构件
  scene/site-layout.js 场地平面、道路与弧线映射
  scene/fallback-rules.js 简化画面（无 WebGL2 时）的构件处理规则
  scene/panda/         Loom OS 熊猫模型，原样复制自 loom-os/logo/panda-3d/src，不参与格式化
  scene/panda-faceted.js 页面使用的熊猫版本：身体为低面数大块面片，哑光材质
  vendor/              Three.js 0.180.0 及所用官方插件
scripts/               Node 内置 HTTP 开发服务器与静态构建
server/                匿名会话、不可变版本、分享与受限 Agent API
cloud-functions/       EdgeOne Node Cloud Functions 入口
agents/space-designer/ EdgeOne 原生 Agent 入口 /space-designer
tests/                 Node 测试与 WebKit / Firefox 浏览器验收
```

## 内容依据

官网基于 Loom OS 仓库的 README、开发计划、Mosaico 真机验收清单、网页阅读器示例编写。当前文案对应 **0.1.1 集成候选**：主机侧集成已通过，Mosaico 真机验收待完成；Network / Agent / Creator 等能力需要设备适配器或 Provider。发布状态变化时，应更新官网 `web/index.html`，以项目仓库为准。

设备屏幕为交互示意，不是设备实拍、实时设备数据或完整操作系统模拟器。首页面向普通访客，以日常操作说明功能、进度与试用方式；开发示例默认收起，点击「想自己写应用？展开看看」才显示。Lua 代码是基于网页阅读器 UI API 改写的最小示例；manifest 展示独立的 `org.loom-os.hello` 示例身份。完整可运行的项目示例请以 Loom OS 仓库为准。

## 织界空间

保留依据用户参考视频与俯视图重建的弧形屋顶、W 形柱、玻璃房、封闭白色栅格、园路与两侧道路。栅格在视频起点一侧，占玻璃房宽度约三分之一；另外约三分之二为入口空间，端部双开玻璃门可开启。面向熊猫的玻璃房正面为带竖向接缝与上下轨道的固定玻璃墙，不设玻璃门。几何尺寸为估算，并非测绘成果。唯一的熊猫是位于左侧栅格柱的静态屋顶熊猫，面朝屋面；身体和头部均为 faceted 面片，双手抓住檐口、脚掌踩在格栅上，臀部略微上翘。

首页 iframe 与正文独立，点击「进入织界空间」可旋转、缩放、切换视角、开关门和景观。按 Esc 或「返回官网」退出。进入视口外或后台时暂停绘制，没有视角、天气粒子或光照变化时按需重绘；WebGL2 不可用时使用简化 SVG 三维预览（无精细材质与实时阴影）。原始参考视频、截图与地图不包含在官网发布文件中。

### 熊猫造型

当前 World 只展示上述静态屋顶熊猫，没有可操控的地面角色或手柄入口。`web/js/panda-controller.js` 与 `web/js/panda-input.js` 保留为独立模块，当前未接入 World 场景。

### 场地天气与昼夜

`world.html` 使用固定场地坐标 `119.36433054520208, 26.042010002204606`（经度、纬度），当地时间固定为 `Asia/Shanghai`，不获取访客位置。天气与当天日出日落来自 MET Norway 的公开 API，经同源 `/api/world-weather` 代理提供；无需 API key，也不依赖个人空间登录或 Agent。天气是当前时段的**模型预报**，不是场地传感器实测；紧凑卡片突出温度与天气，并保留北京时间、当天日出日落。缺少天气或日照数据时使用占位符；数据来源与许可说明见首页页脚的许可说明页。

场景随晴阴、雨雪与昼夜调整光照、天空、雾和降水效果，日出日落呈现暖色过渡；太阳方向是根据当天日照时段的视觉近似，不是测绘方位。减少动态效果设置与后台/屏外暂停同样生效。接口故障不阻塞建筑浏览，日期不匹配的日出日落不会作为“今天”展示。仅部署 `dist/` 的静态站没有天气 API，需同时部署新增的 Cloud Function。

服务端遵守上游 `Expires`、条件请求与退避要求；向上游发送的坐标按接口规范截取至四位小数，不上传访客 IP 或身份 Cookie。默认 User-Agent 使用本仓库链接，可通过 `LOOM_WEATHER_USER_AGENT` 设置实际应用及联系方式。天气署名、CC BY 4.0 和转换说明见 [许可说明页](./web/credits.html)。免费服务没有可用性保证，见 [使用条款](https://docs.api.met.no/doc/TermsOfService.html)。

## 个人织界空间 MVP

打开 `http://localhost:5173/create.html`，从官方母版创建自己的副本。可调整环境、门、廊亭材质与视角，添加竹丛、树木、长椅、园灯，选择/拖动物件或编辑位置、旋转、缩放。支持撤销/重做、IndexedDB 草稿与历史恢复、JSON 导入/导出、不可变保存版本和公开只读分享/撤销。官方只读场景与个人副本的资源互相隔离。

不注册、不采集浏览器指纹。匿名身份由服务端签名的 HttpOnly Cookie 保持；清理 Cookie、过期或更换浏览器/域名后，不能认领原云端空间。保留下来的本地内容可另存为新副本；请定期导出 JSON 备份。多标签页各保留自己的本地记录；同一父版本的并发保存保留为分支，不静默覆盖。

本地开发的“云端保存”API 使用被 git 忽略的 `.loom-data/` 文件存储，**不是实际 EdgeOne 云端**。该目录还包含本地签名密钥；不要公开、上传或随意删除。生产入口只使用 Blob，不会自动退回本地文件或内存。

Agent 默认关闭，编辑器会明确显示状态。配置后它只提出六种白名单场景操作，校验通过才预览到草稿；不能运行代码、自动保存或分享。真实模型联调需要自行选择兼容模型、配置服务端密钥，并先验证供应商侧不可超支的费用上限。网络失败不会自动重新发起可能计费的任务。浏览器测试使用合成提案，服务端测试使用注入 provider，均不调用真实计费模型。

部署准备、环境变量、限制与 staging 门禁见 [EdgeOne 部署说明](docs/edgeone-deployment.md)。产品与技术边界见 [MVP Spec](docs/specs/loom-space-mvp.md)。本地构建和测试通过不代表已经在 EdgeOne 上线。

```sh
npx playwright install webkit firefox
npm run test:e2e  # 只使用 WebKit / Firefox，不使用 Chrome
```

## 第三方许可

Three.js 及官方插件遵循 MIT，许可原文见 `web/vendor/THREE-LICENSE.txt`。场景代码与官网内容的使用授权由仓库所有者决定；未对 Loom OS 本身另作许可声明。

## 页面文案约定

- 首页写给普通访客：先说能做什么、怎么使用、如何试用，用日常操作说明用途。
- 内部测试编号、接口名和开发术语放在开发文档；代码示例保持默认收起。
- 按钮说明点击后会发生什么；加载、失败和操作提示也使用简单中文。
- 说明仍在测试、设备测试未完成的实际状态，不把计划中的能力写成已完成。

## 品牌资源

官网页头和页脚直接使用 Loom OS 仓库的 `logo/Zhi-Jie-logo.svg`，保留原始图形、文字与配色；网站图标使用同一 Logo 的图形部分。官网中的三维入口统一称为「织界空间」。
