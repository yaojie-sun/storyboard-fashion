# 行业专业版复刻指南（fuke.md）

> **用途**：把一个已完成的行业版本（基准版）完整复刻成一个全新的行业版本。
> **最近一次实战**：以萌宠版（`com.storyboard.pet` v1.0.0）为基准，复刻出科普版（`com.storyboard.science` v1.0.0），端到端验证通过。
> 本文把这次实战固化为 SOP，以后复刻新行业版本直接照做。

---

## 0. 一句话总纲

**整库复制 → 品牌替换（约 23 处）→ 行业内容重写（presets/refTypes/运镜/规则JSON/SKILL）→ 改名上传服务器 → 建仓 CI → 下载页 → 逐项验证。**

**铁律（贯穿全程，先记住）**：
1. **视频生成走百度 VOD**（`vod.bj.baidubce.com/v3/aigc/bailian`，模型 `happyhorse-1.1-r2v`，复用 `BAIDU_VIDEO_KEY`）。**禁止阿里云直连、禁止 wan2.7**（wan2.7 相关代码全删，`git ls-files | grep -i wan` 必须为空）。
2. **发布日志 / `notes` 字段不能出现任何模型名称**（MiniMax / H3 / 海螺 / 欢乐马 / happyhorse / wan 等一律不写）。
3. **各专业版的专属词绝对不能动**——你复刻的是「新版本的行业词」，复刻过程中只能替换品牌标识和行业内容，不能误改其他版本的专属词（尤其下载页 `industry.html` 里其他版本的卡片文案）。

---

## 一、开工前必确认的 5 个决策

复刻前先和用户对齐这 5 项，避免返工：

| # | 决策 | 说明 | 科普版实例 |
|---|------|------|-----------|
| 1 | **基准版本** | 用**最新、功能最全**的行业版做模板（当前是萌宠版 v1.0.0，含欢乐马 1.1 + 平滑运镜 + 自动超分 2K），不是旧服饰版 | 萌宠版 `com.storyboard.pet` |
| 2 | **视频类型数量** | 每个行业的主题数，决定 `SCIENCE_VIDEO_TYPES` / `VIDEO_TYPES` 数组长度 | 7 种（宏观/微观/生物制品/科幻/实验/活动/故事） |
| 3 | **合规保护层级** | 二选一：**轻量提示**（规则/SKILL 里加一句合规句）或 **三层合规**（大健康版那种独立合规体系） | 轻量提示 |
| 4 | **dev 端口** | 必须避开已占用端口；当前占用：`9997`(服饰/美妆/健康) `9998`(旅游) `9999`(萌宠/短视频)。**要改两处**（见坑 #1） | 9996 |
| 5 | **版本号 + 下载页配色** | 版本号独立新线从 `1.0.0` 起；下载页卡片配色 + `accent-rgb` 三值 | 1.0.0 / `#5bc0eb` / `91,192,235` |

---

## 二、品牌标识映射总表（核心，一次性替换约 23 处）

这是复刻的**地基**，最容易漏。下表以「萌宠 → 科普」为实例，第三列是通用模板（`{src}`→`{dst}` 占位）。

