# 欢乐马 1.1 视频生成迁移指南

> 本文档记录**服饰版**（Storyboard-Fashion，基准模板）将视频模型对齐到 **欢乐马 1.1**（走百度 VOD 透传）的完整改动。
> 后续要把 **美妆版 / 旅游版 / 大健康版** 对齐欢乐马 1.1 时，照本文档逐项执行即可（行业定制点单独标注）。

---

## 0. 铁律（不可违反）

1. **视频生成 / 宫格生成一律走百度 VOD**（`BAIDU_VIDEO_KEY`），禁止阿里云 DashScope 直连、禁止 wan2.7。
2. **发布日志 / 更新日志（`notes` 字段）禁止出现模型名称**（欢乐马 / happyhorse / 阿里百炼 / Bailian 等）。
3. **积分扣费 / 退费逻辑零改动**——`banana_consume_credit` / `refund_generation_credit` 与模型无关。
4. **参考图不变**——继续用单张 6 宫格故事板合成图，作为 `media` 数组（`reference_image`）传入。

---

## 1. 迁移涉及的两大块

| 块 | 内容 | 关键文件 |
|----|------|---------|
| **A. 视频模型接入** | 后端 provider + 路由 + 规则映射 + 提示词清洗器 + 前端默认模型 + 规则文件 | `happyhorse/mod.rs`、`providers/mod.rs`、`banana_api.rs`、`deepseek.rs`、`update.rs`、`VideoGenDialog.tsx`、`videoGenRules.ts`、`video_gen_rules_*.json` |
| **B. skill 提示词格式** | SKILL.md 用欢乐马 `Begin with Shot N [X-Ys]` 格式 | `docs/skills/SKILL.md` + `chat.rs` 运行时覆盖指令 |

---

## 2. A 块：视频模型接入

### 2.1 依赖检查（`src-tauri/Cargo.toml`）

欢乐马 provider 用到 `base64` + `image`（参考图补黑边用）。确认目标版本已有：

```toml
base64 = "0.22"
image = "0.25"
```

### 2.2 新建/覆盖 provider：`src-tauri/src/ai/providers/happyhorse/mod.rs`

**直接复制服饰版该文件即可，完整内容如下：**

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

// ── Baidu VOD（透传阿里百炼 Bailian）──
// 欢乐马 1.1 只走百度 VOD 通道（vod.bj.baidubce.com/v3/aigc/bailian），
// 不通过阿里云 DashScope 直连。
const BAIDU_VOD_BASE_URL: &str = "https://vod.bj.baidubce.com/v3/aigc/bailian";
const CREATE_VIDEO_PATH: &str = "/api/v1/services/aigc/video-generation/video-synthesis";
const BAIDU_VOD_TASK_QUERY_URL: &str = "https://vod.bj.baidubce.com/v3/tasks";

const POLL_INTERVAL_MS: u64 = 15000;
const MAX_REFERENCE_IMAGES: usize = 9;

// ── 阿里百炼 Bailian 响应类型（百度 VOD 透传返回的阿里格式）──

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct BailianCreateResponse {
    output: Option<BailianCreateOutput>,
    code: Option<String>,
    message: Option<String>,
}

#[derive(Debug, Deserialize)]
struct BailianCreateOutput {
    task_id: String,
}

// ── Baidu VOD 响应类型 ──

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct BaiduVodTaskResponse {
    status: Option<String>,
    #[serde(rename = "videoUrl")]
    video_url: Option<String>,
    #[serde(rename = "videoGenerateTaskInfo")]
    video_gen_info: Option<serde_json::Value>,
    #[serde(rename = "taskId")]
    task_id: Option<String>,
    code: Option<String>,
    message: Option<String>,
}

pub struct HappyHorseProvider {
    client: Client,
    api_key: Arc<RwLock<Option<String>>>,
    /// Model name to send in API requests (e.g. "happyhorse-1.1-r2v")
    api_model: String,
}

impl HappyHorseProvider {
    pub fn new() -> Self {
        Self::new_baidu_vod("happyhorse-1.1-r2v")
    }

    /// Create a provider that routes through Baidu VOD (Bearer token auth).
    pub fn new_baidu_vod(model: &str) -> Self {
        Self {
            client: Client::builder()
                .timeout(Duration::from_secs(3600))
                .connect_timeout(Duration::from_secs(30))
                .build()
                .unwrap_or_else(|_| Client::new()),
            api_key: Arc::new(RwLock::new(None)),
            api_model: Self::sanitize_model(model),
        }
    }

    fn sanitize_model(model: &str) -> String {
        model
            .split_once('/')
            .map(|(_, bare)| bare.to_string())
            .unwrap_or_else(|| model.to_string())
    }

    fn is_valid_media_url(value: &str) -> bool {
        value.starts_with("http://") || value.starts_with("https://") || value.starts_with("data:")
    }

