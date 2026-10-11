# xhs-cli

在终端里使用的小红书工具：**登录**、**创作者指标**、**创作者后台已发笔记**（`recent`）、**单篇笔记详情**（`detail`）、**本地发帖归档**（`posted`）、**图文发帖**（`post`）与**长文/文章发帖**（`longtext`，需本机 Chrome/Chromium）。

支持**多账号隔离**（每账号独立浏览器会话目录），适合与 Agent 或自动化流程编排配合；发帖仍以**本地人机确认**为前提。

## 依赖

- **Node.js** 20 及以上
- **Chrome 或 Chromium**（本机已安装；CLI 通过 Puppeteer 连接，不随包下载浏览器）

## 安装

```bash
npm i -g @easyasstudio/xhs-cli
```

安装后使用命令 **`xhs`**。完整子命令列表：`xhs help`。

## 快速开始

### 1. 添加账号并登录

账号名仅允许 `[a-zA-Z0-9._-]+`：

```bash
xhs account add my-account
xhs account use my-account
xhs login
```

`login` 成功后会自动把该账号记为**当前账号**。会话保存在 `~/.config/xhs-cli/.cache/accounts/<name>/browser-data`。

### 2. 发帖（填表）

```bash
xhs post \
  --title "标题" \
  --content "正文至少十个字，须满足小红书长度校验" \
  --image ./cover.png
```

- `--image` 可重复，至少 1 张、最多 18 张；也可用 `--content-file <路径>` 代替 `--content`。
- 默认只填表，**不会**自动点击发布；加 `--publish` 会在填表后尝试点击页面「发布」按钮。
- 临时操作其他账号：`--account other`。

### 3. 长文发帖（文章，无需本地图片）

```bash
xhs longtext \
  --title "标题" \
  --md-file ./article.md \
  --description "发布页正文区的 SEO 关键词（可选）"
```

- 也可用 `--content` / `--content-file` 直接填 markdown 正文。
- `--publish` 会自动点「一键排版/下一步」→ 等转换 → 点「发布」。

### 4. 打开创作者后台（保持 Chrome 窗口）

```bash
xhs home
xhs home note-manager
```

`home` 会启动独立 Chrome 并绑定当前账号会话；后续 `metrics`/`post` 等命令可复用该窗口。

### 5. 查看数据

```bash
xhs metrics
xhs recent --limit 20
xhs detail <noteId>
xhs posted
```

## 当前账号

| 命令 | 说明 |
|------|------|
| `xhs account use <name>` | 设置当前账号（写入 `registry.json`） |
| `xhs account current` | 打印当前账号 slug |
| `xhs account list` | 列表中带 `*` 的为当前账号 |

业务命令**默认使用当前账号**，无需每次写账号参数。临时切换仅支持 **`--account <slug>`**。

未设置当前账号时，命令会提示先执行 `xhs account use <name>`。

## 登录态导入 / 导出（跨机器、跨系统）

Chrome 的 cookie 由系统级加密保护（Windows 用 DPAPI，绑定当前用户凭据），
**直接拷贝 `browser-data` 目录到另一台机器会解不开，等于没登录**。

本组命令走 CDP 导出「浏览器已解密的明文 cookie」，再在目标机注入，
因此可跨机器、跨操作系统迁移 —— 典型场景是把本机登录态搬到 Linux 服务器跑无头发帖。

| 命令 | 说明 |
|------|------|
| `xhs session export [--out <路径>]` | 导出当前登录态（默认 `./session.json`） |
| `xhs session import <路径>` | 导入登录态到本机 |
| `xhs session status` | 查看本机登录态（含账号名） |

典型流程：

```bash
# 本机（已登录）导出
xhs session export --out session.json
scp session.json user@server:/root/     # 传到服务器

# 服务器上导入
chmod 600 session.json
xhs session import session.json
# ✅ 已注入 16 个 cookie / 登录态验证: 成功 / 发布页可达: 是 / 账号: xxx

# 之后即可正常发帖
XHS_HEADLESS=1 xhs post --title "..." --content-file ... --image ... --publish
```

> ⚠️ **导出文件是明文登录凭据，等同账号密码。**
> 写入时已是 `0o600`；传输请走 `scp`，传完 `chmod 600`，用完 `shred -u` 删除。
> 不要提交进 git、不要走 IM、不要放公开存储。
>
> ⚠️ **核心凭据有效期通常只有数天**（如 `galaxy_creator_session_id`、`access-token-creator`）。
> 过期后需回源机器重新导出。若目标机导入后验证失败，多为 cookie 过期，
> 或风控 cookie（`websectiga`/`acw_tc`）绑定了源机器 IP —— 此时需在目标机 `xhs login` 重新扫码。
> **不要反复重试导入**，连续失败可能触发平台风控。

## 命令一览

| 命令 | 说明 |
|------|------|
| `xhs help` | 打印帮助 |
| `xhs account list` | 列出已配置账号 |
| `xhs account add <name>` | 新建账号（首个账号会自动设为当前） |
| `xhs account show <name>` | 查看单账号配置 |
| `xhs account use <name>` | 设置当前账号 |
| `xhs account current` | 显示当前账号 |
| `xhs session export [--out <路径>]` | 导出登录态（跨机器迁移用） |
| `xhs session import <路径>` | 导入登录态 |
| `xhs session status` | 查看登录态 |
| `xhs login [--account <name>]` | 登录创作者中心 |
| `xhs metrics [--account <name>]` | 运营数据摘要 |
| `xhs recent [--limit N] [--account <name>]` | 创作者后台已发笔记 |
| `xhs detail <noteId> [--account <name>]` | 笔记详情 |
| `xhs posted [--account <name>]` | 本地 `published/` 归档列表 |
| `xhs post --title … (--content … \| --content-file …) --image … [--account <name>]` | 创作页填表发帖（图文） |
| `xhs longtext --title … (--content … \| --content-file … \| --md-file …) [--description …] [--publish] [--account <name>]` | 长文/文章发帖（正文渲染成图） |
| `xhs home [home\|note-manager\|content\|fans\|profile] [--account <name>]` | 打开创作者后台（独立 Chrome） |

## 数据目录

默认路径：**`~/.config/xhs-cli/.cache/`**

| 路径 | 说明 |
|------|------|
| `accounts/registry.json` | 账号注册表（含 `currentAccount`） |
| `accounts/<name>/browser-data/` | 该账号 Chrome 会话（Cookie 等） |
| `published/` | 本地发帖归档 JSON（`xhs posted`） |

## 发帖说明

- 本工具**不会**在未经你确认的情况下向小红书发稿。
- `xhs post` 未加 `--publish` 时：填入标题、正文、图片后保持浏览器窗口，由你在页面中确认并发布。
- `xhs longtext` 默认同样只填表；加 `--publish` 会尝试自动完成排版与发布。
- `--publish` 会尝试自动点击「发布」，是否成功以页面实际状态为准。

## 许可证

[GNU General Public License v3.0](./LICENSE)（GPL-3.0）

## 链接

- 仓库：<https://github.com/woshihoujinxin/xhs-cli>
- Issues：<https://github.com/woshihoujinxin/xhs-cli/issues>
