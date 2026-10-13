# 行业版本功能复刻总文档（读图能力 + H3 视频模型）

> **用途**：把任意一个行业版本（服饰 / 美妆 / 旅游 / 大健康 / 萌宠 / 科普 …）一次补齐两大功能——**读图能力** + **H3 视频模型**，外加若干配套修复。用户说「复刻到 XX 版本」时，照本文档逐项执行即可。
>
> 本文档 = `pic.md`（读图能力等 6 个 Part）+ `h3.md`（H3 迁移）的**合并版**，消除两文交叉重复，并补入科普版 v1.1.0 实战踩坑。
>
> **已实战验证**：短视频版（首个 H3）、科普版 v1.1.0（照本文档完整落地：读图 + H3 + 排队 + 1.5秒 + 品牌清理 + 报错翻译，`cargo check` + `tsc` 双绿）。

---

## 0. 铁律（不可违反）

1. **视频生成 / 宫格生成一律走百度 VOD**（`BAIDU_VIDEO_KEY`），H3 与欢乐马走同一条百度 VOD 通道，只是调用模型不同（`vod.bj.baidubce.com/v3/aigc/minimax`）。**禁止阿里云 DashScope 直连、禁止 wan2.7。**
2. **发布日志 / 更新日志（`notes` 字段）禁止出现模型名称**（MiniMax / H3 / 海螺 / 欢乐马 / happyhorse / wan 等）。本文档是内部技术文档，可以出现模型名。
3. **积分扣费 / 退费逻辑零改动**——`banana_consume_credit` / `refund_generation_credit` 与模型无关。
4. **参考图不变**——继续用单张 6 宫格故事板合成图，作为 `reference_image` 传入。
5. **各专业版的专属词绝对不能动**——规则 JSON / SKILL.md 里的「行业主体锁定」「行业写实质感」「合规句」是每个版本各自的专属词。迁移时**只改运镜 / 时间戳 / 音频格式**，保留目标版本自己的专属词。

---

## 1. 功能总览（6 块）

| 块 | 功能 | 来源 |
|----|------|------|
| **A** | H3 视频模型迁移（默认模型 欢乐马 → MiniMax H3） | h3.md |
| **B** | 读图能力（图片 → 千帆 VL 视觉描述 → skill 上下文） | pic.md Part 1 + 5 |
| **C** | 视频规则「每个镜头时长 ≥ 1.5 秒」 | pic.md Part 2 |
| **D** | 自动连线参考图（素材库 → 画布直通） | pic.md Part 3 |
| **E** | 品牌名残留清理 | pic.md Part 4 |
| **F** | 百度图片生成报错翻译 | pic.md Part 6 |

> 块 A 和块 C 都改到 `video_gen_rules_minimax_h3.json`（A 新建、C 加 1.5 秒），合并处理见 §5.1。

---

## 2. 前置条件核对（复刻前必查）

### 2.1 Cargo 依赖

H3 provider 和读图都用到以下 crate，确认目标版本已有（欢乐马版本已具备）：

```toml
base64 = "0.22"
image = "0.25"
md5 = "0.7"
```

### 2.2 既有能力（读图功能依赖，缺一不可）

**后端（Rust）**

| # | 依赖 | 位置 | 说明 |
|---|------|------|------|
| 1 | `chat_send_message` 支持 `project_context` 参数并注入 `【项目全局上下文】` | `commands/chat.rs` | **命门**：读图描述传给 skill 的最后一环 |
| 2 | `open_db(app)` / `ensure_assets_table(conn)` | `commands/asset.rs` | 读图复用 |
| 3 | `secret_setter!` / `secret_getter!` 宏、`Arc`/`Mutex`/`OnceLock` 导入 | `commands/banana_api.rs` | 千帆 VL key 存储复用 |
| 4 | `AIError::Provider(String)` 变体 | `ai/error.rs` | `describe.rs` 依赖 |

**前端（TS）**

| # | 依赖 | 位置 | 说明 |
|---|------|------|------|
| 5 | `projectContext` 状态 + `setProjectContext` action + `currentProjectId` 字段 + `sendMessage` 传 `projectContext` | `stores/chatStore.ts` | 读图上下文注入依赖 |
| 6 | `AddAssetDialog` 组件，props `{ projectId, isOpen, onClose }` | `features/project/AddAssetDialog.tsx` | Chat 上传弹窗 |
| 7 | `readProjectGlobalsMd` 命令 | `commands/projectState.ts` | `projectContext.ts` 依赖 |
| 8 | `getEmphasisLabels` 函数 | `features/project/presets.ts` | `projectContext.ts` 依赖（各行业版维度不同，函数签名一致） |
| 9 | `currentProject`（含 `aspectRatio/style/tone/directorRef/emphasisDimensions`） | `stores/projectStore.ts` | `projectContext.ts` 兜底参数 |

**核对方法**（第 1 项最关键）：

```bash
grep -n "project_context\|项目全局上下文" src-tauri/src/commands/chat.rs
```

确认有 `system_prompt.push_str` 注入 `【项目全局上下文】` 的逻辑。其余各项 grep 对应函数名 / 字段名即可。

---

## 3. 后端改动（Rust）

### 3.1 新增 `src-tauri/src/ai/describe.rs`（块 B，原样复制）

千帆 ERNIE-VL 读图模块（含 WebP→PNG 兜底），**行业无关，全文原样复制**：

```rust
use std::io::Cursor;

use base64::Engine;
use reqwest::Client;
use tokio::time::Duration;
use tracing::info;

use crate::ai::error::AIError;

/// 千帆 OpenAI 兼容接口（ERNIE-VL 多模态读图）。
const QIANFAN_VL_URL: &str = "https://qianfan.baidubce.com/v2/chat/completions";
/// 读图模型标识。复刻到衍生版本无需改动（行业无关）。
const QIANFAN_VL_MODEL: &str = "ernie-4.5-turbo-vl";

/// 通用视觉描述引导词：结构化、客观、可复现，不绑定任何行业。
const DESCRIBE_PROMPT: &str = r#"你是一名专业的图像描述助手。请仔细观察这张参考图，用简洁、客观、结构化的中文描述图片内容，供后续分镜提示词生成使用。

严格按以下维度输出（每项一行，无内容则写"无"）：
- 主体：画面主要人物/物体的外观特征（年龄、性别、发型发色、服装、动作姿态）
- 配色：主色调与色彩搭配
- 构图：景别（特写/近景/中景/全景/远景）与画面布局
- 风格：艺术风格（写实/国风/赛博朋克/日系等）
- 光线：光照方向与氛围（自然光/影棚光/夜景/黄金时刻等）
- 关键元素：服装道具/品牌标识/文字等细节
- 背景：背景环境与氛围

要求：描述客观、可复现，不添加主观评价或故事性延伸，控制在 150 字以内。"#;

/// 千帆 VL 的 base64 通道仅支持 JPG/PNG/BMP；WebP/GIF 等需先转 PNG。
fn normalize_for_vl(image_bytes: &[u8]) -> Result<(Vec<u8>, &'static str), AIError> {
    let fmt = image::guess_format(image_bytes).unwrap_or(image::ImageFormat::Png);
    let (bytes, media_type) = match fmt {
        image::ImageFormat::Jpeg => (image_bytes.to_vec(), "image/jpeg"),
        image::ImageFormat::Png => (image_bytes.to_vec(), "image/png"),
        image::ImageFormat::Bmp => (image_bytes.to_vec(), "image/bmp"),
        _ => {
            let img = image::load_from_memory(image_bytes)
                .map_err(|e| AIError::Provider(format!("读图图片解码失败: {}", e)))?;
            let mut buf = Vec::new();
            img.write_to(&mut Cursor::new(&mut buf), image::ImageFormat::Png)
                .map_err(|e| AIError::Provider(format!("读图图片转PNG失败: {}", e)))?;
            (buf, "image/png")
        }
    };
    Ok((bytes, media_type))
}

pub async fn describe_image(image_bytes: &[u8], api_key: &str) -> Result<String, AIError> {
    if api_key.is_empty() {
        return Err(AIError::Provider("千帆VL读图API密钥未配置".to_string()));
    }

    let (image_bytes, media_type) = normalize_for_vl(image_bytes)?;

    let b64 = base64::engine::general_purpose::STANDARD.encode(&image_bytes);
    let image_data_url = format!("data:{};base64,{}", media_type, b64);

    let body = serde_json::json!({
        "model": QIANFAN_VL_MODEL,
        "messages": [
            {
                "role": "user",
                "content": [
                    { "type": "text", "text": DESCRIBE_PROMPT },
                    { "type": "image_url", "image_url": { "url": image_data_url } }
                ]
            }
        ],
        "max_tokens": 512,
        "temperature": 0.3
    });

    let client = Client::builder()
        .timeout(Duration::from_secs(30))
        .connect_timeout(Duration::from_secs(10))
        .build()?;

    info!("[读图] 千帆VL请求, image {} bytes", image_bytes.len());

    let response = client
        .post(QIANFAN_VL_URL)
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await?;

    let status = response.status();
    if !status.is_success() {
        let error_text = response.text().await.unwrap_or_default();
        return Err(AIError::Provider(format!(
            "千帆VL API error {}: {}",
            status, error_text
        )));
    }

    let result: serde_json::Value = response
        .json()
        .await
        .map_err(|e| AIError::Provider(format!("千帆VL response parse error: {}", e)))?;

    let description = result
        .pointer("/choices/0/message/content")
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .unwrap_or_default();

    if description.is_empty() {
        return Err(AIError::Provider("千帆VL返回空描述".to_string()));
    }

    info!("[读图] 千帆VL完成, description {} chars", description.len());

    Ok(description)
}
```

### 3.2 新增 `src-tauri/src/ai/providers/minimax/mod.rs`（块 A，原样复制）

MiniMax H3 走百度 VOD 原生透传。**含「排队中」分支，务必用这一版**（旧文档缺 `Queued` 分支）：