    /// 检查 base64 图片宽高比，低于 min_ratio 时上下加黑边补齐。
    /// 六宫格竖幅（3列×2行）宽高比可能低到 0.375，需补齐到 0.40 满足模型最小宽高比。
    /// （注释里"短视频版特有"是历史遗留，此逻辑对所有版本通用。）
    fn ensure_image_ratio(data_url: &str, min_ratio: f64) -> String {
        let (header, encoded) = match data_url.split_once(',') {
            Some((h, e)) if h.contains("data:image") => (h, e),
            _ => return data_url.to_string(),
        };

        let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(encoded) else {
            return data_url.to_string();
        };

        let Ok(img) = image::load_from_memory(&bytes) else {
            return data_url.to_string();
        };

        let (w, h) = (img.width() as f64, img.height() as f64);
        let ratio = h / w;
        if ratio >= min_ratio {
            return data_url.to_string();
        }

        let new_h = (w * min_ratio).ceil() as u32;
        let pad_top = (new_h - h as u32) / 2;
        let mut canvas = image::RgbaImage::new(w as u32, new_h);
        for pixel in canvas.pixels_mut() {
            *pixel = image::Rgba([0, 0, 0, 255]);
        }
        image::imageops::overlay(&mut canvas, &img.to_rgba8(), 0, pad_top as i64);

        let dyn_img = image::DynamicImage::ImageRgba8(canvas);
        let mut buf = Vec::new();
        if dyn_img
            .write_to(&mut std::io::Cursor::new(&mut buf), image::ImageFormat::Jpeg)
            .is_err()
        {
            return data_url.to_string();
        }
        let new_encoded = base64::engine::general_purpose::STANDARD.encode(&buf);
        format!("data:image/jpeg;base64,{}", new_encoded)
    }

    fn build_media_array(reference_images: &[String]) -> Vec<Value> {
        const MIN_ASPECT_RATIO: f64 = 0.40;
        reference_images
            .iter()
            .take(MAX_REFERENCE_IMAGES)
            .filter(|url| Self::is_valid_media_url(url))
            .map(|url| {
                let fixed = if url.starts_with("data:") {
                    let before = url.len();
                    let result = Self::ensure_image_ratio(url, MIN_ASPECT_RATIO);
                    if result.len() != before {
                        info!("[HappyHorse] image padded to meet min aspect ratio {}", MIN_ASPECT_RATIO);
                    }
                    result
                } else {
                    url.clone()
                };
                json!({
                    "type": "reference_image",
                    "url": fixed
                })
            })
            .collect()
    }

    fn extract_baidu_vod_video_url(resp: &BaiduVodTaskResponse) -> Option<String> {
        // Direct videoUrl field
        if let Some(ref url) = resp.video_url {
            if !url.is_empty() {
                return Some(url.clone());
            }
        }
        // Nested VOD format: videoGenerateTaskInfo.videoGenerateTaskOutput.mediaBasicInfos[0].source.sourceUrl
        resp.video_gen_info
            .as_ref()
            .and_then(|info| info.get("videoGenerateTaskOutput"))
            .and_then(|output| output.get("mediaBasicInfos"))
            .and_then(|medias| medias.as_array())
            .and_then(|arr| arr.first())
            .and_then(|media| media.get("source"))
            .and_then(|source| source.get("sourceUrl"))
            .and_then(|url| url.as_str())
            .map(|s| s.to_string())
    }

