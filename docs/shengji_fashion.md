# 分镜大师服饰版 — 升级流程

> **本文档是标准模板。** 服饰专业版为基准版本，后续所有行业版本（美妆专业版、萌宠专业版等）的升级流程均以此文档为蓝本，按第 九 节指引复刻。

本文档涵盖服饰版的两种升级链路 + 跨平台构建：

- **程序本体升级**：构建 → 上传 → 版本检测 → 下载 → 安装
- **技能热更新**：SKILL.md 迭代 → 打包上传 → 客户端自动检测更新
- **跨平台构建**：Windows (本地 NSIS) + macOS (GitHub Actions CI)

---

## 一、架构总览

```
开发机                       服务器 / CI                     用户机器
───────                     ────────────                    ────────
1. npm run release          2. GitHub Actions              3. 小鸭服饰版启动
   打 tag 推远端               tag 触发 CI 自动构建:           check_for_upgrade()
                              ├─ macOS: universal .dmg      ↓
4. npm run tauri build       │   从 evermeet.cx 拉取        发现新版本
   本地构建 Windows NSIS      │   ffmpeg 静态构建             弹 UpdateAvailableDialog
                              │   打包进 .app bundle          ↓
                              └─ 产物上传为 artifact         用户点击"直接下载安装"
                                                           download_upgrade()
                            5. 上传 .exe/.dmg 到服务器        ↓
                               /jy/uploads/app/             emit download-progress
                                                           进度条实时显示
                            6. 更新 version_fashion.json     ↓
                                                           launch_installer()
                                                           启动安装程序
                                                           ↓
                                                           新版本覆盖安装完成
```

### 关键文件清单

| 层 | 文件 | 作用 |
|----|------|------|
| 版本检测 JSON | `https://aixiaoxi.top/jy/uploads/app/version_fashion.json` | 服务器上存放最新版本信息 |
| Rust 命令 | `src-tauri/src/commands/update.rs` | 版本比较、下载、启动安装程序 |
| Rust 注册 | `src-tauri/src/lib.rs` | 注册 Tauri 命令 |
| 前端命令 | `src/commands/update.ts` | `checkForUpgrade()` 封装 |
| 前端 UI | `src/components/UpdateAvailableDialog.tsx` | 升级弹窗 + 进度条 |
| 前端入口 | `src/App.tsx` | 启动时调用 `checkForUpgrade` |
| 构建配置 | `src-tauri/tauri.conf.json` | 主构建配置（平台无关） |
| Windows 构建覆盖 | `src-tauri/tauri.windows.conf.json` | Windows 专属资源捆绑 (ffmpeg + realesrgan) |
| macOS 构建覆盖 | `src-tauri/tauri.macos.conf.json` | macOS 专属资源捆绑 (ffmpeg) |
| 版本同步 | `scripts/sync-version.mjs` | 同步 package.json / Cargo.toml / tauri.conf.json |
| CI/CD | `.github/workflows/build.yml` | tag 推送 → GitHub Actions 自动构建 macOS DMG |
| macOS ffmpeg | 从 evermeet.cx 动态拉取 | CI 构建时下载静态 ffmpeg/ffprobe (Intel, Rosetta 2 兼容) |

---

## 二、服务器端：版本信息 JSON

### 2.1 文件位置

```
https://aixiaoxi.top/jy/uploads/app/version_fashion.json
```

### 2.2 JSON 格式

```json
{
  "version": "1.0.0",
  "releaseDate": "2026-08-07",
  "downloadUrl": "https://aixiaoxi.top/jy/uploads/app",
  "notes": "## 新增\n- xxx功能\n## 修复\n- yyy问题"
}
```

### 2.3 字段说明

| 字段 | 必需 | 说明 |
|------|------|------|
| `version` | 是 | 最新版本号，不带 `v` 前缀。客户端用语义版本比较（major.minor.patch） |
| `releaseDate` | 是 | 发布日期，展示用 |
| `downloadUrl` | 是 | 安装包所在目录的 **基础 URL**（不含文件名）。文件名由客户端按规则拼接 |
| `notes` | 否 | 更新日志，Markdown 格式。**不能出现模型名称** |

### 2.4 安装包命名规则

客户端根据操作系统自动拼接文件名：

- **Windows**: `Storyboard-Fashion_{version}_x64-setup.exe`
- **macOS**: `Storyboard-Fashion_{version}_universal.dmg`