```rust
use base64::Engine;
use reqwest::Client;
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::Arc;
use tokio::sync::RwLock;
use tokio::time::{sleep, Duration};
use tracing::info;

use crate::ai::error::AIError;
use crate::ai::{
    AIProvider, GenerateRequest, ProviderTaskHandle, ProviderTaskPollResult, ProviderTaskSubmission,
};

// ── MiniMax H3 via 百度 VOD 原生透传 ──
const BASE_URL: &str = "https://vod.bj.baidubce.com/v3/aigc/minimax";
const CREATE_PATH: &str = "/v2/video_generation";
const QUERY_PATH: &str = "/v2/query/video_generation";
const POLL_INTERVAL_MS: u64 = 10000;
const API_MODEL: &str = "MiniMax-H3";

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct MinimaxCreateResponse {
    task_id: Option<String>,
    code: Option<String>,
    message: Option<String>,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct MinimaxQueryResponse {
    task: Option<MinimaxTask>,
    status: Option<String>,
    content: Option<MinimaxContent>,
    code: Option<String>,
    message: Option<String>,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct MinimaxTask {
    status: Option<String>,
    content: Option<MinimaxContent>,
    #[serde(rename = "videoUrl")]
    video_url: Option<String>,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct MinimaxContent {
    url: Option<String>,
    #[serde(rename = "videoUrl")]
    video_url: Option<String>,
}

pub struct MiniMaxProvider {
    client: Client,
    api_key: Arc<RwLock<Option<String>>>,
}

impl MiniMaxProvider {
    pub fn new() -> Self {
        Self {
            client: Client::builder()
                .timeout(Duration::from_secs(2000))
                .connect_timeout(Duration::from_secs(30))
                .build()
                .unwrap_or_else(|_| Client::new()),
            api_key: Arc::new(RwLock::new(None)),
        }
    }

    fn sanitize_model(model: &str) -> String {
        model
            .split_once('/')
            .map(|(_, bare)| bare.to_string())
            .unwrap_or_else(|| model.to_string())
    }

    fn query_status(resp: &MinimaxQueryResponse) -> String {
        resp.task
            .as_ref()
            .and_then(|t| t.status.as_deref())
            .or(resp.status.as_deref())
            .unwrap_or("")
            .to_uppercase()
    }

    fn extract_video_url(resp: &MinimaxQueryResponse) -> Option<String> {
        let task = resp.task.as_ref();
        if let Some(u) = task
            .and_then(|t| t.content.as_ref())
            .and_then(|c| c.url.as_ref())
            .filter(|u| !u.is_empty())
        {
            return Some(u.clone());
        }
        if let Some(u) = task
            .and_then(|t| t.content.as_ref())
            .and_then(|c| c.video_url.as_ref())
            .filter(|u| !u.is_empty())
        {
            return Some(u.clone());
        }
        if let Some(u) = task
            .and_then(|t| t.video_url.as_ref())
            .filter(|u| !u.is_empty())
        {
            return Some(u.clone());
        }
        if let Some(u) = resp
            .content
            .as_ref()
            .and_then(|c| c.url.as_ref())
            .filter(|u| !u.is_empty())
        {
            return Some(u.clone());
        }
        resp.content
            .as_ref()
            .and_then(|c| c.video_url.as_ref())
            .filter(|u| !u.is_empty())
            .map(|u| u.clone())
    }

    /// 检测百度 VOD 以 HTTP 200 返回的错误体 {"type":"error",...}
    fn extract_error_body(raw: &str) -> Option<String> {
        let val: Value = serde_json::from_str(raw).ok()?;
        if val.get("type").and_then(|t| t.as_str()) != Some("error") {
            return None;
        }
        let msg: String = val
            .pointer("/error/message")
            .and_then(|m| m.as_str())
            .map(|s| {
                match serde_json::from_str::<Value>(s) {
                    Ok(nested) => nested
                        .pointer("/error/message")
                        .and_then(|m| m.as_str())
                        .unwrap_or(s)
                        .to_string(),
                    Err(_) => s.to_string(),
                }
            })
            .unwrap_or_else(|| "MiniMax H3 未知错误".to_string());
        Some(msg)
    }

    /// H3 参考图单边上限 5760，超限等比缩放 + JPEG q85 重编码。
    fn downscale_base64_image(data_url: &str, max_side: u32) -> Option<String> {
        let b64 = data_url.strip_prefix("data:")?.split_once(";base64,")?.1;
        let bytes = base64::engine::general_purpose::STANDARD.decode(b64).ok()?;
        let img = image::load_from_memory(&bytes).ok()?;
        let (w, h) = (img.width(), img.height());
        if w <= max_side && h <= max_side {
            return Some(data_url.to_string());
        }
        let scale = (max_side as f64) / (w.max(h) as f64);
        let nw = ((w as f64) * scale).round().max(1.0) as u32;
        let nh = ((h as f64) * scale).round().max(1.0) as u32;
        let resized = img.resize_exact(nw, nh, image::imageops::FilterType::Lanczos3);
        let rgb = resized.to_rgb8();
        let mut buf = std::io::Cursor::new(Vec::new());
        let mut enc = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buf, 85);
        enc.encode_image(&rgb).ok()?;
        let new_b64 = base64::engine::general_purpose::STANDARD.encode(buf.into_inner());
        Some(format!("data:image/jpeg;base64,{}", new_b64))
    }

    /// H3 用 content[] 结构：text + image_url（role=reference_image）
    fn build_content(prompt: &str, reference_images: &[String]) -> Vec<Value> {
        let mut content: Vec<Value> = vec![json!({
            "type": "text",
            "text": prompt,
        })];
        for ref_img in reference_images {
            if ref_img.starts_with("data:") {
                let url = Self::downscale_base64_image(ref_img, 5760)
                    .unwrap_or_else(|| ref_img.clone());
                content.push(json!({
                    "type": "image_url",
                    "image_url": { "url": url },
                    "role": "reference_image",
                }));
            } else if ref_img.starts_with("http://") || ref_img.starts_with("https://") {
                content.push(json!({
                    "type": "image_url",
                    "image_url": { "url": ref_img },
                    "role": "reference_image",
                }));
            }
        }
        content
    }

    async fn create_task(
        &self,
        api_key: &str,
        request: &GenerateRequest,
    ) -> Result<String, AIError> {
        let duration = request
            .extra_params
            .as_ref()
            .and_then(|params| params.get("duration_seconds"))
            .and_then(|raw| raw.as_u64())
            .unwrap_or(5) as u32;

        // H3 只支持 768P / 2K，不支持 720P。banana_api 写入的 key 是 quality（小写 "720p"），
        // 归一化为 "768P"（H3 最低档），积分档位仍按原 720P 计、不变。
        let resolution = request
            .extra_params
            .as_ref()
            .and_then(|params| params.get("quality"))
            .and_then(|raw| raw.as_str())
            .map(|q| {
                if q.eq_ignore_ascii_case("720p") {
                    "768P".to_string()
                } else {
                    q.to_uppercase()
                }
            })
            .unwrap_or_else(|| "768P".to_string());

        let reference_images = request.reference_images.as_deref().unwrap_or(&[]);
        let content = Self::build_content(&request.prompt, reference_images);

        let body = json!({
            "model": API_MODEL,
            "content": content,
            "resolution": resolution,
            "duration": duration,
            "ratio": request.aspect_ratio,
        });

        let endpoint = format!("{}{}", BASE_URL, CREATE_PATH);
        info!(
            "[MiniMax H3 createTask] model={}, duration={}, resolution={}, ratio={}, refs={}, promptLen={}",
            API_MODEL, duration, resolution, request.aspect_ratio,
            reference_images.len(), request.prompt.chars().count()
        );
        info!("[MiniMax H3 createTask] FULL PROMPT:\n{}", request.prompt);

        let response = self
            .client
            .post(&endpoint)
            .header("Authorization", format!("Bearer {}", api_key))
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await?;

        let status = response.status();
        let raw = response.text().await.unwrap_or_default();

        if !status.is_success() {
            return Err(AIError::Provider(format!(
                "MiniMax H3 createTask failed {}: {}",
                status, raw
            )));
        }

        info!("[MiniMax H3 createTask] raw response: {}", raw);
        let resp: MinimaxCreateResponse = serde_json::from_str(&raw).map_err(|err| {
            AIError::Provider(format!("MiniMax H3 create invalid JSON: {}; raw={}", err, raw))
        })?;

        if let Some(code) = &resp.code {
            let msg = resp.message.as_deref().unwrap_or("unknown");
            if code != "0" && code != "Success" {
                return Err(AIError::Provider(format!(
                    "MiniMax H3 create API error [{}]: {}",
                    code, msg
                )));
            }
        }

        resp.task_id
            .filter(|id| !id.is_empty())
            .ok_or_else(|| AIError::Provider(format!("MiniMax H3 create missing task_id. raw={}", raw)))
    }

    async fn poll_task_once(
        &self,
        api_key: &str,
        task_id: &str,
    ) -> Result<ProviderTaskPollResult, AIError> {
        let endpoint = format!("{}{}/{}", BASE_URL, QUERY_PATH, task_id);
        let key_prefix = if api_key.len() > 20 { &api_key[..20] } else { api_key };
        info!("[MiniMax H3 Poll] url={}, key={}...", endpoint, key_prefix);

        let response = self
            .client
            .get(&endpoint)
            .header("Authorization", format!("Bearer {}", api_key))
            .send()
            .await?;

        let status = response.status();
        let raw = response.text().await.unwrap_or_default();

        if !status.is_success() {
            return Err(AIError::Provider(format!(
                "MiniMax H3 query failed {}: {}",
                status, raw
            )));
        }

        info!("[MiniMax H3 Poll] raw response: {}", raw);

        // 百度 VOD 可能以 HTTP 200 返回错误体，视为任务失败（终态），避免前端无限轮询。
        if let Some(err_msg) = Self::extract_error_body(&raw) {
            info!("[MiniMax H3] task {} FAILED (error body): {}", task_id, err_msg);
            return Ok(ProviderTaskPollResult::Failed(err_msg));
        }

        let resp: MinimaxQueryResponse = serde_json::from_str(&raw).map_err(|err| {
            AIError::Provider(format!("MiniMax H3 query invalid JSON: {}; raw={}", err, raw))
        })?;

        if let Some(code) = &resp.code {
            let msg = resp.message.as_deref().unwrap_or("unknown");
            if code != "0" && code != "Success" {
                return Err(AIError::Provider(format!(
                    "MiniMax H3 query API error [{}]: {}",
                    code, msg
                )));
            }
        }

        // 只要拿到视频 URL 就视为成功（可能早于 status 翻转为 succeeded）
        if let Some(url) = Self::extract_video_url(&resp) {
            info!("[MiniMax H3] task {} succeeded: {}", task_id, url);
            return Ok(ProviderTaskPollResult::Succeeded(url));
        }

        let task_status = Self::query_status(&resp);
        match task_status.as_str() {
            "SUCCEEDED" | "COMPLETED" | "SUCCESS" => {
                info!("[MiniMax H3] task {} status={} but no URL yet, keep polling", task_id, task_status);
                Ok(ProviderTaskPollResult::Running)
            }
            "FAILED" | "ERROR" | "CANCELLED" => {
                let msg = resp.message.unwrap_or_else(|| "生成失败".to_string());
                info!("[MiniMax H3] task {} FAILED: {}", task_id, msg);
                Ok(ProviderTaskPollResult::Failed(msg))
            }
            "QUEUED" | "PENDING" | "WAITING" => {
                Ok(ProviderTaskPollResult::Queued)
            }
            _ => Ok(ProviderTaskPollResult::Running),
        }
    }
}

impl Default for MiniMaxProvider {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait::async_trait]
impl AIProvider for MiniMaxProvider {
    fn name(&self) -> &str {
        "minimax"
    }

    fn supports_model(&self, model: &str) -> bool {
        Self::sanitize_model(model) == "minimax-h3"
    }

    fn list_models(&self) -> Vec<String> {
        vec!["minimax/minimax-h3".to_string()]
    }

    async fn set_api_key(&self, api_key: String) -> Result<(), AIError> {
        let mut key = self.api_key.write().await;
        *key = Some(api_key);
        Ok(())
    }

    fn supports_task_resume(&self) -> bool {
        true
    }

    async fn generate(&self, request: GenerateRequest) -> Result<String, AIError> {
        let api_key = self
            .api_key
            .read()
            .await
            .clone()
            .ok_or_else(|| AIError::InvalidRequest("MiniMax H3 API key not set".to_string()))?;

        let task_id = self.create_task(&api_key, &request).await?;

        loop {
            match self.poll_task_once(&api_key, &task_id).await? {
                ProviderTaskPollResult::Queued | ProviderTaskPollResult::Running => {
                    sleep(Duration::from_millis(POLL_INTERVAL_MS)).await
                }
                ProviderTaskPollResult::Succeeded(url) => return Ok(url),
                ProviderTaskPollResult::Failed(message) => {
                    return Err(AIError::TaskFailed(message))
                }
            }
        }
    }

    async fn submit_task(
        &self,
        request: GenerateRequest,
    ) -> Result<ProviderTaskSubmission, AIError> {
        let api_key = self
            .api_key
            .read()
            .await
            .clone()
            .ok_or_else(|| AIError::InvalidRequest("MiniMax H3 API key not set".to_string()))?;

        let task_id = self.create_task(&api_key, &request).await?;

        Ok(ProviderTaskSubmission::Queued(ProviderTaskHandle {
            task_id,
            metadata: Some(serde_json::json!({
                "backend": "baidu_vod",
                "api_key": api_key,
                "api_model": API_MODEL,
            })),
        }))
    }

    async fn poll_task(
        &self,
        handle: ProviderTaskHandle,
    ) -> Result<ProviderTaskPollResult, AIError> {
        let api_key = handle
            .metadata
            .as_ref()
            .and_then(|m| m.get("api_key")?.as_str().map(|s| s.to_string()))
            .or_else(|| {
                self.api_key
                    .try_read()
                    .ok()
                    .and_then(|guard| guard.clone())
            })
            .ok_or_else(|| {
                AIError::InvalidRequest(
                    "MiniMax H3 API key not set (not in metadata or provider)".to_string(),
                )
            })?;

        self.poll_task_once(&api_key, &handle.task_id).await
    }
}
```

