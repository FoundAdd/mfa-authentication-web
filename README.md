# TOTP 密钥管理器 (MFA Authenticator) 项目开发说明文档
## 1. 项目概述
本项目旨在开发一个基于 Vite + Vue 3 的多平台响应式 TOTP(基于时间的一次性密码)密钥管理工具。项目采用"本地优先"架构,完全离线可用。**Phase 1 为纯本地版本**,不包含任何云端功能;加密云同步作为 Phase 2 迭代开发。前端打包为 Web 应用部署于 Cloudflare Pages,同时通过 Capacitor 打包为 Android APK 供移动端使用。

## 2. 技术栈选型
*   **前端框架**: Vite 7 + Vue 3 (Composition API) + TypeScript
*   **UI 组件库**: Element Plus (需做移动端响应式适配)
*   **状态管理**: Pinia
*   **国际化**: Vue I18n (首版中/英文)
*   **本地存储**: `localforage` (基于 IndexedDB)
*   **TOTP 核心**: `otpauth` (库)
*   **加解密**: 浏览器原生 Web Crypto (`crypto.subtle`,PBKDF2-SHA256 + AES-256-GCM),**不引入 crypto-js**
*   **二维码**:
    *   生成: 不涉及 (Phase 1 不生成二维码)
    *   Web 扫码: `html5-qrcode`
    *   App 扫码: `@capacitor-mlkit/barcode-scanning` (原 README 中的 `@capacitor-community/barcode-scanner` 已归档停止维护,废弃)
*   **拖拽排序**: `vuedraggable`
*   **App 分享导出**: `@capacitor/share` (零额外存储权限)
*   **移动端打包**: Capacitor 7 (minSdk 26 / targetSdk 35)
*   **后端服务**: Phase 2 规划 (Cloudflare Workers + Hono + D1),Phase 1 不实现
*   **CI/CD**: GitHub Actions (基于 Tag 触发)
*   **代码质量**: ESLint + Prettier + Vitest

## 3. 数据结构与模型定义
### 3.1 本地存储数据结构 (TotpItem & TotpGroup)
使用 `localforage` 存储一个包含所有分组和密钥的数组对象,Key 为 `totp_data`。整个数组在写入前由设备级密钥整体 AES-256-GCM 加密,读出后解密,业务层无感知(详见 5.1)。

```typescript
interface TotpItem {
  id: string;           // UUID
  issuer: string;       // 服务名称 (如 Google, GitHub)
  label: string;        // 用户标识 (如 email 或 username,允许留空)
  secret: string;       // Base32 密钥
  algorithm: 'SHA1' | 'SHA256' | 'SHA512'; // 默认 SHA1
  digits: number;       // 默认 6
  period: number;       // 默认 30
}
interface TotpGroup {
  id: string;
  name: string;         // 分组名称
  isExpanded: boolean;  // UI 展开状态,仅本地 UI 状态,不参与导入导出
  items: TotpItem[];
}
// 不属于任何分组的条目保存在独立的"未分组"集合中:
interface TotpData {
  groups: TotpGroup[];
  ungrouped: TotpItem[]; // 列表顶部"未分组"区域展示,虚拟分组,导出时不写入分组结构
}
```
**说明**:
- 数据模型不存储任何图标字段,图标由 UI 层的 issuer 首字母占位符呈现(背景色由 issuer 哈希决定),不加载任何外部 favicon 服务。
- 新增条目追加到所在分组(或"未分组")末尾;组内条目排序与分组排序通过拖拽调整(见 5.3)。

### 3.2 导出文件格式规范 (v1)
统一 JSON 信封格式,文件后缀 `.totp`,文件名 `totp-backup-YYYYMMDD-HHmm.totp`:
```jsonc
// 加密导出 (密码选填,默认不加密;勾选加密时密码需输入两次确认)
{ "v": 1, "encrypted": true, "salt": "<32字节hex>", "iter": 250000, "ct": "<base64密文>" }
// 不加密导出 (base64 仅为编码,非加密)
{ "v": 1, "encrypted": false, "data": "<TotpData JSON 的 base64 编码>" }
```
*   密钥派生: PBKDF2-SHA256,250000 轮随机 salt,派生 AES-256-GCM 密钥
*   解密失败(GCM 认证标签校验不过)统一提示"密码错误或文件损坏",不做其他尝试
*   选择不加密导出时弹窗一次性提示"导出文件将包含明文密钥,请妥善保管",点击确认后继续

