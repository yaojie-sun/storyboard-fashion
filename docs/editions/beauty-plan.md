# 美妆专业版 — 完整复刻方案

> **基准版本**：服饰专业版 v1.0.2（`com.storyboard.fashion`）
> **目标版本**：美妆专业版 v1.0.0（`com.storyboard.beauty`）
> **复刻原则**：以本文档为唯一施工清单，逐条修改，逐条勾销。

---

## 一、概述

### 1.1 产品定位

| | 服饰专业版 (基准) | 美妆专业版 (目标) |
|------|------|------|
| **行业** | 服装展示 | 美妆展示 |
| **核心场景** | T台走秀 / 穿搭展示 / 细节特写 / LOOKBOOK | 妆容教程 / 妆效对比 / 产品试色 / 护肤流程 |
| **产品名** | 小鸭服饰版 | 小鸭美妆版 |
| **identifier** | `com.storyboard.fashion` | `com.storyboard.beauty` |
| **SKILL name** | `xiaoya-ai-cinema-fashion` | `xiaoya-ai-cinema-beauty` |
| **App title** | 小鸭服饰版 | 小鸭美妆版 |

### 1.2 改动量估算

| 层级 | 文件数 | 改动点数 | 难度 |
|------|--------|---------|------|
| 品牌标识 | 8 | 22 | ⭐ 机械替换 |
| SKILL 文件 | 3 | 1 重写 | ⭐⭐⭐ 需行业知识 |
| 前端预设/UI | 5 | 15 | ⭐⭐ 行业适配 |
| 服务器文件 | 4 | 4 新建 | ⭐ 机械操作 |
| 下载页 | 1 | 1 新增区块 | ⭐ 机械操作 |
| **总计** | **21** | **~43** | — |

---

## 二、完整改动清单

> **标记说明**：`🔴` = 必须改，否则崩溃；`🟡` = 应该改，否则品牌错乱；`🟢` = 建议改，影响用户体验。

---

### 2.1 品牌标识层（8 文件 / 22 点）

#### 文件 1：`package.json`

| # | 行 | 旧值 | 新值 | 优先级 |
|---|-----|------|------|--------|
| 1 | `"name"` | `"storyboard-fashion"` | `"storyboard-beauty"` | 🔴 |
| 2 | `"version"` | `"1.0.2"` | `"1.0.0"` | 🔴 |

#### 文件 2：`src-tauri/Cargo.toml`

| # | 行 | 旧值 | 新值 | 优先级 |
|---|-----|------|------|--------|
| 3 | `[package].name` | `"storyboard-fashion"` | `"storyboard-beauty"` | 🔴 |
| 4 | `[package].version` | `"1.0.2"` | `"1.0.0"` | 🔴 |
| 5 | `[lib].name` | `"storyboard_fashion_lib"` | `"storyboard_beauty_lib"` | 🔴 |

#### 文件 3：`src-tauri/tauri.conf.json`

| # | 行 | 旧值 | 新值 | 优先级 |
|---|-----|------|------|--------|
| 6 | `productName` | `"小鸭服饰版"` | `"小鸭美妆版"` | 🔴 |
| 7 | `version` | `"1.0.2"` | `"1.0.0"` | 🔴 |
| 8 | `identifier` | `"com.storyboard.fashion"` | `"com.storyboard.beauty"` | 🔴 |
| 9 | `main.windows[0].title` | `"小鸭服饰版"` | `"小鸭美妆版"` | 🔴 |

#### 文件 4：`src-tauri/src/main.rs`

| # | 行 | 旧值 | 新值 | 优先级 |
|---|-----|------|------|--------|
| 10 | `storyboard_fashion_lib::run()` | → | `storyboard_beauty_lib::run()` | 🔴 |

#### 文件 5：`src-tauri/src/lib.rs`

| # | 行 | 旧值 | 新值 | 优先级 |
|---|-----|------|------|--------|
| 11 | log 目录名 | `storyboard-fashion` → | `storyboard-beauty` | 🔴 |
| 12 | log env var | `storyboard_fashion=trace` → | `storyboard_beauty=trace` | 🟡 |
| 13 | 启动日志 | `"Storyboard Fashion starting..."` → | `"Storyboard Beauty starting..."` | 🟡 |

#### 文件 6：`src-tauri/src/commands/update.rs`

