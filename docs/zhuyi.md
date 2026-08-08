## 修复

### 本地视频超分比例拉伸（1920×1080→默认16:9）

**症状**：视频本地超分后画面被拉伸/压扁为 16:9 横屏，无论源视频是 9:16 竖屏还是其他比例。

**根因**（两层问题）：
1. `enhance_video` 分辨率检测沿用 ffprobe 回退 ffmpeg -i stderr 解析的双通道方案。ffprobe 分支失败后回退默认 (1920, 1080)；**之前调试时在 `target/debug/ffmpeg/` 留下过一个无效 ffprobe.exe**（由 ffmpeg.exe 直接复制而来，不支持 ffprobe 模式），导致 `ffprobe_path.exists() == true` 始终走 ffprobe 分支 → ffprobe 调用失败 → `.ok()` 返回 None → 回退默认 16:9。
2. fallback 分支中原始 `.find(|w| w.contains('x'))` 的写法无法区分 `1920x1080` 和 `#0:0[0x1](und):` 中的十六进制 `0x1`，导致误匹配。

**修复内容**：
- 删除 `target/debug/ffmpeg/ffprobe.exe`（无效副本）
- fallback 分辨率解析从 `.find()` 改为 `.filter_map()` + `split('x')` + `parse::<u32>()` 严格校验，同时过滤 `height >= 10_000_000`（排除十六进制误匹配）
- 编码器从 `libopenh264` 改为 `libx264`（npm ffmpeg-static 提供了 libx264 但不含 libopenh264）
- 新增分辨率检测全链路 info 日志，便于追踪

**涉及文件**：
- `src-tauri/src/commands/enhance.rs` — 视频超分分辨率检测与编码逻辑

**旅游版风险**：旅游版 `enhance.rs` 的 else 分支直接硬编码 `(1920, 1080)`，完全没有 ffmpeg -i 回退逻辑。若 ffprobe 缺失或不可用（如 Windows 端 npm ffmpeg-static 不含 ffprobe），所有视频超分都会默认 16:9。需要将服饰版的修复移植到旅游版。
