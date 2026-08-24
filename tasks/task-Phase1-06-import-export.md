# Task Phase1-06: 导入导出与批量迁移

> 依赖: 02 | 被依赖: 05 (扫码结果汇入)
> 对应 README: §3.2、模块 2 要求 4、模块 3 要求 6

## 目标
实现导出信封 v1 两种模式、文件导入合并/覆盖、Google Authenticator 批量迁移解析。

## 具体工作
1. 加密服务 `src/services/crypto.ts` (Web Crypto):
   - `pbkdf2Key(password, salt, iter=250000)` → AES-256-GCM key
   - `encryptJson(data, password)` / `decryptJson(envelope, password)`
   - 解密失败抛统一错误,UI 提示"密码错误或文件损坏"
2. 导出:
   - 信封 v1: `{v:1,encrypted:true,salt,iter:250000,ct}` / `{v:1,encrypted:false,data(base64)}`
   - 导出对话框: 密码选填默认不加密;加密需两次一致;明文一次性风险提示
   - Web: Blob 下载,文件名 `totp-backup-YYYYMMDD-HHmm.totp`
   - App: `@capacitor/share` 分享面板,零存储权限
3. 导入:
   - 文件选择 → 信封解析 → 加密时要求输密码 → 格式校验 → 模式选择 (默认合并)
   - 合并: `secret`(去空格转大写)+`issuer`(trim 转小写) 指纹去重,重复跳过仅新增;同名分组并入,否则进"未分组"
   - 覆盖: 二次确认显示"现有 N 条密钥将被替换"
   - `isExpanded` 不参与导入导出 (导入时默认折叠)
4. Google Authenticator 迁移解析 `src/services/ga-migration.ts`:
   - 解析 `otpauth-migration://offline?data=<base64 protobuf>`
   - 支持 protobuf 手工解码 (fields: secret/type/algorithm/idigits/profile_issuer/profile_name),不引入额外 protobuf 库
   - issuer 回退 (2026-08-24): 条目缺失 issuer 时,`name` 含 `Issuer:Label` 前缀则拆分为 issuer+label,纯名称直接作为服务名展示 (GA 中重命名过的条目导出时仅含 name)
5. 批量预览选择页: 解析结果列表可勾选 → 确认 → 走合并规则导入
6. 无法识别内容统一提示"不支持的二维码内容"

## 验收标准
- [x] 加密信封导出→导入往返一致 (含中文条目)
- [x] 错误密码提示"密码错误或文件损坏",不崩溃
- [x] 明文信封导出→导入往返一致
- [x] 合并时重复指纹条目被跳过且不影响已有条目
- [x] 覆盖模式二次确认与替换行为正确
- [x] GA 官方 App 导出的 fixture (至少含 3 条目、含 SHA1/SHA256、6/8 位) 解析正确
- [x] Vitest 覆盖: 信封加解密往返、合并去重、GA protobuf 解析、非法格式分支
- [x] GA 重命名条目 (仅 name 无 issuer) 导入后按名称作为服务名展示,含 `Issuer:Label` 格式的 name 正确拆分 (2026-08-24)

## 状态: 已完成 (2026-08-06,issuer 回退优化 2026-08-24)
