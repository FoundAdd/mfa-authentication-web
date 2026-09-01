# Task Phase1-01: 项目脚手架与基础设施

> 依赖: 无 | 被依赖: 所有其他任务
> 对应 docs/Phase01.md: §2 技术栈、模块 1 要求 1/7

## 目标
初始化 Vite + Vue 3 + TypeScript 项目骨架,接通全部基础依赖与工程配置。

## 具体工作
1. `npm create vite@latest` 初始化 vue-ts 模板
2. 依赖安装:
   - `element-plus`, `pinia`, `vue-i18n`, `localforage`, `otpauth`
   - `vuedraggable`, `@vueuse/core`
   - `vite-plugin-pwa`
   - dev: `eslint`, `prettier`, `eslint-plugin-vue`, `@typescript-eslint/eslint-plugin`, `@typescript-eslint/parser`, `vitest`
3. `vite.config.ts`:
   - `base: './'` (Capacitor WebView file 协议必须)
   - `vite-plugin-pwa`: generateSW,precache 全部静态资源,`skipWaiting: true`,`clientsClaim: true`
4. i18n 配置:
   - 首启按 `navigator.language` 选择(`zh-*` → 简体中文,其余 → English)
   - 手动选择持久化到 localforage,提供"跟随系统"选项
   - `src/locales/zh-CN.ts` 与 `src/locales/en.ts`
5. ESLint (flat config) + Prettier 配置
6. Pinia store 骨架 (`useTotpStore`, `useSettingStore`)
7. PWA 图标: 192/512 两档占位 PNG
8. `package.json` scripts: `dev` / `build` / `typecheck` (vue-tsc) / `lint` / `test`
9. SW 注册封装: 仅在 `Capacitor.isNativePlatform()` 为 false 时注册 (此判断做成可 stub 的工具函数,Capacitor 未安装时返回 false)
10. Gradle 构建加速:
    - 启用并行模块编译(`org.gradle.parallel`)
    - 启用构建缓存(`org.gradle.caching`)与按需配置(`org.gradle.configureondemand`)
    - 提升 JVM 堆至 4GB(`-Xmx4096m`)

## 验收标准
- [x] `npm run dev` 启动无报错,页面渲染占位内容
- [x] `npm run build` 成功,dist 产出含 PWA manifest 与 SW
- [x] `npm run typecheck` / `npm run lint` / `npm run test` 可执行并通过
- [x] 手动切换浏览器语言后刷新,界面语言随 navigator.language 变化
- [x] 手动选择语言后刷新,保持用户选择
- [x] Gradle 并行与缓存加速构建,缩短 Android 打包时间

## 状态: 已完成 (2026-08-05,Gradle 构建加速 2026-08-11)