### 3.3 云同步数据结构 (Phase 2 预留,Phase 1 不实现)
Phase 2 采用 account + password 用户模型:
*   `user_credi = hash(account 拼接 password 拼接 ACCESS_PASSWORD)`,ACCESS_PASSWORD 为 Worker 环境变量
*   登录: `SELECT COUNT(1) FROM user_data WHERE user_credi = ?` 判断成功
*   双 JWT: access_token 7 天 + refresh_token 60 天
*   D1 表预留设计:
```sql
CREATE TABLE IF NOT EXISTS user_data (
  user_credi TEXT NOT NULL,
  device_id TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_credi, device_id)
);
```
*   前端将整个 TotpData 转为 JSON 字符串,使用用户输入的密码 AES 加密后作为 ciphertext 上传

## 4. 模块化任务拆分 (Agent 执行指南)
以下任务的详细验收标准见 `tasks/task-Phase1-*.md`。
### 模块 1: 前端骨架与 UI 响应式 (适合 UI Agent)
**任务目标**: 搭建基础项目,实现类 Google Authenticator 的极简风格界面及多端响应式适配。
**具体要求**:
1.  初始化 Vite + Vue3 + TS 项目,集成 Element Plus 和 Vue I18n (中英文)。Vite `base: './'`(Capacitor WebView 必须)。
2.  **响应式布局适配**: Element Plus 偏桌面端。移动端需将 `el-dialog` 替换为底部抽屉 `el-drawer` (direction="btt")。使用 Flexbox 布局,少用 `el-row`/`el-col`。可借助 VueUse 的 `useBreakpoints` 动态调整 UI。
3.  **极简 UI 设计**:
    *   列表式布局,去除多余边框和卡片阴影。
    *   左侧显示 issuer 首字母占位符(背景色由 issuer 字符串哈希生成,同一服务颜色稳定)。**不加载任何外部图标服务**(原 Google favicons 方案已废弃)。
    *   右侧大字号显示验证码,6 位显示为 `123 456`(3+3 分组),8 位按 4+4 分组,随 digits 自适应;点击数字一键复制(`navigator.clipboard.writeText`),复制内容为**纯数字**,toast 提示,**不自动清除剪贴板**。
    *   底部显示倒计时进度条(`el-progress` 判断剩余秒数,最后 5 秒变红)。
4.  实现分组管理 UI:可折叠的分组列表;组内条目排序与分组排序使用 `vuedraggable` 拖拽;**不做条目跨分组拖动**("未分组"条目置顶展示);新增条目追加末尾。空分组点击展开无反应(不渲染占位容器)。
5.  实现全局搜索过滤:匹配 issuer / label / 分组名,大小写不敏感子串匹配;命中的分组临时展开,清空搜索恢复原展开状态;无结果显示空态文案(中英文)。
6.  首次启动无任何数据时显示引导视图:三个大按钮"扫码添加 / 手动添加 / 从文件导入",附简介文案(中英文)。
7.  i18n:首启按 `navigator.language` 自动选择(`zh-*` → 简体中文,其余 → English);设置页可手动切换并持久化,提供"跟随系统"选项。Phase 1 设置页仅含语言切换。
### 模块 2: 核心逻辑与本地存储 (适合 Logic Agent)
**任务目标**: 实现 TOTP 实时计算、本地数据持久化、本地静态加密及文件导入导出。
**具体要求**:
1.  **TOTP 计算**: 引入 `otpauth`。创建全局 `setInterval` 每秒更新,计算所有密钥的验证码。公式基于 `new Date().getTime() / 1000`。
2.  **本地 CRUD**: 使用 `localforage` 封装本地数据库操作层,实现分组和密钥的增删改查(含批量操作:移动到分组、批量删除)。
3.  **本地静态加密 (方案乙)**: 设备级 256 位随机密钥(base64)存 localStorage(key `_dk`);写入前对整个 TotpData JSON 做 AES-256-GCM 加密,读出解密,存储层透明处理。检测到数据存在但设备密钥缺失时提示数据损坏并提供"清空并重置"入口。密钥不导入导出。首次创建数据后弹出一次性提示"本应用数据仅存于本设备,请定期使用导出功能备份"(中英文)。
4.  **导入导出**:
    *   导出: TotpData → JSON → (可选)用户密码加密 → Blob 下载;移动端使用 `@capacitor/share` 调起系统分享面板保存(零存储权限)。导出密码**选填,默认不加密**;加密导出需输入两次一致才执行;明文导出一次性风险提示。
    *   导入: 读取文件 → 解析信封 → (加密时要求输密码)解密 → 校验格式 → 选择"合并"或"覆盖"(默认合并)。合并去重规则:以 `secret`(去空格转大写)+ `issuer`(trim 转小写)规范化组合作为唯一键,重复项跳过,仅新增;导入条目分组名与本地同名分组则并入,否则进入"未分组"。覆盖模式需二次确认并显示"现有 N 条密钥将被替换"。不支持批量导出勾选条目。
