# 长文发布（longtext）— 实现记录

> 状态：**已完成，真机验证通过**（2026-06-15）
> 适用版本：xhs-cli 1.5.0+

## 真实页面流程（实测确认）

小红书文章页 DOM 与最初设想差异较大，实际流程如下：

```
?from=menu&target=article
       │
       ▼
   ┌──────────────────────────────────┐
   │  「写长文」起始页                  │
   │  - tab: 上传视频/上传图文/写长文   │
   │  - 底部按钮：[新的创作] [导入链接] │
   └──────────────────────────────────┘
       │ 点「新的创作」
       ▼
   ┌──────────────────────────────────┐
   │  文章编辑器                        │
   │  - 标题：textarea[placeholder=    │
   │          "输入标题"]              │
   │  - 正文：div.tiptap.ProseMirror   │
   │          [contenteditable="true"] │
   │  - 工具栏：.menu-items-container  │
   │    最后一个 .menu-item =          │
   │    「从文件导入」(仅 hover tooltip │
   │    标识，无文字/aria)             │
   │  - 底部按钮：[暂存离开] [一键排版] │
   └──────────────────────────────────┘
```

### 「从文件导入」markdown 的两步流程

1. 点工具栏最后按钮 → 弹出 **`.import-from-file-modal`** 自定义模态框
   （标题"文档导入"，含 `.upload-area`，文案"点击或拖拽上传，支持 docx/md/txt"）
2. 点 `.upload-area` → 才弹**原生 filechooser** → `chooser.accept([绝对路径])`
3. 文件被解析渲染到正文区，模态框自动关闭

### 发布流程

```
填标题 + 导入 md
    ↓
④ 点「一键排版」  (clickFooterButton 文案匹配)
    ↓  页面异步渲染
⑤ 点「下一步」    (轮询 pollMs 等按钮出现)
    ↓  跳转到常规发布页
⑤.5 [可选] 填正文描述   (等 ProseMirror 编辑器出现,fillContent 输入)
    ↓
⑥ 点「发布」      (轮询 pollMs 等按钮出现)
```

## 关键实现点

| 点 | 选择器/方式 | 备注 |
|----|------------|------|
| 标题输入框 | `textarea[placeholder="输入标题"]` | 旧版 `input.d-text` 已失效 |
| 正文编辑器 | `.tiptap.ProseMirror[contenteditable="true"]` | 仅 `--content`/`--content-file` 纯文本模式用 |
| 导入按钮 | `.menu-items-container .menu-item:not(.disabled)` 取最后一个 | 无文字标识，靠位置 |
| 模态框上传区 | `.import-from-file-modal .upload-area` | 点击触发原生 filechooser |
| 一键排版 / 下一步 / 发布 | `clickFooterButton` 文案匹配 + 坐标兜底 | `pollMs` 轮询出现 |

## CLI 用法

```bash
# 推荐：导入 markdown 文件 + 在发布页正文区追加 SEO 关键词
xhs longtext --title "标题" --md-file path/to/article.md \
    --description "核心关键词 + 引导文案，用于长尾搜索流量" \
    --publish

# 纯文本正文
xhs longtext --title "标题" --content "正文内容" --publish

# 从文件读描述（描述较长时用）
xhs longtext --title "标题" --md-file article.md \
    --description-file path/to/seo-desc.txt --publish
```

## 进程退出策略

`browser.disconnect()` 解除 puppeteer 控制但保留 Chrome 进程（方便用户查看发布结果），
随后 `process.exit(0)` 让 Node 命令干净退出。
设置 `XHS_LONGTEXT_NO_EXIT=1` 可保留进程（被外部 agent 复用时）。

## 调参环境变量

| 变量 | 默认 | 用途 |
|------|------|------|
| `XHS_LONGTEXT_NEXT_X/Y` | 934/983 | 「下一步」坐标兜底 |
| `XHS_PUBLISH_X/Y` | 934/983 | 「发布」坐标兜底 |
| `XHS_HEADLESS` | - | `=1` 无头模式 |
| `XHS_LONGTEXT_NO_EXIT` | - | `=1` 不强制退出进程 |

## 探查脚本（小红书改版时复用）

- `scripts/probe-article.js` — 进入编辑器，hover 工具栏取 tooltip + 属性
- `scripts/probe-import.js` — 完整演练「从文件导入」流程并验证导入结果
- `docs/test-article.md` — 探查/测试用的 markdown 样本

改版后若 longtext 失效，先跑这两个脚本定位 DOM 变化，再更新 `src/toolset/postLongText.ts` 的选择器。