代码位置：`src-tauri/src/commands/update.rs` → `installer_name()`

### 2.5 上传新版本的步骤

1. 构建安装包（见第三节）
2. 将安装包上传到 `https://aixiaoxi.top/jy/uploads/app/` 目录
3. 确保安装包同时有带版本号的文件名副本（如 `Storyboard-Fashion_1.0.0_x64-setup.exe`）
4. 编辑 `version_fashion.json`，更新 `version`、`releaseDate`、`notes` 字段
5. 上传新的 JSON 覆盖旧文件

---

## 三、构建安装包

### 3.1 前提条件

- Windows 构建机需安装 NSIS
- Rust 工具链已安装
- Node.js 20+

### 3.2 Windows NSIS 构建（本地）

```bash
npm run tauri build
```

构建产物：
```
src-tauri/target/release/bundle/nsis/小鸭服饰版_{version}_x64-setup.exe
```

### 3.3 macOS 构建（GitHub Actions 自动）

macOS DMG 由 GitHub Actions 在 tag 推送后自动触发。

- **触发条件**：`git push {remote} v{版本号}`
- **配置文件**：`.github/workflows/build.yml`
- **Runner**：`macos-latest`
- **产物**：`Storyboard-Fashion_{version}_universal.dmg`

#### 3.3.1 CI 构建流程

```
tag push (v1.0.2)
  ↓
Checkout repository
  ↓
Setup Node.js 20 + Rust (aarch64 + x86_64 target)
  ↓
node scripts/sync-version.mjs → 同步版本号到三文件
  ↓
npm ci
  ↓
📥 下载 macOS ffmpeg 静态构建
  curl evermeet.cx/ffmpeg/ → src-tauri/resources/ffmpeg/
  ffmpeg (Intel 静态构建, Apple Silicon 通过 Rosetta 2 运行)
  ffprobe (同上)
  ↓
npx tauri build --target universal-apple-darwin
  ↓
Rename DMG → Storyboard-Fashion_{version}_universal.dmg
  ↓
Upload artifacts (DMG + .app bundle)
```

#### 3.3.2 为什么 CI 动态下载 ffmpeg 而不是提交

`src-tauri/resources/ffmpeg/` 包含 Windows DLL + macOS 静态二进制，总计 ~290MB，不提交到 git。
- **Windows 构建**：开发者本地已有 Windows ffmpeg 二进制（resources/ 目录在 .gitignore 中）
- **macOS 构建**：CI 在 `npx tauri build` 前从 evermeet.cx 拉取，放到 `src-tauri/resources/ffmpeg/`

#### 3.3.3 平台专属资源覆盖

Tauri v2 支持平台级配置覆盖。三个配置文件按平台合并：

| 文件 | 作用 |
|------|------|
| `tauri.conf.json` | 主配置（平台无关） |
| `tauri.windows.conf.json` | Windows 覆盖：捆绑 `resources/realesrgan/` + `resources/ffmpeg/` |
| `tauri.macos.conf.json` | macOS 覆盖：捆绑 `resources/ffmpeg/`（不含 realesrgan） |

**关键原则**：`bundle.resources` 不在主配置中声明，只在平台专属配置中声明。

### 3.4 视频超分：平台依赖说明

| 平台 | 图片超分 | 视频超分 | 编码器 | 备注 |
|------|---------|---------|--------|------|
| Windows | realesrgan-ncnn-vulkan (GPU) | ffmpeg Lanczos | libopenh264 | 本地 resources 捆绑 |
| macOS | ❌ 不可用 | ffmpeg Lanczos | libopenh264 | CI 动态拉取 ffmpeg；realesrgan 无 macOS 构建，图片超分降级 |

代码位置：`src-tauri/src/commands/enhance.rs`
- `enhance_image` → realesrgan (Windows only, `cfg!(target_os)` 控制)
- `enhance_video` → ffmpeg Lanczos (全平台，`resolve_binary` 查找 bundled ffmpeg)
- 二进制名称自动适配：`cfg!(target_os = "windows")` → `ffmpeg.exe` / 否则 `ffmpeg`

---

## 四、版本发布流程

### 阶段一：本地测试构建

#### 步骤 1：准备发布日志

创建 `docs/releases/v{版本号}.md`，格式：

```markdown
## 新增
- 功能A描述

## 修复
- 修复D描述
```

> **铁律：发布日志中绝对不能出现模型名称。**