5.  **PWA**: 配置 `vite-plugin-pwa`(generateSW,precache 全部静态资源,skipWaiting + clientsClaim);**仅在非 Capacitor 原生环境注册 Service Worker**(`Capacitor.isNativePlatform()` 判断);提供 192/512 两档 PNG 图标。App 壳内不生成 manifest 安装提示。
6.  **离线可用**: 静态资源全量缓存,核心计算离线可用。
### 模块 3: 扫码导入功能 (适合 Hybrid Agent)
**任务目标**: 实现通过扫描二维码导入密钥。
**具体要求**:
1.  解析标准 OTP URI: `otpauth://totp/Issuer:label?secret=XXX&issuer=Issuer`。
2.  **手动输入添加**: 与扫码并列的新增入口。表单:issuer(必填)、label(可留空)、secret(必填,粘贴自动去空格转大写,实时 Base32 合法性校验);高级选项默认折叠(algorithm 默认 SHA1、digits 默认 6、period 默认 30)。保存前**试算一次当前 TOTP 展示预览**;扫码结果解析出的参数同样允许在保存前编辑修正。
3.  **编辑条目**: 除 secret 外所有字段可编辑(secret 只读);保存前同样试算 TOTP 预览。
4.  **Web 端扫码**: 使用 `html5-qrcode` 调用 `navigator.mediaDevices`。注意浏览器需 HTTPS 环境且需用户授权摄像头。
5.  **App 端扫码**: 集成 `@capacitor-mlkit/barcode-scanning`,调用原生相机扫码,自绘取景框 UI(Vue 透明覆盖层)+ 手电筒支持。处理 Android 动态权限申请逻辑。
    *   **取景框位置**: 自定义取景框通过 `translateY(-4.5vh)` 适度上移,避免位置过靠下;隐藏 html5-qrcode 自带遮罩层以消除双层取景框,并使用 `:deep(video)` 将摄像头画面全屏拉伸 (`object-fit: cover`) 填满扫码区域。
    *   **手势变焦 (类微信)**: 扫码区域设置 `touch-action: none` 阻止浏览器整页缩放与双指手势;双指捏合时对 `<video>` 元素做 CSS `scale()` 变换实现画面放大(1–5 倍,以捏合中心为缩放原点),TopBar、取景框、按钮等 UI 保持原位不入镜。同时将解码区域 `qrbox` 放大至 `0.9 × min(width,height)`(上限 420px),确保取景框上移后仍完整落在解码区域内。