### 3.3 `src-tauri/src/ai/mod.rs`（块 A + B）

**(a) 注册 `describe` 模块**（块 B）：

```rust
pub mod deepseek;
pub mod describe;   // ← 新增
pub mod error;
pub mod providers;
```

**(b) `ProviderTaskPollResult` 枚举加 `Queued` 变体**（块 A，⚠️ 极易漏）：

```rust
pub enum ProviderTaskPollResult {
    Queued,          // ← 新增：任务排队中（未开始生成）
    Running,
    Succeeded(String),
    Failed(String),
}
```

**(c) 修所有非穷尽 match**——加完枚举后 `cargo check` 会列出所有没覆盖 `Queued` 的 match，逐个把 `Running` 分支改成 `Queued | Running`。科普版实战命中的文件（目标版本以 `cargo check` 报错为准）：

| 文件 | 位置 | 改动 |
|------|------|------|
| `ai/providers/grsai/mod.rs` | `poll_result_until_complete` 的 match | `Running =>` → `Queued \| Running =>` |
| `ai/providers/kie/mod.rs` | poll 循环的 match | 同上 |
| `ai/providers/happyhorse/mod.rs` | `generate()` 的 match | 同上 |
| `commands/ai.rs` | poll 的 match | `Ok(ProviderTaskPollResult::Running) =>` → `Ok(ProviderTaskPollResult::Queued) \| Ok(ProviderTaskPollResult::Running) =>` |
| `commands/banana_api.rs` | poll 的 match | 新增 `Queued` 分支（见 §3.7） |

### 3.4 `src-tauri/src/ai/providers/mod.rs`（块 A）

加 3 处：

```rust
pub mod minimax;                                    // ① 模块声明

pub use minimax::MiniMaxProvider;                    // ② 导出

pub fn build_default_providers() -> Vec<Arc<dyn AIProvider>> {
    vec![
        // ... 已有 provider ...
        Arc::new(MiniMaxProvider::new()),            // ③ 加入默认列表
    ]
}
```

### 3.5 `src-tauri/src/commands/asset.rs`（块 B，三处改动）

**(a) 顶部 import 加 `warn`：**

```rust
use tracing::warn;   // ← 新增（文件顶部）
```

**(b) `add_asset` 函数末尾、`Ok(record)` 之前加异步读图（不阻塞上传返回）：**

```rust
    // 异步读图：不阻塞上传返回，后台补读视觉描述供 skill 生成更准提示词
    let app_for_desc = app.clone();
    let asset_id_for_desc = record.id.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(e) = describe_asset_inner(&app_for_desc, &asset_id_for_desc).await {
            warn!("asset {} 读图失败: {}", asset_id_for_desc, e);
        }
    });

    Ok(record)
```

**(c) `delete_asset` 里，删除文件前加清理缓存（best-effort）：**

```rust
    // Delete description cache (best-effort)
    let _ = ensure_asset_descriptions_table(&conn);
    let _ = conn.execute("DELETE FROM asset_descriptions WHERE asset_id = ?1", params![id]);
```

**(d) 文件末尾追加读图描述模块（含并发合并锁，完整）：**