| # | 文件 | 改动点 | 萌宠(源) → 科普(目标) | 通用模板 |
|---|------|--------|----------------------|---------|
| 1 | `package.json` | `name` | `storyboard-pet` → `storyboard-science` | `storyboard-{src}` → `storyboard-{dst}` |
| 2 | `src-tauri/Cargo.toml` | `[package].name` | `storyboard-pet` → `storyboard-science` | 同上 |
| 3 | `src-tauri/Cargo.toml` | `[lib].name` | `storyboard_pet_lib` → `storyboard_science_lib` | `storyboard_{src}_lib` → `storyboard_{dst}_lib` |
| 4 | `src-tauri/Cargo.toml` | `description` | 萌宠行业… → 科普行业… | `{src}行业…` → `{dst}行业…` |
| 5 | `src-tauri/tauri.conf.json` | `productName` | `小鸭萌宠版` → `小鸭科普版` | `小鸭{src}版` → `小鸭{dst}版` |
| 6 | `src-tauri/tauri.conf.json` | `identifier` | `com.storyboard.pet` → `com.storyboard.science` | `com.storyboard.{src}` → `com.storyboard.{dst}` |
| 7 | `src-tauri/tauri.conf.json` | window `title` | `小鸭萌宠版` → `小鸭科普版` | 同 #5 |
| 8 | `src-tauri/tauri.conf.json` | `devUrl` 端口 | `9999` → `9996` | 分配独立端口 |
| 9 | `vite.config.ts` | `server.port` + `hmr.port` | `9999` → `9996` | **必须与 #8 一致**（坑 #1） |
| 10 | `src-tauri/src/commands/update.rs` | `RELEASE_APP_NAME` / 安装包名 | `Storyboard-Pet` → `Storyboard-Science` | `Storyboard-{Dst}` |
| 11 | `src-tauri/src/commands/banana_api.rs` | `User-Agent`（**多处**，全文件） | `Storyboard-Pet/1.0` → `Storyboard-Science/1.0` | `Storyboard-{Dst}/1.0` |
| 12 | `src-tauri/src/commands/banana_api.rs` | skill 目录/zip/缓存路径 | `xiaoya-ai-cinema-pet` → `xiaoya-ai-cinema-science` | `xiaoya-ai-cinema-{dst}` |
| 13 | `src-tauri/src/commands/banana_api.rs` | 版本检测 URL | `version_pet.txt` → `version_science.txt` | `version_{dst}.txt` |
| 14 | `src-tauri/src/commands/chat.rs` | `SKILL_VERSION_URL` | `version_pet.txt` → `version_science.txt` | `version_{dst}.txt` |
| 15 | `src-tauri/src/commands/chat.rs` | `get_skill_dir` 路径 | `xiaoya-ai-cinema-pet` → `xiaoya-ai-cinema-science` | `xiaoya-ai-cinema-{dst}` |
| 16 | `src-tauri/src/commands/update.rs` | 版本检查 URL | `version_pet.json` → `version_science.json` | `version_{dst}.json` |
| 17 | `src-tauri/src/commands/update.rs` | 宫格规则 URL | `grid_prompt_rules_pet.json` → `grid_prompt_rules_science.json` | `grid_prompt_rules_{dst}.json` |
| 18 | `src-tauri/src/commands/update.rs` | `resolve_video_gen_rules_url` 路由 | `video_gen_rules_pet.json` → `video_gen_rules_science.json` | `video_gen_rules_{dst}.json` |
| 19 | `src-tauri/src/lib.rs` | 日志目录 | `storyboard-pet` → `storyboard-science` | `storyboard-{dst}` |
| 20 | `index.html` | `<title>` | `小鸭萌宠版` → `小鸭科普版` | `小鸭{dst}版` |
| 21 | `src/i18n/locales/zh.json` | 版本相关 key（title/subtitle/aboutAppName/…） | `小鸭萌宠版` → `小鸭科普版`、`宠物及道具` → `科学主体及道具` | 逐 key 检查 |
| 22 | `src/i18n/locales/en.json` | `Storyboard Pet` → `Storyboard Science` 等 | `Storyboard Pet` → `Storyboard Science` | `Storyboard {Dst}` |
| 23 | `.github/workflows/build.yml` | workflow `name` + `RELEASE_APP_NAME` | `Storyboard-Pet` → `Storyboard-Science` | `Storyboard-{Dst}` |

> **替换方法**：用 sed 批量替换 `pet → science`、`Pet → Science`、`萌宠 → 科普`，但**必须先排除下载页 `industry.html` 里其他版本的下载链接**（见坑 #2），替换后全库 `grep -ri` 核对残留。

---

## 三、行业内容重写清单（每个版本的核心创作层）

品牌标识之外，这些是「行业属性」内容，必须整段重写，不能只替换关键词：

### 3.1 `src/features/project/presets.ts`

- **导出名**：`PET_*` → `SCIENCE_*`（`SCIENCE_STYLE_PRESETS` / `SCIENCE_VIDEO_TYPES` 等）
- 数组内容整段重写：
  - `STYLE_PRESETS`（15 视觉风格）
  - `TONE_PRESETS`（15 调性）
  - `{INDUSTRY}_STYLE_PRESETS`（场景风格，科普版 11 个）
  - `{INDUSTRY}_VIDEO_TYPES`（视频类型，`value/label/desc` 三字段）
  - `EMPHASIS_DIMENSIONS`（重点维度，`key/label/desc`）
- **导出名改动必须同步引用文件**：`PresetPicker.tsx`、`EditParamsDialog.tsx`、`ProjectDashboard.tsx`、`ProjectManager.tsx`、`ProjectSetupDialog.tsx`、`ReanalyzeDialog.tsx`。改完全库 `grep -r "PET_"` 应为 0。

### 3.2 `src/features/videoGeneration/refTypes.ts`

- `RefImageType` 成员 `'pet'` → `'{industry}'`；`REF_TYPE_LABELS` 标签同步（`宠物参考` → `{行业}参考`）
- `detectRefType` 关键词正则整段换（宠物词 → 行业词，中英文都要）
- 同步 `VideoGenDialog.tsx` 里 `meta.type === 'pet'` 分支 → `'{industry}'`，徽章色改成行业配色

