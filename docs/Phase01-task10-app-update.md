# Task Phase1-10: App 内更新检测

> 依赖: 07 (Capacitor 原生壳) / 08 (Release 产物 APK 与 tag 版本注入)
> 需求来源: 2026-09-01 追加,不属于 docs/Phase01.md 原始模块范围

## 目标
App 检测 Git 仓库是否存在新的 Release;发现新版本时提示用户,确认更新后下载该 Release 的 APK 并调起系统安装器完成升级。更新为**非强制更新**(可暂缓、可跳过该版本),且用户可在设置中**完全关闭更新检测**。

## 具体工作
1. 检测服务 `src/services/appUpdate.ts`:
   - 由 Release 仓库页面地址推导 releases 列表 API,GitHub(`api.github.com`)与自建 Gitea(`/api/v1`)双兼容,仅接受 https 下载地址(防 APK 明文劫持);
   - releases 列表取第一个非 draft/prerelease 的稳定版,大小写不敏感匹配 `.apk` 资产;
   - 安装包 versionName 与最新 tag 做语义化版本比较判定新版(容忍 `v` 前缀、缺省段、预发布后缀,`1.0` 等价 `1.0.0`,`1.0.0-beta` < `1.0.0`)。
2. 下载与安装:
   - `@capacitor/filesystem` 的 `downloadFile` 下载 APK 到应用缓存目录,`progress` 事件驱动进度条;文件名由 tag 派生并过滤非法字符;
   - 新增原生插件 `AppUpdateInstaller.java`: 校验路径(防目录穿越)后经 FileProvider 调起系统安装器;Android 8+ 未授予"安装未知应用"权限时返回 `permission_required` 并跳转系统设置引导,授权后重试;`MainActivity` 注册该插件;
   - `AndroidManifest.xml` 新增 `REQUEST_INSTALL_PACKAGES` 权限(调起安装器所必需)。
3. UI 与状态:
   - `src/stores/appUpdate.ts`: 弹窗状态机 idle / downloading / ready / permission / error;
   - `UpdateDialog.vue`: 展示当前版本与发布说明、下载进度,提供"立即更新 / 暂不更新 / 跳过此版本"按钮,失败可重试;
   - 启动延迟 3s 自动检测(仅原生环境且开关开启时执行),失败静默不打扰;"跳过此版本"记录忽略 tag,该版本不再提醒、下一新版恢复提醒;
   - 设置弹窗新增"版本更新"区块(仅原生环境显示):"自动检查更新"开关默认开启、localforage 持久化,**完全关闭后不发起任何版本检查请求**,手动"检查更新"按钮同时禁用;另展示当前版本号。
4. CI 联动(`release.yml` / `android/app/build.gradle`):
   - 构建时注入 `VITE_RELEASE_REPO_URL`(`github.server_url` + `github.repository`)作为检测基准,可用环境变量覆盖;
   - tag `vX.Y.Z` 推导 `APP_VERSION_NAME` / `APP_VERSION_CODE` 注入 gradle,保证安装包 versionName 与 Release tag 一致(更新检测的对比基准)。
5. i18n: 12 种语言补齐 `update.*` 文案;en 与 zh-CN 为完整基准,键结构与占位符由 `src/locales/locales.test.ts` 守护。

## 验收标准
- [x] 检测到新 Release 且附带 APK 时弹窗提示,展示版本对比与发布说明
- [x] 点击更新后下载 APK(带进度条)并调起系统安装器,下载失败可重试
- [x] 更新非强制:可"暂不更新"或"跳过此版本",任何情况下不阻断正常使用
- [x] 设置中可完全关闭更新检测,关闭后 App 不发起任何版本检查请求
- [x] 语义化版本比较、API 端点推导、稳定版挑选、更新判定等 18 项单元测试通过;lint / typecheck / test / build 全绿

## 状态: 已完成 (2026-09-01)

> 说明: 原生插件编译与安装链路需在下次真实发版后线上复核;`versionName` 自 tag 注入自下一个 tag 发版起生效。