```rust
// ============ 读图描述（视觉描述缓存） ============

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetDescription {
    pub asset_id: String,
    pub description: String,
}

fn ensure_asset_descriptions_table(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS asset_descriptions (
          asset_id TEXT PRIMARY KEY,
          file_hash TEXT NOT NULL,
          description TEXT NOT NULL,
          model TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        );
        "#,
    )
    .map_err(|e| format!("Failed to initialize asset_descriptions table: {}", e))
}

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{Mutex as TokioMutex, OnceCell as TokioOnceCell};

static IN_FLIGHT_DESCRIBES: std::sync::LazyLock<
    TokioMutex<HashMap<String, Arc<TokioOnceCell<String>>>>,
> = std::sync::LazyLock::new(|| TokioMutex::new(HashMap::new()));

/// 读图核心逻辑：先查缓存（file_hash 命中秒回），未命中调千帆 VL 并写缓存。
/// 幂等，可被 add_asset 异步任务和前端 describe_asset 重复调用，不会重复产生读图费用。
async fn describe_asset_inner(app: &AppHandle, asset_id: &str) -> Result<Option<String>, String> {
    let api_key = crate::commands::banana_api::get_qianfan_vl_key()
        .ok_or_else(|| "千帆VL读图API密钥未配置".to_string())?;

    // 阶段一（同步）：读文件 + 查缓存。conn 必须在 await 前 drop（rusqlite Connection 非 Send）。
    let (file_hash, bytes, cached_desc) = {
        let conn = open_db(app)?;
        ensure_assets_table(&conn)?;
        ensure_asset_descriptions_table(&conn)?;

        let file_path: String = conn
            .query_row(
                "SELECT file_path FROM assets WHERE id = ?1",
                params![asset_id],
                |row| row.get(0),
            )
            .map_err(|e| format!("Failed to find asset: {}", e))?;

        let bytes = std::fs::read(&file_path)
            .map_err(|e| format!("Failed to read asset file: {}", e))?;
        let file_hash = format!("{:x}", md5::compute(&bytes));

        let cached: Option<String> = conn
            .query_row(
                "SELECT description FROM asset_descriptions WHERE asset_id = ?1 AND file_hash = ?2",
                params![asset_id, file_hash],
                |row| row.get(0),
            )
            .ok();

        (file_hash, bytes, cached)
    };

    if let Some(desc) = cached_desc {
        return Ok(Some(desc));
    }

    // 阶段二（await）：调读图，带并发合并锁（首个调用者读图，后续 await 复用同一结果）。
    let cell = {
        let mut map = IN_FLIGHT_DESCRIBES.lock().await;
        map.entry(asset_id.to_string())
            .or_insert_with(|| Arc::new(TokioOnceCell::new()))
            .clone()
    };
    let description: String = cell
        .get_or_try_init(|| async {
            crate::ai::describe::describe_image(&bytes, &api_key)
                .await
                .map_err(|e| e.to_string())
        })
        .await?
        .clone();

    // 阶段三（同步）：写缓存
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    {
        let conn = open_db(app)?;
        ensure_asset_descriptions_table(&conn)?;
        conn.execute(
            r#"
            INSERT INTO asset_descriptions (asset_id, file_hash, description, model, updated_at)
            VALUES (?1, ?2, ?3, ?4, ?5)
            ON CONFLICT(asset_id) DO UPDATE SET
              file_hash = ?2, description = ?3, model = ?4, updated_at = ?5
            "#,
            params![asset_id, file_hash, description, "ernie-4.5-turbo-vl", now],
        )
        .map_err(|e| format!("Failed to save asset description: {}", e))?;
    }

    Ok(Some(description))
}

#[tauri::command]
pub async fn describe_asset(app: AppHandle, asset_id: String) -> Result<Option<String>, String> {
    describe_asset_inner(&app, &asset_id).await
}

#[tauri::command]
pub fn get_asset_descriptions(
    app: AppHandle,
    project_id: String,
) -> Result<Vec<AssetDescription>, String> {
    let conn = open_db(&app)?;
    ensure_assets_table(&conn)?;
    ensure_asset_descriptions_table(&conn)?;

    let mut stmt = conn
        .prepare(
            r#"
            SELECT d.asset_id, d.description
            FROM asset_descriptions d
            JOIN assets a ON a.id = d.asset_id
            WHERE a.project_id = ?1
            "#,
        )
        .map_err(|e| format!("Failed to prepare get descriptions: {}", e))?;

    let rows = stmt
        .query_map(params![project_id], |row| {
            Ok(AssetDescription {
                asset_id: row.get(0)?,
                description: row.get(1)?,
            })
        })
        .map_err(|e| format!("Failed to query descriptions: {}", e))?;

    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| format!("Failed to read description row: {}", e))?);
    }
    Ok(out)
}
```

### 3.6 `src-tauri/src/commands/banana_api.rs`（块 A + B）

**(a) 千帆 VL key 静态存储**（块 B，在 `static KIE_KEY` 后加）：

```rust
static QIANFAN_VL_KEY: std::sync::OnceLock<Arc<Mutex<Option<String>>>> = std::sync::OnceLock::new();
```

**(b) getter/setter**（块 B，在 `secret_getter!(get_baidu_video_key, BAIDU_VIDEO_KEY);` 后加）：

```rust
secret_setter!(set_qianfan_vl_key, QIANFAN_VL_KEY);
secret_getter!(get_qianfan_vl_key, QIANFAN_VL_KEY);
```

**(c) `banana_update_local_api_keys` 的 api_type 匹配分支**（块 B，在 `"baidu_secret_key"` 分支后加）：

```rust
            // 千帆 ERNIE-VL 多模态读图密钥（独立于百度 VOD，千帆大模型平台单独授权）
            "qianfan_vl" | "QIANFAN_VL" | "ernie_vl" | "ERNIE_VL" => {
                info!("存储千帆VL读图密钥: {}", config.id);
                set_qianfan_vl_key(config.api_key.clone()).await;
                continue;
            },
```

**(d) submit（视频生成提交）加 `is_minimax` 分支**（块 A）：

```rust
// 默认模型改为 minimax（若目标版本默认模型不同，改这里）
let model_name = model.unwrap_or_else(|| "minimax/minimax-h3".to_string());

let is_happyhorse = model_name.starts_with("happyhorse/");
let is_pixverse = model_name.starts_with("pixverse/");
let is_minimax = model_name.starts_with("minimax/");     // ← 新增

let provider = if is_happyhorse {
    // ... 原 happyhorse 分支 ...
} else if is_pixverse {
    // ... 原 pixverse 分支 ...
} else if is_minimax {                                   // ← 新增分支
    let api_key = get_baidu_video_key()
        .ok_or_else(|| "百度视频生成密钥未配置，请联系管理员".to_string())?;
    let p: std::sync::Arc<dyn crate::ai::AIProvider> = std::sync::Arc::new(
        crate::ai::providers::minimax::MiniMaxProvider::new()
    );
    p.set_api_key(api_key).await.map_err(|e| format!("设置MiniMax百度VOD密钥失败: {}", e))?;
    p
} else {
    return Err("不支持的视频模型：仅支持 happyhorse/ 、 pixverse/ 和 minimax/ 前缀");
};
```

**(e) 参考图 base64 直传**（块 A，`is_baidu_vod` 判断要包含 minimax）：

```rust
let is_baidu_vod = is_happyhorse || is_minimax;          // ← 加 || is_minimax
let qiniu_images = if is_baidu_vod {
    image_input                                           // 跳过七牛，base64 直传
} else if !image_input.is_empty() {
    upload_refs_to_qiniu(&image_input).await
} else {
    image_input
};
```

**(f) poll（轮询 / 续传）加 `is_minimax` 判断 + 分支 + `Queued` 返回臂**（块 A）：

```rust
let is_happyhorse = model_name.starts_with("happyhorse/");
let is_pixverse = model_name.starts_with("pixverse/");
let is_minimax = model_name.starts_with("minimax/");          // ← 新增

let provider: Box<dyn AIProvider + Send> = if is_happyhorse {
    // ... 原 happyhorse 分支 ...
} else if is_pixverse {
    // ... 原 pixverse 分支 ...
} else if is_minimax {                                        // ← 新增分支
    let api_key = get_baidu_video_key()
        .ok_or_else(|| "百度视频生成密钥未配置，请联系管理员".to_string())?;
    let p = crate::ai::providers::minimax::MiniMaxProvider::new();
    p.set_api_key(api_key).await.map_err(|e| format!("设置MiniMax百度VOD密钥失败: {}", e))?;
    Box::new(p)
} else {
    return Ok(serde_json::json!({ "status": "failed", "error": format!("不支持的视频模型: {}", model_name) }));
};
```

poll 的 `match` 里新增 `Queued` 臂：

```rust
match provider.poll_task(handle).await {
    Ok(crate::ai::ProviderTaskPollResult::Queued) => {        // ← 新增臂
        {
            let mut counts = VIDEO_POLL_ERROR_COUNT.lock().await;
            counts.remove(&task_id);
        }
        Ok(serde_json::json!({ "status": "queued" }))
    }
    Ok(crate::ai::ProviderTaskPollResult::Running) => {
        // ... 原 Running 分支（返回 running）...
    }
    Ok(crate::ai::ProviderTaskPollResult::Succeeded(url)) => {
        // ... 原成功分支 ...
    }
    Ok(crate::ai::ProviderTaskPollResult::Failed(e)) | Err(_) => {
        // ... 原失败/错误分支 ...
    }
}
```

### 3.7 `src-tauri/src/commands/update.rs`（块 A）

`resolve_video_gen_rules_url` 的 match 加一行（文件名带目标版本自己的行业后缀）：

```rust
let file = match model.as_str() {
    "happyhorse_r2v" | "happyhorse/happyhorse-1.1-r2v" => "video_gen_rules_happyhorse.json",
    "pixverse_c1" | "pixverse/c1" => "video_gen_rules_pixverse_c1.json",
    "minimax" | "minimax/minimax-h3" => "video_gen_rules_minimax_h3.json",   // ← 新增
    _ => "video_gen_rules_happyhorse.json",
};
```

### 3.8 `src-tauri/src/lib.rs`（块 B）

在 `asset::delete_asset,` 后加两行：

```rust
            asset::describe_asset,
            asset::get_asset_descriptions,
```

### 3.9 `src-tauri/src/commands/chat.rs`（块 A + B）

**(a) 三轨式覆盖指令**（块 A）：`system_prompt.push_str()`【分镜大师覆盖指令】块是运行时最高权威，SKILL.md 的格式变更**必须**同步到此块。重点两处：

1. **分镜映射铁律**：`shots[].time` 从欢乐马 `"0-Xs"` 改成 H3 `"00:00.000"`（MM:SS.mmm），并同步文案说明「= 视频提示词里的 `[Shot N] At MM:SS.mmm` 起点时间戳」。
2. **示例 JSON 规则**：凡出现 `0-Xs` / `X-Ys` 的地方全改成 `00:00.000` / `MM:SS.mmm`。

**(b) 第 8 条 @图N 措辞对齐**（块 B）：

原文：`8. 绝对禁止 @图N / Image N 语法指代参考图。参考图由宫格故事板锁定。`

改为（区分「输入索引」与「输出语法」）：

```
8. 【项目全局上下文】「可用参考图」中的 @图N 是系统注入的参考图索引，其「视觉描述」可直接采信为参考图内容。但你在输出分镜/视频提示词时，绝对禁止出现 @图N / Image N 语法——参考图内容已由系统自动用于宫格生成。
```

**(c) 删除欢乐马清洗器调用**（块 A）：删掉 `integrate_video_prompt` 函数 + 不再使用的 `use crate::ai::deepseek;` import。

### 3.10 `src-tauri/src/ai/deepseek.rs`（块 A）

删掉 `clean_video_prompt` 函数 + `CLEAN_MODEL` 常量 + 不再使用的 `warn` import（只留 `use tracing::info`）。

### 3.11 `src-tauri/src/ai/providers/baidu/mod.rs`（块 F）

**(a) 400 分支改调用翻译函数**（约第 340 行）：

```rust
400 => translate_baidu_image_error(&raw_response),
```

（其余 429/408/500/503 分支不变，`_` 兜底分支保持 `生成失败(HTTP {status})` 不带原始报文。）

