# Task Phase2-11: 限流、日志、CSP、Cron 与恢复

> 依赖: 03/04/05/06/07/09 | 被依赖: 12
> 对应 docs/Phase2.md: §11.1、§12、§13、§17

## 目标

完成同步功能的运行安全与维护能力,包括限流、脱敏日志、PWA API 禁缓存、基础 CSP、Cron 清理、功能开关和 D1 恢复流程。

## 具体工作

1. 限流与容量:
   - Cloudflare WAF/Rate Limiting 保护 `/api/*` 和 `/auth/*`。
   - Worker 按 user_id 限制同步频率、payload 大小、设备数量和历史写入。
   - 默认 1 MiB 或 5,000 条上限,压测后调整为配置项。
   - 超限返回 413/429,客户端展示可操作提示。
2. 日志:
   - 结构化记录 request_id、内部 user_id、route、status、latency、error code、revision。
   - 添加 `LOG_EMAIL_SECRET` 和脱敏函数:
     - `email_ref = HMAC-SHA256(normalized_email, LOG_EMAIL_SECRET)`
     - `email_masked = a***@example.com`
   - 禁止记录 JWT、Cookie、refresh token、DEK、TOTP secret、vault payload 和完整邮箱。
3. PWA/浏览器安全:
   - Service Worker 将 `/api/*`、`/auth/*` 设为 NetworkOnly。
   - 验证 API/vault 响应不进入 Cache Storage。
   - 设置基础 CSP: 禁止内联脚本,限制 connect-src;为 `index.html` 主题内联脚本配置 hash/nonce。
4. Cron:
   - 每日清理过期 web session、stale 设备判定和可清理 tombstone/history。
   - 清理任务基于索引查询,不扫描或输出 vault 明文。
   - 记录脱敏运行指标和失败告警。
5. 功能开关与版本:
   - 实现 `SYNC_ENABLED` 和 `MIN_CLIENT_VERSION` capability。
   - 客户端支持构建开关 + 运行时 kill switch。
   - 低于最低版本时返回 426 并触发现有更新提示。
6. 恢复:
   - 记录 D1 Time Travel Free 7 天窗口和恢复步骤。
   - migration 前生成导出/快照,记录责任人。
   - KEK rotation 演练和用户云端删除演练。

## 验收标准

- [ ] 高频同步、超大 payload、超设备数和认证回调限流均返回稳定错误
- [ ] 日志字段审计通过,不存在 token、Cookie、secret、payload 或完整邮箱
- [ ] 脱敏邮箱格式与 HMAC 稳定性测试通过
- [ ] Service Worker 测试确认 `/api/*`、`/auth/*` 不进入任何 Cache
- [ ] CSP 在核心 Web 页面通过,无 JS 内联执行被放行
- [ ] Cron 可清理过期 session/tombstone/history并保留用户唯一 vault
- [ ] 运行时开关能停止客户端入口和重试,服务端仍保持完整鉴权
- [ ] D1 migration 前导出、Time Travel restore 和 KEK rewrap 完成一次演练

## 状态: 待开始