    async fn create_task(
        &self,
        api_key: &str,
        request: &GenerateRequest,
        reference_images: &[String],
    ) -> Result<String, AIError> {
        let duration = request
            .extra_params
            .as_ref()
            .and_then(|params| params.get("duration_seconds"))
            .and_then(|raw| raw.as_u64())
            .unwrap_or(5) as u32;

        let resolution = request
            .extra_params
            .as_ref()
            .and_then(|params| params.get("resolution"))
            .and_then(|raw| raw.as_str())
            .unwrap_or("720P")
            .to_string();

        let media = Self::build_media_array(reference_images);

        let body = json!({
            "model": self.api_model,
            "input": {
                "prompt": request.prompt,
                "media": media
            },
            "parameters": {
                "resolution": resolution,
                "ratio": request.aspect_ratio,
                "duration": duration,
                "watermark": false
            }
        });

        let endpoint = format!("{}{}", BAIDU_VOD_BASE_URL, CREATE_VIDEO_PATH);
        let log_tag = "HappyHorse-BaiduVOD";

        info!(
            "[{} createTask] model={}, duration={}, resolution={}, ratio={}, refs={}, promptLen={}",
            log_tag, self.api_model, duration, resolution, request.aspect_ratio,
            reference_images.len(), request.prompt.chars().count()
        );
        info!("[{} createTask] FULL PROMPT:\n{}", log_tag, request.prompt);

        let response = self
            .client
            .post(&endpoint)
            .header("Authorization", format!("Bearer {}", api_key))
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await?;

        let status = response.status();
        let raw_response = response.text().await.unwrap_or_default();

        if !status.is_success() {
            return Err(AIError::Provider(format!(
                "{} createTask failed {}: {}",
                log_tag, status, raw_response
            )));
        }

        // 欢乐马经百度 VOD 是阿里百炼 Bailian 的透明透传。
        // 创建响应为阿里格式：{"output":{"task_id":"...","task_status":"PENDING"}}
        // 先尝试阿里格式，失败则回退到百度 VOD 格式。
        let raw = &raw_response;

        if let Ok(resp) = serde_json::from_str::<BailianCreateResponse>(raw) {
            if let Some(code) = resp.code {
                let msg = resp.message.unwrap_or_else(|| "unknown error".to_string());
                return Err(AIError::Provider(format!(
                    "{} createTask API error [{}]: {}",
                    log_tag, code, msg
                )));
            }
            if let Some(task_id) = resp.output.and_then(|o| if o.task_id.is_empty() { None } else { Some(o.task_id) }) {
                return Ok(task_id);
            }
        }

        // 回退到百度 VOD 格式：{"taskId":"...","code":"0"}
        if let Ok(resp) = serde_json::from_str::<BaiduVodTaskResponse>(raw) {
            if let Some(code) = &resp.code {
                let msg = resp.message.as_deref().unwrap_or("unknown");
                if code != "0" && code != "Success" {
                    return Err(AIError::Provider(format!(
                        "{} createTask API error [{}]: {}",
                        log_tag, code, msg
                    )));
                }
            }
            if let Some(task_id) = resp.task_id {
                return Ok(task_id);
            }
        }

        Err(AIError::Provider(format!(
            "{} createTask: unable to extract task_id from response: {}",
            log_tag, raw_response
        )))
    }

    async fn poll_task_once(
        &self,
        api_key: &str,
        task_id: &str,
    ) -> Result<ProviderTaskPollResult, AIError> {
        let endpoint = format!("{}/{}", BAIDU_VOD_TASK_QUERY_URL, task_id);
        let log_tag = "HappyHorse-BaiduVOD";

        let response = self
            .client
            .get(&endpoint)
            .header("Authorization", format!("Bearer {}", api_key))
            .send()
            .await?;

        let status = response.status();
        let raw_response = response.text().await.unwrap_or_default();

        if !status.is_success() {
            return Err(AIError::Provider(format!(
                "{} task query failed {}: {}",
                log_tag, status, raw_response
            )));
        }

        info!("[{}] poll raw response: {}", log_tag, raw_response);
        let resp: BaiduVodTaskResponse =
            serde_json::from_str(&raw_response).map_err(|err| {
                AIError::Provider(format!(
                    "{} task query invalid JSON: {}; raw={}",
                    log_tag, err, raw_response
                ))
            })?;
        if let Some(code) = &resp.code {
            let msg = resp.message.as_deref().unwrap_or("unknown");
            if code != "0" && code != "Success" {
                return Err(AIError::Provider(format!(
                    "{} task query API error [{}]: {}",
                    log_tag, code, msg
                )));
            }
        }
        // Check video_gen_info embedded status — may be SUCCEEDED even when
        // the top-level status is still RUNNING (post-processing / upload in progress).
        let inner_status = resp.video_gen_info
            .as_ref()
            .and_then(|vi| vi.get("status"))
            .and_then(|s| s.as_str())
            .unwrap_or("")
            .to_uppercase();
        // Always try to extract video URL first — mediaBasicInfos may be populated
        // before the top-level status flips to SUCCESS.
        if let Some(url) = Self::extract_baidu_vod_video_url(&resp) {
            info!("[{}] task {} succeeded (media ready): {}", log_tag, task_id, url);
            return Ok(ProviderTaskPollResult::Succeeded(url));
        }
        if inner_status == "FAILED" || inner_status == "ERROR" {
            let msg = resp.video_gen_info
                .as_ref()
                .and_then(|vi| vi.get("message").or_else(|| vi.get("error")))
                .and_then(|m| m.as_str())
                .unwrap_or("生成失败");
            info!("[{}] task {} FAILED (inner): {}", log_tag, task_id, msg);
            return Ok(ProviderTaskPollResult::Failed(msg.to_string()));
        }
        let task_status = resp.status.as_deref().unwrap_or("").to_uppercase();
        match task_status.as_str() {
            "SUCCEEDED" | "COMPLETED" | "SUCCESS" => {
                info!("[{}] task {} status={} but no media URL yet, keep polling",
                    log_tag, task_id, task_status);
                Ok(ProviderTaskPollResult::Running)
            }
            "FAILED" | "ERROR" => {
                let msg = resp.message.unwrap_or_else(|| "生成失败".to_string());
                info!("[{}] task {} FAILED: {}", log_tag, task_id, msg);
                Ok(ProviderTaskPollResult::Failed(msg))
            }
            "READY" | "PENDING" | "RUNNING" | "PROCESSING" | _ => {
                let detail = if inner_status == "SUCCEEDED" {
                    " (AI done, waiting for media upload)"
                } else {
                    ""
                };
                info!("[{}] task {} status={}{}", log_tag, task_id, task_status, detail);
                Ok(ProviderTaskPollResult::Running)
            }
        }
    }
}

