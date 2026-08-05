# Task Phase1-07: Capacitor Android 集成

> 依赖: 01 (可提前初始化) / 05 (扫码接线)
> 对应 README: 模块 5 全部

## 目标
完成 Android 工程初始化、权限裁剪、插件集成与本地真机跑通。

## 具体工作
1. 安装 `@capacitor/core` `@capacitor/cli` `@capacitor/android` (Capacitor 7)
2. `npx cap init`: appId `cn.hy.mfaauthenticator`,appName `MFA Authenticator`,webDir `dist`
3. `npx cap add android`;配置 `minSdkVersion 26` / `targetSdkVersion 35`
4. AndroidManifest.xml 权限裁剪,仅保留:
   ```xml
   <uses-permission android:name="android.permission.INTERNET" />
   <uses-permission android:name="android.permission.CAMERA" />
   ```
5. 插件集成: `@capacitor-mlkit/barcode-scanning` (权限声明由插件合并,CAMERA 已在 manifest)
6. `@capacitor/share` 集成 (导出面板调用,见 06)
7. SW 注册禁用验证: app 内不注册 Service Worker (模块 2 的 isNativePlatform 判断生效)
8. Gradle release 签名配置骨架 (keystore 路径/别名/密码从 CI 注入,本地可用 debug 签名)
9. 应用图标与启动图: 使用 Capacitor 默认占位文件,不做自定义设计

## 验收标准
- [ ] `npm run build && npx cap sync android` 成功
- [ ] Android Studio / gradlew assembleDebug 构建通过
- [ ] 真机或模拟器安装后:应用启动、TOTP 计算、拖拽、导入导出 (share 面板) 正常
- [ ] 扫码权限申请与扫码流程正常
- [ ] manifest 合并后无多余权限 (`adb shell dumpsys package cn.hy.mfaauthenticator | grep permission` 核查)
- [ ] app 内无 Service Worker 注册痕迹
