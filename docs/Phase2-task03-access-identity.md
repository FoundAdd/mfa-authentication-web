# Task Phase2-03: Cloudflare Access OIDC 与用户身份映射

> 依赖: 01/02 | 被依赖: 04/05/06/11/12
> 对应 docs/Phase2.md: §2、§4.1、§4.4、§12

## 目标

使用 Cloudflare Access OIDC 作为唯一用户认证来源,验证 Access JWT,按 `(issuer, sub)` 自动 provision 用户,并拒绝 service token 或缺少稳定身份声明的 token。

## 具体工作

1. 配置 Access OIDC:
   - Staging 与 Production 使用独立 Access application。
   - 配置可信邮箱 OTP/IdP、allow policy 和必要的 admin group。
   - 记录 `TEAM_DOMAIN`、`ACCESS_AUD`、JWKS URL 和回调地址。
2. 实现 JWT 验证:
   - 使用 `jose` 验证签名、`iss`、`aud`、`exp`、`nbf`。
   - JWKS 远程验证结果缓存,缓存失败时有安全默认。
   - 缺少非空 `sub`、`issuer` 或 `email` 时拒绝。
3. 用户自动 provision:
   - 按 `(provider='cloudflare-access', issuer, subject)` 查询 `auth_identities`。
   - 新身份创建 Snowflake `users.id`、身份映射和 revision=1 的空加密 vault。
   - 同邮箱但不同 `sub` 不得自动合并,除非未来有明确账户关联流程。
   - 登录成功更新 `auth_identities.email`、`email_normalized` 和 `last_seen_at`。
4. 权限:
   - 用户 API 拒绝 Cloudflare Access service token、空 `sub` token 和机器 token。
   - 管理员接口检查配置的 Access Group/claim,与普通用户路由隔离。
5. 日志:
   - 只记录 `user_id`、`email_ref` 和 `email_masked`。
   - 不记录完整邮箱、JWT、Cookie、JWKS 响应或 Authorization header。

## 验收标准

- [ ] Staging Access 登录可返回有效 JWT 并完成用户自动创建
- [ ] 同一 `(issuer, sub)` 重复登录始终映射同一内部 `users.id`
- [ ] 邮箱变化不会创建新用户,也不会覆盖身份主键
- [ ] service token、空 `sub`、错误 audience、过期和签名错误 token 均被拒绝
- [ ] 管理员 claim 普通用户无法伪造,Access Policy 变更可阻止后续登录
- [ ] 单元测试覆盖验证、provision、claim、拒绝和日志脱敏;typecheck/lint 通过

## 状态: 待开始
