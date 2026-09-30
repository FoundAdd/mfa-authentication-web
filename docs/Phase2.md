# TOTP 密钥管理器 Phase 2: Cloudflare 加密云同步

> 状态: 需求已确认,待开发
> 前置: Phase 1 已完成
> 说明: 本文是 Phase 2 的权威需求文档。实现与验收以本文件和 `docs/Phase2-task*.md` 为准;本文对 `docs/Phase01.md` §3.3、§6.1 的预留方案进行了决策和替换。

## 1. 目标

在保持现有“本地优先、离线可用”能力的前提下,为用户提供基于 Cloudflare Access、Workers 和 D1 的跨设备加密云同步。

Phase 2 必须满足:

- Web PWA 与 Android App 可以使用同一 Access 身份访问云端 vault。
- 用户明确授权后才上传本地 MFA 数据;关闭同步后可继续纯本地使用。
- 云端支持多设备自动双向同步,新增、修改、删除和排序最终一致。
- 客户端无需持有云端数据密钥;Worker 负责解密、合并和重新加密。
- D1 中不保存 TOTP 明文,当前 vault 和最近历史版本使用 envelope encryption。
- 同步协议具备 revision、幂等、tombstone、设备撤销和旧客户端兼容能力。
- 不引入 Cloudflare 之外的业务后端,不引入 CRDT、WebSocket 或第三方同步服务。

Phase 2 不包含:

- PIN、生物识别或独立 App 锁。
- 用户可见的历史版本列表、版本对比或自助回滚 UI。
- 实时协同编辑、逐字段 CRDT 或 WebSocket/SSE 推送。
- WebDAV、Nextcloud、Supabase、Firebase 等替代后端。
- 远程擦除设备本地数据。
- 多云账号在同一本地 vault 中并存。

## 2. 已确认的关键决策

1. 同步语义: 跨设备自动双向同步。
2. 数据信任模型: 服务端托管加密;Worker 可解密 vault,TOTP secret 不以前端密文形式永久保存。
3. 账号模型: 多用户,关闭公开注册;准入由 Cloudflare Access Policy 控制。
4. 身份来源: Cloudflare Access OIDC;以 `(issuer, sub)` 映射应用用户,`email` 只作为可变属性。
5. 服务端实体 ID: 使用 64 位 Snowflake,以十进制字符串在 API/TypeScript 中传输;条目和分组继续使用客户端 UUID。
6. Snowflake 生成: 使用独立 Durable Object 分配器,布局为 41 位毫秒时间戳 + 10 位节点号 + 12 位序列。
7. 数据加密: 每用户独立 DEK,DEK 由 Worker Secret 中的 KEK 包装;Phase 2 不主动轮换 DEK,只支持 KEK 版本轮换。
8. 同步单位: 每个用户一个逻辑 vault;客户端提交完整快照,Worker 合并。
9. 冲突规则: 条目/分组实体级 LWW + tombstone,删除优先;排序列表整体 LWW;字段级 CRDT 不在本阶段范围。
10. 时间规则: 使用客户端 UTC 毫秒时间戳;服务端处理小时钟偏差,严重超前时间返回错误。
11. 同步协议: 版本化 REST;本地采用状态型 dirty + base revision,不保存逐条操作队列。
12. 历史版本: 当前版本 + 最近 2 个历史版本,共 3 个可恢复版本;Phase 2 不提供用户回滚 UI。
13. 认证: 用户 API 不接受 Cloudflare Access service token;必须存在非空 `sub` 和可映射身份。
14. Web: Worker BFF 管理 Access refresh token,浏览器只持有 `HttpOnly` session Cookie;写请求使用 CSRF token。
15. Android: 系统浏览器 + Authorization Code + PKCE + Custom Scheme 回调;refresh token 保存在 Android 安全存储。
16. 部署: 独立 `server/` Worker,同仓库开发;网页和 API 使用同源 `app.example.com/api/*` 路由。
17. 存储: Phase 2 当前密文和历史 revision 都存 D1;不引入 R2。
18. 恢复: 依赖 D1 Time Travel,Free 计划恢复窗口为 7 天;发布/migration 前执行额外导出。
19. 运维: Cron 清理过期 session、设备和历史;速率限制、脱敏日志、API 网络禁缓存和基础 CSP 必须实现。
20. 发布: Local/Staging/Production 三环境;Worker 与前端独立发布,兼容 migration 先于 Worker 部署。

## 3. 总体架构