**(b) 文件末尾新增翻译函数**（放在 impl 块之后、`VOD Super-Resolution` 段之前）：

```rust
/// 把百度图片生成的 400 错误响应翻译成用户可读的中文提示，避免把英文 JSON 直接甩给用户。
fn translate_baidu_image_error(raw_response: &str) -> String {
    let lower = raw_response.to_lowercase();

    if lower.contains("moderation_blocked")
        || lower.contains("safety_violations")
        || lower.contains("rejected by the safety")
        || lower.contains("content_filter")
    {
        return "提示词或参考图可能包含违规或敏感内容，请修改后重试，积分已返还，请重新生成".to_string();
    }

    "生成失败，请检查提示词或参考图后重试，积分已返还，请重新生成".to_string()
}
```

> 安全关键词文案必须含「违规」或「敏感」其中一个，前端 `StoryboardGenNode.tsx` 的 `safetyKeywords` 靠这些中文词命中。

---

## 4. 前端改动（TS/TSX）

### 4.1 新增 `src/features/chat/projectContext.ts`（块 B，原样复制）

```ts
import { readProjectGlobalsMd } from '@/commands/projectState';
import { getEmphasisLabels } from '@/features/project/presets';
import { buildAssetReferenceLines } from '@/commands/asset';
import { useProjectStore } from '@/stores/projectStore';

/**
 * 构建 chat 的 projectContext：项目全局参数 + 可用参考图（含视觉描述）。
 */
export async function buildProjectChatContext(projectId: string): Promise<string> {
  // 1. 优先读项目全局 MD
  let context = await readProjectGlobalsMd(projectId).catch(() => '');

  // 2. 无 MD 时从项目参数兜底
  if (!context.trim()) {
    const project = useProjectStore.getState().currentProject;
    if (project) {
      const parts: string[] = [];
      parts.push(`# ${project.name}\n`);
      parts.push('## 项目全局参数\n');
      if (project.aspectRatio) parts.push(`- 画幅比例: ${project.aspectRatio}`);
      if (project.style) parts.push(`- 视觉风格: ${project.style}`);
      if (project.tone) parts.push(`- 项目调性: ${project.tone}`);
      if (project.directorRef) parts.push(`- 短视频风格: ${project.directorRef}`);
      const emphasisLabels = getEmphasisLabels(
        project.emphasisDimensions.filter((d) => d.enabled).map((d) => d.key),
      );
      if (emphasisLabels.length > 0) {
        parts.push(`- 提示词重点维度: ${emphasisLabels.join('、')}`);
      }
      context = parts.join('\n') + '\n';
    }
  }

  // 3. 追加可用参考图（含视觉描述）
  try {
    const assetLines = await buildAssetReferenceLines(projectId);
    if (assetLines.length > 0) {
      context = `${context}\n## 可用参考图\n${assetLines.join('\n')}\n\n生成分镜提示词时，如需引用参考图请使用 @图N 格式。`;
    }
  } catch {
    // assets not critical for chat — ignore errors
  }

  return context;
}
```

### 4.2 `src/commands/asset.ts`（块 B）

**(a) 文件末尾追加**（含补读阻塞 + 重查缓存，块 B）：

```ts
export interface AssetDescription {
  assetId: string;
  description: string;
}

export async function describeAsset(id: string): Promise<string | null> {
  return await invoke<string | null>('describe_asset', { assetId: id });
}

export async function getAssetDescriptions(projectId: string): Promise<AssetDescription[]> {
  return await invoke<AssetDescription[]>('get_asset_descriptions', { projectId });
}

// 组装 Chat context 用的 @图N 参考图行（含视觉描述，缺失时后台补读）。
// 行业无关，复刻到服饰版/美妆版等衍生版本时无需改动。
export async function buildAssetReferenceLines(projectId: string): Promise<string[]> {
  const assets = await listAssets(projectId);
  if (assets.length === 0) return [];

  const descArr = await getAssetDescriptions(projectId).catch(() => []);
  const descMap = new Map(descArr.map((d) => [d.assetId, d.description]));

  // 缺失描述的资产后台补读（阻塞 + 补读后重查缓存，保证发消息时描述已就绪）
  const missing = assets.filter((a) => !descMap.has(a.id));
  if (missing.length > 0) {
    await Promise.allSettled(missing.map((a) => describeAsset(a.id).catch(() => null)));
  }
  const refreshed = await getAssetDescriptions(projectId).catch(() => []);
  refreshed.forEach((d) => descMap.set(d.assetId, d.description));

  const catLabel = (cat: string) =>
    cat === 'character' ? '角色' : cat === 'scene' ? '场景' : '服饰道具';

  return assets.map((a, i) => {
    const base = `@图${i + 1}: ${a.name} (${catLabel(a.category)})`;
    const desc = descMap.get(a.id);
    return desc ? `${base}\n  视觉描述：${desc}` : base;
  });
}
```

**(b) 删除 `cleanVideoPrompt` 导出函数**（块 A，若有）。

### 4.3 `src/features/canvas/Canvas.tsx`（块 B + D）

**(a) 复用 projectContext**（块 B）：

- import 区：删除 `import { readProjectGlobalsMd } from '@/commands/projectState';` 和 `import { listAssets } from '@/commands/asset';`
- 把 `import { getEmphasisLabels } from '@/features/project/presets';` 改为 `import { buildProjectChatContext } from '@/features/chat/projectContext';`
- `buildAndSetContext` 内联逻辑替换为：

```ts
    void buildProjectChatContext(canvasProjectId).then((context) =>
      useChatStore.getState().setProjectContext(context),
    );
```

（原来 40+ 行的内联组装逻辑整段删除）

**(b) 自动连线参考图**（块 D，2 处）：

文件顶部常量区（`DEFAULT_VIEWPORT` 后）新增：

```ts
/// 生成宫格图时，自动连线到宫格节点的最近参考图数量（按上传时间倒序取最近 N 张）
const MAX_AUTO_REF_IMAGES = 6;
```

`handleChatFillGrid` 里的参考图匹配逻辑（`for (const asset of allAssets) { if (detail.prompt.includes(asset.name) ...) }`）整段替换为：

```ts
      // Auto-link the N most recent reference images from project assets
      const matchedAssets: Array<{ name: string; filePath: string; index: number }> = [];
      const projectId = useProjectStore.getState().currentProject?.id;
      if (projectId) {
        const allAssets = useAssetStore.getState().getAssets(projectId);
        matchedAssets.push(
          ...allAssets
            .filter((asset) => asset.filePath)
            .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
            .slice(0, MAX_AUTO_REF_IMAGES)
            .map((asset, index) => ({
              name: asset.name,
              filePath: asset.filePath,
              index,
            })),
        );
      }
```

（后面的「创建 upload 节点 + 连线到宫格节点」逻辑不变。）

### 4.4 `src/features/project/ProjectDashboard.tsx`（块 B）

- import 区：删除 `readProjectGlobalsMd` / `buildAssetReferenceLines` / `getEmphasisLabels` 三个 import，加 `import { buildProjectChatContext } from '@/features/chat/projectContext';`
- `buildAndSetContext` 替换为：

```ts
  const buildAndSetContext = useCallback(async () => {
    const context = await buildProjectChatContext(projectId);
    setProjectContext(context);
  }, [projectId, setProjectContext]);
```

### 4.5 `src/features/project/ReanalyzeDialog.tsx`（块 B）

- import 区：删除 `import { buildAssetReferenceLines } from '@/commands/asset';` 和 `import { readProjectGlobalsMd } from '@/commands/projectState';`，加 `import { buildProjectChatContext } from '@/features/chat/projectContext';`
- **注意保留** `getEmphasisLabels`（它在 `handleAnalyze` / `handleConfirmReport` 里仍使用）
- `handleConfirmReport` 里最后刷新上下文的整段内联逻辑替换为：

```ts
    // Refresh chat context with new globals + assets
    const context = await buildProjectChatContext(projectId);
    useChatStore.getState().setProjectContext(context);

    onClose();
```

### 4.6 `src/features/chat/ChatInput.tsx`（块 B）

**(a) import 区加：**

```ts
import { AddAssetDialog } from '@/features/project/AddAssetDialog';
import { buildProjectChatContext } from './projectContext';
```

**(b) state 加：**

```ts
const [showAddAsset, setShowAddAsset] = useState(false);
const currentProjectId = useChatStore((s) => s.currentProjectId);
```

**(c) 新增回调：**

```ts
const handleAssetAdded = useCallback(async () => {
  setShowAddAsset(false);
  const pid = useChatStore.getState().currentProjectId;
  if (!pid) return;
  try {
    const context = await buildProjectChatContext(pid);
    useChatStore.getState().setProjectContext(context);
  } catch {
    // context 刷新失败不影响已上传的素材
  }
}, []);
```

**(d) 快捷操作栏（爆款灵感按钮旁）加上传按钮：**

```tsx
<button
  type="button"
  onClick={() => setShowAddAsset(true)}
  disabled={isStreaming}
  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[var(--accent)]/10 text-[var(--accent)] hover:bg-[var(--accent)]/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
>
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
    <rect x="2" y="3" width="12" height="10" rx="1.5" />
    <circle cx="6" cy="6.5" r="1.2" />
    <path d="M2 12l3.5-3 2.5 2 2-2L14 12" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
  {t('chat.uploadImage', '上传图片')}