#### 步骤 2：预检

```bash
npx tsc --noEmit
cd src-tauri && cargo check
```

#### 步骤 3：本地构建

```bash
npm run tauri build
```

#### 步骤 4：本地测试

构建产物：`src-tauri/target/release/bundle/nsis/小鸭服饰版_{version}_x64-setup.exe`

1. 双击安装包覆盖安装旧版本
2. 启动新版本，验证核心链路（登录 → 对话 → 宫格生成 → 视频生成）
3. 验证数据不丢失

### 阶段二：正式发布

#### 步骤 5：执行发布命令

```bash
npm run release -- patch --notes-file docs/releases/v1.0.1.md
```

#### 步骤 6：上传安装包到服务器

1. 上传 NSIS 安装包到 `/jy/uploads/app/`
2. 确保有英文名副本：`Storyboard-Fashion_{version}_x64-setup.exe`
3. 更新 `version_fashion.json`
4. 上传新 JSON 覆盖旧文件

```bash
# 示例
scp "小鸭服饰版_1.0.2_x64-setup.exe" root@47.108.237.10:/jy/uploads/app/
ssh root@47.108.237.10 "cp '/jy/uploads/app/小鸭服饰版_1.0.2_x64-setup.exe' /jy/uploads/app/Storyboard-Fashion_1.0.2_x64-setup.exe"
scp version_fashion.json root@47.108.237.10:/jy/uploads/app/
```

#### 步骤 7：更新用户下载页

更新 `http://47.108.237.10/jy/uploads/install_guide/industry.html` 中的版本号和下载链接。

```bash
# 1. 拉取页面
ssh root@47.108.237.10 "cat /jy/uploads/install_guide/industry.html" > /tmp/industry.html

# 2. 替换版本号和下载链接
sed -i 's/Storyboard-Fashion_[0-9.]*_x64-setup\.exe/Storyboard-Fashion_1.0.2_x64-setup.exe/g' /tmp/industry.html
sed -i 's/下载 Windows 版 &middot; v[0-9.]*/下载 Windows 版 \&middot\; v1.0.2/g' /tmp/industry.html

# 3. 上传
scp /tmp/industry.html root@47.108.237.10:/jy/uploads/install_guide/industry.html

# 4. 验证
ssh root@47.108.237.10 "grep 'Fashion_1.0.2' /jy/uploads/install_guide/industry.html"
```

> **注意**：只更新服饰版（Fashion Edition）的链接，不要改动旅游版等其他行业的版本号。

#### 步骤 8：验证

1. 旧版本客户端启动 → 弹升级对话框 → 下载安装验证完整链路
2. 浏览器访问 `https://aixiaoxi.top/jy/uploads/app/version_fashion.json` → 确认版本号
3. 浏览器访问 `http://47.108.237.10/jy/uploads/install_guide/industry.html` → 确认下载页版本号

---

## 五、版本号同步机制

发布时以下文件**必须**版本号一致：

| 文件 | 版本字段位置 |
|------|-------------|
| `package.json` | `version` |
| `src-tauri/Cargo.toml` | `[package].version` |
| `src-tauri/tauri.conf.json` | `version` |

`scripts/sync-version.mjs` 负责三文件同步。

---

## 六、技能热更新流程（xiaoya-ai-cinema-fashion）

### 6.1 架构概览

```
开发机                             服务器                              用户机器
───────                            ────────                            ────────
1. 修改 SKILL.md                  2. 打包 zip 上传                      3. 启动时自动同步
   + version.txt                  47.108.237.10                       对比本地 ~/.claude/skills/
   docs/skills/                     /jy/uploads/install_guide/files/    xiaoya-ai-cinema-fashion/
                                   xiaoya-ai-cinema-fashion.zip        version.txt vs 服务器
                                   version_fashion.txt                 version_fashion.txt
                                                                      ↓
                                                                  发现新版本 → 自动下载解压
```

### 6.2 本地文件位置

| 文件 | 路径 |
|------|------|
| Skill 源文件 | `D:\Story-Fashion\docs\skills\SKILL.md` |
| 版本文件 | `D:\Story-Fashion\docs\skills\version.txt` |
| Skill zip | `D:\Story-Fashion\docs\skills\xiaoya-ai-cinema-fashion.zip` |

### 6.3 服务器文件位置

