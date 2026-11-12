# 语音与声纹链路

## 1. 共享设备身份

共享 PWA 的设备 Cookie 只代表“这台设备已绑定到农场”，不代表当前说话人。

第一版使用 1:1 声纹验证：

1. 孩子在共享 PWA 点选自己的头像或地块。
2. 系统要求说出一句短 challenge。
3. 声纹模块验证录音是否匹配所选孩子。
4. 验证失败要求重录，不自动改派给其他孩子。
5. ASR 文本读回，孩子确认后才入队。

不建议第一版直接做开放集 1:N 识别。儿童声线变化、环境噪声和多人说话会显著提高误识别风险。

## 2. 声纹建档

- 同一台共享设备、同一麦克风位置录制。
- 每个孩子至少 3 段、每段 5～8 秒。
- 从多段录音提取多个 embedding 模板。
- 只保存 embedding、模型版本、阈值和同意版本。
- 原始录音只用于建档处理，默认不长期保留。
- 儿童建议每 4～6 周复测或重录。

生产阈值必须使用本场地、本设备和本组儿童样本校准。`src/voice.js` 中的默认相似度和 margin 只是接口默认值，不是生产结论。

## 3. 判定规则

对声明身份进行验证：

```text
score = max similarity(embedding, child templates)
margin = score - best score of all other children
accept = score >= threshold && margin >= minimumMargin
```

每个 case 只记录 `speakerVerification: verified` 和 `speakerProfileVersion`。相似度分数供 Gateway 内部审计和校准，不进入 Agent 提示词。

## 4. 防重放

Challenge 是最小防重放措施：

- 一次性 `challengeId`
- 绑定设备会话和声明孩子
- 短过期时间
- TTS 播报随机短句
- ASR 检查短句是否出现在开头
- 成功后删除 challenge，不能重复使用

声纹不是高安全认证。它只用于防止共享设备上的身份串号，不能用于支付、门禁或账号恢复。

## 5. 音频质量门槛

进入声纹和 ASR 前检查：

- 最短和最长录音时长
- 最小有效语音时长
- 最大静音比例
- 最大削波比例
- 多人说话检测

第一版要求一次只有一个孩子说话。多人声或环境噪声过高时直接要求重录。

## 6. DSH ASR

DSH 现有 `speechToText` 服务支持完整录音转写，不支持流式识别。输入契约为 canonical 16 kHz mono PCM16 WAV；Provider 可选择本地 SenseVoice。

孩子 PWA 可以将 MediaRecorder 输出在浏览器内转换为该格式，或在 Gateway 内使用受控转换器。不要上传任意格式的大文件。

当前 `Transcript` 只有 `text`、`audioSeconds` 和 `inferenceSeconds`，没有 confidence。Gateway 不应伪造 ASR 置信度；应使用音频质量门槛和 TTS 读回确认。

## 7. 数据流

```text
raw audio (memory only)
  -> quality check
  -> speaker embedding + verification
  -> ASR
  -> transcript confirmation
  -> text queue
```

原始音频、embedding 和相似度都不进入 Farm Agent。Agent 只看到转写后的问题文本和最少身份字段。
