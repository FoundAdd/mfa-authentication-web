# Task Phase1-09: 测试与质量保障

> 依赖: 02/03/06 (被测代码) | 与 08 联动 (CI 接线)
> 对应 README: §5 安全与规范约定、模块 6 要求 3

## 目标
搭建 Vitest 测试体系,覆盖全部核心纯逻辑,接线 lint/typecheck 到 CI。

## 具体工作
1. Vitest 配置 (environment: node,纯逻辑测试无需 DOM)
2. 测试用例清单:
   - `totp`: RFC 6238 测试向量 (SHA1/SHA256/SHA512 × 6/8 位 × 30/60s),format 分组输出
   - `otpauth-uri`: 标准解析、label 缺省、issuer 冲突优先级、非法 URI
   - `storage-crypto`: 设备密钥加解密往返、非法密文报错
   - `file-crypto`: PBKDF2+GCM 信件加解密往返、错误密码报错、v1 信封字段校验
   - `merge`: 指纹去重 (secret 空格/大小写变体视为相同)、同名分组并入、覆盖替换
   - `ga-migration`: 官方格式 fixture (多条目、混合算法/位数)、非法 base64/protobuf 报错
3. CI 接线: 08 的前置步骤已在 08 定义,此处确保 `npm run test` 本地与 CI 行为一致
4. ESLint flat config 与 vue-ts 规则验证,修复全部存量告警
5. `vue-tsc --noEmit` 全量类型检查通过

## 验收标准
- [ ] `npm run test` 全部用例通过,覆盖率报告中 services/ 目录 > 90%
- [ ] 故意改错一处 TOTP 逻辑可被测试捕获
- [ ] `npm run lint` 与 `npm run typecheck` 在干净代码上零错误零警告
- [ ] CI workflow 中三个检查步骤顺序正确、失败即终止