| 文件 | URL |
|------|-----|
| Skill zip | `https://aixiaoxi.top/jy/uploads/install_guide/files/xiaoya-ai-cinema-fashion.zip` |
| 版本文件 | `https://aixiaoxi.top/jy/uploads/install_guide/files/version_fashion.txt` |

### 6.4 客户端同步逻辑

代码位置：`src-tauri/src/commands/banana_api.rs` → `sync_xiaoya_skill()`

```
应用启动 (banana_initialize)
  ↓
sync_xiaoya_skill_public()
  ↓
检查 ~/.claude/skills/xiaoya-ai-cinema-fashion/ 目录是否存在
  ├── 不存在 → 下载 zip 解压
  └── 已存在 → 对比本地 version.txt vs 服务器 version_fashion.txt
       ├── 版本一致 → 跳过
       └── 版本不同 → 删除旧目录 → 下载 zip 解压
```

聊天面板打开时：
```
ensure_skill_md()
  ↓
检查 ~/.claude/skills/xiaoya-ai-cinema-fashion/SKILL.md
  ├── 存在 → 加载
  └── 不存在 → 调用 sync_xiaoya_skill_public()
```

### 6.5 发版步骤

```bash
# 1. 修改 SKILL.md 内容
#    编辑 D:\Story-Fashion\docs\skills\SKILL.md

# 2. 更新版本号
#    编辑 D:\Story-Fashion\docs\skills\version.txt
#    格式要求：
#      name: xiaoya-ai-cinema-fashion
#      version=1.0.1
#      description: 小鸭AI服饰短视频提示词 — 服饰行业AI短视频制作专家
#      release_date: 2026-08-07
#      changelog: |
#        v1.0.1 — 新增xxx功能
#        v1.0.0 — 初始版本：服饰行业专属SKILL

# 3. 打包 zip
cd D:\Story-Fashion\docs\skills
powershell -Command "Compress-Archive -Path 'SKILL.md','version.txt' -DestinationPath 'xiaoya-ai-cinema-fashion.zip' -Force"

# 4. 上传到服务器
scp xiaoya-ai-cinema-fashion.zip root@47.108.237.10:/jy/uploads/install_guide/files/
scp version.txt root@47.108.237.10:/jy/uploads/install_guide/files/version_fashion.txt

# 5. 验证
curl -s "https://aixiaoxi.top/jy/uploads/install_guide/files/version_fashion.txt"
ssh root@47.108.237.10 "unzip -p /jy/uploads/install_guide/files/xiaoya-ai-cinema-fashion.zip version.txt | head -3"
```

### 6.6 关键约束

- **生产服务器**: `47.108.237.10`
- **安全标记**: `<!-- SECURITY_MARKER: xiaoya-ai-cinema-fashion-protected-skill-v{X.Y.Z} -->` 必须与 `version.txt` 版本号一致
- **version_fashion.txt**: 与 zip 包内的 `version.txt` 内容相同，用于客户端版本检测
- **用户本地目录**: `~/.claude/skills/xiaoya-ai-cinema-fashion/`

### 6.7 快速更新命令（一键）

```bash
# === 在 D:\Story-Fashion\docs\skills 目录执行 ===

# 1. 编辑 SKILL.md + version.txt 后
# 2. 一键打包上传：
cd D:\Story-Fashion\docs\skills && \
powershell -Command "Compress-Archive -Path 'SKILL.md','version.txt' -DestinationPath 'xiaoya-ai-cinema-fashion.zip' -Force" && \
scp xiaoya-ai-cinema-fashion.zip root@47.108.237.10:/jy/uploads/install_guide/files/ && \
scp version.txt root@47.108.237.10:/jy/uploads/install_guide/files/version_fashion.txt && \
echo "=== 上传完成，验证 ===" && \
curl -s "https://aixiaoxi.top/jy/uploads/install_guide/files/version_fashion.txt"
```

---

## 七、客户端本地调试

### 7.1 清除本地 SKILL 缓存

测试热更新时需要模拟"首次下载"场景：

```bash
# 删除本地缓存，下次启动会重新从服务器下载
rm -rf ~/.claude/skills/xiaoya-ai-cinema-fashion
```

### 7.2 查看本地 SKILL 版本

```bash
cat ~/.claude/skills/xiaoya-ai-cinema-fashion/version.txt
```

### 7.3 查看 Tauri 日志

日志位置（Windows）：
```
%TEMP%\storyboard-fashion\logs\storyboard.log
```

