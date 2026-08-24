# Task Phase1-05: 新增与编辑密钥

> 依赖: 02/03 | 被依赖: 04 (视图接线)
> 对应 README: 模块 3 要求 1/2/3/4/5

## 目标
实现扫码添加与手动添加两条新增路径、保存前 TOTP 预览、编辑表单,以及 Web/App 双端扫码能力。

## 具体工作
1. otpauth URI 解析 `src/services/otpauth-uri.ts`:
   - 解析 `otpauth://totp/Issuer:label?secret=...&issuer=...&algorithm=...&digits=...&period=...`
   - 容错: label 缺省、issuer 参数与路径 issuer 冲突时优先参数、未知参数忽略
   - issuer 回退 (2026-08-24): 无 issuer 参数且账号名不含 `Issuer:` 前缀时,整个账号名作为 issuer (label 清空),与 GA"仅有名称就只显示名称"的行为一致
2. 手动添加表单:
   - issuer 必填 / label 可留空 / secret 必填
   - secret 粘贴自动去空格转大写,实时 Base32 校验与提示
   - 高级选项默认折叠: algorithm (SHA1) / digits (6) / period (30)
3. 保存前预览: 试算当前 TOTP 展示,用户确认后才写入存储
4. 编辑: 复用新增表单,secret 字段只读禁用;保存前同样预览试算
5. Web 扫码: `html5-qrcode`,`navigator.mediaDevices`,HTTPS 与权限异常处理与文案
6. App 扫码: `@capacitor-mlkit/barcode-scanning`
- 自绘取景框 UI (Vue 透明覆盖层),手电筒开关
    - Android 动态权限申请流程与拒权引导文案
    - 扫描结果回传统一进入 URI/GA-migration 解析入口 (解析实现见 06)
    - 取景框位置上移 (`translateY(-4.5vh)`),避免过于靠下
    - 隐藏 html5-qrcode 自带遮罩层,仅保留自定义取景框,消除双层覆盖
    - 视频 `:deep(video)` 全屏拉伸 (`object-fit: cover`),填满整个扫码区域
    - 双指捏合变焦: `touch-action: none` 阻止页面缩放,对 `<video>` 做 CSS `scale()` 变换,图片放大而 UI 保持不变(1–5 倍)
7. 全帧高分辨率解码 (v2 重构):
    - 自建 `getUserMedia` 高分辨率视频流(1920×1080 ideal),替代 html5-qrcode 相机循环
    - 快速档(≤640px)保证常规二维码响应速度,深度档(≤1920px,每 4 帧)覆盖大型/高密度二维码
    - 图片导入多级降采样:首次按原图分辨率解码,失败后自动降采样(2048→1400→1024→720→512)重试

## 验收标准
- [x] 合法 otpauth URI 各参数解析正确,非法 URI 提示"不支持的二维码内容"
- [x] secret 实时校验: 非法字符/长度红字提示且禁止提交
- [x] 保存前预览码与 otpauth 官方测试向量一致
- [x] 编辑时 secret 不可修改,其余字段可改
- [x] Web 端在无摄像头/拒绝授权场景有明确文案
- [x] App 端权限申请、拒绝、扫码取消流程完整
- [x] Vitest 覆盖: URI 解析正常与容错分支
- [x] 取景框位置适度上移,不再过于靠下,与解码区域保持对齐
- [x] 双指捏合时页面不再整体缩放,改为摄像头画面放大,UI 元素保持原位
- [x] 全帧高分辨率解码: 大型/高密度二维码可通过摄像头识别,图片导入亦可成功解析
- [x] 图片导入多级降采样: 大分辨率图片失效后自动降采样重试
- [x] issuer 回退: 无 issuer 的裸名称 URI 导入后按名称作为服务名展示,不再显示"未知服务" (2026-08-24)

## 状态: 已完成 (2026-08-06,扫码解码优化 2026-08-11,issuer 回退优化 2026-08-24)