| # | 行 | 旧值 | 新值 | 优先级 |
|---|-----|------|------|--------|
| 14 | `VERSION_CHECK_URL` | `version_fashion.json` | `version_beauty.json` | 🔴 |
| 15 | `GRID_PROMPT_RULES_URL` | `grid_prompt_rules_fashion.json` | `grid_prompt_rules_beauty.json` | 🔴 |
| 16 | `installer_name()` Windows | `Storyboard-Fashion` | `Storyboard-Beauty` | 🔴 |
| 17 | `installer_name()` macOS | `Storyboard-Fashion` | `Storyboard-Beauty` | 🔴 |

#### 文件 7：`src-tauri/src/commands/chat.rs`

| # | 行 | 旧值 | 新值 | 优先级 |
|---|-----|------|------|--------|
| 18 | `SKILL_VERSION_URL` | `version_fashion.txt` | `version_beauty.txt` | 🔴 |
| 19 | skill 目录 | `xiaoya-ai-cinema-fashion` | `xiaoya-ai-cinema-beauty` | 🔴 |
| 20 | skill zip URL | `xiaoya-ai-cinema-fashion.zip` | `xiaoya-ai-cinema-beauty.zip` | 🔴 |
| 21 | SECURITY_MARKER 前缀 | `...-fashion-protected-skill-v` | `...-beauty-protected-skill-v` | 🔴 |

#### 文件 8：`src-tauri/src/commands/banana_api.rs`

| # | 行 | 旧值 | 新值 | 优先级 |
|---|-----|------|------|--------|
| 22 | User-Agent (全部 ~15 处) | `Storyboard-Fashion/1.0` | `Storyboard-Beauty/1.0` | 🟡 |

---

### 2.2 前端 UI 层（5 文件 / 15 点）

#### 文件 9：`index.html`

| # | 行 | 旧值 | 新值 | 优先级 |
|---|-----|------|------|--------|
| 23 | `<title>` | `小鸭服饰版` | `小鸭美妆版` | 🔴 |

#### 文件 10：`src/i18n/locales/zh.json`

| # | 行 | 旧值 | 新值 | 优先级 |
|---|-----|------|------|--------|
| 24 | `app.title` | `"小鸭服饰版"` | `"小鸭美妆版"` | 🔴 |
| 25 | `aboutAppName` | `"小鸭服饰版"` | `"小鸭美妆版"` | 🔴 |
| 26 | 激活标题 | `"激活小鸭服饰版"` | `"激活小鸭美妆版"` | 🟡 |
| 27 | emptyState 文案 | `"小鸭小鸭服饰版会帮你..."` | `"小鸭美妆版会帮你..."` | 🟡 |

#### 文件 11：`src/features/project/presets.ts`

> **这是最大的改动之一** — 行业预设从服装切换为美妆。

| # | 改动 | 旧值 | 新值 | 优先级 |
|---|------|------|------|--------|
| 28 | STYLE_PRESETS | 服装风格 | 妆容风格列表（见 3.1） | 🔴 |
| 29 | FASHION_STYLE_PRESETS → BEAUTY_STYLE_PRESETS | 穿搭风格 | 妆效风格列表（见 3.1） | 🔴 |
| 30 | FASHION_VIDEO_TYPES → BEAUTY_VIDEO_TYPES | 服装类型 | 美妆视频类型（见 3.1） | 🔴 |
| 31 | EMPHASIS_DIMENSIONS | 服装维度 | 美妆维度（见 3.1） | 🔴 |
| 32 | 导出函数名更新 | `FASHION_*` | `BEAUTY_*` | 🔴 |

#### 文件 12：`src/features/videoGeneration/videoGenRules.ts`

| # | 行 | 旧值 | 新值 | 优先级 |
|---|-----|------|------|--------|
| 33 | `DEFAULT_PROMPT_RULE` | 服饰版铁律 | 美妆版铁律（见 3.2） | 🔴 |
| 34 | DEFAULT_RULES.negative_prompt | 服装变形相关 | 妆容/肤质相关（见 3.2） | 🟡 |
| 35 | DEFAULT_RULES.constraints.* | garment → makeup/beauty | 全部替换（见 3.2） | 🟡 |

#### 文件 13：`src/features/videoGeneration/refTypes.ts`

