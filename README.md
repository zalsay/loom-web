# Loom OS Website

面向 [Loom OS](https://github.com/zalsay/loom-os) 的中文官网。原生 HTML / CSS / JavaScript，首页包含 Three.js 建筑空间，可展开为全屏交互场景。

## 本地运行

需要 Node.js 20 或更新版本。所有浏览器依赖已随源码提供，无需安装 npm 包，也不依赖 CDN。

```sh
git clone https://github.com/zalsay/loom-web.git
cd loom-web
npm run dev
```

打开 `http://localhost:5173`。请通过 HTTP 访问，不要直接双击 HTML。

```sh
npm run check   # JavaScript 语法与静态资源引用检查
npm run build   # 生成 dist/，并压缩其中的 JS 和 CSS（需先 npm install）
npm run preview # 预览 dist/，默认端口 5173
```

源码统一用 Prettier 排版（配置见 `.prettierrc.json`，`web/vendor/` 不参与）。修改代码前先运行一次 `npm install`：

```sh
npm run format        # 格式化全部源码
npm run format:check  # 只检查，不改文件
```

可通过 `PORT=8080 npm run dev` 指定端口。开发服务器默认只允许本机访问；要用同一局域网的手机测试，运行 `HOST=0.0.0.0 npm run dev`。将 `dist/` 部署到任意静态托管服务即可；构建命令 `npm run build`，输出目录 `dist`。资源使用相对地址，支持子目录托管。仓库不自动修改 GitHub Pages 或绑定域名。

## 结构

```text
web/
  index.html           官网内容与项目文档链接
  styles.css           响应式样式
  js/home.js           能力示意、代码页签、复制、导航与 3D 入口
  world.html           可独立访问的 3D 场景
  world.css            场景控件样式
  js/world.js          渲染、视角、玻璃门与景观交互
  scene/model.js       白色弧形廊亭与园林构件
  scene/site-layout.js 场地平面、道路与弧线映射
  scene/fallback-rules.js 简化画面（无 WebGL2 时）的构件处理规则
  vendor/              Three.js 0.180.0 及所用官方插件
scripts/               Node 内置 HTTP 开发服务器与静态构建
```

## 内容依据

官网基于 Loom OS 仓库的 README、开发计划、Mosaico 真机验收清单、网页阅读器示例编写。当前文案对应 **0.1.1 集成候选**：主机侧集成已通过，Mosaico 真机验收待完成；Network / Agent / Creator 等能力需要设备适配器或 Provider。发布状态变化时，应更新官网 `web/index.html`，以项目仓库为准。

设备屏幕为交互示意，不是设备实拍、实时设备数据或完整操作系统模拟器。首页面向普通访客，以日常操作说明功能、进度与试用方式；开发示例默认收起，点击「想自己写应用？展开看看」才显示。Lua 代码是基于网页阅读器 UI API 改写的最小示例；manifest 展示独立的 `org.loom-os.hello` 示例身份。完整可运行的项目示例请以 Loom OS 仓库为准。

## 织界空间

保留依据用户参考视频与俯视图重建的弧形屋顶、W 形柱、玻璃房、封闭白色栅格、园路与两侧道路。栅格在视频起点一侧，占玻璃房宽度约三分之一；另外约三分之二为入口空间，双开门与单侧门可开启。几何尺寸为估算，并非测绘成果。

首页 iframe 与正文独立，点击「进入织界空间」可旋转、缩放、切换视角、开关门和景观。按 Esc 或「返回官网」退出。进入视口外或后台时暂停绘制，默认静止以减少资源消耗；WebGL2 不可用时使用简化 SVG 三维预览（无精细材质与实时阴影）。原始参考视频、截图与地图不包含在官网发布文件中。

## 第三方许可

Three.js 及官方插件遵循 MIT，许可原文见 `web/vendor/THREE-LICENSE.txt`。场景代码与官网内容的使用授权由仓库所有者决定；未对 Loom OS 本身另作许可声明。

## 页面文案约定

- 首页写给普通访客：先说能做什么、怎么使用、如何试用，用日常操作说明用途。
- 内部测试编号、接口名和开发术语放在开发文档；代码示例保持默认收起。
- 按钮说明点击后会发生什么；加载、失败和操作提示也使用简单中文。
- 说明仍在测试、设备测试未完成的实际状态，不把计划中的能力写成已完成。

## 品牌资源

官网页头和页脚直接使用 Loom OS 仓库的 `logo/Zhi-Jie-logo.svg`，保留原始图形、文字与配色；网站图标使用同一 Logo 的图形部分。官网中的三维入口统一称为「织界空间」。