```text
Web PWA (Cloudflare Pages)
  - 静态应用壳公开
  - /api/* 同源到 Worker
  - Worker BFF Cookie，不把 refresh token 暴露给 JS

Android App (Capacitor)
  - Access OIDC + PKCE + system browser
  - Access token 通过 Authorization: Bearer 调用 Worker
  - refresh token 存 Android secure storage

Cloudflare Worker (Hono)
  - Access JWT 验证与用户映射
  - Web BFF session
  - 设备注册/撤销
  - vault revision、envelope crypto、合并、幂等
  - Cron maintenance

Cloudflare D1
  - users/auth_identities/devices
  - vaults/vault_revisions
  - web_sessions
  - id 分配器 DO 不存 D1
```

### 3.1 同源路由

- Pages 自定义域: `app.example.com`。
- Worker Route: `app.example.com/api/*`。
- Pages 继续服务静态资源;Worker 只处理 `/api/*` 和必要的 `/auth/*` BFF 回调。
- 上线前必须在预发环境验证 Worker Route 优先于 Pages 路由;若平台冲突,迁移到 Workers Static Assets,而不是退回 Pages Functions。

### 3.2 建议目录

```text
src/services/sync/
  api.ts
  auth.ts
  engine.ts
  meta.ts
  types.ts

src/stores/sync.ts
server/
  src/
    index.ts
    routes/
      auth.ts
      capabilities.ts
      devices.ts
      vault.ts
      admin.ts
    services/
      access.ts
      crypto.ts
      devices.ts
      idAllocator.ts
      merge.ts
      sessions.ts
      vault.ts
    middleware/
      auth.ts
      csrf.ts
      rateLimit.ts
      errors.ts
    db/
      repositories.ts
    types.ts
  migrations/
  test/
  wrangler.toml
```

## 4. 身份、认证与会话

### 4.1 身份映射

- Access Policy 是唯一准入控制,不实现应用内邀请码或公开注册。
- 首次收到有效用户 JWT 时自动创建 `users` 和 `auth_identities`。
- 身份唯一键固定为 `(provider, issuer, subject)`。
- API 中的 `email` 只用于展示、审计和脱敏日志,不能作为主键。
- 缺少 `sub`、`issuer` 或 `email` 的 token 不得创建用户或访问 vault。
- Access service token、机器 token 或空 `sub` token 一律拒绝。

### 4.2 Web 登录

- Web 使用 Access OIDC Authorization Code + PKCE。
- 回调由 Worker BFF 处理,access/refresh token 存在 `web_sessions`。
- session 中的 Access token 使用当前 KEK 加密,AAD 绑定 `session_id`、`user_id` 和 `key_version`。
- 浏览器 Cookie: `HttpOnly; Secure; SameSite=Lax`,只保存随机 session ID。
- 写请求必须校验同源 CSRF token 和精确 `Origin`/`Referer`。
- BFF 负责服务端刷新 Access token;刷新失败返回 401 并清理 session。

### 4.3 Android 登录

- 使用系统浏览器,不使用内嵌 WebView 完成 Access 登录。
- 回调使用 `cn.hy.mfaauthenticator://auth/callback`。
- Android 负责 PKCE、token exchange 和 refresh,refresh token 存 Android Keystore/EncryptedSharedPreferences 支持的存储。
- Worker 只验证 Bearer Access JWT,不接受 Android refresh token。
- 如果 Cloudflare Access 的 OIDC 配置不接受 custom scheme,使用同域 HTTPS bridge 再 302 到 custom scheme;禁止回退到 WebView。

### 4.4 退出与撤销

- “退出同步”只清除本应用 session,保留本地 vault、设备记录和账号绑定。
- 提供可选的“退出 Access 会话”;默认不强制退出其他 Zero Trust 应用。
- 设备撤销由服务端拒绝该 `device_id`,并清理对应 Web session。
- 强撤销依赖 Cloudflare Access 会话撤销或 Access Policy 变更,文档和 UI 不得把逻辑设备撤销描述为远程擦除。

## 5. 数据模型

### 5.1 D1 表

