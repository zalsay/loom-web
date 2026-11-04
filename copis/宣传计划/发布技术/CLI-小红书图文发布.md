# CLI-小红书图文发布（MCC 自动化指南）

更新日期：2026-11-04  
适用工具：`mcc` (v0.3.6) + Google Chrome 自动化  
目标场景：小红书创作服务平台（`creator.xiaohongshu.com`）图文笔记自动上传、标题正文填写与暂存离开/发布。

---

## 一、实操关键经验与避坑清单

1. **绝对权限与安全性**：
   - 严禁绕过权限，严格使用用户已授权的 `windowId`；
   - 任务未确认发布前，**绝对禁止点击【发布】按钮**，严格点击【暂存离开】。
2. **正文换行限制**：
   - `mcc type` **严禁包含 `\n` 控制字符**，否则报 `INVALID_ARGUMENT: 不能包含控制字符`；
   - 段落换行必须通过 `mcc press --key Enter` 投递；两段之间空行连续按两次 `Enter`。
3. **按键映射规范**：
   - macOS 系统的回车键在 MCC 中名称为 `Enter`，**不是 `Return`**（输入 `Return` 会报不在允许按键列表中）。
4. **多图上传逻辑**：
   - 第一张图点击页面中央的「上传图片」按钮，随后通过 `mcc select-file --path <file>` 调起并自动确认原生系统选图弹窗；
   - 后续图片：页面缩略图左侧会固定常驻一个「+」图标（如坐标约 `(461, 267)`），点击后再次调用 `mcc select-file` 追加；
   - 每次选图后调用 `mcc observe` 核对缩略图数量（如 `4/18`）及首图预览。
5. **USER_PAUSED 安全接管机制**：
   - MCC 本机运行模式下，若检测到真实用户操作、鼠标移动或窗口失焦，会立即触发挂起保护并返回 `USER_PAUSED`；
   - 此时在 Mac 屏幕顶部中央会出现浮动控制条，必须由本人点击「继续」按钮并等待 3 秒倒计时后方可恢复输入；
   - 恢复后必须整步重新 observe 校验，不可假设前一个动作已生效。
6. **收尾断开规范**：
   - 任务结束后，必须显式调用 `mcc disconnect --connection <id>` 释放窗口控制租约。

---

## 二、标准执行脚本示例

```bash
# 1. 观察当前 Chrome 页面状态
mcc observe --connection <id>

# 2. 点击上传第一张图片
mcc click --connection <id> --frame <frameId> --x 821 --y 719
mcc select-file --connection <id> --path /absolute/path/01-封面.png

# 3. 点击 + 追加后续图片
mcc click --connection <id> --frame <frameId> --x 461 --y 267
mcc select-file --connection <id> --path /absolute/path/02-两难.png

# 4. 聚焦标题并打字
mcc click --connection <id> --frame <frameId> --x 499 --y 376
mcc type --connection <id> --frame <frameId> --text "7岁女儿说想要个机器人，这话怎么接？"

# 5. 聚焦正文并分段输入
mcc click --connection <id> --frame <frameId> --x 562 --y 422
mcc type --connection <id> --frame <frameId> --text "第一段文字..."
mcc press --connection <id> --frame <frameId> --key Enter
mcc press --connection <id> --frame <frameId> --key Enter
mcc type --connection <id> --frame <frameId> --text "第二段文字..."

# 6. 暂存离开（保存草稿箱，禁止点发布）
mcc click --connection <id> --frame <frameId> --x 663 --y 1253

# 7. 观察验证并断开
mcc observe --connection <id>
mcc disconnect --connection <id>
```