关键日志关键字：
- `[SkillUpgrade]` — 版本检测
- `[Skill]` — 同步状态
- `[Chat]` — SKILL.md 加载

---

## 八、故障排查

| 现象 | 可能原因 | 解决方法 |
|------|---------|---------|
| 不弹升级框 | `version_fashion.json` 未更新或版本号不高于当前 | 检查 JSON 文件和版本比较逻辑 |
| 下载失败（1392 错误） | 安装包文件名不匹配或未上传英文副本 | 确认服务器上有 `Storyboard-Fashion_{version}_x64-setup.exe` |
| "文件校验失败" | 下载不完整 | 重新上传安装包 |
| 安装程序启动后无反应 | 旧进程未退出 | 确认 `std::process::exit(0)` 执行 |
| SKILL 版本显示 0.0.0 | 服务器 `version_fashion.txt` 不存在或返回 404 | 检查第 6.5 节上传步骤 |
| SKILL 热更新不触发 | `banana_api.rs` 中 `version_url` 还是 `version_travel.txt` | 确认代码中已是 `version_fashion.txt` |
| 本地 SKILL.md 为空 | 网络不通或 zip 下载失败 | 检查日志 `[Skill]` 相关错误 |
| macOS 构建失败 "resource path doesn't exist" | `bundle.resources` 在主配置中声明了平台专属资源 | 资源和配置移至 `tauri.{platform}.conf.json`，见 3.3.3 |
| macOS 构建找不到 ffmpeg | CI 没有本地 resources 目录 | 确认 CI workflow 中有 ffmpeg 下载步骤 |

---

## 九、复刻为其他行业版本

服饰专业版是**基准版本**。以此文档和代码仓库为模板，可以快速复刻出以下版本：

| 版本 | identifier | productName | 行业 | 预计改动量 |
|------|-----------|-------------|------|-----------|
| 服饰专业版 | `com.storyboard.fashion` | 小鸭服饰版 | 服装 | 基准 (0) |
| 美妆专业版 | `com.storyboard.beauty` | 小鸭美妆版 | 美妆 | ~30 处 |
| 萌宠专业版 | `com.storyboard.pet` | 小鸭萌宠版 | 宠物 | ~30 处 |
| (更多行业) | `com.storyboard.{industry}` | 小鸭{行业}版 | 自定义 | ~30 处 |

### 9.1 复刻清单

以下是以"服饰 → 美妆"为例的完整改动清单。括号内为萌宠版对应值。

#### 第一层：品牌标识（9 处）

| # | 文件 | 改动 | 示例 (美妆版) |
|---|------|------|--------------|
| 1 | `package.json` | `name` 字段 | `"storyboard-beauty"` |
| 2 | `src-tauri/tauri.conf.json` | `productName` | `"小鸭美妆版"` |
| 3 | `src-tauri/tauri.conf.json` | `identifier` | `"com.storyboard.beauty"` |
| 4 | `src-tauri/tauri.conf.json` | `main` window `title` | `"小鸭美妆版"` |
| 5 | `src-tauri/Cargo.toml` | `[package].name` | `"storyboard-beauty"` |
| 6 | `src-tauri/src/commands/update.rs` | `RELEASE_APP_NAME` 常量 | `"Storyboard-Beauty"` |
| 7 | `src-tauri/src/commands/banana_api.rs` | skill 同步 URL | `version_beauty.txt` |
| 8 | `.github/workflows/build.yml` | DMG 重命名常量 | `"Storyboard-Beauty"` |
| 9 | `src/components/UpdateAvailableDialog.tsx` | UI 弹窗标题文本 | `"小鸭美妆版"` |

#### 第二层：SKILL 文件（4 处）

| # | 文件 | 改动 |
|---|------|------|
| 10 | `docs/skills/SKILL.md` | 行业角色定义（服装导演 → 美妆导演） |
| 11 | `docs/skills/SKILL.md` | `name` frontmatter: `xiaoya-ai-cinema-beauty` |
| 12 | `docs/skills/SKILL.md` | SECURITY_MARKER 版本标识 |
| 13 | `docs/skills/version.txt` | 版本文件名、描述、更新日志 |

#### 第三层：服务器文件（4 处）