6.  **批量导入 (Google Authenticator 迁移)**: 解析 `otpauth-migration://offline?...` protobuf 格式,解析出多条目后进入**预览选择页**(列表勾选),确认后按模块 2 的合并规则导入;无法识别的格式提示"不支持的二维码内容"。Microsoft Authenticator 无公开批量导出格式,其迁移走标准单条 `otpauth://` 扫码(已覆盖),README/帮助文案注明。
7.  **删除确认交互**: 单删需二次确认弹窗(显示 issuer + label);删除分组弹窗含勾选框"同时删除分组内条目",默认未勾选,未勾选时条目移入"未分组",勾选时连同删除。批量选择模式:长按条目进入多选,顶部"已选 N 项"与操作栏(移动到分组/删除/取消)。
### 模块 4: Cloudflare Workers 后端 (Phase 2,本次不开发)
见 3.3 预留设计。Phase 1 不创建 Worker、D1、同步接口与同步 UI。
### 模块 5: Capacitor 集成与移动端打包 (适合 Mobile Agent)
**任务目标**: 将 Web 项目封装为 Android APK,并遵循最小权限原则。
**具体要求**:
1.  安装 Capacitor 7 依赖: `@capacitor/core`, `@capacitor/cli`, `@capacitor/android`。
2.  初始化 Android 项目: `npx cap init`(包名 `cn.hy.mfaauthenticator`,应用名 `MFA Authenticator`) -> `npx cap add android`。
3.  **AndroidManifest.xml 权限裁剪**: 仅保留以下权限:
    ```xml
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.CAMERA" />
    ```
4.  minSdk 26 (Android 8.0) / targetSdk 35 (Android 15)。
5.  配置 Gradle 构建参数,支持后续的 Release 签名。
6.  应用图标与启动图使用基础占位文件,后续由用户自行替换。
### 模块 6: CI/CD 自动化构建 (适合 DevOps Agent)
**任务目标**: 基于 GitHub Tag 触发自动部署 Web 和打包 APK。
**具体要求**:
1.  编写 `.github/workflows/release.yml`。
2.  **触发条件**: `on: push: tags: - 'v*'`。
3.  构建前置步骤: `npm install` -> `npm run lint` -> `npm run typecheck` -> `npm run test`,任一失败即终止。
4.  **Web 部署 Job**:
    *   Checkout 代码 -> Setup Node 22 -> 构建前置步骤 -> `npm run build`。
    *   使用 `cloudflare/wrangler-action@v3` 将 `dist` 目录部署到 Cloudflare Pages;`CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` 走 GitHub Secrets。
    *   将 `dist` 打包为 `mfa-authenticator-v{tag}-web.zip` 上传到 GitHub Release Assets。
5.  **APK 打包 Job**:
    *   Checkout 代码 -> Setup Node 22 -> Setup Java JDK 17。
    *   `npm install` -> `npm run build` -> `npx cap sync android`。
    *   从 GitHub Secrets 读取 Android Keystore (`BASE64_KEYSTORE`)、别名 (`KEYSTORE_ALIAS`)、密码 (`KEYSTORE_PASSWORD`)。
    *   将 Keystore 解密到指定路径,配置 `android/app/build.gradle` 动态读取签名信息。
    *   执行 `cd android && ./gradlew assembleRelease`。
    *   将生成的产物重命名为 `mfa-authenticator-v{tag}.apk` 上传到 GitHub Release Assets。

## 5. 安全与规范约定
*   所有敏感数据(如 Base32 Secret)绝不上传云端(Phase 1 无云端)。
*   本地存储采用设备级密钥 AES-256-GCM 静态加密,密钥存 localStorage,不可恢复即意味着清除应用数据会丢失数据,需通过导出备份缓解(见模块 2 第 3 条)。
*   不使用弱 KDF(禁止 crypto-js evp_kdf 类方案),一律 Web Crypto PBKDF2-SHA256 250000 轮。
*   App 遵循"最小权限原则",绝不申请不必要的系统权限。
*   遵循 ESLint + Prettier 规范,提交前通过 `npm run lint` 与 `npm run typecheck`。

## 6. 后续迭代 (Phase 2+) 预留清单
1.  云同步:account + password 模型,`user_credi` 哈希 + 双 JWT(7 天 access / 60 天 refresh),见 3.3。
2.  App 锁:PIN / 生物识别解锁界面(需引入原生 biometric 插件)。
3.  批量导出勾选条目(按需在导入导出信封 v2 中扩展)。
4.  P1 批量二维码格式扩展(Aegis、2FAS 等多行 otpauth 导出)。
5.  自动化 E2E 测试(Playwright)。