</button>
```

**(e) 组件底部渲染弹窗：**

```tsx
{showAddAsset && currentProjectId && (
  <AddAssetDialog
    projectId={currentProjectId}
    isOpen={showAddAsset}
    onClose={handleAssetAdded}
  />
)}
```

### 4.7 `src/features/videoGeneration/VideoGenDialog.tsx`（块 A）

改动点（照短视频版 / 科普版逐处对齐）：

| 位置 | 改动 |
|------|------|
| 默认模型 state | `useState<string>('minimax/minimax-h3')`（原来 `happyhorse/...`） |
| `bananaReportUsage` 的 `api_type` | 3 处硬编码 → `'minimax_h3'` |
| resume 判定 | `isResumableTask` 加 `savedConfig?.videoModel?.includes('minimax')`；`resumeModel` 三元加 `'minimax/minimax-h3'` |
| 模型判断 | `const isMinimax = videoModel.includes('minimax');` |
| 提交/轮询的 model | 直接传 `'minimax/minimax-h3'`（即 `videoModel`） |
| **跳过欢乐马清洗器** | 若目标版本有 `cleanVideoPrompt`，对 H3 要跳过——H3 用自然语言，不需二次清洗 |

**排队提示（§4.8 + 本节）：**

```typescript
// 1) 状态声明（isResuming 旁）
const [pollStatus, setPollStatus] = useState<'queued' | 'running' | null>(null);

// 2) 提交/续接开始处，重置（setIsGenerating(true) 之后）
setPollStatus(null);

// 3) 轮询循环里，拿到 pollResult 后、succeeded/failed 判断之前更新
if (pollResult.status === 'queued') {
  setPollStatus('queued');
} else if (pollResult.status === 'running') {
  setPollStatus('running');
}
```

UI 文案（`isGenerating` 分支内）按 `pollStatus` 分流：

```tsx
{isResuming
  ? t('videoGen.resuming', '正在恢复之前的视频生成任务...')
  : pollStatus === 'queued'
    ? t('videoGen.queued', '排队中，请稍候...')
    : t('videoGen.generating', '正在生成视频...')}
{/* 副标题同理：queued → t('videoGen.queuedHint', '当前任务较多，正在等待分配算力')
           running/null → 原「预计需要 30–60 秒」 */}
```

### 4.8 `src/commands/ai.ts`（块 A）

`VideoPollResult` 的 `status` 联合类型补 `'queued'`：

```typescript
export interface VideoPollResult {
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'retry';   // ← 补 'queued'
  videoUrl?: string;
  error?: string;
  // ...
}
```

> 注意：`VideoPollResult.status` 与 `GenerationJobState`（宫格图生成的类型）是**两个不同**的类型，别改错。宫格图的 `GenerationJobState` 本就含 `queued`，本次只需给视频的 `VideoPollResult` 补。

### 4.9 `src/features/videoGeneration/videoGenRules.ts`（块 A）

`DEFAULT_PROMPT_RULE` / `DEFAULT_RULES` 的兜底内容从欢乐马风格改为 H3 风格（`[Shot N] At MM:SS.mmm` 时间戳 + 三轨音频 + 反 AI 化）。仅网络故障时兜底用，完整规则仍走服务端 JSON。

### 4.10 i18n（块 A + B）

**块 B**（`zh.json` / `en.json` 的 `chat` 组，`"inspiration"` 后加）：

```json
"uploadImage": "上传图片",        // en: "Upload Image"
```

**块 A**（`zh.json` / `en.json` 的 `videoGen` 段 `generating` 旁加）：

```json
"queued": "排队中，请稍候...",                              // en: "Queued, please wait..."
"queuedHint": "当前任务较多，正在等待分配算力"               // en: "High task volume — waiting for compute allocation"
```

---

## 5. 规则文件（块 A + C）

### 5.1 新建 `public/video_gen_rules_minimax_h3.json`（块 A 新建 + 块 C 加 1.5 秒，version=2）

**注意专属词**：下面 JSON 是**骨架**，其中 `⟦行业专属词⟧` 处必须替换成目标版本自己的专属词，**不能照抄短视频/科普的专属词**（铁律 #5）：

- `【主体锁定】` 段 → 目标版本自己的「主体锁定」句（短视频「产品PAC锁定·企业商业专用」、科普「科学主体锁定·科普专业」、服饰「服饰主体锁定·服装专业」…）
- `【写实质感】` 段 → 目标版本自己的「写实质感」句（短视频「人物真人质感」、科普「科学写实质感」…）
- `【合规】` 段 → 目标版本自己的合规句；轻量提示型（科普/萌宠）加一句行业合规句；三层合规型（大健康）沿用其独立合规层、此处不强加

```json
{
  "version": "2",
  "integration": {
    "model": "minimax/minimax-h3",
    "max_tokens": 0,
    "system_prompt": ""
  },
  "negative_prompt": "chromatic aberration, motion blur excess, morphing, distortion, warping, flicker, unnatural physics, floating objects, anti-gravity, product shape drift, product color shift, doll-like, wax figure, plastic skin, dead eyes, lifeless eyes, frozen expression, fixed smile, uncanny valley, robotic movement, mechanical motion, exaggerated gesture, over-smooth skin, stiffness, waxiness",
  "prompt_rule": "【核心指令】参考图是 6 宫格故事板，生成一段连续、带运镜的短视频。宫格 1→2→3→4→5→6 是一条连续时间线，不是 6 张独立快照拼接的幻灯片。人物/场景/道具/光影跨宫格完全一致，动作从前一格自然延续到后一格，无跳跃、无重置、无时间倒流。\n\n【故事板=唯一视觉真相】画面内容 100% 来自参考图宫格，文本只写运镜+动作+声音，禁止添加参考图不存在的人物/物品/道具/背景，禁止改写参考图已有内容。\n\n【自然语言运镜】用中文自然语言描述摄像机运动（缓慢推近/缓慢拉远/平稳摇镜/平稳跟拍/环绕/固定机位/手持微晃/升镜/降镜等），速度均匀、不叠加。画面与人物一致时用运镜丝滑串联、禁止硬切；仅场景发生实质变化时才允许切镜头。\n\n【多镜头时间锚定】如需精确控制镜头节奏，用 [Shot N] At MM:SS.mmm 标注每个镜头起点，时间戳严格递增、落在总时长内。单镜头内动作不超过 2-3 个，复杂动作链拆分到多个镜头。每个镜头时长不低于1.5秒，相邻镜头时间戳间隔≥1.5秒，禁止一闪而过的碎镜头。\n\n【三轨音频】① 对白与画内声融入视听描述（标注说话人）；② 环境音/物理声/非语言人声单独成段；③ 配乐单独成段（无则忽略）。三轨不重叠。\n\n【物理规律·强制】所有运动符合真实物理：重力向下、物体自然下落、碰撞反弹、布料/头发/液体按物理运动，禁止反重力悬浮、物体凭空出现/消失、违反惯性瞬时变速。\n\n【色温】指定色温时严格遵循：暖光 3200K / 中性 4500K / 冷光 5600K。\n\n【物体状态锁定】物体被摧毁后只留碎片，不复活、不重置。\n\n⟦主体锁定·行业专属词⟧\n\n⟦写实质感·行业专属词⟧\n\n⟦合规·行业专属词⟧\n\n【禁止】禁止文字/水印/字幕/对话框/标签；禁止分辨率/画幅/模型名。No text overlays, no watermarks, no subtitles, no captions.",
  "constraints": {
    "global_rule": "故事板宫格=连续短视频时间线。画面内容 100% 由参考图锁定，文本只写运镜+动作+声音。用中文自然语言描述摄像机运动，多镜头用 [Shot N] At MM:SS.mmm 时间戳锚定。",
    "shot_continuity": "六格→一个连续视频。摄像机运动均匀串联，每格停留足够时间（每个镜头时长≥1.5秒，禁止一闪而过的碎镜头）。场景/道具/光影跨格一致。画面与人物一致时用运镜连贯过渡、禁止硬切；仅场景发生实质变化时才允许切镜头。",
    "hard_constraints": [
      "宫格1-6是连续时间线，顺序不变",
      "不添加/不删减/不修改画面内容",
      "用摄像机运动丝滑串联，画面/人物一致时禁止硬切；仅场景发生实质变化时才可切镜头",
      "提示词只写运镜+动作+声音，不写光影/场景/外观",
      "多镜头用 [Shot N] At MM:SS.mmm 时间戳锚定，严格递增",
      "每个镜头时长≥1.5秒，相邻镜头时间戳间隔≥1.5秒，禁止一闪而过的碎镜头",
      "三轨音频分离：对白/画内声融入视听描述，环境音/物理声单独，配乐单独",
      "色温严格按指定值",
      "物体状态跨格锁定",
      "所有运动必须符合真实物理规律（重力/惯性/碰撞/流体），禁止反重力悬浮和物体穿模",
      "⟦行业专属词：主体/产品/Logo 严格锁死参考图，禁止 AI 自行重新设计⟧",
      "⟦行业专属词：写实/真人质感——禁止蜡像感/娃娃感/塑料感/死鱼眼/固定微笑⟧"
    ]
  }
}
```

> 上传服务器：`scp -i "$HOME/jiaoyan.pem" video_gen_rules_minimax_h3.json root@47.108.237.10:/jy/uploads/app/`

### 5.2 `public/video_gen_rules_happyhorse.json`（块 C，version 递增）

**(a) `version` 字段**：`"12"` → `"13"`（目标版本以实际值为准，递增 1）

**(b) `prompt_rule` 字段**：在 `【镜头切换边界】` 段末尾「…才允许切镜头。」与 `【导演语法】` 之间插入：

```
【镜头时长·强制】每个镜头（Shot）时长不低于1.5秒，禁止一闪而过的碎镜头。宫格切换时，每个宫格画面至少完整停留1.5秒再过渡到下一格，宁长勿短。
```

**(c) `constraints.shot_continuity`**：把 `每格停留足够时间` 改为 `每格停留足够时间（每个镜头时长≥1.5秒，禁止一闪而过的碎镜头）`

**(d) `constraints.hard_constraints`** 数组新增一项：

```json
"每个镜头（Shot）时长≥1.5秒，禁止一闪而过的碎镜头",
```

### 5.3 `public/video_gen_rules_pixverse_c1.json`（块 C，version 递增）

**(a) `version` 字段**：`"11"` → `"12"`（递增 1）

**(b) `prompt_rule` 字段**：在 RULES 末尾「…fpv-drone.」之后追加第 5 条规则（英文）：

```
5. Minimum shot duration — each shot lasts at least 1.5 seconds. No flash cuts, no blink-and-miss shots, no strobing between frames.
```

**(c) `constraints.hard_constraints`** 数组新增一项：

```json
"每个镜头时长≥1.5秒，禁止一闪而过的碎镜头",
```

> 三个通用模型规则文件 happyhorse / minimax / pixverse 在各行业版共享（同一服务器下发）。若行业版有专属规则文件（如 `video_gen_rules_travel.json`），在该专属文件按「prompt_rule + shot_continuity + hard_constraints」三处同位置补入 1.5 秒约束，保持 `version` 递增。

---

## 6. SKILL.md 双补丁（块 A + B）

> `docs/skills/SKILL.md` 是热更新文件。改本地不会立即生效，发布见 §6.3。

### 6.1 视频提示词步改三轨式（块 A）

把欢乐马 `Begin with Shot [X-Ys]` 格式换成 H3 三轨式自然语言模板：

```
【视频提示词】
{视听描述 integrated_multimodal_description}
一条自然语言时间线，融合画面/景别/运镜/人物动作/对白/画内声。
- 风格锚定融入开头：色调/光影/画面质感，只用定性描述，禁止分辨率/画幅/技术参数。
- 可用色温精准控制：暖光(3200K)、中性光(4500K)、冷光(5600K)、烛火光(2000K)。
- 景别：远景/全景/中景/近景/特写/超特写。
- 运镜用中文自然语言：缓慢推近/缓慢拉远/平稳摇镜/平稳跟拍/环绕/固定机位/手持微晃/升镜/降镜/航拍/希区柯克变焦。
- 多镜头用 [Shot N] At MM:SS.mmm 锚定每个镜头起点，时间戳严格递增、落在总时长内、保留三位毫秒。
- 对白写清说话人（角色名）与情绪语调。单镜头台词≤2句。

