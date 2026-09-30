# Task Phase2-04: Web BFF、Android PKCE 与双模式认证

> 依赖: 03 | 被依赖: 06/09/11/12
> 对应 docs/Phase2.md: §4.2、§4.3、§4.4、§7.2、§13

## 目标

为 Web 实现 HttpOnly BFF session,为 Android 实现系统浏览器 OIDC PKCE,并让 Worker API 中间件把 Cookie 与 Bearer token 归一化为内部身份。

## 具体工作

1. Web BFF:
   - `GET /api/v1/auth/login` 生成 state/PKCE 并跳转 Access。
   - `GET /api/v1/auth/callback` 交换 token,创建 `web_sessions`,设置 HttpOnly Cookie。
   - 只把随机 256 位 session ID 写入 Cookie。
   - Access access/refresh token 使用当前 KEK 加密,AAD 绑定 session ID、user ID 和 key version。
   - `POST /api/v1/auth/logout` 撤销 session;提供可选 Access logout 入口。
   - BFF 在 token 接近过期时服务端刷新;刷新失败返回 401。
2. CSRF:
   - 登录后设置非 HttpOnly CSRF cookie。
   - 所有 Web 写请求携带 `X-CSRF-Token`,服务端校验 cookie/header 一致。
   - 校验 `Origin`/`Referer` 白名单。
3. Android:
   - 使用系统浏览器完成 Authorization Code + PKCE。
   - 回调 `cn.hy.mfaauthenticator://auth/callback`。
   - token 存 Android Keystore/EncryptedSharedPreferences 支持的 secure storage。
   - 客户端负责 refresh;API 只发送 Bearer Access JWT。
   - 验证 Access custom scheme 支持;失败时使用同域 HTTPS bridge,不能退回内嵌 WebView。
4. 双模式认证中间件:
   - Web 验证 BFF session + CSRF。
   - Android 验证 Access JWT + device_id 对应关系。
   - 两种模式统一输出 `{ user_id, device_id }`。
5. Web session 生命周期:
   - 空闲 30 天过期,绝对最长 90 天。
   - 撤销、删除云端数据或设备撤销时同步失效 session。

## 验收标准

- [ ] Web 登录后只有 HttpOnly session Cookie 和同 site CSRF Cookie,浏览器 JS 无法读取 Access token
- [ ] 缺少/错误 CSRF token、跨域 Origin 的写请求被拒绝
- [ ] Android 可通过系统浏览器完成 PKCE 并正确回到 App,token 不落入 `localStorage`
- [ ] Android token 过期后可刷新;API 始终只接受可验证的 Access JWT
- [ ] Web 与 Android 调用同一 API 时得到一致的内部 `user_id`/`device_id`
- [ ] Web/Android 退出、刷新失败、撤销 session 的集成测试通过
- [ ] typecheck/lint/test 和 staging 手工登录 smoke test 通过

## 状态: 待开始