### 3.3 `src-tauri/src/ai/deepseek.rs` — `VIDEO_CLEAN_HAPPYHORSE_PROMPT`

- 只替换**运镜词库** + 措辞，三层结构（铁律/反 AI 化/术语映射）不变
- 【运镜仅限】清单换成行业运镜（科普版：`macro focus pull | microscope depth drift | star-field push-in | …`）
- 行业术语映射 + forbidden 词表同步

### 3.4 `src/features/videoGeneration/videoGenRules.ts`（前端兜底）

- `DEFAULT_PROMPT_RULE` + `DEFAULT_RULES` 与新版 `video_gen_rules_{dst}.json` **完全一致**
- `prompt_rule` 开头 `【铁律·{行业}版】…`；`negative_prompt`、`constraints`（`motion_catalog` / `hard_constraints`）同步；合规句（§3.7）出现于此

### 3.5 `public/grid_prompt_rules_{dst}.json`（宫格规则）

- `frame_fields` 第 5 字段 `pet` → `{industry}`（`frame_field_labels.{industry}="{行业}主体"`）
- `frame_quality_suffix` / `reference_image_priority` 的行业锁定句
- `hard_constraints` 加合规句（§3.7）
- 六宫格叙事表 `global_header` / `continuity_and_axis` 的「呈现旅程」措辞

### 3.6 `docs/skills/SKILL.md` + `version.txt`（全文行业重写）

- frontmatter `name/description/welcome_message` → 行业版；`SECURITY_MARKER` → `xiaoya-ai-cinema-{dst}-protected-skill-v1.0.0`
- 角色设定：`{行业}内容导演`；核心命题 `{行业}主体=唯一主角`；四能力重写
- 六宫格叙事表（7 列，每列 Hook/Context/Demo/Proof/Outcome/CTA 六格）
- 10 种专属运镜（中文版）+ 风格模板表 + 平台参数 + 热更新启动步

### 3.7 合规句（轻量，非独立层）

在 `grid_prompt_rules_{dst}.json` 的 `hard_constraints` + `video_gen_rules_{dst}.json` 的 `prompt_rule`/`hard_constraints` + `SKILL.md` 强制规则里，各加一句行业合规提示。

（大健康版走**三层合规**，属例外，不在此 SOP 的「轻量」范围内。）

---

## 四、复刻 9 步流程

```bash
# 1. 整库复制（排除 node_modules / target / .git / dist）
#    保留 src-tauri/resources/ffmpeg/（本地二进制，gitignore）与 resources/realesrgan/（LFS 跟踪）

# 2. 品牌替换（§二 映射表 23 处，sed 批量 + 手工核对，先处理下载页误伤）

# 3. 行业内容重写（§三：presets/refTypes/运镜/规则JSON/SKILL）

# 4. 规则文件改名（grid_prompt_rules_{dst}.json / video_gen_rules_{dst}.json / version_{dst}.json）

# 5. CI / 图标 / 下载页（§六）

# 6. 本地验证（§八：cargo check + tsc + 品牌/wan 残留检查）

# 7. GitHub 建仓 + 触发构建（§六）

# 8. 服务器上传 + 下载页（§五/§六）

# 9. 端到端验证（§八）
```

---

## 五、服务器文件清单 + 上传命令

需要新建并上传 5 类文件：

| 本地文件 | 服务器路径 | 用途 |
|---------|-----------|------|
| `public/version_{dst}.json` | `/jy/uploads/app/` | 版本检测（`version` 字段、`notes` 无模型名） |
| `public/grid_prompt_rules_{dst}.json` | `/jy/uploads/app/` | 宫格规则热更新 |
| `public/video_gen_rules_{dst}.json` | `/jy/uploads/app/` | 视频规则热更新 |
| `docs/skills/version.txt` | `/jy/uploads/app/version_{dst}.txt` | 技能版本检测 |
| `docs/skills/xiaoya-ai-cinema-{dst}.zip` | `/jy/uploads/install_guide/files/` | 技能 zip（SKILL.md + version.txt **flat 打包**，根目录无嵌套） |
| NSIS 产物 `小鸭{dst}版_{v}_x64-setup.exe` | `/jy/uploads/app/` | Windows 安装包 |
| 英文副本 `Storyboard-{Dst}_{v}_x64-setup.exe` | `/jy/uploads/app/` | Windows 下载用英文名（`cp` 出来） |
| `Storyboard-{Dst}_{v}_universal.dmg` | `/jy/uploads/app/` | macOS（CI 产出） |

