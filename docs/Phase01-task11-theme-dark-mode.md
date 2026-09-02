# Task Phase1-11: 白天/黑夜主题适配

> 依赖: 04 (列表 UI) / 07 (Capacitor 原生壳)
> 需求来源: 2026-09-02 追加,不属于 docs/Phase01.md 原始模块范围

## 目标
当前样式仅支持单一浅色主题(110 处硬编码颜色、无 CSS 变量)。本次改造后应用同时适配白天/黑夜两套主题,**默认跟随系统外观实时切换**,用户也可在设置中手动指定浅色或深色;切换立即生效、启动无闪色,原生状态栏图标与 Web 主题保持一致。

## 具体工作
1. 语义变量表 `src/styles/theme.css`:
   - Element Plus 启用官方暗色方案(`element-plus/theme-chalk/dark/css-vars.css`),`html.dark` 下全部 `--el-*` 变量自动翻转;
   - EP 未覆盖的应用级表面色沉淀为 `--app-*` 变量(页面背景、顶栏半透明、卡片/底栏阴影、警示文字色),浅色基准值与原设计逐像素一致;
   - 业务样式中 110 处硬编码颜色全部替换为语义变量(15 个文件,机械映射:EP 调色板值 → 对应 `--el-*` 语义变量);
   - 例外白名单:`ScanView.vue` 相机页恒为深色 UI 不随主题;`AvatarIcon.vue` 与二维码为身份/品牌色保持固定;`CountdownBar.vue` 的 success/danger 色两主题通用。
2. 主题状态 `src/stores/settings.ts`:
   - 三态偏好 `follow-system | light | dark`(与语言偏好同模型),localforage 持久化,非法值回退 `follow-system`;
   - `matchMedia('(prefers-color-scheme: dark)')` 监听系统变化,`follow-system` 下实时响应;
   - 解析结果写穿 localStorage 镜像 `app-theme`,并同步 `theme-color` meta 与原生状态栏。
3. 启动防闪色 `index.html`:
   - 内联脚本在首帧前同步读镜像设置 `html.dark`,无镜像时回退系统 `prefers-color-scheme`;localforage 异步读取不再造成启动闪色。
4. 原生联动:
   - 新增 `@capacitor/status-bar` 插件,主题变化时同步状态栏图标样式(`src/services/themeNative.ts`,失败静默);
   - `values-night/styles.xml` 覆盖 `windowLightStatusBar=false`,修正启动瞬间深色系统下状态栏图标;
   - 状态栏背景保持透明,由 WebView 页面背景透出;splash 启动图为已知限制,保持现状。
5. 设置 UI 与静态资源:
   - `SettingsDialog.vue` 语言下方新增「主题」三态选择器(复用语言选择器交互);
   - 12 种语言补齐 `settings.theme / themeLight / themeDark` 文案(键结构由 locales.test.ts 守护);
   - `vite.config.ts` PWA manifest `theme_color/background_color` 由旧值 `#1a1a2e` 修正为浅色基准 `#f5f5f5`。

## 验收标准
- [x] 默认跟随系统:系统深色时应用即时切深色,系统切换实时响应
- [x] 手动指定浅色/深色立即生效,持久化后重启保持;刷新无闪色(localStorage 镜像首帧前应用)
- [x] 首页/设置弹窗/添加页等核心界面两套主题下均正常渲染,无硬编码色残留(白名单除外)
- [x] 主题 store 单测 6 项通过(三态切换、系统跟随、手动覆盖、持久化恢复、非法值回退)
- [x] lint / test 无回归(遗留:master 上已存在的 HomeView 拖拽排序 4 项过期测试失败与 `rowTags` typecheck 错误,属 task07 后重构遗留,与本任务无关)

## 状态: 已完成 (2026-09-02)

> 说明: splash 启动图未做深色适配(需复制整套位图资源,收益低);原生状态栏实际效果需在真机 APK 上复核。