| # | 文件 | 改动 |
|---|------|------|
| 14 | 安装包 | `Storyboard-Beauty_{version}_x64-setup.exe` |
| 15 | `version_fashion.json` | → `version_beauty.json`，更新 URL 和 notes |
| 16 | `version_fashion.txt` | → `version_beauty.txt`（技能热更新版本文件） |
| 17 | `xiaoya-ai-cinema-fashion.zip` | → `xiaoya-ai-cinema-beauty.zip` |

#### 第四层：下载页（2 处）

| # | 文件 | 改动 |
|---|------|------|
| 18 | `industry.html` | 新增美妆版下载区块（或复制 fashion 区块调整） |
| 19 | `industry.html` | 版本号、下载链接、页面文案 |

#### 第五层：代码逻辑（按需，3-5 处）

| # | 文件 | 改动 |
|---|------|------|
| 20 | `src-tauri/src/commands/banana_api.rs` | 版本检测 URL 指向 `version_beauty.json` |
| 21 | `src/App.tsx` | 启动加载的默认行业参数 |
| 22 | SKILL fallback 逻辑 | 确保无网络时正确降级 |

### 9.2 复刻步骤（标准流程）

```
步骤 1: Fork/Copy 仓库
  git clone <storyboard-fashion> storyboard-beauty
  修改 git remote

步骤 2: 全局搜索替换
  # 品牌名替换
  fashion → beauty
  服饰 → 美妆
  Fashion → Beauty

步骤 3: 修改 9.1 清单中的 ~30 个点位

步骤 4: 改写 SKILL.md
  - 角色从"服装展示导演"改为"美妆展示导演"
  - 六宫格从"服装呈现旅程"改为"妆容呈现旅程"
  - 面料翻译 → 肤质/妆效翻译
  - 保留所有强制规则框架

步骤 5: 修改 CI/CD
  - .github/workflows/build.yml 中的 RELEASE_APP_NAME
  - version JSON/TXT 文件名

步骤 6: 首次构建验证
  - Windows: npm run tauri build
  - macOS: git push v0.1.0-beta → CI 自动构建

步骤 7: 上传安装包 + 版本文件到服务器
  路径规则: /jy/uploads/app/Storyboard-{Industry}_{version}_x64-setup.exe

步骤 8: 更新下载页 industry.html

步骤 9: 端到端测试
  - 安装 → 启动 → 升级检测 → 技能同步 → 核心链路
```

### 9.3 不可变部分（所有行业版本共享）

以下文件/逻辑在复刻时**不要改动**：

| 共享层 | 说明 |
|--------|------|
| `src-tauri/src/commands/enhance.rs` | 图片/视频超分 - 全行业通用 |
| `src-tauri/src/commands/update.rs` | 升级检测逻辑 - installer_name() 自动适配 RELEASE_APP_NAME |
| `src/features/` 目录 | 核心 UI 组件（对话/项目/宫格/视频生成） |
| `src-tauri/src/commands/banana_api.rs` | API 通信层（COS 上传、VOD 转码等） |
| `src-tauri/tauri.conf.json` | 主构建配置（平台无关） |
| `tauri.windows.conf.json` / `tauri.macos.conf.json` | 平台资源捆绑 |
| CI 构建流程 | `.github/workflows/build.yml` 框架（仅改 APP_NAME） |
| 热更新机制 | 技能同步逻辑（仅改 URL 指向） |

### 9.4 版本号约定

所有行业版本独立编号，互不影响：

```
服饰版: v1.0.0 → v1.0.1 → v1.0.2 → ...
美妆版: v1.0.0 → v1.0.1 → v1.0.2 → ...
萌宠版: v1.0.0 → v1.0.1 → v1.0.2 → ...
```

### 9.5 服务器目录结构

```
/jy/uploads/
├── app/
│   ├── Storyboard-Fashion_1.0.2_x64-setup.exe
│   ├── Storyboard-Fashion_1.0.2_universal.dmg
│   ├── Storyboard-Beauty_1.0.0_x64-setup.exe
│   ├── Storyboard-Beauty_1.0.0_universal.dmg
│   ├── Storyboard-Pet_1.0.0_x64-setup.exe
│   ├── version_fashion.json
│   ├── version_beauty.json
│   └── version_pet.json
├── install_guide/
│   ├── industry.html          (所有行业公用下载页)
│   └── files/
│       ├── xiaoya-ai-cinema-fashion.zip
│       ├── version_fashion.txt
│       ├── xiaoya-ai-cinema-beauty.zip
│       └── version_beauty.txt
```