上传命令（密钥 `C:\Users\Administrator\jiaoyan.pem`，即 `$HOME/jiaoyan.pem`）：

```bash
scp -i "$HOME/jiaoyan.pem" version_science.json root@47.108.237.10:/jy/uploads/app/
scp -i "$HOME/jiaoyan.pem" grid_prompt_rules_science.json root@47.108.237.10:/jy/uploads/app/
scp -i "$HOME/jiaoyan.pem" video_gen_rules_science.json root@47.108.237.10:/jy/uploads/app/
scp -i "$HOME/jiaoyan.pem" version.txt root@47.108.237.10:/jy/uploads/app/version_science.txt
scp -i "$HOME/jiaoyan.pem" xiaoya-ai-cinema-science.zip root@47.108.237.10:/jy/uploads/install_guide/files/
# 安装包英文副本
ssh root@47.108.237.10 "cp '/jy/uploads/app/小鸭科普版_1.0.0_x64-setup.exe' /jy/uploads/app/Storyboard-Science_1.0.0_x64-setup.exe"
```

验证上传后 HTTP 200：

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://aixiaoxi.top/jy/uploads/app/version_science.json
```

### `update.rs` 路由映射（复刻时必改）

```rust
const VERSION_CHECK_URL      = ".../version_science.json";
const GRID_PROMPT_RULES_URL  = ".../grid_prompt_rules_science.json";

fn resolve_video_gen_rules_url(model) {
    match model.as_str() {
        "happyhorse_r2v" | "happyhorse/happyhorse-1.1-r2v" => "video_gen_rules_science.json",
        "{dst}_r2v" | "{dst}-1.0-r2v"                        => "video_gen_rules_science.json",
        "pixverse_c1" | "pixverse/c1"                        => "video_gen_rules_pixverse_c1.json",
        _ => "video_gen_rules_science.json",
    }
}
```

---

## 六、GitHub / CI / 下载页

- **建仓**：`gh repo create storyboard-science --public`（`yaojie-sun/` 名下），remote `https://github.com/yaojie-sun/storyboard-science.git`
- **`.github/workflows/build.yml`**：`name: Build Storyboard-Science`、`RELEASE_APP_NAME="Storyboard-Science"`；SCP 流不变（`SERVER_SSH_KEY` secret 用有效密钥）
- **图标**：沿用共享品牌 logo（md5 `df035230…`），不换
- **下载页 `industry.html`**：新增「{行业}专业版 v1.0.0」卡片，配色 + accent-rgb 按决策 #5，6 个功能格 + 下载按钮

---

## 七、必坑指南（逐条都是实战踩过的）

1. **dev 端口漏改 `vite.config.ts`**（本次科普版实际踩坑）：
   `tauri.conf.json` 的 `devUrl` 改了 `9996`，但 `vite.config.ts` 的 `server.port` 和 `hmr.port` 还是 `9999` → **dev 模式白屏/连不上**。两处必须同时改且一致。

2. **sed 全局品牌替换误伤下载页**：
   `industry.html` 里**其他版本卡片的下载链接**（如萌宠卡的 `Storyboard-Pet_1.0.0_x64-setup.exe`）会被全局 `Pet→Science` 替换误伤，导致旧版本链接指向新版本。**先备份/排除下载页，替换后逐个核对下载链接**，再手动新增本版本卡片。

3. **Cargo.lock 版本不同步**：
   `scripts/sync-version.mjs` 只改 `Cargo.toml` 不改 `Cargo.lock`，构建后需单独 `git add Cargo.lock` 提交同步（`cargo check` 会更新它）。

4. **git push 网络 flaky**：
   github 间歇 `Recv failure: Connection was reset` / `Failed to connect github.com port 443`。多重重试即可；若卡 LFS 上传，先 `git config lfs.https://github.com/yaojie-sun/<repo>.git/info/lfs.locksverify false` 禁用 LFS 锁校验。

5. **tag 未建就 push**：
   `git push origin v1.0.0` 报 `src refspec v1.0.0 does not match any` → 先 `git tag v1.0.0` 再 push。

6. **`get_user_api_key` 返回 404 是正常的**（不是 bug）：
   所有版本都打 `/jy/api/v1/auth/api-key` 都会 404，代码里已有 `ensure_user_api_token` 兜底。排查「分析失败」时别被这个 404 误导。

7. **「分析失败」的真凶是 deepseek 服务器抖动**（本次排查结论）：
   日志 `[Analyze] ... len=0` = 网关对 `deepseek-v4-flash` 间歇返回空文本，HTTP 200 但 `content[0].text==""`。这是**服务器侧问题，自愈**，不是复刻代码问题。排查入口：`%TEMP%\storyboard-{dst}\logs\storyboard.log.YYYY-MM-DD` 搜 `[Analyze]`。别去改 `ANALYSIS_MODEL`。

