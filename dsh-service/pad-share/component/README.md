# pad_share — ESP-IDF 单卡快照、项目卡片列表与照片接收

把本目录作为 `components/pad_share` 加入固件，调用方依赖 `pad_share` 并包含 `pad_share.h`。组件不启动 Wi-Fi，也不接受客户端指定的文件名或目录。默认事件循环、Wi-Fi、默认 `WIFI_STA_DEF` 接口需由应用初始化，并在 `pad_share_stop()` 返回前保持存在。仅支持已关联且有 IPv4 的 Wi-Fi STA 模式；不支持 SoftAP、AP+STA 或蜂窝。

```c
const char *steps[] = {"先读说明", "记录观察"};
pad_share_snapshot_t snapshot = {.title="实验卡", .steps=steps, .step_count=2};
char path[PAD_SHARE_PATH_SIZE];
esp_err_t err = pad_share_start(NULL, &snapshot, path, sizeof(path));
/* 成功后由设备 UI 展示 http://<STA IPv4>:8088 + path；不要记录 URL 或上传。 */
/* UI 关闭时调用 pad_share_stop()；轮询发现 !pad_share_active() 时也应调用 stop 释放资源。 */
```

- 分享已导出的 HTML 时，零初始化 `pad_share_snapshot_t`，只设置 `html`、`html_size`。输入是已批准的 UTF-8 单页内存，不是文件系统路径；仅保留文本与有限的无属性结构标签。脚本、样式、图片、链接、外部资源、表单和原始布局不会透传。结构化模式可附一张已经批准的 JPEG/PNG（检查类型签名而非完整解码）；不读取客户端提交的任何资源。
- 调用者在 `start` 期间须保持输入有效且不变，返回后可以释放。最大输入 HTML 64 KiB；结构化标题 512 字节、最多 64 步、每步 4096 字节；最终 HTML 最多 128 KiB，另加最多 128 KiB 图片。为避免双份常驻快照，启动新分享会先撤销旧分享，即使新输入未通过校验也不会复用旧链接。
- 默认 HTTP TCP 8088，控制 UDP 32769，TTL 300 秒；可以配置不同端口和 1–86400 秒有效期。不要与其他服务共用端口。HTTPD 在任意地址监听，但只接受本地目的地址为分享时 STA IPv4 的连接。关闭/切换网络、进入 SoftAP、重新获取 IP 或接收断线事件后，分享失效，不会自动恢复。
- 访问者只有在持有完整随机链接时才能 GET 当前快照和它的一张可选图片。此为明文 HTTP，只宜在可信 Wi-Fi 上短时展示；持有者能保存、转发或截屏。立即撤销拒绝新的访问并在发送下一块前检查，无法追回已发送或进入 TCP 缓冲区的字节。TTL 到期后不再允许读取；回收监听任务和快照内存须由 UI/调用者调用 `stop`。任务上下文调用 API，不要从中断、HTTP 回调或默认事件循环调用。

## 当前项目卡片列表（单独开通，只读）

先调用 `pad_share_current_project(id)` 并显示待授权项目，用户确认后将同一个 ID 传给 `pad_share_library_start(cfg,id,path,sizeof(path))`。只枚举 `/sdcard/metalio/e-ink/project/<id>/cards/` 下的直接普通文件，扩展名 `.html` 不区分大小写；不递归、不读取照片、不包含其他项目。只支持已挂载的 FatFs。全局 `current.html` 没有项目归属，不自动纳入列表；可继续显式开通旧单卡快照，或把确定归属的卡复制进该项目的 `cards/`。