| # | 行 | 旧值 | 新值 | 优先级 |
|---|-----|------|------|--------|
| 36 | 行业关键词匹配 | 服装/衣服/穿着/clothing... | 美妆/化妆/口红/眼影/makeup... | 🟡 |

---

### 2.3 SKILL 文件层（3 文件）

#### 文件 14：`docs/skills/SKILL.md`

> **最大的单一文件改动** — 全文重写从"服装展示导演"到"美妆展示导演"。
> 详见第 3.3 节重写指南。

#### 文件 15：`docs/skills/version.txt`

```diff
- name: xiaoya-ai-cinema-fashion
+ name: xiaoya-ai-cinema-beauty
- version=1.0.2
+ version=1.0.0
- description: 小鸭AI服饰短视频提示词 — 服饰行业AI短视频制作专家
+ description: 小鸭AI美妆短视频提示词 — 美妆行业AI短视频制作专家
- v1.0.2 — xxx
+ v1.0.0 — 初始版本：美妆行业专属SKILL
```

#### 文件 16：`docs/skills/xiaoya-ai-cinema-beauty.zip`

重新打包（SKILL.md + version.txt），命令：
```bash
cd docs/skills
powershell -Command "Compress-Archive -Path 'SKILL.md','version.txt' -DestinationPath 'xiaoya-ai-cinema-beauty.zip' -Force"
```

---

### 2.4 服务器文件层（4 文件 / 新建）

| # | 文件 | 服务器路径 | 操作 |
|---|------|-----------|------|
| 37 | `version_beauty.json` | `/jy/uploads/app/version_beauty.json` | 新建（内容同 fashion 但版本号 1.0.0） |
| 38 | `version_beauty.txt` | `/jy/uploads/install_guide/files/version_beauty.txt` | 新建（同 skills/version.txt） |
| 39 | `xiaoya-ai-cinema-beauty.zip` | `/jy/uploads/install_guide/files/xiaoya-ai-cinema-beauty.zip` | 新建 |
| 40 | `grid_prompt_rules_beauty.json` | `/jy/uploads/app/grid_prompt_rules_beauty.json` | 新建（复制 fashion 修改行业词） |

---

### 2.5 CI/CD 层（1 文件）

#### 文件 17：`.github/workflows/build.yml`

| # | 行 | 旧值 | 新值 | 优先级 |
|---|-----|------|------|--------|
| 41 | DMG 重命名 | `RELEASE_APP_NAME="Storyboard-Fashion"` | `RELEASE_APP_NAME="Storyboard-Beauty"` | 🔴 |

---

### 2.6 下载页（1 文件）

#### 文件 18：`docs/install_guide/industry.html`（服务器上）

在服饰版区块下方新增美妆版区块：

```html
<!-- 美妆版 -->
<div class="download-card">
    <div class="label">即将发布 &middot; Beauty Edition</div>
    <h2>&#x1F484; 小鸭分镜大师 &middot; 美妆专业版</h2>
    <p class="desc">
        面向美妆展示的AI短视频创作工具——妆容教程、妆效对比、产品试色、护肤流程。
        智能分镜可视化，让每一帧都精准呈现妆容层次。
    </p>
    <div class="platforms">
        <div class="platform-box">
            <div class="os-label">Windows</div>
            <a href="http://47.108.237.10/jy/uploads/app/Storyboard-Beauty_1.0.0_x64-setup.exe" download class="btn-dl">
                下载 Windows 版 &middot; v1.0.0
            </a>
            <div class="hint">Windows 10/11 &middot; 64位</div>
        </div>
        <div class="platform-box">
            <div class="os-label">macOS</div>
            <a href="http://47.108.237.10/jy/uploads/app/Storyboard-Beauty_1.0.0_universal.dmg" download class="btn-dl">
                下载 macOS 版 &middot; v1.0.0
            </a>
            <div class="hint">通用二进制 &middot; Apple Silicon &amp; Intel<br>首次打开如遇安全提示，前往 系统设置 &rarr; 隐私与安全性 &rarr; 仍要打开</div>
        </div>
    </div>
</div>
```

---

## 三、内容重写指南

### 3.1 行业预设重写（`presets.ts`）

#### STYLE_PRESETS（视觉风格 → 妆容风格）