所有 Snowflake ID 在 D1 中使用 `TEXT` 保存,避免 SQLite/JavaScript 精度问题。

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'active',
  wrapped_dek TEXT,
  dek_wrap_iv TEXT,
  dek_version INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE auth_identities (
  provider TEXT NOT NULL,
  issuer TEXT NOT NULL,
  subject TEXT NOT NULL,
  user_id TEXT NOT NULL,
  email TEXT NOT NULL,
  email_normalized TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  PRIMARY KEY (provider, issuer, subject),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE devices (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  platform TEXT NOT NULL,
  last_sync_revision INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  revoked_at INTEGER,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE vaults (
  user_id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL,
  ciphertext TEXT NOT NULL,
  cipher_iv TEXT NOT NULL,
  crypto_version INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE vault_revisions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  ciphertext TEXT NOT NULL,
  cipher_iv TEXT NOT NULL,
  crypto_version INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (user_id, revision),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE web_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  device_id TEXT,
  access_token_enc TEXT,
  access_token_iv TEXT,
  refresh_token_enc TEXT,
  refresh_token_iv TEXT,
  csrf_token_hash TEXT NOT NULL,
  key_version INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  absolute_expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (device_id) REFERENCES devices(id)
);
```

`vaults` 当前版本与 `vault_revisions` 历史版本均保存加密后的完整 `VaultPayload`;每个用户最多保留当前版本加 2 个历史版本。

### 5.2 Vault payload

```ts
interface VaultPayload {
  schema_version: 1
  data: TotpData
  meta: SyncMeta
}

interface EntitySyncMeta {
  updatedAt: number
  updatedBy: string
  deletedAt: number | null
  deletedBy: string | null
}

interface ListSyncMeta {
  updatedAt: number
  updatedBy: string
}

interface SyncMeta {
  schema_version: 1
  items: Record<string, EntitySyncMeta>
  groups: Record<string, EntitySyncMeta>
  groupOrder: ListSyncMeta
  itemOrder: Record<string, ListSyncMeta>
  ungroupedOrder: ListSyncMeta
}
```

- `data` 继续使用现有 `TotpData` 结构。
- `isExpanded` 在同步前剥离,接收结果后按本机 group ID 恢复。
- `SyncMeta` 与 `data` 一起加密,不拆成 D1 明文列。
- 本地存储使用 V2 信封 `{ data, meta }`,一次写入保证数据与同步元数据原子更新。
- `.totp` 导出格式不变,只导出 `data`。

### 5.3 删除与去重

- 同步合并以稳定 ID 为实体身份。
- 指纹去重仅用于导入和首次认领,不用于已建立 vault 的普通同步。
- 删除写 tombstone;删除优先于并发编辑,普通更新不能复活 tombstone。
- tombstone 保留到所有活跃设备确认对应 revision,再保留 30 天。
- 90 天未同步设备标记为失效,不再阻塞 tombstone 清理,但设备记录不自动删除。

## 6. 加密与密钥生命周期

### 6.1 Envelope encryption

```text
KEK_Vn（Worker Secret）
  -> AES-GCM wrap -> wrapped_dek + dek_wrap_iv + dek_version

DEK（每用户随机 256 位）
  -> AES-GCM encrypt -> VaultPayload ciphertext + cipher_iv + crypto_version
```

- KEK 不进入仓库和客户端。
- DEK 首次需要创建 vault 时生成。
- Phase 2 不主动轮换 DEK。
- KEK 轮换通过新增版本、批量 rewrap DEK 和更新 `dek_version` 完成。
- AAD 至少绑定 `user_id`、`crypto_version` 和用途标记,防止密文跨记录替换。

### 6.2 API 明文边界

- 客户端与 Worker 之间通过 TLS 传输 `TotpData + SyncMeta` JSON。
- Worker 在内存中解密并合并,再重新加密落 D1。
- 不在日志、错误响应、分析和审计字段中记录 TOTP secret、vault payload、Access token、refresh token、Cookie 或 DEK。

## 7. 同步协议

### 7.1 Revision 与 CAS

- `vaults.revision` 是每用户独立的整数,从 1 开始。
- 每次成功写入生成 `revision + 1`。
- 更新使用 `WHERE user_id = ? AND revision = base_revision` 的 CAS。
- CAS 失败时 Worker 重新读取最新 revision 并合并重试。
- revision 不使用 Snowflake;历史记录 ID 使用 Snowflake。

### 7.2 REST API

所有用户 API 均支持:

```text
Authorization: Bearer <Access JWT>   # Android/API 客户端
或
HttpOnly BFF Cookie                 # Web,写请求附加 X-CSRF-Token
```

主要接口:

```text
GET    /api/v1/capabilities
GET    /api/v1/auth/login
GET    /api/v1/auth/callback
GET    /api/v1/auth/me
POST   /api/v1/auth/logout

POST   /api/v1/devices
GET    /api/v1/devices
PATCH  /api/v1/devices/:id
DELETE /api/v1/devices/:id

GET    /api/v1/vault
PUT    /api/v1/vault
DELETE /api/v1/vault

DELETE /api/v1/admin/users/:id/cloud-data
```

### 7.3 GET vault

```json
{
  "revision": 12,
  "schema_version": 1,
  "data": { "groups": [], "ungrouped": [] },
  "meta": {}
}
```

### 7.4 PUT vault

请求:

```json
{
  "request_id": "opaque-random-id",
  "device_id": "1234567890123456789",
  "base_revision": 12,
  "schema_version": 1,
  "data": { "groups": [], "ungrouped": [] },
  "meta": {}
}
```

成功响应返回完整合并后的 payload 和新 revision。服务端自动处理 revision 竞争,不把普通合并冲突作为 409 返回。

### 7.5 同步触发

- 应用启动/恢复前台。
- `online` 事件恢复网络。
- 本地同步相关编辑后防抖。
- 用户手动点击“立即同步”。
- Web 不依赖后台常驻连接;Android 不承诺后台定时同步。

### 7.6 幂等

- 每次未完成推送使用随机 opaque `request_id`。
- 服务端按 `user_id + device_id + request_id` 去重。
- 成功响应可重复返回同一合并结果,避免重试产生重复 tombstone 或 revision。

## 8. 服务端合并规则

1. Worker 校验 schema、设备状态、payload 大小和客户端时间。
2. 按稳定 ID 比较当前云端与客户端实体。
3. 同一实体单侧变更时取变更侧;双侧变更时比较 `updatedAt`,再以 `updatedBy` Snowflake 数值作为 tie-breaker。
4. 任一版本存在 `deletedAt` 时删除优先,普通编辑不能复活实体。
5. 分组删除未删除条目时,移动后的条目必须产生新的实体元数据。
6. `groupOrder`、`itemOrder[groupId]`、`ungroupedOrder` 作为整体按相同的 LWW 规则合并。
7. 服务端时间与客户端时间偏差小于 5 分钟时接受客户端时间;偏差更大时钳制到服务端时间;超过 24 小时返回 `CLOCK_SKEW`。
8. 合并成功后写入新 current revision,把旧 current 移入历史,并清理超过 2 个历史版本的记录。
9. 合并算法只在 Worker 实现,客户端不复制完整 LWW 逻辑。

## 9. 首次绑定与导入导出

- 默认关闭云同步;Access 登录不等于授权上传。
- 本地 vault 首次绑定时记录 `sync_identity=(issuer, subject)` 和内部 `user_id`。
- 本地为空: 可直接下载云端 vault。
- 云端为空: 用户明确选择后可上传本地 vault。
- 两端都有数据: 提供“合并 / 云端覆盖本地 / 本地覆盖云端”,默认合并并显示数量,覆盖前要求导出备份。
- 同步开启后执行覆盖导入时,缺失条目转换为 tombstone 并同步到云端,且明确提示影响所有设备。
- 同步成功且状态健康时不再重复显示本地备份提示;同步关闭或连续失败时继续提醒备份。
- 切换 Access 身份必须显式解绑;禁止把本地 vault 自动上传到另一个账号。

## 10. 设备与云端数据生命周期

- 首次登录后由服务端签发 Snowflake `device_id`。
- 设备名称优先使用设备型号和系统版本,例如 `Chrome (Ubuntu 22.04)`、`Android 15`;获取失败回退到 `Chrome`、`Android App` 等通用名。
- 不采集硬件指纹。
- 设备列表展示名称、平台、最后同步时间和状态,支持撤销。
- 新设备注册不要求已有设备审批;通过速率限制和 Access 会话撤销控制风险。
- “关闭同步”只停止上传/拉取,保留本地和云端数据。
- “解除账号绑定”保留本地数据,可选择保留或删除云端数据。
- “删除云端数据”删除 vault、历史版本、wrapped DEK、Web session 和设备同步状态,但保留本地数据。
- 云端删除后,其他设备收到 `410 CLOUD_DELETED`,保留本地数据、停止重试,再由用户决定是否重新上传。
- Access 身份被移除后默认保留云端数据,只有管理员显式删除或用户主动删除时才清理。

## 11. 客户端行为与 UI

- 同步入口放在 `SettingsDialog.vue` 的“云同步”区块/子页。
- 首页或设置页展示同步状态: 已同步、同步中、离线、需要登录、同步失败、云端已删除。
- 提供上次成功同步时间和手动重试。
- 自动合并导致本地变化时显示非阻塞摘要,例如“已合并其他设备的 2 处变更”。
- 设备列表支持重命名和撤销;不提供远程擦除。
- Phase 2 不展示 revision 号、同步日志、逐条冲突或历史版本。
- 新文案进入 12 种语言包;`en` 与 `zh-CN` 为完整基准,其余可回退英文。

### 11.1 Service Worker

- `/api/*` 与 `/auth/*` 永远是 NetworkOnly。
- API 响应、认证响应和 vault 数据不得写入 Cache Storage 或 Workbox runtime cache。
- PWA 只缓存静态应用壳。

## 12. 安全、限流与可观测性

- Access JWT 验证至少覆盖签名、`iss`、`aud`、`exp`、`nbf`、`sub`。
- 用户 API 拒绝 service token 和无 `sub` token。
- 管理员路由使用独立 Access Group/claim 校验,不提供查看用户明文 vault 的后台入口。
- WAF/Rate Limiting 保护 `/api/*` 和 `/auth/*`;Worker 按 `user_id` 限制同步频率、payload 大小和设备创建。
- 推荐首版限制为 1 MiB 或 5,000 个条目,最终阈值由压测决定;超限返回稳定错误码。
- 结构化日志只记录 `request_id`、内部 Snowflake `user_id`、路由、状态、耗时、错误码和 revision。
- 日志可记录脱敏邮箱:

```text
email_ref     = HMAC-SHA256(normalized_email, LOG_EMAIL_SECRET)
email_masked  = a***@example.com
```

- 日志禁止出现完整邮箱、JWT、Cookie、refresh token、DEK、TOTP secret 和 vault payload。
- 设置基础 CSP;禁止内联脚本,`connect-src` 仅允许同源和 Access 必要域名。
- Cron 每日清理过期 session、长期未活跃设备和符合 retention 条件的 tombstone/history。

## 13. 环境、配置与发布

### 13.1 环境

| 环境       | Pages           | Worker                     | D1         | Access             |
| ---------- | --------------- | -------------------------- | ---------- | ------------------ |
| Local      | Vite dev        | Wrangler/Miniflare         | 本地       | mock JWT           |
| Staging    | staging Pages   | staging Worker             | staging D1 | staging Access App |
| Production | app.example.com | prod Worker Route `/api/*` | prod D1    | prod Access App    |

禁止在 staging 与 production 之间共享 D1、KEK、Access application 或 session。

### 13.2 关键配置

```text
VITE_SYNC_ENABLED
VITE_SYNC_API_BASE
ACCESS_TEAM_DOMAIN
ACCESS_AUD
ACCESS_CLIENT_ID
ACCESS_CLIENT_SECRET                # Web BFF 使用,不进入 Android
KEK_V1
LOG_EMAIL_SECRET
SYNC_ENABLED
MIN_CLIENT_VERSION
```

### 13.3 功能开关

- `VITE_SYNC_ENABLED` 控制构建是否包含同步入口。
- `/api/v1/capabilities` 返回 `sync_enabled`、`min_client_version` 和 schema/crypto 版本。
- 运行时 kill switch 可停止客户端重试和隐藏入口,但不能替代鉴权、限流或 D1 权限。

### 13.4 发布与迁移

- Worker 使用独立 `.github/workflows/server.yml`。
- 生产顺序: 向后兼容 D1 migration -> 部署 Worker -> 发布前端。
- 回滚顺序: 回滚 Worker -> 必要时恢复 D1 Time Travel/迁移前导出。
- D1 Time Travel Free 计划提供 7 天恢复窗口;重大 migration 前额外导出。
- 服务端至少兼容上一发布客户端一个窗口;低于最低版本返回 426 和升级提示。

## 14. API 错误约定

错误响应不得包含堆栈、token、email 明文、TOTP secret 或 SQL。

| HTTP | code                      | 场景                                 |
| ---- | ------------------------- | ------------------------------------ |
| 401  | `UNAUTHENTICATED`         | JWT/session 缺失、过期或无效         |
| 403  | `FORBIDDEN`               | 身份无权、设备被撤销、管理员权限不足 |
| 410  | `CLOUD_DELETED`           | 云端 vault 已被显式删除              |
| 413  | `PAYLOAD_TOO_LARGE`       | vault 或请求体超限                   |
| 422  | `CLOCK_SKEW`              | 客户端时间严重超前                   |
| 426  | `CLIENT_UPGRADE_REQUIRED` | 客户端低于最低支持版本               |
| 429  | `RATE_LIMITED`            | 超过频率、设备或容量限制             |
| 500  | `INTERNAL_ERROR`          | 服务端异常,仅返回 request_id         |

## 15. 测试与验收

### 15.1 自动测试

- 前端 Vitest: SyncMeta 更新、dirty、状态机、isExpanded 保留、覆盖导入 tombstone、错误映射。
- Worker 集成测试: Access JWT 验证、用户自动 provision、service token 拒绝、设备注册/撤销、revision CAS、幂等、合并、tombstone、排序、时间校正、限流和 Cron 清理。
- 加密测试: DEK/KEK wrap/unwrap、AAD、错误密钥、历史版本解密、KEK 轮换。
- D1 migration 测试: 新库初始化、旧 schema 升级和失败回滚。
- 不把 Playwright/Android 实机测试纳入 Phase 2 强制 CI 门槛。

### 15.2 发布前手工 smoke test

- Web Access 登录、刷新、退出和 CSRF 防护。
- Android 系统浏览器登录、custom scheme 回调、secure storage 恢复和 logout。
- 两台客户端并发新增、编辑、删除和排序;确认 revision、tombstone 与顺序最终一致。
- 首次绑定三种分支和覆盖导入告警。
- 云端删除后其他设备停止重试并保留本地数据。
- Staging 验证 Worker Route 与 Pages 同源路由。
- 确认无 API/vault 响应进入 Service Worker Cache Storage。

### 15.3 完成门槛

Phase 2 完成前必须执行并记录:

```bash
npm run lint
npm run typecheck
npm run test
npm run build
npm run cap:sync
```

以及 `server/` 的 lint、typecheck、test、Wrangler dry-run 和 staging smoke test。

## 16. 任务拆分

| 任务                                               | 目标                                      | 依赖              |
| -------------------------------------------------- | ----------------------------------------- | ----------------- |
| [Phase2-01](Phase2-task01-server-foundation.md)    | Worker/Hono/D1/DO 基础设施                | Phase 1           |
| [Phase2-02](Phase2-task02-server-crypto.md)        | 密钥托管与 envelope encryption            | 01                |
| [Phase2-03](Phase2-task03-access-identity.md)      | Access OIDC、用户映射与自动 provision     | 01/02             |
| [Phase2-04](Phase2-task04-client-auth-sessions.md) | Web BFF、Android PKCE 与双模式认证        | 03                |
| [Phase2-05](Phase2-task05-device-management.md)    | Snowflake 设备注册、命名与撤销            | 03                |
| [Phase2-06](Phase2-task06-vault-api-revisions.md)  | Vault API、revision CAS、历史与幂等       | 02/03/05          |
| [Phase2-07](Phase2-task07-server-merge.md)         | LWW、tombstone、排序与时间校正            | 06                |
| [Phase2-08](Phase2-task08-local-sync-model.md)     | 本地 V2 信封、SyncMeta 与 mutation helper | 06                |
| [Phase2-09](Phase2-task09-sync-engine.md)          | 客户端状态机、触发、重试与状态写回        | 04/07/08          |
| [Phase2-10](Phase2-task10-sync-ui-import.md)       | 同步设置、设备 UI、导入导出与备份提示     | 09                |
| [Phase2-11](Phase2-task11-security-ops.md)         | 限流、日志、CSP、Cron、功能开关与恢复     | 03/04/05/06/07/09 |
| [Phase2-12](Phase2-task12-cicd-quality.md)         | 三环境 CI/CD、migration、全量验收         | 全部              |

## 17. 已知风险与验证门

1. Cloudflare Access OIDC 对 Android custom scheme redirect 的支持必须在 staging 验证;若不支持,使用 HTTPS bridge。
2. Cloudflare Access generic OIDC 是否允许 `token_endpoint_auth_method=none` 必须在 staging 验证;否则 Android 使用同域 confidential-client bridge,禁止在 APK 中嵌入 secret。
3. Worker Route 与 Pages 自定义域的同源路径优先级必须在发布前验证。
4. D1 Time Travel Free 只有 7 天窗口,不能替代长期备份。
5. 实体级 LWW 可能丢失并发元数据编辑;secret 不可编辑,因此数据丢失风险受控。
6. 服务端可解密 vault,威胁模型明确信任 Worker、Secret 和 Cloudflare 账户权限;零知识 E2EE 不在本阶段范围。