- 启动时只保存按文件名排序的索引（每名不超过 255 字节，非空标题，禁止控制字符、斜杠、反斜杠及冒号）；不把目录内的每张卡加载到内存。超过 128 个归档条目返回 `ESP_ERR_INVALID_SIZE`，不会截断列表。目录尚未创建或为空显示「暂无卡片」。每页 12 张，显示文件名去掉扩展名后的文字。会话内新文件要重新授权才出现。
- `GET /l/<token>/` 返回首页，`p2` 等返回其他页，`c1` 等打开卡片；详情带「返回卡片列表」。仅接受精确编号和该设备 STA 的 Host，不接收路径、查询、写入或上传。详情打开时从已授权目录读取对应文件，再用单卡的安全 HTML 投影生成页面；归档**不是内容快照**，原地替换后可能看到新内容；删除返回 404，空文件或超过 64 KiB 返回 422，读卡失败返回错误，不输出原始 HTML。
- 三种模式互斥，重开（即使失败）会撤销旧链接。网络和 TTL 条件同上。列表启动前后、请求开始、准备完成和每个发送块前都复核 `current.id`，一旦发现变化会永久撤销本次授权。项目管理端切换前必须先 `pad_share_stop()`；轮询不能检测两次读取之间发生的切出又切回。

## 照片接收（单独开通，不给只读链接加权限）

`pad_share_current_project(id)` 读取 SD 上 `/sdcard/metalio/e-ink/project/current.id`，只接受 1–32 位小写 ASCII 字母、数字、`_`、`-`，允许单个 LF/CRLF，拒绝 FAT 设备保留名。当前项目必须由可信项目管理方写入；没有标识就不能开接收，不回退到通用目录。项目切换方应先 `pad_share_stop()`，再更新标识；UI 的 `pad_share_active()` 轮询以及每次上传开始、发布前还会复核标识。此接口仅用于已挂载的本地 FatFs SD（无符号链接），不接收客户端文件名、项目名或保存路径。

`pad_share_upload_start(cfg,id,path,sizeof(path))` 替换已有服务并返回新的 128 位随机 `/u/<token>/`。GET 只返回手机表单；仅同一 STA `Host` 和 `Origin` 可 `POST /u/<token>/photo`，不提供照片 GET、目录列表、删除、覆盖或任意文件 API。未使用 CORS，不加载外网脚本。只读分享和接收共用监听器、撤销开关、网络失效条件和 TTL，但每次授权重新抽取密钥。局域网 HTTP 不是加密认证，请只在可信网络短时开启。

每次 POST 必须携带 `Content-Type: image/jpeg`、严格十进制 `Content-Length` 和每次选择新生成的 32 位小写十六进制 `X-Upload-Id`，不接受分块或编码请求体。单次 ≤1 MiB，最多 8 个成功保存的选择/会话，无失败自动重传；同一已保存 ID 即使回复丢失再请求也返回 409，不会多写一份。1 个同步处理任务；接收每次等待最多 2 秒，整次处理截止 60 秒且不晚于分享过期。接受最长边 ≤2048 的 8-bit baseline JPEG（灰度或三分量、单扫描），验证 JPEG 段、Huffman 系数块、重启标记和精确 EOI；非 JPEG、渐进 JPEG、截断、尾随数据和超限尺寸均不发布。

服务在绑定项目的 `<id>/photos` 内以固定 1 KiB 缓冲写 `receive.tmp`，验证后 `fsync`、成功关闭、复核权限，再用 FatFs 同目录 rename 发布为设备生成的八位十六进制 `.jpg`；随机名碰撞拒绝，绝不采用手机文件名。成功发布后才增加 `pad_share_upload_count()` 并回复 **201** `{"saved":true}`。错误、断网、退出或超期不发布未完成文件，尽力删除临时文件；突然断电/拔卡可能留下保留的 `receive.tmp`，下次开启该项目接收时清理。已提交的照片不因关闭接收而删除；若设备计数增加但手机未获确认，请先核对，不要自动换 ID 重发。FatFs、卡固件和供电决定物理掉电可靠性，rename 不是整卡断电事务。

主机测试（POSIX C11）：`./test/run.sh`；可选 `CFLAGS='-fsanitize=address,undefined' ./test/run.sh`。测试使用固件的同一快照构建、上传路由、JPEG 校验及流式存储代码，还以传输替身驱动实际 HTTP 请求适配层，覆盖来源、长度、类型、成功落盘后发送失败的重放、读写切换、网络失效和过期。主机临时目录和传输替身不代替真机无线电、IDF HTTP 解析器、TCP 或 FatFs 实测。
