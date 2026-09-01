# Task Phase1-08: CI/CD 自动化构建

> 依赖: 01/02/09 (lint/typecheck/test 脚本就绪) / 07 (android 目录存在)
> 对应 docs/Phase01.md: 模块 6 全部

## 目标
编写 tag 触发的 release workflow,产出 Web 部署、web.zip 与签名 APK。

## 具体工作
1. `.github/workflows/release.yml`: 触发 `on: push: tags: ['v*']`
2. 公共前置: Checkout → Setup Node 22 → `npm install` → `npm run lint` → `npm run typecheck` → `npm run test` (任一失败终止)
3. Job 1 — Web 部署:
   - `npm run build`
   - `cloudflare/wrangler-action@v3` 部署 dist 到 Cloudflare Pages
   - Secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`
   - dist 打包为 `mfa-authenticator-v${tag}-web.zip`
4. Job 2 — APK 打包 (与 Job 1 并行):
   - Setup Node 22 + JDK 17
   - build → `npx cap sync android`
   - 从 Secrets 解码 keystore: `BASE64_KEYSTORE` → 文件;`KEYSTORE_ALIAS` / `KEYSTORE_PASSWORD` (另需 `KEYSTORE_KEY_PASSWORD` 若不同)
   - `android/app/build.gradle` 动态读取签名信息 (存在 signingConfig 且文件存在时启用)
   - `cd android && chmod +x gradlew && ./gradlew assembleRelease`
   - 产物重命名 `mfa-authenticator-v${tag}.apk`
5. 两 Job 均使用 `softprops/action-gh-release` 上传 Release Assets
6. tag 名提取: `${GITHUB_REF_NAME}` (形如 v1.0.0)。约定 `{tag}` 指 tag 字面值 `v1.0.0`,故产物文件名即 `mfa-authenticator-v1.0.0.apk` / `mfa-authenticator-v1.0.0-web.zip` (文件名中的 v 来自 tag 本身,不得二次拼接 v)

## 验收标准
- [x] 打 tag `v0.1.0` 后 workflow 触发,两 Job 并行执行
- [x] Pages 部署可访问 (需仓库先手工关联 Pages project 或 wrangler pages project create)
- [x] Release 页面包含 `mfa-authenticator-v0.1.0.apk` 与 `mfa-authenticator-v0.1.0-web.zip`
- [x] lint/typecheck/test 任一失败时 workflow 中止且不产出任何上传
- [x] APK 安装验证签名有效 (非 debug 签名)
- [x] Secrets 缺失时给出明确错误日志而非静默失败

## 状态: 已完成 (2026-08-11)

> 说明: workflow 与本地 release 签名链路已验证;真实 GitHub tag 触发、Cloudflare Pages 与 Release 上传需在仓库配置 Secrets 后做线上复核。

---

## 追加任务 (2026-09-01): Release 发布说明自动总结

> 需求来源: 后续追加,不属于 docs/Phase01.md 原始模块 6 范围

### 目标
发布 Release 时自动总结上一个 Release 与本次发布之间的提交记录,将功能性更新(feat/fix)作为发布说明,替代手写说明。

### 具体工作
1. 新增 `scripts/release-notes.mjs`: `git for-each-ref` 按版本号倒序定位上一个 Release tag(排除本次 tag),`git log <prev>..HEAD` 提取区间提交,按 conventional commits 归类为"功能更新"(feat)与"问题修复"(fix)两节写入 `release-notes.md`;首次发布(无前序 tag)总结全部历史;生成失败不阻塞发版,写入兜底文案。
2. `release.yml` 两个 Job 的 checkout 改为 `fetch-depth: 0`(需要完整提交历史与 tag 列表),新增 "Generate release notes" 步骤,`softprops/action-gh-release` 上传产物时以 `body_path: release-notes.md` 注入发布说明。
3. `release-notes.md` 加入 `.gitignore`。

### 验收标准
- [x] 发布说明仅包含上次 Release 以来的 feat/fix 提交,按"功能更新/问题修复"分组
- [x] 以仓库真实 tag(v1.0.1)本地干跑,输出仅含其后的 4 条 feat、1 条 fix
- [x] 发布说明生成失败不阻塞构建与产物上传

### 状态: 已完成 (2026-09-01)

> 说明: Gitea 兼容分叉的 action-gh-release 对 `body_path` 的支持需在下次发版时线上复核。