```typescript
export const STYLE_PRESETS = [
  '自然裸妆', '韩系水光', '欧美亚光', '日系清透', '烟熏摇滚',
  '甜美约会', '通勤OL', '红毯高光', '中式古典', '泰妆混血',
  '纯欲白开水', 'Y2K千禧', '轻欧美', '法式慵懒', '伪素颜',
];
```

#### BEAUTY_STYLE_PRESETS（妆容风格预设）

```typescript
export const BEAUTY_STYLE_PRESETS = [
  '韩系水光妆',
  '欧美雾面妆',
  '日系透明感妆',
  '中式复古妆',
  '纯欲初恋妆',
  '轻欧美混血妆',
  '烟熏小烟熏妆',
  '泰式浓颜妆',
  '法式裸感妆',
  'Y2K千禧妆',
];
```

#### BEAUTY_VIDEO_TYPES（美妆视频类型）

```typescript
export const BEAUTY_VIDEO_TYPES = [
  { value: 'tutorial', label: '妆容教程', desc: '完整上妆流程，步骤分解+局部特写过渡' },
  { value: 'comparison', label: '妆效对比', desc: '妆前/妆后 split-screen，半脸对比，多妆效切换' },
  { value: 'swatch', label: '产品试色', desc: '口红/眼影/腮红的手臂试色+上脸效果' },
  { value: 'skincare', label: '护肤流程', desc: '洁面→精华→面霜的日常Routine展示' },
  { value: 'detail', label: '细节微距', desc: '眼妆层次/唇妆质感/底妆服帖度的微距特写' },
  { value: 'makeover', label: '变装改造', desc: '素颜→全妆的逐层叠加变换过程' },
];
```

#### EMPHASIS_DIMENSIONS（美妆重点维度）

```typescript
export const EMPHASIS_DIMENSIONS = [
  { key: 'base_makeup', label: '底妆质感', desc: '水光/雾面/丝绒的底妆质地和服帖度呈现' },
  { key: 'eye_depth', label: '眼妆层次', desc: '眼影晕染过渡/眼线精度/睫毛卷翘的层次表现' },
  { key: 'lip_texture', label: '唇妆质感', desc: '哑光/镜面/丝绒/染唇的质地和水润度特写' },
  { key: 'color_rendering', label: '色彩还原', desc: '彩妆产品颜色在镜头中的准确还原度' },
  { key: 'skin_texture', label: '肤质呈现', desc: '自然肤质纹理保留，不磨皮过度，不假面' },
  { key: 'lighting', label: '光效配合', desc: '环形光/柔光/侧光对妆容立体感的表现' },
  { key: 'transition', label: '步骤过渡', desc: '上妆步骤之间的画面转场流畅度' },
  { key: 'product_showcase', label: '产品展示', desc: '彩妆产品包装/刷具/色号的清晰展示' },
] as const;
```

### 3.2 视频生成规则重写（`videoGenRules.ts`）

#### DEFAULT_PROMPT_RULE（兜底铁律）

```
【铁律·美妆版】图1=视频首帧，视频从图1开始妆容呈现旅程（整体→细节·素颜→全妆），经过图2-图5自然过渡，在图6结束。按左→右、上→下顺序逐格处理全部6张宫格图。每张宫格=一个关键帧。画面内容100%来自宫格参考图，文字仅提供运镜+动作+化妆刷声。禁止修改参考图中的妆容颜色/眼影晕染/唇形/眉形。妆容外观由参考图锁定。运镜优先正面推近/眼部微距/唇部特写/半脸对比/慢速环绕。真实妆容摄影美学：禁止CG感/塑料感/3D渲染。自然肤质纹理（毛孔/细纹/绒毛保留）、化妆品真实质地（粉状/膏状/液体的真实光泽）、真实不完全完美。
```

#### negative_prompt

```
makeup smearing, color bleeding, foundation patchiness, eyeshadow fallout, lipstick feathering, eyeliner smudge, mascara clumping, skin texture erasure (over-smoothing), plastic skin, mannequin look, CG face, 3D render, unnatural skin tone, makeup morphing, product distortion, chromatic aberration, flicker, empty frame, static image, abrupt transition
```

#### constraints