8. **sed 会漏改 Rust 里的驼峰/下划线/连字符变体**：
   同一个品牌有 `Storyboard-Pet` / `storyboard-pet` / `storyboard_pet_lib` / `xiaoya-ai-cinema-pet` / `com.storyboard.pet` 多种写法，sed 要分别覆盖，替换后 `grep -ri` 逐变体核对。

9. **`docs/shengji_fashion.md`（升级模板）可保留但需更新映射行**：它是「升级流程」SOP（构建/上传/热更新），不是「复刻」SOP。本 `fuke.md` 才是复刻专用。两者分工：`shengji_*.md`=单个版本的升级发布；`fuke.md`=新行业版的复刻。

---

## 八、验证清单（逐项勾销）

1. **编译**：`cd src-tauri && cargo check` 通过；前端 `npx tsc --noEmit` 通过。
2. **品牌一致性**：全库 `grep -ri` 无残留 `pet`/`Pet`/`萌宠`/`xiaoya-ai-cinema-pet`/`com.storyboard.pet`/`storyboard-pet`（`Cargo.lock` 除外）。
3. **行业内容**：`grep PET_` = 0；`grep 萌宠` 在 presets/refTypes/SKILL/规则 JSON 中 = 0。
4. **wan 干净**：`git ls-files | grep -i wan` 为空；`grep -ri "wan2.7\|wan_r2v" src-tauri/src` 为空。
5. **端到端**：6 宫格故事板（行业图）→ 生成视频 → 走 `happyhorse/` 路由 → 百度 VOD 透传 → 轮询拿 URL；积分扣费与基准版一致。
6. **规则热更新**：`fetchVideoGenRules('happyhorse/happyhorse-1.1-r2v')` 拉到 `video_gen_rules_{dst}.json`。
7. **发布链路**：本地 Windows 构建 → NSIS 产物 `小鸭{dst}版_{v}_x64-setup.exe` → scp + cp 英文副本 `Storyboard-{Dst}_{v}_x64-setup.exe`；macOS CI 构建 → DMG 改名 → SCP 上传；下载页可下载。
8. **dev 模式**：`npm run tauri dev` 能正常起（端口一致，见坑 #1）。

---

## 九、不可变共享层（复刻时**不要动**）

| 共享层 | 说明 |
|--------|------|
| `src-tauri/src/commands/enhance.rs` | 图片/视频超分，全行业通用 |
| `src-tauri/src/commands/update.rs` | 升级检测逻辑（`installer_name()` 自动适配 `RELEASE_APP_NAME`） |
| `src-tauri/src/commands/banana_api.rs` | API 通信核心（仅改 User-Agent / skill 路径 / 版本 URL） |
| `src/features/` 核心 UI 组件 | 对话/项目/宫格/视频生成框架 |
| `tauri.windows.conf.json` / `tauri.macos.conf.json` | 平台资源捆绑（ffmpeg + realesrgan），不按行业变化 |
| CI 构建流程 | `.github/workflows/build.yml` 框架（仅改 `name` / `RELEASE_APP_NAME`） |
| 热更新机制 | 技能同步逻辑（仅改 URL 指向） |
| `video_gen_rules_pixverse_c1.json` | PixVerse 备用路由，各版共用，不按行业改 |

---

## 十、快速参考：一次完整复刻的命令序列

```bash
# 0. 前置决策（§一 5 项）确认后开工

# 1. 复制
cp -r /d/Story-Pet /d/Story-Science    # 排除 node_modules/target/.git/dist

# 2. 品牌替换（sed 批量，注意下载页误伤）
cd /d/Story-Science
#    pet→science / Pet→Science / 萌宠→科普 / 9999→9996 ...
#    逐个核对 §二 23 处

# 3. 行业内容重写（§三）

# 4. 规则文件改名
mv public/grid_prompt_rules_pet.json public/grid_prompt_rules_science.json   # 实际在源文件上改内容+改名

# 5. 验证
npx tsc --noEmit && cd src-tauri && cargo check

# 6. 建仓 + 推送
gh repo create storyboard-science --public
git remote add origin https://github.com/yaojie-sun/storyboard-science.git
git add -A && git commit -m "feat: 科普专业版复刻"
git push -u origin main
git tag v1.0.0 && git push origin v1.0.0

# 7. 服务器上传（§五）+ 下载页更新（§六）

# 8. 端到端验证（§八）
```
