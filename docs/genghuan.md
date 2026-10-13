# MINIMAX H3 模型迁移方案

> **状态：待启动** — 等百度 VOD 接入 MINIMAX H3 后开始执行  
> **创建日期：** 2026-08-10  
> **适用版本：** 服饰 / 旅游 / 美妆 / 大健康 / 短视频（5个行业专业版同时变更）

---

## 一、MINIMAX H3 模型简介

MiniMax 于 2026 年 7 月 31 日发布，8 月 3 日开源，是业内首个**全模态通用生成模型**，统一了文本、图像、视频、音频的理解和生成。

### 核心指标

| 指标 | 数据 |
|------|------|
| 视频时长 | 4–15 秒 |
| 最高分辨率 | 2K (2560×1440) |
| 帧率 | 24 FPS |
| 音频 | 32kHz 原生立体声（与视频联合生成） |
| 多镜头 | 原生支持，无需拼接 |
| 多模态参考 | 最多 9 张图片 + 3 段视频 + 3 段音频（共 ≤12 文件） |
| 价格 | 2K: 0.8 元/秒（主流旗舰的 1/3） |
| 全球排名 | 视频编辑 #1 / 文生视频(带音频) #2 / 图生视频 #3 |

### 关键能力

- **指令遵循强**：复杂复合 prompt 理解准确，不再是"写一页只执行一半"
- **多镜头原生建模**：一次生成多个连续镜头，不是逐段拼接
- **文字渲染**：品牌 Logo、UI 文字、字幕的透视/光照/运动一致性
- **V2V 运动迁移**：将一段视频的动作风格迁移到另一主体/场景
- **参考图驱动**：多模态参考模式下，人物/产品/场景的外观保持优于同类

### 和 HappyHorse 1.1 的关键差异（预期）

| | HappyHorse 1.1 | MINIMAX H3 |
|---|---|---|
| 指令遵循度 | 中等（prompt 中 60-70% 被遵守） | 强（据报道 >90%） |
| 物理规律 | 偶尔反重力/悬浮 | 原生物理一致性更好 |
| 多镜头 | 需要 prompt 强行串联 | 原生多镜头建模 |
| 运镜响应 | 部分运镜被忽略 | 运镜指令响应更精准 |
| 负面提示词 | 敏感度中等 | 可能需要重新校准关键词 |
| 参考图锁定 | 偶尔漂移 | 多模态参考机制更强 |

---

## 二、当前系统架构（提示词/规则层）

```
L1: SKILL.md                 → AI 分镜生成技能（定义 AI 如何产出分镜脚本）
L2: grid_prompt_rules_*.json → 六宫格图片生成规则
L3: video_gen_rules_*.json   → 视频生成规则（prompt_rule + negative_prompt + constraints）
L4: videoGenRules.ts          → 客户端兜底规则（网络故障用）
L5: update.rs                 → 模型名 → 规则文件 URL 的路由映射
```

H3 适配的核心在 **L3** 和 **L1**——L3 的 `prompt_rule` 是直接注入到视频模型 prompt 前面的指令，H3 理解 prompt 的方式和 HappyHorse 不同，需要重新调校。L1 的分镜生成逻辑也可能需要调整以适应 H3 的输入偏好。

---

## 三、变更计划

### 第一阶段：代码层（每版 4 个文件，机械改动）

#### R1: `src-tauri/src/ai/providers/happyhorse/mod.rs`

```rust
// supports_model() — 添加 minimax-h3
fn supports_model(&self, model: &str) -> bool {
    let bare = Self::sanitize_model(model);
    matches!(
        bare.as_str(),
        "happyhorse-1.0-r2v" | "happyhorse-1.1-r2v" | "minimax-h3"  // ← 新增
    )
}

// list_models() — 添加 minimax-h3
fn list_models(&self) -> Vec<String> {
    vec![
        "happyhorse/happyhorse-1.0-r2v".to_string(),
        "happyhorse/happyhorse-1.1-r2v".to_string(),
        "happyhorse/minimax-h3".to_string(),  // ← 新增
    ]
}
```

#### R2: `src-tauri/src/commands/banana_api.rs`

- `banana_submit_video_job`：加 `"happyhorse/minimax-h3"` 分支，复用 BaiduVOD 后端
- `banana_poll_video_job`：同上

#### R3: `src-tauri/src/commands/update.rs`

```rust
fn resolve_video_gen_rules_url(model: Option<String>) -> String {
    // ...
    let file = match model.as_str() {
        "happyhorse_r2v" | "happyhorse/happyhorse-1.0-r2v" | "happyhorse/happyhorse-1.1-r2v"
            => "video_gen_rules_{edition}.json",
        "happyhorse/minimax-h3" => "video_gen_rules_{edition}_h3.json",  // ← 新增
        // ...
    };
}
```

各版本映射目标：
| 版本 | H3 规则文件 |
|------|------------|
| 服饰 | `video_gen_rules_fashion_h3.json` |
| 旅游 | `video_gen_rules_travel_h3.json` |
| 美妆 | `video_gen_rules_beauty_h3.json` |
| 大健康 | `video_gen_rules_health_h3.json` |
| 短视频 | `video_gen_rules_shortvideo_h3.json` |