{声音氛围 overall_soundscape}
环境音+物理声+非语言人声（呼吸/脚步/衣物摩擦等），1-4 句，写声源+质感，不重复对白。

{配乐 non_diegetic_music}
仅观众可听的 BGM（乐器/速度/动态），无则写 N/A。

{负面约束}
- 人物外貌服装全程一致
- ⟦行业专属词：主体/产品 PAC 锁定——外形/材质/颜色/Logo 严格锁定参考图，逐帧不变⟧
- 禁止文字/水印/字幕
- 画面稳定无抖动
- 表情控制：用具体动作替代情绪形容词
```

**自检清单**同步改（欢乐马 `Shot N [X-Ys]` 校验 → H3 校验）：

| # | ✅ | ❌ |
|---|-----|-----|
| 1 | 【视频提示词】标记 + 三轨式结构完整 | 缺少标记或任意一轨 |
| 2 | `[Shot N] At MM:SS.mmm` 时间戳格式 | 无时间戳 / 时间戳不递增 |
| 3 | 三轨音频分离（视听描述/声音氛围/配乐） | 声音与对白混在一起 / 缺声音氛围 |
| 4 | 中文自然语言运镜描述 | 英文运镜词 |
| 5 | 风格只写色调/光影/质感 | `4K`/`16:9`/`1080P`/`超清` |
| 6 | 全文无引擎/模型名称 | 任何产品名/供应商名 |

### 6.2 读图逻辑补丁（块 B，⚠️ 不改则 skill 无视读图描述）

各行业版 SKILL.md 自 v1.0.2 起有意写死「你无法看到图片」，导致读图描述注入后 skill 仍无视、反问用户。必须把三处「你无法看到图片」反转：

**位置 1 — 角色限制**（把「⚠️ 重要限制：你无法看到图片……」整句改为）：

```
**⚠️ 参考图视觉描述：** 用户提供的参考图，系统可能已通过读图能力自动生成了**中文视觉描述**（出现在【项目全局上下文】的「可用参考图」部分，形如「@图N: 名称 (分类)」+「视觉描述：…」）。当「视觉描述」存在时，它就是该参考图的**客观视觉事实**，你必须优先采用它来锁定⟦品类/颜色/面料/设计细节/配饰⟧，**不得再说"我无法看到图片"**。只有当某张参考图没有视觉描述时，才依赖用户文字描述。
```

（`⟦⟧` 处换成目标行业专属词：美妆→妆容/色彩/质地、旅游→景点/季节/光线、科普→结构/材质/尺度…）

**位置 2 — 规则7（反虚构铁律）**（首句「你无法看到参考图……」改为）：

```
⟦行业主体⟧的视觉信息按以下优先级采信：①参考图视觉描述（【项目全局上下文】「可用参考图」中的「视觉描述」字段）＞ ②用户文字描述 ＞ ③仪表板参数。因此：
- ✅ 若参考图带有「视觉描述」，直接采信其中的⟦品类/颜色/面料/设计细节/配饰⟧，无需追问，也不得说"我无法看到图片"
```

（其余 ❌ 禁止项里「除非用户明确描述」→「除非参考图视觉描述或用户明确描述」）

**位置 3 — 用户描述优先原则**（「🔴 用户描述优先原则：你无法看到参考图……」→）：

```
🔴 参考图视觉描述优先原则：若【项目全局上下文】「可用参考图」中某张图带有「视觉描述」，则该描述是系统读图生成的客观事实，是视觉信息的第一依据，应直接采用，不得说"我无法看到图片"…
```

「信息完备性检查」的「✅ 已知」追加「若参考图有视觉描述，⟦品类/颜色/面料/设计细节/配饰⟧视为已知」。

### 6.3 热更新发布

1. bump `docs/skills/version.txt` 版本号 + 写 changelog（**changelog 不能出现任何模型名**）。
2. 同步 `SKILL.md` 里 `<!-- SECURITY_MARKER: xiaoya-ai-cinema-<行业>-protected-skill-vX.Y.Z -->` 的版本号。
3. 重新打包 zip（flat：SKILL.md + version.txt 在 zip 根目录）：
   ```bash
   cd docs/skills && python -c "import zipfile; z=zipfile.ZipFile('xiaoya-ai-cinema-<行业>.zip','w',zipfile.ZIP_DEFLATED); z.write('SKILL.md','SKILL.md'); z.write('version.txt','version.txt'); z.close()"
   ```
4. 上传服务器 `/jy/uploads/install_guide/files/`（**不是** `/jy/uploads/app/`）：
   ```bash
   scp -i "$HOME/jiaoyan.pem" xiaoya-ai-cinema-<行业>.zip root@47.108.237.10:/jy/uploads/install_guide/files/
   scp -i "$HOME/jiaoyan.pem" version.txt root@47.108.237.10:/jy/uploads/install_guide/files/version_<行业>.txt
   ```
5. 本地测试：复制新 SKILL.md 到 `~/.claude/skills/xiaoya-ai-cinema-<行业>/`，或删该目录让 `ensure_skill_md` 重新下载。

> 注意：`version_<行业>.txt` 的内容 = `version.txt` **完整内容**（`sync_xiaoya_skill` 用 `remote.trim() == local.trim()` 全量比对，不是只比版本号数字）。

---

## 7. 品牌名残留清理（块 E）

复刻到新行业版时，关于页面 / 激活弹窗 / i18n / localStorage key 常残留旧版名。必查 5 类：

| # | 位置 | 残留类型 |
|---|------|---------|
| 1 | `src/components/SettingsDialog.tsx`「关于」区块 | 硬编码应用名，改为 `t('settings.aboutAppName', '<本版名>')` |
| 2 | `src/components/TokenActivationDialog.tsx` | `t(...)` 兜底默认值（title / hint） |
| 3 | `src/i18n/locales/zh.json` + `en.json` | `app.title` / `app.subtitle` / `settings.aboutAppName` / `tokenActivation.title` / `chat.emptyState` |
| 4 | `src/App.tsx` beforeunload 写入 key | `localStorage.setItem('storyboard-<本版>-videogen-configs', ...)` |
| 5 | `src/features/videoGeneration/videoGenStore.ts` 的 `STORE_KEY` | 与 App.tsx 写入 key **必须一致** |

**排查命令：**

```bash
grep -rniE "旅游|萌宠|美妆|大健康" src/ --include="*.ts" --include="*.tsx" --include="*.json"
grep -rniE "Storyboard (ShortVideo|Travel|Pet|Beauty)|storyboard-(travel|shortvideo|pet|beauty)" src/ --include="*.ts" --include="*.tsx" --include="*.json"
```

> 注意：`Storyboard`（=分镜，功能术语）**不能误改**；只有「Storyboard + 旧版名」（如 `Storyboard ShortVideo` / `Storyboard Travel`）和孤立旧版名（`旅游版` / `ShortVideo`）才是品牌残留。

---

## 8. 执行 SOP（顺序）

1. **核对前置条件**（§2），尤其 `chat.rs` 的 `project_context` 注入。
2. **复制 3 个新增文件**原样到目标版本：`ai/describe.rs`、`ai/providers/minimax/mod.rs`、`features/chat/projectContext.ts`。
3. **后端逐个修改**：`ai/mod.rs`（describe + Queued 枚举）→ 修非穷尽 match → `providers/mod.rs` → `asset.rs` → `banana_api.rs` → `lib.rs` → `update.rs` → `chat.rs` → `deepseek.rs` → `baidu/mod.rs`。
4. **前端逐个修改**：`asset.ts` → `Canvas.tsx` → `ProjectDashboard.tsx` → `ReanalyzeDialog.tsx` → `ChatInput.tsx` → `VideoGenDialog.tsx` → `ai.ts` → `videoGenRules.ts` → i18n。
5. **规则文件**：新建 `video_gen_rules_minimax_h3.json`（带 1.5 秒）+ 改 happyhorse / pixverse 加 1.5 秒（version 递增）。
6. **SKILL.md 双补丁** + `chat.rs` 覆盖指令同步（三轨式 + 读图逻辑）。
7. **品牌名残留清理**（§7）。
8. **编译验证**：`npx tsc --noEmit` + `cd src-tauri && cargo check` 零错误。
9. **功能验证**（§9）。
10. **上传 + 发布**（§10）。

---

## 9. 验证清单

**编译：**
```bash
npx tsc --noEmit
cd src-tauri && cargo check
```

**读图（块 B）：**
1. 上传一张参考图（用 WebP 伪装 .jpg，顺带验证转 PNG 兜底）。
2. 等 1-2 秒，确认日志 `[读图] 千帆VL请求` / `[读图] 千帆VL完成`。
3. sqlite 查 `asset_descriptions` 表，确认描述为七维度结构。
4. Chat 发「根据参考图生成分镜提示词」，确认日志 `[Chat] 项目上下文已注入 (N 字符)`（N > 0）。
5. skill 返回的提示词出现参考图**具体视觉细节**（配色/背景/光影等仅读图才知道的信息）。

**视频（块 A）：**
1. 6 宫格故事板 → 生成视频 → 日志出现 `[MiniMax H3 createTask] model=MiniMax-H3`、`vod.bj.baidubce.com/v3/aigc/minimax`。
2. 确认规则加载 `[Rules] model=minimax/minimax-h3, loading video_gen_rules_minimax_h3.json`。
3. 排队时前端显示「排队中」，生成中显示「正在生成视频」。
4. 轮询拿到 `content.url`。

**积分核对：** 扣费按 duration/resolution 表，接入前后一致；失败退费正常。

---

## 10. 发布清单

1. **规则文件上传**（块 A/C）：`video_gen_rules_minimax_h3.json`（新建）、`video_gen_rules_happyhorse.json`、`video_gen_rules_pixverse_c1.json` → `/jy/uploads/app/`。
2. **版本文件上传**：`version_<行业>.json`（version 递增、notes **无模型名**）→ `/jy/uploads/app/`。
3. **SKILL 热更新**（§6.3）：zip + `version_<行业>.txt` → `/jy/uploads/install_guide/files/`。
4. **下载页更新**：`industry.html` 该版本卡片版本号 + Windows/macOS 下载 URL → `/jy/uploads/install_guide/industry.html`。
5. **构建**：本地 Windows NSIS（`小鸭<行业>版_<v>_x64-setup.exe`）+ macOS CI（tag push 触发，DMG 自动 SCP 上传）。
6. **服务器双命名**：NSIS 上传英文名 `Storyboard-<行业>_<v>_x64-setup.exe` + `cp` 中文副本 `小鸭<行业>版_<v>_x64-setup.exe`。
7. **发布日志**：`notes` 字段不出现任何模型名称。

---

## 11. 关键坑位汇总（迁移时必须带着这些修复）

### 11.1 编译 / 运行坑（5 个，来自 h3.md）

| # | 现象 | 根因 | 修复 |
|---|------|------|------|
| 1 | 查询接口 404 `uri resource not found` | `QUERY_PATH` 少了前导 `/`，拼成 `minimax//v2/query` | `QUERY_PATH = "/v2/query/video_generation"` 带前导斜杠 |
| 2 | `720P not supported, supported: 768P, 2K` | H3 只支持 `768P`/`2K` | provider 归一化：`720p` → `768P`（积分档位不变） |
| 3 | 前端无限轮询卡死、积分不退 | 百度 VOD 以 HTTP 200 返回 `{"type":"error",...}`，被当 Running | `extract_error_body` 检测 error 体 → `Failed` |
| 4 | `image size 6912x8192, expected each side in [256, 5760]` | 6 宫格合成图长边 8192 超 H3 上限 5760 | `downscale_base64_image` 长边等比缩 ≤5760 + JPEG q85 |
| 5 | 编译报错 `ProviderTaskPollResult::Queued` 未找到 | 目标版本枚举没有 `Queued` 变体 | §3.3：枚举加 `Queued` + 修所有非穷尽 match |

