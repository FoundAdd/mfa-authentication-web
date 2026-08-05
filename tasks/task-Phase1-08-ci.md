# Task Phase1-08: CI/CD 自动化构建

> 依赖: 01/02/09 (lint/typecheck/test 脚本就绪) / 07 (android 目录存在)
> 对应 README: 模块 6 全部

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
- [ ] 打 tag `v0.1.0` 后 workflow 触发,两 Job 并行执行
- [ ] Pages 部署可访问 (需仓库先手工关联 Pages project 或 wrangler pages project create)
- [ ] Release 页面包含 `mfa-authenticator-v0.1.0.apk` 与 `mfa-authenticator-v0.1.0-web.zip`
- [ ] lint/typecheck/test 任一失败时 workflow 中止且不产出任何上传
- [ ] APK 安装验证签名有效 (非 debug 签名)
- [ ] Secrets 缺失时给出明确错误日志而非静默失败