impl Default for HappyHorseProvider {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait::async_trait]
impl AIProvider for HappyHorseProvider {
    fn name(&self) -> &str {
        "happyhorse"
    }

    fn supports_model(&self, model: &str) -> bool {
        Self::sanitize_model(model) == "happyhorse-1.1-r2v"
    }

    fn list_models(&self) -> Vec<String> {
        vec!["happyhorse/happyhorse-1.1-r2v".to_string()]
    }

    async fn set_api_key(&self, api_key: String) -> Result<(), AIError> {
        let mut key = self.api_key.write().await;
        *key = Some(api_key);
        Ok(())
    }

    fn supports_task_resume(&self) -> bool {
        true
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
            .ok_or_else(|| AIError::InvalidRequest("欢乐马 API key not set".to_string()))?;

        let refs = request.reference_images.as_deref().unwrap_or(&[]);
        let task_id = self.create_task(&api_key, &request, refs).await?;

        Ok(ProviderTaskSubmission::Queued(ProviderTaskHandle {
            task_id,
            metadata: Some(serde_json::json!({
                "backend": "baidu_vod",
                "api_key": api_key,
                "api_model": self.api_model,
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
            .ok_or_else(|| AIError::InvalidRequest("欢乐马 API key not set (not in metadata or provider)".to_string()))?;

        self.poll_task_once(&api_key, &handle.task_id).await
    }

    async fn generate(&self, request: GenerateRequest) -> Result<String, AIError> {
        let api_key = self
            .api_key
            .read()
            .await
            .clone()
            .ok_or_else(|| AIError::InvalidRequest("欢乐马 API key not set".to_string()))?;

        let refs = request.reference_images.as_deref().unwrap_or(&[]);
        let task_id = self.create_task(&api_key, &request, refs).await?;

        loop {
            match self.poll_task_once(&api_key, &task_id).await? {
                ProviderTaskPollResult::Running => {
                    sleep(Duration::from_millis(POLL_INTERVAL_MS)).await
                }
                ProviderTaskPollResult::Succeeded(url) => return Ok(url),
                ProviderTaskPollResult::Failed(message) => {
                    return Err(AIError::TaskFailed(message))
                }
            }
        }
    }
}
```

### 2.3 注册 provider：`src-tauri/src/ai/providers/mod.rs`

```rust
pub mod happyhorse;                                 // ① 模块声明

pub use happyhorse::HappyHorseProvider;             // ② 导出

pub fn build_default_providers() -> Vec<Arc<dyn AIProvider>> {
    vec![
        // ... 已有 provider ...
        Arc::new(HappyHorseProvider::new()),         // ③ 加入默认列表
    ]
}
```

### 2.4 路由：`src-tauri/src/commands/banana_api.rs`

**① submit** —— 默认模型 + `is_happyhorse` 分支：

```rust
let model_name = model.unwrap_or_else(|| "happyhorse/happyhorse-1.1-r2v".to_string());

let is_happyhorse = model_name.starts_with("happyhorse/");
let is_pixverse = model_name.starts_with("pixverse/");

let provider = if is_happyhorse {
    let key = get_baidu_video_key()
        .ok_or_else(|| "百度视频生成密钥未配置，请联系管理员".to_string())?;
    let p: std::sync::Arc<dyn crate::ai::AIProvider> = std::sync::Arc::new(
        crate::ai::providers::happyhorse::HappyHorseProvider::new_baidu_vod(&model_name),
    );
    p.set_api_key(key.clone()).await.map_err(|e| format!("设置欢乐马百度VOD密钥失败: {}", e))?;
    p
} else if is_pixverse {
    // ... 原 pixverse 分支 ...
} else {
    // 报错文案
};
```

**② 参考图 base64 直传** —— `is_baidu_vod` 判断：

```rust
let is_baidu_vod = is_happyhorse && model_name.contains("happyhorse-1.1");
let qiniu_images = if is_baidu_vod {
    image_input                                   // 跳过七牛，base64 直传
} else if !image_input.is_empty() {
    upload_refs_to_qiniu(&image_input).await
} else {
    image_input
};
```

> ⚠️ 注意：`is_baidu_vod` 要带 `contains("happyhorse-1.1")`——只有 1.1 走百度 VOD base64 直传；若目标版本还有 1.0 残留，1.0 走七牛。

**③ poll（轮询 / 续传）** —— 同样加 `is_happyhorse` 分支，返回 `Box<dyn AIProvider + Send>`：

```rust
let is_happyhorse = model_name.starts_with("happyhorse/");
let provider: Box<dyn AIProvider + Send> = if is_happyhorse {
    let api_key = get_baidu_video_key()
        .ok_or_else(|| "百度视频生成密钥未配置，请联系管理员".to_string())?;
    let p = crate::ai::providers::happyhorse::HappyHorseProvider::new_baidu_vod(&model_name);
    p.set_api_key(api_key).await.map_err(|e| format!("设置欢乐马百度VOD密钥失败: {}", e))?;
    Box::new(p)
} else {
    // ...
};
```

### 2.5 提示词清洗器：`src-tauri/src/ai/deepseek.rs`（欢乐马特有，H3 已删）

欢乐马 1.1 对提示词有严格的 `Begin with Shot` 格式要求，需要一个清洗器在提交前二次清洗。**这是欢乐马与 H3 最大的区别之一**（H3 用自然语言、无需清洗）。

`VIDEO_CLEAN_HAPPYHORSE_PROMPT` 常量 + `clean_video_prompt` 函数照抄服饰版 `deepseek.rs`：

```rust
const VIDEO_CLEAN_HAPPYHORSE_PROMPT: &str = r#"你是一个视频提示词清洗器。清洗分镜提示词，保留 Begin with Shot / Then Shot / Cut to Shot 分镜结构。

【铁律】
- 保留原有分镜结构（Begin with Shot N [X-Ys] / Then Shot N [X-Ys] / Cut to Shot N [X-Ys]），时间码 [X-Ys] 不变，禁止改写成 S1/S2、"第N个镜头" 等其它格式
- 声音和台词逐字保留原文，一字不改
- 禁止光影/场景/角色外观/道具外观
- 禁止 [Image N] / [Image1] / 图N / 图1 等一切参考图文本引用（参考图由 media 数组提供）
- 禁止分辨率/画幅/模型名
- 禁止在动作内塞秒级量化（如 1.5秒转身、0.5秒插袋）——时间只由 [X-Ys] 括号统一控制
- 人物表情与动作必须真人化，禁止AI塑料感
- 【平滑运镜·禁止硬切】同一场景内（同一人物/同一服装/同一空间连续推进）镜头之间禁止硬切、跳切、幻灯片式切换，必须用连续平滑运镜自然衔接（推近/拉远/摇移/环绕/跟拍/升降一气呵成），让六格丝滑连成一镜到底的完整短片。Cut to Shot 仅用于场景根本性变化（换空间/换人物/换时间），同一场景内一律用 Then Shot 平滑过渡，禁止逐格用 static 定点硬切

【输出格式】每个Shot一行，保持原有分镜结构。同一场景的连续镜头优先用 Then Shot 平滑衔接，禁止每格都 Cut to 硬切：
Begin with Shot 1 [0-3s]: {运镜}。{动作≤15字}。{声音}
Then Shot 2 [3-8s]: {运镜}。{动作≤15字}。{声音}
Then Shot 3 [8-12s]: {运镜}。{动作≤15字}。{声音}

【反AI化·真人质感】动作/表情用自然真人语序英文，用词从：natural micro-expressions | subtle breathing | weight shift | genuine blink | soft gaze ...
禁止用：plastic skin | doll-like | wax figure | dead eyes | frozen expression | fixed smile | robotic movement | exaggerated gesture | uncanny | over-smooth | CGI render。

【运镜仅限】优先连续平滑运镜（跨格衔接禁止用 static 硬切）：slow push-in | slow pull-out | smooth pan L->R | smooth pan R->L | smooth tracking | orbit L | orbit R | tilt up | tilt down | crane up | crane down | micro close-up | fabric flutter | ... | static（仅用于起始/收尾定格，不用于跨格衔接）

【约束】动作≤15字。全部英文。纯文本输出。末尾加一句：No text overlays, no watermarks, no subtitles, no dialogue boxes, no captions."#;
```

> 完整内容（含 `split_header_and_shots`、`clean_video_prompt` 函数）照抄服饰版 `deepseek.rs`（`VIDEO_CLEAN_HAPPYHORSE_PROMPT` 在 `:150-172`，`clean_video_prompt` 在 `:190` 起）。
> **运镜词库要按行业替换**：服饰版是 `fabric flutter / catwalk forward / vertical pan (collar→hem)…`，美妆版换成妆容特写类运镜，旅游版换成航拍/推近风景类，大健康版换成产品微距/成分溯源类。

### 2.6 规则映射：`src-tauri/src/commands/update.rs`

`resolve_video_gen_rules_url` 的 match，把 `happyhorse_r2v` / `happyhorse/happyhorse-1.1-r2v` 映射到目标版本的规则文件：

```rust
let file = match model.as_str() {
    "happyhorse_r2v" | "happyhorse/happyhorse-1.1-r2v" => "video_gen_rules_fashion.json",  // ← 换成目标版本文件名
    "fashion_r2v" | "travel/fashion-1.0-r2v" => "video_gen_rules_fashion.json",            // ← 历史兼容映射，可清理
    "pixverse_c1" | "pixverse/c1" => "video_gen_rules_pixverse_c1.json",
    _ => "video_gen_rules_fashion.json",                                                    // ← 兜底也换成目标版本
};
```

> 目标版本规则文件名：美妆版 → `video_gen_rules_beauty.json`，旅游版 → `video_gen_rules_travel.json`，大健康版 → `video_gen_rules_health.json`。

### 2.7 前端：`src/features/videoGeneration/VideoGenDialog.tsx`

改动点（照服饰版逐处对齐）：

| 位置 | 改动 |
|------|------|
| 默认模型 state | `useState<string>('happyhorse/happyhorse-1.1-r2v')` |
| `bananaReportUsage` 的 `api_type` | 硬编码为 `'happyhorse_1_1'`（或目标版本自定义值） |
| resume 判定 | `isHappyhorseTask = savedConfig?.videoModel?.includes('happyhorse')` |
| 模型判断 | `const isHappyhorse = videoModel.includes('happyhorse');` |
| 提交/轮询 model | 直接传 `'happyhorse/happyhorse-1.1-r2v'` |
| **清洗器调用** | `cleanVideoPrompt` 在提交前对欢乐马提示词二次清洗（H3 版已删此调用，欢乐马必须保留） |

### 2.8 前端兜底规则：`src/features/videoGeneration/videoGenRules.ts`

`DEFAULT_PROMPT_RULE` / `DEFAULT_RULES` 的兜底内容改成目标版本行业语义（仅网络故障时兜底用，完整规则走服务端 JSON）。**这是行业定制点**，服饰版是"服装呈现旅程"，美妆/旅游/大健康各自替换。

### 2.9 规则文件：`public/video_gen_rules_{行业}.json`（行业定制点）

规则文件结构统一，但 `prompt_rule` / `negative_prompt` / `constraints` 内容按行业定制。以服饰版 `video_gen_rules_fashion.json` 为模板：

```json
{
  "version": "30",
  "integration": { "model": "none", "max_tokens": 0, "system_prompt": "" },
  "negative_prompt": "{行业负面词}",
  "prompt_rule": "{行业铁律：图1=视频首帧…运镜…反AI化…人物真人质感}",
  "guidance_scale": 8.0,
  "shot_type": "multi",
  "constraints": {
    "global_rule": "...",
    "object_persistence": "...",
    "landmark_lock": "...",
    "spatial_progression": "...",
    "motion_catalog": "...",
    "shot_continuity": "...",
    "hard_constraints": [...]
  }
}
```

> **【平滑运镜·禁止硬切】所有行业版都必须在 `prompt_rule` 注入这段**：同一场景六格连续展示，镜头间禁止硬切/跳切/幻灯片式切换，必须用连续平滑运镜（推近/跟拍/环绕/微距）一气呵成丝滑衔接，如同一镜到底的短片；硬切仅场景根本变化（换空间/人物/时间）时用。同时：`shot_continuity` 写「同场景用连续平滑运镜（push-in/tracking/orbit/pan）衔接，硬切仅换空间/人物/时间」；`motion_catalog` 把 `fixed` 移到末尾并标注「仅起始/收尾定格，不用于跨格衔接」；`hard_constraints` 加一条「禁止同场景硬切」。详见服饰版 `video_gen_rules_fashion.json`。

**各版本行业语义对照**（迁移时重点改）：

| 版本 | 负面词侧重 | prompt_rule 侧重 | motion_catalog 侧重 |
|------|-----------|-----------------|-------------------|
| 服饰 | garment deformation / fabric drift / logo smear | 服装呈现旅程（整体→细节·静态→动态） | fabric flutter / catwalk / collar→hem |
| 美妆 | 妆面崩坏 / 色彩偏移 / 口红晕染 | 妆容教程（素颜→上妆→试色→妆效） | 面部特写 / 唇部微距 / 试色涂抹 |
| 旅游 | 场景违和 / 建筑变形 / 天气突变 | 目的地体验（广角→近景→人文→夜景） | 航拍 / 推近风景 / 摇镜全景 |
| 大健康 | 成分失实 / 产品漂移 / 功效夸大 | 产品溯源（成分→工艺→功效→康养） | 产品微距 / 成分特写 / 康养慢镜 |

### 2.10 视频生成页超分改造：去云端超分 + 本地自动 2K（`VideoGenDialog.tsx` + i18n）

**目标**：视频生成后不再让用户手动选超分，而是**生成完成即自动调用本地超分硬写入 2K**。删掉云端超分按钮和本地 4K 按钮，生成按钮文案改为「生成视频（2K）」。

**改动清单**（照服饰版逐处对齐）：

1. **删除状态变量**（原 `VideoGenDialog.tsx` 中 `isLocalEnhancing` / `localEnhanceProgress` 保留，其余删）：
   - `showLocalEnhanceConfirm`、`isUpscaling`、`upscaleTarget`、`showUpscaleConfirm`、`enhanceSuppressVideoConfirmRef` —— 全部删除
2. **删 `handleLocalEnhance`，改为 `autoEnhanceTo2K(localVideoPath: string): Promise<string>`**：
   - 内部 `setIsLocalEnhancing(true)` + 模拟进度条（0→90%，完成跳 100%）
   - `const result = await enhanceVideo(localVideoPath, 2);` —— scale=2 即 2K
   - 成功返回 `result`，失败 `catch` 后 `return localVideoPath`（回退原视频，不阻塞用户）
   - `finally` 里 `clearInterval` + `setIsLocalEnhancing(false)`
   - **不再**自己 `saveConfig` / `addToHistory`（改由生成完成处统一持久化）
3. **两处生成完成路径接入自动超分**（下载到本地后）：
   - `startPolling` 轮询成功分支：`const finalVideoPath = await autoEnhanceTo2K(localVideoPath); setVideoUrl(finalVideoPath);` 然后 `config.videoUrl = finalVideoPath`、`updateNodeData({ generatedVideoUrl: finalVideoPath })`
   - `executeGenerate` 同步完成分支：同上，`syncVideoPath` → `autoEnhanceTo2K` → `finalVideoPath`
4. **删除按钮区**：删「云端 2K (-20积分)」「云端 4K (-35积分)」「本地 4K (免费)」三个按钮，以及云端超分确认弹窗、本地超分硬件要求确认弹窗两个 `<UiModal>`
5. **生成按钮文案**：`t('videoGen.generate', '生成视频')` → `t('videoGen.generate', '生成视频（2K）')`，且同步改 `zh.json` 的 `videoGen.generate` 为「生成视频（2K）」、`en.json` 为「Generate Video (2K)」（否则 i18n 翻译会覆盖默认值）
6. **进度蒙版文案**：「正在本地生成4K视频...」→「正在本地超分到2K...」；loading 蒙版去掉 `isUpscaling`/`upscaleTarget` 引用
7. **清理未用 import**：删除 `UiButton`（两个超分弹窗删掉后不再引用）；`baiduUpscaleVideo` 动态 import 随云端弹窗一并删除

> 依赖：`enhanceVideo(videoPath, scale)` 来自 `@/commands/enhance` → 后端 `enhance_video`（ffmpeg + realesrgan-ncnn-vulkan），已在宫格超分章节接通。若目标版本还没移植本地超分，先补 `enhance.rs` / `enhance.ts` / `enhance_video`。

---

## 3. B 块：skill 提示词格式（SKILL.md）

### 3.1 欢乐马 1.1 官方格式：`Begin with Shot N [X-Ys]`

```text
【视频提示词】
Begin with Shot 1 [0-3s]: {运镜}。{动作≤15字}。{声音}
Then Shot 2 [3-8s]: {运镜}。{动作≤15字}。{声音}
Then Shot 3 [8-12s]: {运镜}。{动作≤15字}。{声音}
```

**硬约束**：
- 时间码在 `[X-Ys]` 括号内，用 `-` 连接，禁止 `第N个镜头[X-Ys]`、`S1/S2`、`for N seconds`
- 每 Shot 一行，`{运镜}。{动作≤15字}。{声音}` 三段式
- 禁止秒级量化（`1.5秒转身`）——时间只由 `[X-Ys]` 统一控制，欢乐马 1.1 对秒级量化执行过于字面化
- 全部英文（清洗器会统一转英文）
- **【平滑运镜·禁止硬切】** 同一场景的连续镜头优先用 `Then Shot` 平滑衔接，禁止每格都 `Cut to` 硬切；`Cut to Shot` 仅场景根本变化（换空间/人物/时间）时用；跨格衔接禁止用 `static` 定点硬切，必须用连续平滑运镜（推近/拉远/摇移/环绕/跟拍/升降）丝滑连成一镜到底

### 3.2 SKILL.md 改动点（照服饰版）

- 「第三步」输出 `【视频提示词】` 标记 + `Begin with Shot N [X-Ys]` 分镜结构
- 「自检清单」校验 `Begin with Shot` 格式、时间码递增、动作≤15字、英文运镜
- 「第五步翻译对照」保留（抽象→具体）
- 行业语义按目标版本替换（服饰版讲服装，美妆版讲妆容，以此类推）
- **「运镜规则 + 示例」加【平滑运镜·禁止硬切】**：调性表删「快切」引导，运镜表后加「同一场景连续平滑运镜、禁止硬切」说明，示例里的 `Cut to Shot 3` 一律改 `Then Shot 3` + 平滑运镜描述（推近/环绕/平移）

### 3.3 同步 `chat.rs` 运行时覆盖指令

`src-tauri/src/commands/chat.rs` 的 `system_prompt.push_str()`【分镜大师覆盖指令】块是运行时最高权威，SKILL.md 格式变更必须同步到此块。服饰版的分镜映射 JSON 里 `shots[].time` 直接引用 `Begin with Shot N [X-Ys]` 的时间括号。

---

## 4. 关键坑位（对齐欢乐马 1.1 必须带着这些修复）

| # | 现象 | 根因 | 修复 |
|---|------|------|------|
| 1 | 走错通道 / 鉴权失败 | 用了阿里云 DashScope 直连 | 一律走百度 VOD `vod.bj.baidubce.com/v3/aigc/bailian` + `Bearer BAIDU_VIDEO_KEY` |
| 2 | 创建拿不到 task_id | 响应是 Bailian 格式 `{"output":{"task_id":...}}`，不是百度 VOD 格式 | 双解析：先 Bailian `output.task_id`，回退百度 VOD `taskId` |
| 3 | 查询 404 / 接口错 | 查询接口拼错 | 查询走 `vod.bj.baidubce.com/v3/tasks/{task_id}`（不是 create 的 bailian 路径） |
| 4 | 竖幅参考图被拒 | 六宫格竖幅宽高比 0.375 < 模型最小 0.40 | `ensure_image_ratio` 上下补黑边到 0.40 |
| 5 | 提示词格式错误 / 执行过字面 | SKILL 出 `第N个镜头`/`S1/S2`/秒级量化 | 清洗器 `VIDEO_CLEAN_HAPPYHORSE_PROMPT` 保留 `Begin with Shot` 结构 + 禁秒级量化 |
| 6 | 参考图文本引用 | 提示词里写 `[Image N]`/`图N` | 清洗器禁止，参考图由 `media` 数组提供 |
| 7 | 同一场景硬切 / 幻灯片感 | 清洗器示例用 `Cut to Shot` + 运镜列表 `static` 靠前，模型逐格定点硬切 | 清洗器铁律加【平滑运镜·禁止硬切】、示例改 `Then Shot`、`static` 移到末尾标注「仅定格用」；规则文件 `prompt_rule`/`shot_continuity`/`motion_catalog`/`hard_constraints` 同步强化；SKILL.md 删「快切」+ 示例改 `Then Shot` |

---

## 5. 迁移 checklist（应用到美妆/旅游/大健康版时逐项打勾）

- [ ] **Cargo.toml**：确认 `base64 = "0.22"`、`image = "0.25"` 已存在
- [ ] **`happyhorse/mod.rs`**：照 §2.2 完整复制（覆盖旧版，删 DashScope 残留）
- [ ] **`providers/mod.rs`**：`pub mod happyhorse` + `pub use` + `build_default_providers`
- [ ] **`banana_api.rs`**：默认模型 `happyhorse/happyhorse-1.1-r2v` + submit/poll 加 `is_happyhorse` 分支 + `is_baidu_vod` 判断 + 删 `HAPPYHORSE_KEY` 统一 `baidu_video`
- [ ] **`deepseek.rs`**：`VIDEO_CLEAN_HAPPYHORSE_PROMPT` 清洗器（运镜词库按行业替换）+ `clean_video_prompt` 函数
- [ ] **`update.rs`**：`resolve_video_gen_rules_url` 映射到目标版本规则文件
- [ ] **`VideoGenDialog.tsx`**：默认模型 / `isHappyhorse` / `api_type` / resume 判定 / 清洗器调用保留
- [ ] **`videoGenRules.ts`**：`DEFAULT_RULES` 兜底改成目标版本行业语义
- [ ] **`video_gen_rules_{行业}.json`**：行业定制（负面词 + prompt_rule + motion_catalog）
- [ ] **`SKILL.md`**：`Begin with Shot N [X-Ys]` 格式 + 行业语义 + 平滑运镜（删「快切」、示例 `Cut to Shot 3` 改 `Then Shot 3`）
- [ ] **平滑运镜·禁止硬切**：清洗器铁律 + 规则文件 `prompt_rule`/`shot_continuity`/`motion_catalog`/`hard_constraints` 四文件同步（§2.9、§2.5、§3.1）
- [ ] **`VideoGenDialog.tsx` 超分改造**：去云端超分/本地4K按钮，`autoEnhanceTo2K` 自动本地 2K，按钮「生成视频（2K）」+ i18n 同步（§2.10）
- [ ] **`chat.rs`**：运行时覆盖指令同步 `Begin with Shot` 格式
- [ ] **删除** wan2.7 残留（`wan/mod.rs`、`wanR2V.ts`、`wan.ts`、`wan.json`）
- [ ] **验证**：`npx tsc --noEmit` + `cd src-tauri && cargo check` 零错误
- [ ] **端到端**：6 宫格故事板 → 生成视频 → 走 `happyhorse/` 路由 → 百度 VOD 透传 → 轮询拿视频 URL
- [ ] **积分核对**：扣费按 duration/resolution 表，接入前后一致；失败退费正常