| 字段 | 旧值关键词 | 新值关键词 |
|------|----------|----------|
| global_rule | garment, fabric | makeup, skin, cosmetic |
| object_persistence | Garment elements | Makeup elements, skin tone |
| landmark_lock | Garment appearance | Makeup appearance, facial features |
| spatial_progression | Fashion presentation journey | Makeup application journey (bare face→full face) |
| motion_catalog | catwalk, fabric flutter | makeup brush stroke, product swatch, slow-mo blending |
| shot_continuity | garment presentation | makeup step progression |
| hard_constraints | Fashion studio lighting | Beauty ring-light / natural window-light / studio softbox |

### 3.3 SKILL.md 重写指南

#### Frontmatter 变更

```diff
- name: xiaoya-ai-cinema-fashion
+ name: xiaoya-ai-cinema-beauty
- description: ...服饰短视频提示词...服装展示视频、T台走秀、穿搭展示、面料特写...
+ description: ...美妆短视频提示词...妆容教程、妆效对比、产品试色、护肤流程...
- SECURITY_MARKER: xiaoya-ai-cinema-fashion-protected-skill-v1.0.2
+ SECURITY_MARKER: xiaoya-ai-cinema-beauty-protected-skill-v1.0.0
```

#### 角色定义重写

```
旧：你是"服装展示导演"。你精通女装/男装/童装/运动装的T台秀、LOOKBOOK拍摄和电商白底图展示。
新：你是"美妆展示导演"。你精通底妆/眼妆/唇妆/修容/护肤的妆容教程、妆效对比拍摄和产品试色展示。
```

#### 核心命题重写

```
旧：服装=唯一主角，人物=服装的载体
新：妆容=唯一主角，人物=妆容的载体

旧：版型推理/面料翻译/模特调度/穿搭构建
新：妆面分析/肤质翻译/模特调度/产品展示
```

#### 六宫格叙事结构重写

| 宫格 | 妆容教程 | 妆效对比 | 产品试色 | 护肤流程 |
|------|---------|---------|---------|---------|
| 1 Hook | 素颜正面定妆 | 左半脸素颜 vs 右半脸全妆 | 产品+手臂试色 | 洁面前素颜 |
| 2 Context | 底妆上妆过程 | 妆前全脸 | 上唇试色微距 | 洁面泡沫微距 |
| 3 Demo | 眼妆晕染特写 | 完妆全脸 | 上脸效果 | 精华涂抹 |
| 4 Proof | 眼妆完成效果 | 半脸 split-screen | 不同光线下显色 | 面霜乳化 |
| 5 Outcome | 唇妆定点 | 多角度完妆 | 持久度测试 | 完肤前后对比 |
| 6 CTA | Logo+产品信息 | Logo+妆效名称 | Logo+色号说明 | Logo+产品名 |

---

## 四、不可变部分

以下**绝不要改动**（所有行业版本共享）：

| 共享层 | 文件/目录 |
|--------|----------|
| 视频/图片超分 | `src-tauri/src/commands/enhance.rs` |
| 升级检测逻辑 | `src-tauri/src/commands/update.rs`（仅改常量） |
| API 通信层 | `src-tauri/src/commands/banana_api.rs`（仅改 User-Agent） |
| 画布/对话/宫格 UI | `src/features/canvas/`, `src/features/chat/`, `src/features/videoGeneration/` 除 presets.ts 外 |
| 平台资源捆绑 | `tauri.windows.conf.json`, `tauri.macos.conf.json` |
| CI 构建框架 | `.github/workflows/build.yml`（仅改 APP_NAME） |
| 热更新机制 | `chat.rs` 中的 sync 逻辑（仅改 URL/路径常量） |
| 国际化框架 | `src/i18n/`（仅改 zh.json 中的品牌文案） |

---

## 五、执行步骤

### 阶段 0：准备工作

```bash
# 1. 从服饰版 fork/复制仓库
git clone <storyboard-fashion-repo> storyboard-beauty
cd storyboard-beauty

# 2. 创建新分支
git checkout -b feat/beauty-v1.0.0
```

### 阶段 1：品牌标识替换（机械操作，~30min）

按 2.1 节逐文件修改，每完成一个 commit 一次：