### 11.2 读图坑（来自 pic.md）

1. **WebP/GIF 自动转 PNG**：`normalize_for_vl` 按 magic bytes 识别真实格式，不信任扩展名。
2. **幂等防重复计费**：`describe_asset_inner` 用 `file_hash` 缓存。
3. **异步读图不阻塞上传**：`add_asset` 用 `tauri::async_runtime::spawn` 后台读图。
4. **rusqlite Connection 非 Send**：`describe_asset_inner` 分三阶段，`conn` 必须在 `await` 前 drop。
5. **并发合并锁**：`describe_asset_inner` 阶段二用 `tokio::sync::OnceCell`（`get_or_try_init`）按 asset_id 共享读图结果，避免 add_asset 异步读图与前端 describe_asset 并发重复计费，失败不缓存。
6. **补读改阻塞**：`buildAssetReferenceLines` 里缺失描述的资产补读从 `void` 改 `await` + 重查缓存，否则上传后立刻发消息拿不到描述。

### 11.3 实战发布坑（科普版 v1.1.0 新踩，务必注意）

1. **SKILL 服务器缓存旧 zip**：改 SKILL.md 后必须 bump `version.txt`（全量比对），否则客户端不重新下载。科普版曾 bump 1.0.1→1.0.2 才生效。
2. **规则文件漏上传**：`video_gen_rules_minimax_h3.json` 是热更新文件，本地建了没上传 → 运行时规则缺失。上传到 `/jy/uploads/app/`。
3. **下载页以服务器版为基准**：服务器 `industry.html` 可能比本地新（其他版本已更新版本号），直接覆盖本地旧文件会回退别的版本。正确做法：先 `scp` 拉取服务器版 → 只改目标版本卡片 → 上传回。
4. **push 网络 flaky**：github.com git push 间歇 `Recv failure: Connection was reset`，需 retry。
5. **Cargo.toml 显示 modified 是 CRLF/LF 噪音**：`git add -A` 后归一为 clean，非真实内容改动。
6. **发布脚本硬编码 remote**：`release.mjs` 里 `git push sunsh0704` 在只有 `origin` 的版本会失败，按需手动发布。

---

## 12. 完整 checklist（逐项打勾）

**后端**
- [ ] `Cargo.toml`：确认 `base64 = "0.22"`、`image = "0.25"`、`md5 = "0.7"` 已存在
- [ ] 新建 `ai/describe.rs`（§3.1，原样复制）
- [ ] 新建 `ai/providers/minimax/mod.rs`（§3.2，原样复制，含 Queued 分支）
- [ ] `ai/mod.rs`：`pub mod describe` + `ProviderTaskPollResult` 加 `Queued`（§3.3）
- [ ] 修非穷尽 match：grsai/kie/happyhorse/ai.rs/banana_api.rs 的 `Running` → `Queued | Running`
- [ ] `providers/mod.rs`：`pub mod minimax` + `pub use` + `build_default_providers` 加 `MiniMaxProvider`
- [ ] `asset.rs`：读图缓存表 + 异步钩子 + 删除清理 + 并发合并锁（§3.5）
- [ ] `banana_api.rs`：qianfan_vl key（§3.6 a-c）+ is_minimax 路由 + is_baidu_vod + poll Queued 臂（§3.6 d-f）
- [ ] `lib.rs`：注册 `describe_asset` / `get_asset_descriptions`（§3.8）
- [ ] `update.rs`：`resolve_video_gen_rules_url` 加 `minimax` 映射（§3.7）
- [ ] `chat.rs`：三轨式覆盖指令 + 第 8 条 @图N + 删 `integrate_video_prompt`（§3.9）
- [ ] `deepseek.rs`：删 `clean_video_prompt` 清洗器（§3.10）
- [ ] `baidu/mod.rs`：400 分支改 `translate_baidu_image_error`（§3.11）

**前端**
- [ ] 新建 `features/chat/projectContext.ts`（§4.1，原样复制）
- [ ] `asset.ts`：读图函数 + 补读阻塞 + 删 `cleanVideoPrompt`（§4.2）
- [ ] `Canvas.tsx`：复用 projectContext + 自动连线（§4.3）
- [ ] `ProjectDashboard.tsx`：复用 projectContext（§4.4）
- [ ] `ReanalyzeDialog.tsx`：复用 projectContext（§4.5）
- [ ] `ChatInput.tsx`：上传按钮 + 弹窗（§4.6）
- [ ] `VideoGenDialog.tsx`：默认模型 H3 + isMinimax + api_type + resume + 排队提示（§4.7）
- [ ] `ai.ts`：`VideoPollResult.status` 补 `'queued'`（§4.8）
- [ ] `videoGenRules.ts`：兜底改 H3 风格（§4.9）
- [ ] i18n：`chat.uploadImage` + `videoGen.queued`/`queuedHint`（§4.10）

**规则文件**
- [ ] 新建 `video_gen_rules_minimax_h3.json`（三轨式 + 1.5 秒，替换 ⟦行业专属词⟧，version=2）+ 上传
- [ ] `video_gen_rules_happyhorse.json`：1.5 秒约束，version 递增 + 上传
- [ ] `video_gen_rules_pixverse_c1.json`：1.5 秒约束，version 递增 + 上传

**SKILL + 发布**
- [ ] `SKILL.md`：三轨式模板 + 读图逻辑补丁（§6.1 + §6.2）
- [ ] 品牌名残留清理（§7）
- [ ] bump `version.txt` + 重打包 zip + 上传（§6.3）
- [ ] 版本文件 `version_<行业>.json`（version 递增、notes 无模型名）+ 上传
- [ ] 下载页 `industry.html` 更新 + 上传
- [ ] 本地 Windows NSIS + macOS CI 构建 + 双命名上传
- [ ] `notes` 字段不出现任何模型名称

**验证**
- [ ] `npx tsc --noEmit` 零错误
- [ ] `cd src-tauri && cargo check` 零错误
- [ ] 读图端到端（§9 读图 5 步）
- [ ] 视频端到端（§9 视频 4 步）
- [ ] 积分扣费 / 退费核对
