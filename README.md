# MFA Authenticator (TOTP 密钥管理器)

基于 Vite + Vue 3 + TypeScript 的多平台 TOTP(基于时间的一次性密码)验证器,采用"本地优先"架构,完全离线可用。Web 端构建为 PWA 部署于 Cloudflare Pages,同时通过 Capacitor 打包为 Android APK 供移动端使用。

## 功能特性

- TOTP 验证码实时计算,支持 SHA1 / SHA256 / SHA512 算法、6 / 8 位位数、自定义周期
- 扫码添加(Web / App 统一 DOM 摄像头,支持手势变焦与图片识别)、手动添加、Google Authenticator 批量迁移(`otpauth-migration` protobuf)
- 分组管理、拖拽排序、全局搜索、批量多选(移动到分组 / 批量删除)
- 本地静态加密:设备级密钥对全部数据 AES-256-GCM 加密,业务层无感知
- 导入导出:`.totp` 备份文件(可选密码加密)、二维码迁移导出(分页)
- App 内更新检测:发现新 Release 提示更新、下载 APK 并调起安装器;非强制更新,可在设置中完全关闭
- 12 种界面语言(简体中文 / English / 日本語 / 한국어 / Deutsch / Français / Italiano / Español / Русский / Português / Nederlands / العربية),中英文为完整基准
- 最小权限原则:Android 仅申请 INTERNET、CAMERA 与更新安装所必需的 REQUEST_INSTALL_PACKAGES

## 环境要求

- Node.js 22+
- Android 构建另需 JDK 21 与 Android SDK(platform 35 / build-tools 35)

## 开发

```bash
npm install
npm run dev        # 本地开发(HTTPS)
npm run lint       # ESLint
npm run typecheck  # vue-tsc
npm run test       # Vitest
```

## 构建

- **Web**: `npm run build` 产出 `dist/`(PWA,仅在非 Capacitor 原生环境注册 Service Worker)
- **Android 调试包**: `npm run android:debug`
- **Android 发布包**: `npm run android:release`;本地签名在 `android/keystore.properties` 配置,缺失时回退 debug 签名,CI 走环境变量注入

## 发布流程

1. 推送 `v*` tag(形如 `v1.2.3`),或在 Actions 页面手动触发 Release 工作流(填写 `commit_hash` 与 `release_tag`)。
2. 工作流执行:前置 lint / typecheck / test → 并行部署 Cloudflare Pages、构建签名 APK → 上传 `mfa-authenticator-v{tag}-web.zip` 与 `mfa-authenticator-v{tag}.apk` 到 Release。
3. 发布说明由 `scripts/release-notes.mjs` 自动生成:总结上一个 Release tag 以来的提交,将 feat / fix 分别归入"功能更新 / 问题修复"两节。
4. tag 同时决定 APK 的 `versionName` / `versionCode`,App 启动时据此检测新 Release 并提示更新(设置中可完全关闭)。
5. 所需 Secrets:`CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`、`KEYSTORE_BASE64`、`KEYSTORE_ALIAS`、`KEYSTORE_PASSWORD`(密钥口令不同时另需 `KEYSTORE_KEY_PASSWORD`)。
6. 更新检测的 Release 仓库地址默认内置,构建时可用环境变量 `VITE_RELEASE_REPO_URL` 覆盖。

## 文档

- 需求说明: [docs/Phase01.md](docs/Phase01.md)
- 任务拆分与验收标准: [docs/](docs/) 目录下的 `Phase01-task*.md`
