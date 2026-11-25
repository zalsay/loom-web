# DuckClaw 颈轴直控固件（专用镜像）

仅用于已核对接线、舵机规格及逐台校准的 **Flashduck ESP32-S3 / DuckClaw**。不适用于另一套 Voice 固件。安装源码或仅构建不会修改原固件、NVS 或设备；要使用直控，维护人员必须显式部署专用镜像。它没有原厂 Agent、表情、LCD、语音、定时任务、WebSocket、配置门户、OTA 或全身初始化；缺密钥、缺校准、断网、重启都**不会回退到原厂动作**。

## 构建，不连接真机

使用固定的 [FlashCat-Jordan/Flashduck 提交](https://github.com/FlashCat-Jordan/Flashduck/tree/9d4316e3f1f7ef693be4d62f4b1aa020a3daedf4/firmware/duckclaw) 和 ESP-IDF v6.0.1。下例从本目录执行：

```sh
python3 tests/run.py                    # C11 主机逻辑与离线配网数据测试
UP="$(mktemp -d)"
git clone https://github.com/FlashCat-Jordan/Flashduck.git "$UP"
git -C "$UP" checkout --detach 9d4316e3f1f7ef693be4d62f4b1aa020a3daedf4
sh install.sh "$UP"
( cd "$UP/firmware/duckclaw_direct" && idf.py build )
```

安装器创建同级独立工程，拒绝版本不符、已改 DuckClaw、带本地 secrets 头文件、覆盖旧工程。新工程链接的**全部上游 C 文件只有** `wifi/wifi_manager.c` 和 `otto/oscillator.c`；JSON 则使用 [Espressif cJSON 1.7.19~2](https://components.espressif.com/components/espressif/cjson/versions/1.7.19~2/readme)。[官方接线](https://github.com/FlashCat-Jordan/Flashduck/blob/9d4316e3f1f7ef693be4d62f4b1aa020a3daedf4/firmware/duckclaw/main/board/board_config.h#L16-L22) 标注 GPIO7 = `OTTO_PIN_RIGHT_HAND` = neck，GPIO4 是嘴。本工程只在首个有效命令开始时 attach GPIO7，调用 [`oscillator_set_position`](https://github.com/FlashCat-Jordan/Flashduck/blob/9d4316e3f1f7ef693be4d62f4b1aa020a3daedf4/firmware/duckclaw/main/otto/oscillator.c#L106-L134)；不用 `otto_init`、`otto_home` 或六轴 pose。本实现采用零 trim 对应的原始角度，不隐式套用原厂 trim。默认控制台为 USB Serial/JTAG 而非 UART0，避免把应用日志送上与腿/脚共用的 GPIO43/44，并关闭 bootloader 日志。应用程序不能约束芯片 ROM、下载模式或复位瞬态的管脚电平；对于只应动颈部的工位，建议物理断开其他舵机及独立控制舵机电源。

## 本地配置及维护

1. 先查本机硬件和舵盘装配、行程、接线、供电；由合格人员在无负载、安全支撑下确定本机**零 trim 原始舵机角度**的安全中位及两侧限位。不得套用示例或猜测角度。必须 `45 <= min < center < max <= 180` 且 `max-min <= 28`。左右标签由网关做本机映射，反装时反向；设备接收的是原始角度而不是「向左」预设。
2. Wi-Fi 复用已配置的上游默认 NVS `wifi_config`（`ssid`, `password`）。直控密钥不是 Wi-Fi 密码、不是网关 API key。只部署在受控隔离 WLAN；HTTP Bearer **不加密传输**，应限制只有网关主机可访问 TCP/80，禁止公网转发、共享/不可信 Wi-Fi。无网络管理或密钥更新端点。
3. 为每台单独生成**新**的本地私密目录（放在仓库之外），提供实测整数；脚本不会访问串口、设备或网络，不会打印密钥。以下命令仅生成文件：

   ```sh
   umask 077
   python3 make-provisioning.py "$PRIVATE_DIR" --min "$MEASURED_MIN" --center "$MEASURED_CENTER" --max "$MEASURED_MAX"
   ( cd "$PRIVATE_DIR" && python "$IDF_PATH/components/nvs_flash/nvs_partition_generator/nvs_partition_gen.py" generate direct.csv direct.bin 0x6000 )
   ```

   `device-key` 是网关使用的专属密钥，CSV/BIN 也包含明文密钥，均须按秘密保管。[IDF NVS 生成器](https://docs.espressif.com/projects/esp-idf/en/v6.0.1/esp32s3/api-reference/storage/nvs_partition_gen.html) 的输入类型为 `key:string`（64 位小写 hex）和 `min_deg/center_deg/max_deg:u8`，namespace 为 `duck_direct`，**分区名为 `duck_keys`**。本方案未实现 flash/NVS 加密；不得以此替代可信局域网与设备物理访问控制。
4. 实机部署是单独的人工步骤：先断开舵机电源，保留可用的原厂镜像与设备完整备份，核对板型、16MB flash、启动槽、实际分区表和回滚方法；仅对匹配固定版本的布局部署。新分区表复用上游 `phy_init` 末尾与 `ota_0` 间的空白，在 `0x12000` 添加大小 `0x6000` 的 `duck_keys`，**保留原 NVS、OTA 和 SPIFFS 的地址**。通过 IDF 的离线/串口流程写专用工程的相应镜像和分区表，并用 IDF `parttool.py … write_partition --partition-name=duck_keys --input .../direct.bin` 将私密 BIN 写入已核对的命名分区；**不要把它写入默认 `nvs`**。本仓库不自动刷写或执行擦除。先验明专用镜像已启动、授权 GET 握手可用，再考虑舵机上电与现场验收。恢复原厂时同样断开舵机电源，恢复匹配的原厂镜像、启动槽和分区表；原厂启动可能自动六轴归位。
5. 每次冷启/复位后，操作员须现场确认颈部实际处于校准中位，无人/障碍物接触机构，才按下并释放 BOOT 解锁。勿强掰带电舵机；不确定中位就不解锁。上电时一直按住不会解锁。按键自身不发 PWM。无有效密钥不启动 HTTP；校准缺失或非法时，只读状态仍可用但 `ready=false`。设备不带编码器，必须由人确认姿态；对准错误会使第一次输出产生突跳。命令后保留最后一帧 PWM 保持舵机，`command_finished` **不表示断电**。卡滞/抖动/断线应人工切断舵机电源，不要重复发送命令来「试试看」。

## wire v1

两个端点均要求 `Authorization: Bearer <device-key>`；固定 80 端口。请求/响应 `Content-Type: application/json`。无 CORS，无设备发现或广播，无管理端点。

- `GET /control/v1/status`：`{v:1,sessionId,uptimeMs,ready,minDeg,centerDeg,maxDeg,motionVerified:false}`。每次启动的 `sessionId` 是 Wi-Fi 启动后生成的 128-bit 随机小写 hex。`ready=false` 亦可能表示正在执行或本次启动的记录已满。
- `POST /control/v1`：严格 8 字段 `{v:1,type:"joint.set",requestId,joint:"neck",angleDeg,durationMs:700,sessionId,expiresAtMs}`。`requestId` 为 1–64 个 ASCII 字母数字/`_`/`-`；只接受校准范围内整数角度。基于刚获取的设备 `uptimeMs` 计算**固定**截止时间（设备受理时 `0 < expiresAtMs - now <= 5000`）；worker 开始前再次检查，过期失败不输出。截止时间是「最迟开始」而不是中途截断。35 个相对时间步，每步至少间隔 20ms、最多变 1°，调度延迟只会延长，不会追赶。固定 700ms 是名义指令轨迹时长；不是到位时限。
- 新命令入单槽队列后立即返回 202；worker 独立输出 PWM。`GET /control/v1/status?id=ID` 返回 200 和 `{v:1,sessionId,requestId,status,motionVerified:false}`。`accepted`=等待/执行中；`command_finished`=最后一帧已送给驱动；`failed`=开始前超时、未执行；`unknown`=当前启动未记录。**没有摄像头/编码器验证实际运动**。
- 每次启动最多保留 128 条命令记录，不淘汰。旧 ID + 相同参数及原截止时间返回当前记录，不入队；相同 ID 不同角度/截止时间或过期/错误启动返回 409；无空位/未解锁/忙返回 503；非法参数 400/422。达到容量后需现场有计划地重启及重新确认姿态。收到超时/未知/会话变化时只查询，不补发、不将旧命令迁移到新的 session 或 requestId。

## 许可

此适配及对 DuckClaw 的组合遵守目录级 [Creative Commons BY-NC-SA 4.0](https://github.com/FlashCat-Jordan/Flashduck/blob/9d4316e3f1f7ef693be4d62f4b1aa020a3daedf4/firmware/duckclaw/LICENSE)，原作者 Ziboyan Wang (Shanmao Tech)，© 2026。变更：新增隔离构建、只读本地配置、HTTP 控制和有限颈轴轨迹。安装器保留该 LICENSE；不要把上层仓库根 MIT 当作 DuckClaw 固件的许可。商用前须取得适当授权；其余第三方组件按各自许可。
