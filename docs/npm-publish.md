# xhs-cli 发布到 npm 官方指南

本文档用于在 **Windows / PowerShell** 下，从本仓库发布 **`@easyasstudio/xhs-cli`** 到 **npm 官方**：

**https://registry.npmjs.org**

> **不要发到华为云镜像。** 镜像只用于本机 `npm install` 加速下载，不能、也不应作为 `npm publish` 的目标。

---

## 0. 记住这三条

| 操作 | 正确做法 | 错误做法 |
|------|----------|----------|
| **登录** | `npm login --registry=https://registry.npmjs.org` | 直接 `npm login`（会登录华为镜像，与发包无关） |
| **发布** | 在本仓库执行 `npm run publish:npm` | 在镜像上发包（会失败或发错地方） |
| **查版本** | `npm view ... --registry=https://registry.npmjs.org` | 只看镜像返回的旧版本 |

本仓库已在 `package.json` 的 `publishConfig.registry` 中**写死官方源**，因此在项目根目录执行 `npm publish` / `npm run publish:npm` 时，**即使用户全局 registry 是华为镜像，也会发到 npm 官方**。

**包名**：`@easyasstudio/xhs-cli`  
**命令行入口**：`xhs`

---

## 1. 安装 vs 发布（两套 registry）

| 用途 | Registry |
|------|----------|
| 日常 `npm install`（本机加速） | 华为云 `https://mirrors.huaweicloud.com/repository/npm/` |
| **发布、查包、登录发包账号** | **npm 官方 `https://registry.npmjs.org`** |

检查你当前全局配置：

```powershell
npm config get registry
# 可能是华为镜像 —— 仅影响 install，不影响本仓库 publish（见 publishConfig）
```

---

## 2. 一次性准备（登录 npm 官方）

### 2.1 确认 Node 版本

```powershell
node -v
# 需要 >= 20
```

### 2.2 登录 npm 官方

**必须带 `--registry`，不要直接 `npm login`：**

```powershell
npm login --registry=https://registry.npmjs.org
```

按提示输入 Username / Password（或 Access Token）/ Email / OTP。

验证登录的是**官方**，不是华为：

```powershell
npm whoami --registry=https://registry.npmjs.org
```

确认对 `@easyasstudio` 有发布权限：

```powershell
npm access ls-packages --registry=https://registry.npmjs.org
```

### 2.3 （推荐）用 Access Token

在 [npmjs.com → Access Tokens](https://www.npmjs.com/settings/~your-user/tokens) 创建 Token（勾选 `@easyasstudio` publish 权限）：

```powershell
npm config set //registry.npmjs.org/:_authToken "你的TOKEN" --location=user
```

> Token 只写在用户级 npm 配置，**不要提交到 Git**。

---

## 3. 发布前检查

```powershell
cd C:\develop\ws\xhs-cli

git status
npm test
npm pack --dry-run
```

查 **npm 官方** 最新已发版本：

```powershell
npm view @easyasstudio/xhs-cli version --registry=https://registry.npmjs.org
```

查某版本是否已在官方存在：

```powershell
npm view @easyasstudio/xhs-cli@1.6.2 version --registry=https://registry.npmjs.org
```

确认清单：

- [ ] `npm test` 通过
- [ ] `package.json` 的 `version` 已递增，且官方尚无该版本
- [ ] 改动已 commit（版本号与 tag 一致）

---

## 4. 标准发布流程

### 4.1 改版本号

```powershell
# 补丁 1.6.2 → 1.6.3
npm version patch --no-git-tag-version

# 或次版本 / 主版本
# npm version minor --no-git-tag-version
# npm version major --no-git-tag-version
```

### 4.2 再测一遍

```powershell
npm test
```

### 4.3 提交并打 tag

假设新版本为 `1.6.3`：

```powershell
git add package.json package-lock.json
git commit -m "chore: bump version to 1.6.3"

git tag v1.6.3
git push origin main
git push origin v1.6.3
```

### 4.4 发布到 npm 官方

**推荐（项目内脚本，已锁定官方 registry）：**

```powershell
npm run publish:npm
```

等价于在项目根目录执行 `npm publish --access public`（`publishConfig.registry` 指向官方）。

等价显式命令（可选，效果相同）：

```powershell
npm publish --access public --registry=https://registry.npmjs.org
```

发布后 `postpublish` 会自动 `git checkout README.md` 还原可能被改写的 README。

### 4.5 在官方源验证

```powershell
npm view @easyasstudio/xhs-cli version --registry=https://registry.npmjs.org
npm view @easyasstudio/xhs-cli dist-tags --registry=https://registry.npmjs.org
```

从**官方**安装验证：

```powershell
npm install -g @easyasstudio/xhs-cli@latest --registry=https://registry.npmjs.org
xhs version
```

---

## 5. 一键命令清单（复制用）

把 `X.Y.Z` 换成实际版本：

```powershell
cd C:\develop\ws\xhs-cli

npm test
npm version patch --no-git-tag-version
npm test

git add package.json package-lock.json
git commit -m "chore: bump version to X.Y.Z"
git tag vX.Y.Z
git push origin main
git push origin vX.Y.Z

npm run publish:npm

npm view @easyasstudio/xhs-cli version --registry=https://registry.npmjs.org
```

---

## 6. GitHub Actions 自动发布（可选）

推送 `v*` tag 触发 `.github/workflows/tag-publish.yml`，CI 使用 **`https://registry.npmjs.org`**（不是华为镜像）。

需在 GitHub **Settings → Secrets → Actions** 配置 `NPM_TOKEN`（npm 官方 Automation Token）。未配置则 CI 会跳过 publish。

---

## 7. 常见问题

### Q: `npm login` 提示华为云地址？

全局 registry 是镜像，**正常**。发包账号请单独登录官方：

```powershell
npm login --registry=https://registry.npmjs.org
```

**不要**指望镜像上的 login 能用来 publish。

### Q: 会不会误发到华为镜像？

不会。本仓库 `package.json` 已设置：

```json
"publishConfig": {
  "access": "public",
  "registry": "https://registry.npmjs.org"
}
```

在项目根目录 `npm run publish:npm` 一定走官方。

### Q: `403 Forbidden - Two-factor authentication required`

用 OTP 登录，或改用 Access Token 写入 `//registry.npmjs.org/:_authToken`。

### Q: `403 You do not have permission to publish`

确认 npm 账号已加入 `@easyasstudio` 组织且有 publish 权限。

### Q: `403 Cannot publish over existing version`

版本号未递增，先 `npm version patch --no-git-tag-version`。

### Q: 官方已发新版，但 `npm install -g` 还是旧的

查官方：`npm view ... --registry=https://registry.npmjs.org`  
若走华为镜像安装，可能有同步延迟。

---

## 8. 相关文件

| 文件 | 作用 |
|------|------|
| `package.json` → `publishConfig.registry` | **锁定发布到 npm 官方** |
| `package.json` → `scripts.publish:npm` | 推荐发布命令 |
| `.github/workflows/tag-publish.yml` | 推 tag 时 CI 发官方 npm |
| `scripts/run-tests.mjs` | 跨平台测试 |

---

## 9. 发布检查表

- [ ] 已用 `npm login --registry=https://registry.npmjs.org` 或配置官方 token
- [ ] `npm test` 通过
- [ ] `version` 已递增，官方尚无该版本
- [ ] `git commit` + `git tag vX.Y.Z` + `git push`
- [ ] **`npm run publish:npm`**（发到官方，不是华为）
- [ ] `npm view @easyasstudio/xhs-cli version --registry=https://registry.npmjs.org` 确认新版本