#### R4: `src/features/videoGeneration/VideoGenDialog.tsx`

- 第 300 行：`useState` 默认值改为 `'happyhorse/minimax-h3'`
- 第 806、869 行：回退值同步改为 `'happyhorse/minimax-h3'`

---

### 第二阶段：提示词适配（核心工作量）

#### L3 视频规则（5 个新文件）

每版新建 `video_gen_rules_{edition}_h3.json`，基于现有的 `video_gen_rules_{edition}.json` 进行调整。H3 适配要点：

| 调整项 | 说明 |
|--------|------|
| `prompt_rule` | H3 指令遵循更强，可简化冗余指令；运镜描述可以更精确（H3 响应更好） |
| `negative_prompt` | 重新校准——原来给 HappyHorse 的负面词可能过度限制 H3，也可能不够 |
| 运镜指令 | H3 响应运镜更准，可加入更丰富的运镜组合（如 "dolly zoom + slow orbit"） |
| 多镜头 | H3 原生多镜头——可以放宽"禁止跳切"的限制，允许更自然的镜头切换 |
| 物理约束 | H3 物理一致性更好，可以减轻此块的硬约束 |
| 参考图锁定 | H3 多模态参考机制更强，"画面由参考图锁定"的强制力度可适度降低 |

#### L3 各版本行业专属调整

| 版本 | H3 适配重点 |
|------|------------|
| **服饰** | 服装材质细节（H3 纹理还原更好）、面料微距运镜、多镜头走秀 |
| **旅游** | 航拍大景（H3 2K 有优势）、空间递进多镜头、地标锁定 |
| **美妆** | 肤质保留（H3 纹理更好）、微距特写、妆品灵活比重 |
| **大健康** | 产品微距质感、暖调3000-4000K、合规约束（禁止医疗声称） |
| **短视频** | 通用产品运镜、物理规律、多镜头叙事 |

#### L1 Skill 文件（服务端 `skill` 文件）

- 分镜生成策略可能需要调整——H3 对 prompt 格式的偏好可能不同
- 如果 H3 能更好地理解中文 prompt，可以简化 Skill 中的"翻译"步骤
- 建议：先在服饰版用现有 Skill + H3 规则跑通，视效果再决定是否改 Skill

#### L2 宫格规则

- 六宫格生成用的是图片模型（gpt-image-2），和 H3 无关——**不需要改**

#### L4 客户端兜底规则

- `videoGenRules.ts` 中的 `DEFAULT_RULES` 加一份 H3 版兜底

---

### 第三阶段：同步 & 部署

```
服饰版（试点）
  ├─ 改代码 + 建 H3 规则
  ├─ cargo check + 本地跑通
  ├─ 调 prompt_rule 到满意效果
  └─ ↓ 模板确认后同步到其余 4 版
      
旅游版 / 美妆版 / 大健康版 / 短视频版
  ├─ 复制代码改动
  ├─ 各建专属 H3 规则文件（行业段落替换）
  └─ 各版 cargo check

服务端部署
  ├─ 上传 5 个 video_gen_rules_{edition}_h3.json
  └─ 如需 → 更新 Skill 文件
```

---

## 四、各版本补齐清单

H3 迁移前需要确保每版基础规则文件完整：

| 版本 | L3 基础规则 | L3 H3 规则 | L2 宫格规则 | 状态 |
|------|:---:|:---:|:---:|------|
| 服饰 | ✅ `_fashion` | 🆕 `_fashion_h3` | ✅ | 基础完备 |
| 旅游 | ✅ `_travel` | 🆕 `_travel_h3` | ✅ | 基础完备 |
| 美妆 | ✅ `_beauty` (8/9 已修复) | 🆕 `_beauty_h3` | ✅ (8/9 已修复) | 基础完备 |
| 大健康 | ✅ `_health` | 🆕 `_health_h3` | ✅ | 基础完备 |
| 短视频 | ❌ 缺少专属规则 | 🆕 `_shortvideo_h3` | ✅ | **需先补齐基础规则** |

---

## 五、待确认事项

1. **百度 VOD 的 H3 接口**：端点是否还是 `/v3/aigc/bailian`？模型名参数是什么？（预期 `"minimax-h3"` 或类似）
2. **H3 的价格**：海报价 0.8 元/秒(2K)，百度 VOD 渠道的实际结算价？
3. **参数兼容性**：duration / resolution / aspect_ratio 的取值范围是否和 HappyHorse 一致？
4. **Skill 文件**：是否需要根据 H3 特性升级服务端的 AI 分镜生成 Skill？

---

## 六、参考

- MiniMax H3 官方博客：https://www.minimax.io/blog/minimax-h3
- MiniMax H3 开源公告：https://www.minimax.io/news/minimax-h3-open-source
- 视频生成 API 文档：https://platform.minimax.io/docs/guides/video-generation
- 当前 HappyHorse 默认模型：`happyhorse-1.1-r2v`
- 当前百度 VOD 端点：`https://vod.bj.baidubce.com/v3/aigc/bailian`
