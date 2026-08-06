# 分镜大师服饰版 — 升级流程

本文档涵盖服饰版的两种升级链路：

- **程序本体升级**：构建 → 上传 → 版本检测 → 下载 → 安装
- **技能热更新**：SKILL.md 迭代 → 打包上传 → 客户端自动检测更新

---

## 一、架构总览

```
开发机                       服务器                          用户机器
───────                     ────────                        ────────
1. npm run release          2. GitHub Actions              3. 小鸭服饰版启动
   打 tag 推远端               自动构建 .dmg                  check_for_upgrade()
                                                           ↓
4. npm run tauri build      5. 上传 .exe 到服务器             发现新版本
   本地构建 Windows NSIS       /jy/uploads/app/              弹 UpdateAvailableDialog
                              安装包上传到服务器
                                                           ↓
                            6. 更新 version_fashion.json     用户点击"直接下载安装"
                                                           download_upgrade()
                                                           ↓
                                                           emit download-progress
                                                           进度条实时显示
                                                           ↓
                                                           launch_installer()
                                                           启动 NSIS 安装程序
                                                           当前进程 exit(0)
                                                           ↓
                                                           用户走完 NSIS 安装向导
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
| 构建配置 | `src-tauri/tauri.conf.json` | NSIS 安装模式 |
| 版本同步 | `scripts/sync-version.mjs` | 同步 package.json / Cargo.toml / tauri.conf.json |
| CI/CD | `.github/workflows/build.yml` | tag 推送 → GitHub Actions 自动构建 macOS DMG |

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

- 触发条件：`git push {remote} v{版本号}`
- 配置文件：`.github/workflows/build.yml`
- 产物：`Storyboard-Fashion_{version}_universal.dmg`

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
scp "小鸭服饰版_1.0.1_x64-setup.exe" root@47.108.237.10:/jy/uploads/app/
ssh root@47.108.237.10 "cp /jy/uploads/app/小鸭服饰版_1.0.1_x64-setup.exe /jy/uploads/app/Storyboard-Fashion_1.0.1_x64-setup.exe"
scp version_fashion.json root@47.108.237.10:/jy/uploads/app/
```

#### 步骤 7：验证

1. 旧版本客户端启动 → 弹升级对话框 → 下载安装验证完整链路
2. 浏览器访问 `https://aixiaoxi.top/jy/uploads/app/version_fashion.json` → 确认版本号

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