```bash
# 批量替换（注意：先确认范围正确再执行）
# fashion → beauty | Fashion → Beauty | 服饰 → 美妆

# 1. 全局替换（手动逐一确认，避免误伤）
#    - package.json, Cargo.toml, tauri.conf.json
#    - main.rs, lib.rs, update.rs, chat.rs, banana_api.rs
#    - index.html, zh.json

# 2. 版本号重置
node scripts/sync-version.mjs "1.0.0"

# 3. 验证编译
npx tsc --noEmit
cd src-tauri && cargo check
```

### 阶段 2：行业内容适配（人工操作，~2h）

```bash
# 4. 重写 presets.ts（见 3.1）
# 5. 重写 videoGenRules.ts 兜底规则（见 3.2）
# 6. 重写 refTypes.ts 关键词匹配
# 7. 重写 SKILL.md（见 3.3）
# 8. 更新 version.txt → xiaoya-ai-cinema-beauty
# 9. 打包 skill zip
```

### 阶段 3：构建 + 上传（~30min）

```bash
# 10. 本地构建 Windows 版
npm run tauri build

# 11. 推送 tag 触发 macOS CI
git add . && git commit -m "feat: 美妆专业版 v1.0.0"
git push origin feat/beauty-v1.0.0
git tag v0.1.0-beta  # 先打 beta 验证 macOS CI
git push origin v0.1.0-beta

# 12. 上传安装包到服务器
scp "小鸭美妆版_1.0.0_x64-setup.exe" root@47.108.237.10:/jy/uploads/app/
scp Storyboard-Beauty_1.0.0_universal.dmg root@47.108.237.10:/jy/uploads/app/

# 13. 创建 version_beauty.json
# 14. 上传 skill zip + version_beauty.txt
# 15. 更新下载页 industry.html
```

### 阶段 4：端到端验证

- [ ] Windows 下载安装 → 启动 → SKILL 同步 → 宫格生成 → 视频生成
- [ ] macOS 下载安装 → 同 Windows 验证链路
- [ ] 升级检测：低版本启动弹窗 → 下载 → 安装 → 版本号更新
- [ ] 下载页：两个平台链接均可下载

---

## 六、服务器目录结构（完成后）

```
/jy/uploads/
├── app/
│   ├── Storyboard-Fashion_1.0.2_x64-setup.exe
│   ├── Storyboard-Fashion_1.0.2_universal.dmg
│   ├── Storyboard-Beauty_1.0.0_x64-setup.exe     ← 新增
│   ├── Storyboard-Beauty_1.0.0_universal.dmg      ← 新增
│   ├── version_fashion.json
│   ├── version_beauty.json                        ← 新增
│   ├── grid_prompt_rules_fashion.json
│   └── grid_prompt_rules_beauty.json              ← 新增
├── install_guide/
│   ├── industry.html                               (已更新)
│   └── files/
│       ├── xiaoya-ai-cinema-fashion.zip
│       ├── version_fashion.txt
│       ├── xiaoya-ai-cinema-beauty.zip            ← 新增
│       └── version_beauty.txt                     ← 新增
```

---

## 七、复刻 check-list（施工用）

按顺序逐项勾销。每完成一项 git commit。

```
□  1. package.json — name + version
□  2. Cargo.toml — name + version + lib name
□  3. tauri.conf.json — productName + identifier + title + version
□  4. main.rs — lib crate 引用
□  5. lib.rs — log 目录/env/启动日志
□  6. update.rs — URL 常量 + installer_name
□  7. chat.rs — SKILL URL + 目录 + zip URL + marker
□  8. banana_api.rs — User-Agent (~15处)
□  9. index.html — <title>
□ 10. zh.json — 品牌文案 (4处)
□ 11. presets.ts — STYLE_PRESETS + VIDEO_TYPES + DIMENSIONS
□ 12. videoGenRules.ts — prompt_rule + negative_prompt + constraints
□ 13. refTypes.ts — 关键词匹配
□ 14. SKILL.md — 全文重写
□ 15. version.txt — 新 skill 版本
□ 16. skill zip — 打包
□ 17. build.yml — RELEASE_APP_NAME
□ 18. 服务器 — version_beauty.json
□ 19. 服务器 — version_beauty.txt + skill zip
□ 20. 服务器 — grid_prompt_rules_beauty.json
□ 21. 下载页 — 新增美妆区块
□ 22. Windows 本地构建验证
□ 23. macOS CI 构建验证
□ 24. 端到端安装验证
```
