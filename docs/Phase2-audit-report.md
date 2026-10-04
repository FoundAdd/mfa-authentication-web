# Phase 2 代码审计报告:Cloudflare 加密云同步

> 审计对象:`docs/Phase2.md` 与 `docs/Phase2-task01..12` 所声明的全部 Phase 2 交付物
> 审计方式:静态代码审计 + 数据流/控制流追踪 + 本地只读验证(未执行破坏性操作)
> 结论一句话:**12 个任务文档全部标记"已完成",但同步链路上存在若干"文档与实现不一致"的功能性与安全性缺陷;其中 D1 明文存储 vault 快照、"本地覆盖云端"墓碑逻辑取反、CSRF 全链路失效、限流中间件完全未挂载四项必须在发布前修复。**

---

## 审计摘要

### 范围与方法

审计覆盖:

| 层                 | 位置                                                                                                       | 说明                                                   |
| ------------------ | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Worker 入口/中间件 | `server/src/index.ts`、`server/src/middleware/*`                                                           | 认证、CSRF、限流、错误、请求上下文、安全头             |
| 认证与身份         | `server/src/services/access.ts`、`identity.ts`、`sessions.ts`、`adminAuth.ts`、`server/src/routes/auth.ts` | Access JWT 校验、用户 provision、Web BFF session、PKCE |
| 加密与密钥         | `server/src/services/crypto.ts`、`kek.ts`、`userVault.ts`                                                  | DEK/KEK envelope、AAD、rekey、云端删除                 |
| 同步协议           | `server/src/routes/vault.ts`、`server/src/services/vault.ts`、`merge.ts`、`vaultSchemas.ts`                | revision CAS、幂等、LWW/tombstone、时钟校正            |
| 设备管理           | `server/src/routes/devices.ts`、`server/src/services/devices.ts`                                           | 注册/重命名/撤销                                       |
| 数据层             | `server/migrations/*.sql`、`server/src/db/repositories.ts`                                                 | D1 schema、SQL 封装                                    |
| 客户端             | `src/services/sync/*`、`src/stores/sync.ts`、`src/components/SyncSettings.vue`                             | 同步引擎、状态机、UI                                   |
| 运维/CI            | `.github/workflows/server.yml`、`server/wrangler.toml`、`server/OPERATIONS.md`                             | 部署、迁移、环境隔离                                   |

方法:先建立资产与信任边界清单,再对每条"文档承诺"做实现对照(逐条 grep 调用点),对可疑点做可达性验证;对关键争议点(如 Hono 通配中间件是否覆盖 `/vault`)编写一次性探针脚本在本地实测,验证后即删除探针。

### 总体风险

- **共 47 项发现**:F 系列 24 项(严重 2、高 4、中 14、低 4)+ 附录 D 的 C 系列 23 项(严重 1、高 6、中高 1、中 11、低 4)+ 4 项"已确认干净"说明。**若只读一段:先看下面 5 条关键结论与「修复优先级」的 P0 表。**
- 最高风险集中在 **Web 写请求的 CSRF 防护在所有真实写路由上实际未生效**、**服务端把完整 vault 快照(含 TOTP secret)以明文写入 D1**(后者直接推翻 `docs/Phase2.md` §1"D1 中不保存 TOTP 明文"的核心卖点),以及 **"本地覆盖云端"的墓碑逻辑取反会删除两端共有的全部条目**。
- 另有大量"文档声称已实现、代码中不存在调用点"的偏差(限流、426 版本门、客户端 API 装配、`sync_identity` 绑定),说明任务状态标记与验收标准之间存在系统性缺口。

### 关键结论(按业务影响排序)

1. CSRF token 的 Cookie 名在服务端与客户端不一致,**Web 端所有写操作在浏览器中必然 403**,且 `devices`/`admin` 写路由根本没有挂载 `requireCsrf`。
2. `PUT /vault` 的幂等重放响应以**明文** JSON 存入 `vault_push_dedupe.response_payload`,违反 envelope encryption 的"D1 无 TOTP 明文"约束。
3. "本地覆盖云端"分支的墓碑逻辑**方向取反**,会删除"两端共有"的全部条目,且该缺陷被一个**恒真的测试断言**掩盖——属不可逆数据丢失风险。
4. `rateLimit.ts` 三个限流器**从未被任何路由 import**,文档与 runbook 描述的限流全部不存在;`MIN_CLIENT_VERSION` 无任何服务端校验,426 是死代码。
5. 客户端 `SyncApiClient` **从未被实例化**,`sync_identity` **从未被写入**,`registerDevice` **从未被调用** → 同步功能在真实装配下不可用(首推必然 403)。这既解释了 3/4 为何未被发现,也意味着这些控制当前处于"空转"状态。

---

## 发现列表

### [F-01] CSRF Cookie 名不一致导致 Web 端所有写请求失败

- **严重性**:严重
- **类型 / CWE / OWASP**:功能缺陷引发安全控制失效 / CWE-1188 / OWASP A05:2021 安全配置错误
- **位置**:
  - `server/src/services/sessions.ts:379`(服务端常量)
  - `server/src/routes/auth.ts:259`(写入 Cookie)
  - `src/services/sync/api.ts:104`(客户端读取名)
- **证据**:
  - 服务端:`export const CSRF_COOKIE = '__Host-csrf'`,并在回调里 `buildCsrfCookie(created.csrfToken)`,即下发 `__Host-csrf=<token>`。
  - 客户端:
    ```ts
    const CSRF_COOKIE = 'csrf_token'
    export function readCsrfCookie(documentRef: Document = document): string | null {
      const entry = documentRef.cookie.split('; ').find((row) => row.startsWith(`${CSRF_COOKIE}=`))
      return entry ? decodeURIComponent(entry.slice(CSRF_COOKIE.length + 1)) : null
    }
    ```
    客户端按 `csrf_token=` 查找,而实际 Cookie 名是 `__Host-csrf`,永远返回 `null`。
  - `src/services/sync/api.ts:145-148` 仅在 `csrf` 非空时才设置头:
    ```ts
    if (method !== 'GET' && mode.kind === 'web') {
      const csrf = this.csrfToken()
      if (csrf) headers['X-CSRF-Token'] = csrf
    }
    ```
  - 服务端 `server/src/middleware/csrf.ts:69-72` 在缺失头时返回 403。
- **触发条件**:任何 Web 端 cookie 模式的写操作(`PUT/DELETE /api/v1/vault`、`POST /api/v1/auth/logout`)。
- **影响**:同步功能在 Web 上完全不可用(功能阻断);更严重的是隐蔽性——因为客户端静默跳过头部,问题会被误判为"服务端 bug",从而诱使运维**放松或移除 CSRF 校验**来"修复",进而暴露真实 CSRF 漏洞。
- **修复建议**:
  1. 客户端改为 `const CSRF_COOKIE = '__Host-csrf'`;
  2. 更稳健的做法是让 BFF 在 HTML 或 `/api/v1/auth/me` 响应中显式返回 CSRF token 字段,不再依赖"客户端猜 Cookie 名";
  3. 客户端在 cookie 模式下发写请求时,若拿不到 CSRF token **必须显式失败**,不要静默省略头部(改为抛出 `SyncApiError('UNAUTHENTICATED')`),让故障可见。
- **验证 / 测试建议**:新增集成测试——用 `buildCsrfCookie` 产出的 Cookie 驱动 `SyncApiClient`(注入 `document.cookie` 桩)对 `PUT /vault` 发请求,断言 `X-CSRF-Token` 头存在且返回非 403。当前 `src/stores/sync.test.ts` 全部使用 stub,不会暴露该问题。
- **参考**:§4.2、Phase2-04 §2 验收标准第 2 条
- **置信度**:高(已逐行核对两处常量与调用点)

---

### [F-02] D1 以明文保存完整 vault 快照(TOTP secret 明文落库)

- **严重性**:严重
- **类型 / CWE / OWASP**:敏感数据明文存储 / CWE-312 / OWASP A02:2021 加密机制失效
- **位置**:
  - `server/src/services/vault.ts:218`
  - `server/src/db/repositories.ts:415-424`
  - `server/migrations/0003_idempotency.sql:9`
- **证据**:
  ```ts
  // server/src/services/vault.ts:207-218
  const resultPayload: PutVaultResult = {
    revision: nextRevision,
    schema_version: 1,
    data: merge.merged.data,   // ← 含每个条目的 secret 明文
    meta: merge.merged.meta,
    merged_from_others: ...,
  }
  // ---- 幂等记录(§7.6) ----
  await repos.vaultPushDedupe.put(userId, request.device_id, request.request_id, JSON.stringify(resultPayload), now)
  ```
  `VaultPushDedupeRepository.put` 直接 `INSERT ... response_payload` 写入该 JSON。migration 注释亦自认:
  > `response_payload holds the encrypted-or-plaintext JSON of the merged snapshot`
- **触发条件**:任何一次成功的 `PUT /api/v1/vault`。
- **影响**:`vault_push_dedupe` 中保存**未加密的完整 vault**(所有 TOTP secret、issuer、label、分组结构),保留至 cron 的 `DEDUPE_RETENTION_MS`(7 天,`server/src/services/maintenance.ts:25`)。直接违反:
  - `docs/Phase2.md` §1:"D1 中不保存 TOTP 明文,当前 vault 和最近历史版本使用 envelope encryption";
  - §6.1 的 envelope 模型;
  - §6.2"不在日志、错误响应…中记录 TOTP secret"的同类精神。
    一旦 D1 被读取(云账号失陷、备份导出、Time Travel 快照),攻击者无需任何 KEK/DEK 即可取得全部 TOTP secret——envelope encryption 的防护被完全旁路。
- **修复建议**(任选一,推荐 1):
  1. **只存摘要,不存快照**:`vault_push_dedupe` 仅保存 `(user_id, device_id, request_id, revision, created_at)`;重放时按 `revision` 从 `vaults` 重新读取并解密返回,语义等价且零新增明文。
  2. 若必须缓存响应体,则用该用户的 DEK 加密后存储(AAD 复用 `vaultAad` 或新增 purpose 标签 `dedupe-cache`),读取时解密。
  3. 停止把 `request_id` 当响应缓存:改为`SELECT` 去重后返回"已处理"标志,由客户端重新 `GET /vault`。
- **验证 / 测试建议**:新增不变量测试——把 `vault_push_dedupe.response_payload` 的内容断言为不解密就**无法**通过正则匹配到任意 `secret` 值;或直接断言该列不存在 vault JSON。当前 `server/test/vault.test.ts` 只验证重放返回相同结果,从未检查存储形态。
- **参考**:§1、§6.1、§6.2、Phase2-02 验收标准第 1 条
- **置信度**:高

---

### [F-03] 限流中间件已实现但从未挂载到任何路由

- **严重性**:高
- **类型 / CWE / OWASP**:缺失安全控制 / CWE-770(资源无限制分配)/ OWASP A04:2021 不安全设计
- **位置**:
  - `server/src/middleware/rateLimit.ts:74-98`(定义 `syncPushLimiter` / `deviceCreateLimiter` / `authCallbackLimiter`)
  - 调用点:**不存在**。`grep -r "from '../middleware/rateLimit'" server/src` 无匹配;全仓库仅 `server/test/securityOps.test.ts` 引用。
- **证据**:路由挂载链中只有 `requireUser` / `requireCsrf`:
  - `server/src/routes/vault.ts:33,47,60`
  - `server/src/routes/devices.ts:34,51,59,71`
  - `server/src/routes/auth.ts:284`
    另 `server/src/routes/auth.ts:149`(`/auth/login`)与 `:228`(`/auth/callback`)无任何限流。
- **触发条件**:任意已认证用户高频 `PUT /vault`、批量 `POST /devices`、或匿名高频打 `/auth/login`、`/auth/callback`。
- **影响**:
  1. `POST /devices` 无 `deviceCreateLimiter`,但 `MAX_DEVICES_PER_USER = 20`(`server/src/services/devices.ts:17`)与 `countByUser` 上限仍在,**设备数上限有兜底**;
  2. `PUT /vault` 无 `syncPushLimiter`,每次请求都执行"解密 → 合并 → 加密 → CAS → 历史复制 → prune",攻击者可用循环写放大 D1 读写与 DO 配额,构成**成本型 DoS**;
  3. `/auth/callback` 无 IP 限流,`exchangeCodeForTokens` 会向 Access token endpoint 发外部请求(`server/src/routes/auth.ts:204`),可被滥用为**放大器**并消耗 Access 配额;
  4. `server/OPERATIONS.md` §6 向运维**明确描述**了"同步 30/min、设备创建 5/hour、auth 回调 10/min"——文档谎报控制存在,掩盖了真实暴露面。
- **修复建议**:
  - 在 `server/src/routes/vault.ts` 的 `PUT /vault` 挂 `syncPushLimiter().middleware`;
  - 在 `POST /devices` 挂 `deviceCreateLimiter().middleware`;
  - 在 `GET /auth/callback` + `GET /auth/login` 挂 `authCallbackLimiter().middleware`;
  - 保留 `rateLimit.ts:8-9` 的 TODO 认知:**当前实现是 isolate 内内存计数,多 isolate 下全局上限为 `max × 实例数`**。发布前应按文档承诺迁移到 Durable Object 或 Cloudflare Rate Limiting binding,否则"限流"仅具象征意义。
- **验证 / 测试建议**:新增"挂载性测试"——用真实 `app` 连续发 N+1 次 `PUT /vault`,断言第 N+1 次返回 429 `RATE_LIMITED`。现有 `securityOps.test.ts:30-88` 只测了限流器**类**的行为,没有测它是否被应用(这是典型的"测了单元、漏了接线")。
- **参考**:§12、Phase2-11 §1、Phase2-11 验收标准第 1 条
- **置信度**:高

---

### [F-04] `devices` 与 `admin` 的写路由缺失 CSRF 校验

- **严重性**:高
- **类型 / CWE / OWASP**:CSRF / CWE-352 / OWASP A01:2021 访问控制失效
- **位置**:
  - `server/src/routes/devices.ts:34`(`POST /devices`)、`:59`(`PATCH /devices/:id`)、`:71`(`DELETE /devices/:id`)
  - `server/src/routes/admin.ts:22`(`DELETE /admin/users/:id/cloud-data`)
- **证据**:这些路由只挂 `requireUser`,没有 `requireCsrf`:
  ```ts
  devicesRoutes.delete('/devices/:id', requireUser, async (c) => { ... })   // devices.ts:71
  adminRoutes.delete('/admin/users/:id/cloud-data', async (c) => { ... })  // admin.ts:22(父级 use 只有 requireUser)
  ```
  对比 `server/src/routes/vault.ts:47,60` 正确挂了 `requireCsrf`。`server/src/middleware/csrf.ts:52` 的注释明确要求:
  > "mount AFTER requireUser on **every state-changing route**."
- **触发条件**:受害者在浏览器中已登录(BFF cookie)、且 `APP_ORIGIN` 未配置或校验可通过时,恶意页面发起跨站写请求。
- **影响**:
  - 攻击者可让受害者**撤销其自己的所有设备**(`DELETE /devices/:id`),把受害者永久踢出同步;
  - 攻击者可**重命名设备**,制造社工/钓鱼语境("已授权设备:Recovery-XXX");
  - 若受害者是管理员,攻击者可**删除任意用户的云端数据**(`DELETE /admin/users/:id/cloud-data`),造成不可逆数据销毁。
  - 缓解现状:会话 Cookie 为 `SameSite=Lax`(`server/src/services/sessions.ts:388`),跨站 `POST/DELETE` 不携带 Cookie,使实际利用被削弱;但 `SameSite` 是**浏览器侧单一防线**,不能替代双提交 token,且 `docs/Phase2.md` §4.2 明确要求"写请求必须校验同源 CSRF token 和精确 Origin/Referer"。
- **修复建议**:在三个 devices 写路由与 admin 删除路由上,`requireUser` 之后补挂 `requireCsrf`。
- **验证 / 测试建议**:针对**真实路由**补测试(而非 `sessions.test.ts:384-433` 中合成的 `/api/v1/__guarded`):带会话 Cookie、不带 `X-CSRF-Token` 发 `POST /api/v1/devices`,断言 403。
- **参考**:§4.2、Phase2-04 §2 与验收标准第 2 条
- **置信度**:高

---

### [F-05] Bearer 模式的 `device_id` 绑定存在可选校验与 fail-open

- **严重性**:中
- **类型 / CWE / OWASP**:访问控制设计缺陷 / CWE-863 / OWASP A01:2021

> 降级说明:Q43/Q70 已确认设备撤销为逻辑撤销,不要求已有可信设备批准新设备,强撤销依赖 Cloudflare Access 会话撤销。该已接受限制不再计入本项缺陷;本项保留的是 `X-Device-Id` 可缺失和数据库异常时 fail-open。

- **位置**:
  - `server/src/middleware/auth.ts:99-111`(`bindBearerDevice`)
  - `server/src/middleware/auth.ts:142-148`(调用点)
  - `server/src/services/vault.ts:140-146`(PUT 侧的 device 校验)
- **证据**:
  ```ts
  async function bindBearerDevice(c, userId) {
    const requested = c.req.header('X-Device-Id')
    if (!requested) return undefined // ← 不带头部即完全跳过校验
    try {
      const device = await createRepositories(c.env.DB).devices.getById(requested)
      if (!device || device.user_id !== userId || device.revoked_at !== null) return 'reject'
      return requested
    } catch {
      return undefined // ← 数据库异常时静默降级为"不校验"
    }
  }
  ```
  `X-Device-Id` 在客户端代码中**从未被发送**(全仓库 grep 无 `X-Device-Id` 的写入方),因此该检查在真实流量中永不执行。
- **触发条件**:持有有效 Access JWT(如从 Android 备份、调试日志、恶意 App 中窃取)的攻击者直接对 `/api/v1/*` 发请求,且不携带 `X-Device-Id`;或数据库查询异常时未携带绑定的设备直接通过。
- **影响**:
  1. `docs/Phase2-task04` §4 要求"Android 验证 Access JWT + **device_id 对应关系**",验收标准第 3 条要求"Web 与 Android 调用同一 API 时得到一致的内部 `user_id`/`device_id`"——实现未满足;
  2. `catch { return undefined }` 是**fail-open**:任何 D1 瞬时错误都会把"设备已撤销"判定降级为"通过"。
- **修复建议**:
  1. 让 `bindBearerDevice` 成为**强制**校验:bearer 模式下缺少 `X-Device-Id` 时返回 403,而不是跳过;
  2. `catch` 分支必须 fail-**closed**(返回 `'reject'` 或 500),绝不静默放行;
  3. `PUT /vault` 除了比对 `device.user_id === userId`,还应比对"请求携带的 device_id 与中间件解析出的 `c.get('deviceId')` 一致",把 body 的 `device_id` 从"自述"降级为"待验证";
  4. 强撤销仍按已确认设计由 Cloudflare Access 会话撤销承担,不在本项中重复要求应用侧实现设备审批链。
- **验证 / 测试建议**:补测试——(a) 已撤销设备的有效 JWT 在**不带** `X-Device-Id` 时调用 `GET /vault` 应 403;(b) 模拟 D1 抛错时请求应被拒绝而非放行。现有 `sessions.test.ts:361-369` 只覆盖了"带 `X-Device-Id` 且已撤销"这一条路径。
- **参考**:§4.3、§4.4、Phase2-04 §4、Phase2-05 验收标准
- **置信度**:高

---

### [F-06] `MIN_CLIENT_VERSION` 无服务端强制,`426` 为死代码

- **严重性**:中
- **类型 / CWE / OWASP**:缺失安全控制 / CWE-1059 / OWASP A04:2021
- **位置**:`server/src/env.ts:8`、`server/src/routes/capabilities.ts:14`、`server/src/errors.ts:15,27`
- **证据**:`grep -rn "CLIENT_UPGRADE_REQUIRED|MIN_CLIENT_VERSION" server/src` 仅命中类型定义、HTTP 状态映射与 capabilities 的**返回值**;没有任何中间件读取客户端版本头、也没有任何地方抛出 `CLIENT_UPGRADE_REQUIRED`。
- **触发条件**:旧版本客户端(协议不兼容)继续调用 `/api/v1/vault`。
- **影响**:违反 `docs/Phase2.md` §13.4"服务端至少兼容上一发布客户端一个窗口;低于最低版本返回 426 和升级提示"。旧客户端可能提交服务端无法安全解析的 payload,或依赖已变更的合并语义,进而产生**静默数据损坏**。客户端 `src/stores/sync.ts:420-421` 也为 426 准备了状态,但服务端从不返回它。
- **修复建议**:新增 `requireClientVersion` 中间件,读取客户端版本(建议 `X-Client-Version` 头 + Android `versionName`,并写入 `capabilities` 之外的独立探测接口),低于 `MIN_CLIENT_VERSION` 时返回 426 `CLIENT_UPGRADE_REQUIRED`;同时客户端必须在每次请求带上该头。
- **验证 / 测试建议**:测试——`X-Client-Version: 0.0.0` 请求 `PUT /vault` 应返回 426。
- **参考**:§13.4、Phase2-11 §5 与验收标准
- **置信度**:高

---

### [F-07] 客户端同步功能未装配:`SyncApiClient` 从未实例化

- **严重性**:高(功能性阻断)
- **类型 / CWE / OWASP**:交付物缺失 / CWE-1059
- **位置**:`src/stores/sync.ts:53,62-65`、`src/components/SyncSettings.vue:151`
- **证据**:
  - `src/stores/sync.ts:53`: `let api: SyncApiClient | null = null`,仅由 `configure(client)` 赋值;
  - 全仓库 `grep "configure\(|new SyncApiClient" src` 只命中 `src/stores/sync.test.ts`;
  - `SyncSettings.vue:151` 直接调用 `await sync.login()`,而 `login()` 第一行即 `if (!api) return null`(`sync.ts:118`),UI 收到 `null` 后静默 `return`(`SyncSettings.vue:152`);
  - `sync.init()` / `bindTotpStore()` 同样无生产调用点。
- **触发条件**:真实用户打开"设置 → 云同步"并打开开关。
- **影响**:Web 端"开启云同步"开关**从未成功过**,且失败是静默的(`login()` 返回 `null` 时无任何错误提示,`SyncSettings.vue:152` 直接 return)。`docs/Phase2-task09/10` 标记"已完成"与事实不符。此发现同时解释了一个风险:任何依赖"同步已跑通"的验收结论都缺乏真实依据。
- **修复建议**:在应用装配层(如 `src/main.ts` 或 store 初始化处)构造并注入 `SyncApiClient`:
  ```ts
  const client = new SyncApiClient({
    baseUrl: import.meta.env.VITE_SYNC_API_BASE ?? '',
    auth: () => ({ kind: 'web' }), // Android 构建改为 bearer
    csrfToken: () => readCsrfCookie(), // 注意 F-01 的 Cookie 名修复
  })
  useSyncStore().configure(client)
  ```
  并让 `SyncSettings.vue` 在 `login()` 返回 `null` 时给出可见错误,而非静默返回。
- **验证 / 测试建议**:新增"装配测试"——在未注入 client 时调用 `sync.login()` 应产生可观测错误;注入后应发起真实(或 msw 拦截的)HTTP 请求。当前 `sync.test.ts` 每次测试都手动 `configure(stub)`,天然掩盖了装配缺失。
- **参考**:§3.2、§11、Phase2-09 §1、Phase2-10
- **置信度**:高

---

### [F-08] `sync_identity` 从未写入,§9"身份切换防护"实际不存在

- **严重性**:高
- **类型 / CWE / OWASP**:安全控制未实现 / CWE-1059 / OWASP A01:2021
- **位置**:
  - `src/services/sync/types.ts:44-57`(`SyncIdentity` / `SyncState.sync_identity`)
  - `src/stores/sync.ts:85-88`(`init()` 依赖它)
  - `src/stores/sync.ts:126-129`(声明了防护但**函数体为空注释**)
  - 写入点:**不存在**(`sync_identity` 仅被 `normalizeSyncState` 读取与 `storage.ts` 的修复逻辑清空)
- **证据**:
  ```ts
  // src/stores/sync.ts:125-129
  const state = await loadSyncState()
  if (state.sync_identity && me.value) {
    // 身份切换防护(§9):不同 (issuer, sub) 必须显式解绑
    // login 只在成功认证后调用;identity 由 BFF/JWT 提供,此处记录 user 绑定
  }
  ```
  这段代码既没有比较 `sync_identity` 与当前 `me`,也没有把 `me` 的身份**写回** `sync_identity`。而 `init()`:
  ```ts
  if (!state.sync_identity || !state.user_id) {
    setStatus('unauthenticated')
    return
  }
  ```
  因此在真实流程中 `init()` 永远判定为未认证,启动时自动同步永不发生。
- **触发条件**:用户以身份 A 绑定并上传本地 vault 后,改用身份 B 登录(或共享设备上他人登录)。
- **影响**:`docs/Phase2.md` §9 明确要求"切换 Access 身份必须显式解绑;禁止把本地 vault 自动上传到另一个账号"。当前既没有身份比对,也没有把 `user_id` 与身份一起写入;`completeBinding`(`sync.ts:158-169`)只写 `user_id`,不写 `sync_identity`,所以"换个账号登录后重新开同步"会走完整的首次绑定向导并把**同一份本地 vault 推到新账号**——这正是 §9 禁止的场景,且 UI 的"合并/覆盖"提示不足以构成身份隔离。
- **修复建议**:
  1. `me` 响应需要包含 `issuer`/`sub`(目前 `AuthMe` 只有 `user_id` 与 `email`:`src/services/sync/api.ts:56-59`;服务端 `server/src/routes/me.ts:14-18` 也确实是 `claims.email`)。**先扩展 API** 返回 `issuer`/`sub`(它们是稳定身份键,email 不是:§4.1);
  2. `login()`/`completeBinding()` 中实际写入 `sync_identity = { issuer, subject }`;
  3. 当 `state.sync_identity` 与当前 `me` 不一致时,**阻断并强制显式解绑**,不得自动上传。
- **验证 / 测试建议**:测试——预置 `sync_identity = {A}`,注入返回身份 B 的 stub,调用 `completeBinding('merge')`,断言**没有**发起 `putVault` 且状态为需解绑。
- **参考**:§9、§4.1、Phase2-08 §4、Phase2-09
- **置信度**:高

---

### [F-09] `vault_revisions` 唯一索引与"current + 2"语义冲突,历史保留可被压缩到 1 条

- **严重性**:中
- **类型 / CWE / OWASP**:业务逻辑缺陷(数据可恢复性)/ CWE-1059
- **位置**:
  - `server/migrations/0001_init.sql:54-66`(`UNIQUE (user_id, revision)` + `CREATE UNIQUE INDEX idx_vault_revisions_user_revision`)
  - `server/src/services/vault.ts:184-204`(先 `copyCurrentToHistory` 再 CAS,失败后 `continue`)
- **证据**:
  ```ts
  await copyCurrentToHistory(env, repos, userId, current, now)   // 用 current.revision 插入
  const result = await repos.vaults.updateWithCas(userId, current.revision, {...})
  if (result.meta && result.meta.changes === 0) {
    attempt++
    if (attempt >= CAS_MAX_ATTEMPTS) throw new ApiError('INTERNAL_ERROR', 'vault revision contention exceeded')
    current = await repos.vaults.getByUserId(userId)
    continue                                                      // ← 再次插入同一 revision
  }
  ```
  历史插入用的是 `current.revision`,而 `vault_revisions` 对 `(user_id, revision)` 有唯一约束。CAS 竞争时循环重试会对**同一个** `current.revision` 二次插入,触发唯一约束冲突 → 抛出未预期的 D1 错误 → 被 `errorHandler` 映射为 500。
- **触发条件**:两个设备在同一毫秒窗口并发 `PUT /vault`。
- **影响**:
  1. 并发同步直接返回 500(客户端 `handlePushError` 对 `>=500` 会重试,可能反复失败),违反 `docs/Phase2.md` §7.4"服务端自动处理 revision 竞争,不把普通合并冲突作为 409 返回"的设计意图(变成了 500);
  2. 即使不冲突,这个"先写历史、后 CAS"的顺序在失败路径上会**持续累积垃圾历史行**,而 `prune(userId, 2)` 只保留 revision 最大的 2 条——可能把真正有用的近两次版本挤掉,削弱 §2 决策 12"3 个可恢复版本"的承诺;
  3. `CAS_MAX_ATTEMPTS = 3` 无退避、无抖动,高并发下必然触顶。
- **修复建议**:
  1. 把 `copyCurrentToHistory` 移到 **CAS 成功之后**,并在同一逻辑中复制"刚被替换掉的旧 current";
  2. 给历史插入加冲突容忍(`INSERT ... ON CONFLICT (user_id, revision) DO NOTHING`),保证幂等;
  3. CAS 失败改为带小退避的重试,并在触顶时返回可重试的语义错误码(建议 409/429 或明确可重试的 5xx),而非笼统 500;
  4. 明确"历史条数"的唯一真相来源:`vaults.revision` 递增 + `prune(userId, 2)` 的组合已足够,不必依赖失败路径的插入。
- **验证 / 测试建议**:并发测试——用两个并行 `putVault` 打同一用户,断言两次都成功、`revision` 单调、`vault_revisions` 恰为 2 条且不含重复 revision。现有 `vault.test.ts` 为串行用例,未覆盖该路径。
- **参考**:§7.1、§8.8、Phase2-06 §5、Phase2-07
- **置信度**:中高(唯一约束与重试插入已确认;具体触发概率取决于 D1 并发语义,标记需实测确认)

---

### [F-10] merge 抛出的 `ClockSkewError` 未被映射为 422

- **严重性**:中
- **类型 / CWE / OWASP**:错误处理缺陷 / CWE-391 / OWASP A09:2021
- **位置**:`server/src/services/merge.ts:471-476`(定义)、`:445`、`:458`(抛出)、`server/src/middleware/errors.ts:29-47`(未处理)
- **证据**:`mergeVaultPayloads` → `correctIncomingMeta` 在 `correctClientTime` 返回 `'skew'` 时 `throw new ClockSkewError()`。`ClockSkewError extends Error`,既不是 `ApiError` 也不是 `ZodError`,因此在 `errorHandler` 中落到兜底分支:打印日志并返回 **500 `INTERNAL_ERROR`**,而 `server/src/errors.ts:26` 为 `CLOCK_SKEW` 定义的状态码是 **422**。
- **触发条件**:`vault.ts:58-70` 的 `assertNoHardSkew` 预检与 `merge.ts:71-77` 的 `correctClientTime` 判定**不完全一致**时,请求会穿过预检却在 merge 中抛出。两者的边界比较(`> maxAhead` vs `ahead > CLOCK_MAX_SKEW_MS`)在相等点附近存在偏差空间,建议实测确认具体可构造的输入。
- **影响**:客户端收到 500,`handlePushError`(`src/stores/sync.ts:435`)把它当作**可重试**错误并进入指数退避重试——但客户端时钟偏差不会自行消失,于是形成**无限重试循环**,持续消耗配额且用户看不到正确提示("设备时间不准")。§14 明确定义该场景为 422 `CLOCK_SKEW`。
- **修复建议**:
  1. 在 `errorHandler` 中显式捕获 `ClockSkewError` → `errorResponse(c, 'CLOCK_SKEW', ...)`(422);
  2. 消除两处时钟判定的重复实现:让 `merge.ts` 的 `correctClientTime` 成为唯一判定源,`vault.ts` 的预检改为调用同一函数;
  3. 统一边界语义(严格 `>` 与 `>=`),并补边界测试。
- **验证 / 测试建议**:表驱动测试覆盖 `ahead ∈ {0, 5min, 5min+1, 24h, 24h+1}`,断言分别得到 `accepted/clamped/skew`,且 skew 场景 HTTP 码为 422。
- **参考**:§8.7、§14、Phase2-07
- **置信度**:中(异常类型与未处理路径已确认;具体触发输入需实测)

---

### [F-11] 会话生命周期配置在创建与校验两侧不一致

- **严重性**:中
- **类型 / CWE / OWASP**:配置未生效(可用性)/ CWE-1188
- **位置**:`server/src/services/sessions.ts:177`(创建)、`:241`(校验)
- **证据**:
  ```ts
  // createSession —— 传空对象,忽略所有 env 覆盖
  const { idleMs, absoluteMs } = sessionLifetimes({})
  ...
  // getSession —— 传真实 env
  const { idleMs, slidingWindowMs } = sessionLifetimes(deps.env)
  ```
  `sessionDepsFromBindings`(`sessions.ts:143-156`)确实把 `SESSION_IDLE_DAYS` / `SESSION_ABSOLUTE_DAYS` / `SESSION_SLIDING_WINDOW_DAYS` 从 bindings 传进了 `deps.env`,但 `createSession` 用的是 `sessionLifetimes({})`,即**永远用默认 30 天 / 90 天 / 7 天**。
- **触发条件**:运维按 `server/src/env.ts:31-36` 的注释设置了会话期环境变量。
- **影响**:两套阈值并存。例如运维设 `SESSION_IDLE_DAYS=7` 期望收紧会话,但新会话仍写 30 天;`getSession` 却按 7 天判定 → 会话在校验侧提前失效,用户被意外登出。反向配置(`SESSION_IDLE_DAYS=60`)则更糟:`getSession` 的滑动逻辑会把 `expires_at` 延长到 `min(now+60d, absolute)`,与"空闲 30 天"的文档承诺不符。配置语义不可信,且属于难排查的运行期故障。
- **修复建议**:`createSession` 改为 `sessionLifetimes(env)`(`SessionKekEnv` 扩展为 `SessionKekAndLifetimeEnv`,或让 `CreateSessionInput` 接收 lifetimes);并补一条"配置生效"断言。
- **验证 / 测试建议**:测试——用 `{ SESSION_IDLE_DAYS: '7' }` 创建会话,断言 `row.expires_at - row.created_at === 7 * DAY_MS`。
- **参考**:§4.2、Phase2-04 §5
- **置信度**:高

---

### [F-12] `putsVault` 会把管理员的非 `cloud_deleted` 状态静默重置为 `active`

- **严重性**:中
- **类型 / CWE / OWASP**:状态机/权限模型缺陷 / CWE-863
- **位置**:`server/src/services/vault.ts:223-226`
- **证据**:
  ```ts
  // ---- 云端删除标记复位 ----
  if (userRow.status !== 'active') {
    await repos.users.setStatus(userId, 'active', now)
  }
  ```
  该复位是"用户删除云端数据后重新上传"所需,但它按 `!== 'active'` 宽泛匹配,会**一并清除其它任何状态**。`UsersRepository.setStatus`(`repositories.ts:110-112`)是通用 setter,而 `users.status` 在 schema 中只有 `'active' | 'cloud_deleted'` 两个已知取值。
- **触发条件**:管理员/风控将来通过 `setStatus(userId, 'suspended'|'banned', ...)` 停用某用户后,该用户下一次 `PUT /vault` 即可自助复活。
- **影响**:任何非 `cloud_deleted` 的账号封禁状态被同步请求静默解除——**权限提升/封禁绕过**。当前代码库尚无其它状态写入点,故为**潜在**缺陷,但只要后续加入风控就会立即成为真实漏洞。
- **修复建议**:把判定收窄为精确匹配 `if (userRow.status === 'cloud_deleted')`,并在 `UsersRepository` 中把状态值收敛为显式枚举(或至少在 `setStatus` 入口校验),避免未来新增状态时重蹈覆辙。
- **验证 / 测试建议**:测试——`setStatus(u,'suspended')` 后调用 `putVault`,断言状态仍为 `suspended`。
- **参考**:§10、§14
- **置信度**:高(代码路径确定;当前 `status` 取值的现实取值范围已在证据中说明)

---

### [F-13] PKCE `state → verifier` 存于 isolate 内存 Map,登录流程不可靠

- **严重性**:中
- **类型 / CWE / OWASP**:可用性/正确性 / CWE-1059
- **位置**:`server/src/routes/auth.ts:100-127`(自述 TODO)
- **证据**:
  ```ts
  /**
   * TODO(Phase2-04 hardening): this in-memory Map only works within one
   * isolate; production must store it in Workers KV (or D1) with a TTL so
   * login works across colos and survives restarts.
   */
  const pendingLogins = new Map<string, PendingLogin>()
  ```
  `/auth/login` 在 isolate A 写入,`/auth/callback` 很可能被路由到 isolate B 或重启后的实例 → `consumeChallenge` 返回 `null` → `errorResponse(c, 'UNAUTHENTICATED', 'invalid login state')`。
- **触发条件**:生产多 colo / 实例回收下的任意 Web 登录。
- **影响**:登录**随机**失败且错误信息误导(用户以为是自己的 state 有问题)。同时该 Map 无容量上限(`pruneExpired` 只在 `/auth/login` 触发),短期大量 `/auth/login` 会累积内存(受 isolate 内存上限约束,属轻微 DoS 面)。
- **修复建议**:按注释迁移到 Workers KV 或 D1(键 `state`,值 `{verifier, expiresAt}`),写 TTL;`consumeChallenge` 改为**读写即删**(KV 不支持原子删除,可用 D1 `DELETE ... RETURNING` 或"先标记已用"实现单次消费);同时给 Map 加容量上限作为兜底。
- **验证 / 测试建议**:该缺陷无法在单进程测试中暴露,必须在 staging 做**跨 colo**登录 smoke test(`docs/Phase2.md` §15.2 已列为必做项)。
- **参考**:§4.2、§15.2、Phase2-04 §1
- **置信度**:高

---

### [F-14] Access token 刷新为未实现的 stub,且 `TODO` 中记录了不存在的环境变量名

- **严重性**:中
- **类型 / CWE / OWASP**:交付物缺失 / CWE-1059
- **位置**:`server/src/services/sessions.ts:286-309`
- **证据**:

  ```ts
  async function stubRefreshCall(
    _teamDomain: string,
    _refreshToken: string,
  ): Promise<TokenRefreshResult> {
    void _teamDomain
    void _refreshToken
    throw new ApiError('UNAUTHENTICATED', 'token refresh not implemented')
  }
  ```

  且注释引用的变量名与实际实现不一致:

  > `&client_id=<CF_ACCESS_OIDC_CLIENT_ID>` … `TODO(Phase2-04 hardening): add the CF_ACCESS_OIDC_CLIENT_ID/SECRET env vars`

  但 `server/src/env.ts:37-40` 定义的是 `ACCESS_OIDC_CLIENT_ID` / `ACCESS_OIDC_CLIENT_SECRET`,`server/src/routes/auth.ts:72,196,200` 使用的也是后者。按注释去配 `CF_ACCESS_OIDC_CLIENT_ID` 将**无效**,增加运维踩坑概率。

- **触发条件**:任何 `refreshAccessToken` 调用(即 Web session 的 access token 需要续期时)。
- **影响**:刷新必然失败 → `refreshAccessToken` 走 catch → `revoke(row.id)` 撤销会话 → 用户被强制重新登录。功能上"登录后约 Access token 有效期即掉线",与 §4.2"BFF 负责服务端刷新 Access token"不符。(目前 `refreshAccessToken` 在生产代码中也**没有调用点**,与 F-07 的装配缺失同源。)
- **修复建议**:
  1. 按注释实现真实 OIDC refresh(带 `AbortSignal.timeout`、失败分类、限流);
  2. 更正 TODO 中的变量名为 `ACCESS_OIDC_CLIENT_ID` / `ACCESS_OIDC_CLIENT_SECRET`;
  3. 在 `requireUser` 的 cookie 分支中接入"临近过期即刷新"逻辑,否则 refresh 代码永远不会被触发。
- **验证 / 测试建议**:用 `__fetch` 桩注入 200/400/超时三种响应,断言 respectively 更新行、撤销会话、撤销会话。
- **参考**:§4.2、§13.2、Phase2-04 §1
- **置信度**:高

---

### [F-15] 静态应用壳缺失 CSP,`securityHeaders` 只作用于 Worker 路由

- **严重性**:中
- **类型 / CWE / OWASP**:缺失安全头 / CWE-1021 + CWE-693 / OWASP A05:2021
- **位置**:`server/src/middleware/securityHeaders.ts:31-39`、`public/`(无 `_headers`)、`index.html:19-38`(主题内联脚本)
- **证据**:
  - `securityHeaders()` 挂在 Worker 的 `app.use('*')`(`server/src/index.ts:27`),而 Worker 只处理 `/api/*` 与 `/auth/*`;HTML 由 Pages 提供。
  - `public/` 下只有图片与 `site.webmanifest`,**没有 `_headers` 文件**,即 Pages 不注入任何 CSP/X-Frame-Options。
  - `index.html` 含必须放行的内联脚本,其哈希已被硬编码在 `server/src/middleware/securityHeaders.ts:13`(`THEME_SCRIPT_HASH`)。
- **触发条件**:任何加载 HTML 应用壳的浏览器。
- **影响**:`docs/Phase2.md` §12 要求"设置基础 CSP;禁止内联脚本,`connect-src` 仅允许同源和 Access 必要域名"。当前 CSP 只保护 API 响应(对 API 而言 `script-src` 等基本无意义),**真正承载 DOM 与内联脚本的 HTML 完全无保护**。虽然 Vue 默认转义 + 无 `v-html` 会显著降低 XSS 可行性(见 F-16),但"无 CSP 兜底"意味着任一渲染缺陷都能直接升级为完整 XSS。
- **修复建议**:新增 `public/_headers`(Cloudflare Pages 原生支持),为 HTML 响应设置与 `buildCsp()` **同一套**策略,避免两处策略漂移;若采用 Workers Static Assets 迁移(§3.1 已将其列为备选),则复用 `securityHeaders()`。同时补 `Strict-Transport-Security`、`X-Frame-Options: DENY`(Pages 侧)。
- **验证 / 测试建议**:对部署后的 `https://app.example.com/` 断言响应头含 CSP 且哈希与 `THEME_SCRIPT_HASH` 一致;`docs/Phase2.md` §15.2 已要求"确认 CSP 在核心 Web 页面通过"。
- **参考**:§11.1、§12、Phase2-11 §3 与验收标准第 5 条
- **置信度**:高

---

### [F-16] `wrangler.toml` 中 staging/production 未声明独立 D1 与 DO 绑定

- **严重性**:中
- **类型 / CWE / OWASP**:环境隔离缺陷 / CWE-1188 / OWASP A05:2021
- **位置**:`server/wrangler.toml`(全文)
- **证据**:顶层声明了 `[[d1_databases]] binding = "DB" … database_id = "local-dev-db"` 与 `[durable_objects] bindings = [...]`,而 `[env.staging]` / `[env.production]` **只覆盖了 `name` 和 `vars`**:
  ```toml
  [env.staging]
  name = "hybrid-totp-server-staging"
  vars = { SYNC_ENABLED = "false", MIN_CLIENT_VERSION = "0.0.1" }

  [env.production]
  name = "hybrid-totp-server-production"
  vars = { SYNC_ENABLED = "false", MIN_CLIENT_VERSION = "0.0.1" }
  ```
  Wrangler 对 environment 采取**合并继承**语义:D1 与 DO 绑定会从顶层继承。因此 staging 与 production **指向同一个 `database_id`**。
- **触发条件**:执行 `npx wrangler deploy --env production`(CI 中已配置,见 `.github/workflows/server.yml` 的 `deploy-production` 作业)。
- **影响**:直接违反 `docs/Phase2.md` §13.1"禁止在 staging 与 production 之间共享 D1、KEK、Access application 或 session"与 `server/OPERATIONS.md` §1 的隔离矩阵。staging 的写入、测试数据、乃至 migration 会作用于**生产数据库**——这是单点即可造成生产数据损坏/泄漏的配置缺陷。`deploy-staging` 与 `deploy-production` 还会对同一 DB 执行 `d1 migrations apply`,staging 先跑 migration 等于提前改动生产 schema。
- **修复建议**:在 `[env.staging]` 与 `[env.production]` 中分别显式声明各自的 `[[env.<name>.d1_databases]]`(独立 `database_id`)与 `[env.<name>.durable_objects]` + 对应 `[[env.<name>.migrations]]`;把 `local-dev-db` 占位符换成真实 UUID;并在 CI 增加断言(如 dry-run 后解析配置,若两环境 `database_id` 相同则失败)。
- **验证 / 测试建议**:`npx wrangler deploy --env staging --dry-run` 与 `--env production --dry-run` 对比输出中的 D1 binding id,必须不同。`docs/Phase2.md` §15.3 只要求 dry-run 通过,无法发现该问题,故需显式断言。
- **参考**:§13.1、§13.4、Phase2-12
- **置信度**:高(wrangler 环境继承语义;`database_id` 为占位符亦已在文件中确认)

---

### [F-18] 测试只覆盖了合成的 CSRF 路由,未覆盖真实写路由的挂载

- **严重性**:中
- **类型 / CWE / OWASP**:测试有效性缺陷 / CWE-1059
- **位置**:`server/test/sessions.test.ts:383-433`、`src/utils/sw.test.ts:13-24`
- **证据**:
  - CSRF 测试全部针对合成路由 `/api/v1/__guarded`(如 `sessions.test.ts:396,403,409,416,422`),因此"CSRF 中间件本身正确"与"CSRF 中间件被挂到写路由上"是两回事——后者无测试,正是 F-04 得以共存的原因;
  - `src/utils/sw.test.ts` 通过**读取 `vite.config.ts` 源码字符串**断言 PWA 缓存策略:
    ```ts
    const viteConfigSource = readFileSync(resolve(__dirname, '../../vite.config.ts'), 'utf-8')
    expect(viteConfigSource).toMatch(/navigateFallbackDenylist:\s*\[[^\]]*\/\^\\\/api\\\//)
    ```
    这只能证明**配置文本**里写了规则,不能证明生成的 Service Worker 行为正确;改用一个语义等价的写法(如数组变量、转义差异)即可让测试失败而功能正常,反之亦然。
- **触发条件**:回归 —— 任何人删掉某路由的 `requireCsrf`、或改写 `vite.config.ts` 的表达方式。
- **影响**:安全控制的回归无法被 CI 捕获,给出虚假的覆盖感。
- **修复建议**:
  - CSRF/鉴权类测试改为对**真实 app 与真实路由**发请求(`vaultTestHelpers.ts:7-13` 已经展示了如何挂真实路由,可直接复用);
  - Service Worker 策略改为构建后断言:`npm run build` 产物中的 `sw.js`/workbox 配置,或直接检查 `dist/` 是否出现 `runtimeCaching` 的 `NetworkFirst`/`CacheFirst` 策略;至少断言 `/api/` 在 `navigateFallbackDenylist` 的同时,`globPatterns` 不包含任何 API 路径。
- **验证 / 测试建议**:对每个写路由做一次"删掉 `requireCsrf` 后测试应当失败"的变异验证(mutation check),确认测试确实有判别力。
- **参考**:§15.1、§15.3、Phase2-11 §3、Phase2-12
- **置信度**:高

---

### [F-19] `sizeOk` 用 UTF-16 码元长度代替字节数

- **严重性**:低
- **类型 / CWE / OWASP**:限制实现不精确 / CWE-1284
- **位置**:`server/src/services/vault.ts:47-55`、`server/src/services/vaultSchemas.ts:83`
- **证据**:
  ```ts
  function sizeOk(request: PutVaultRequest): void {
    const bytes = payloadToString({ schema_version: 1, data: request.data, meta: request.meta }).length
    if (bytes > MAX_PAYLOAD_BYTES) { throw new ApiError('PAYLOAD_TOO_LARGE', ...) }
  }
  ```
  `.length` 是 UTF-16 码元数(`MAX_PAYLOAD_BYTES = 1024 * 1024` 被当作"字节"使用)。含大量非 ASCII 字符(中日韩 issuer/label)时,真实 UTF-8 字节数可达该值的约 3 倍。
- **触发条件**:提交大量非 ASCII 内容。
- **影响**:`docs/Phase2.md` §12"1 MiB 上限"实际可被放宽到约 3 MiB。缓解因素:字段级限长(`issuer`/`label` ≤256、`secret` ≤512)与 `MAX_ENTITIES = 5000` 共同把真实上限压在 1 MiB 量级以内,故**实际影响有限**,但作为容量控制语义仍不准确,且未来放宽字段限长后会放大。
- **修复建议**:改用 `new TextEncoder().encode(json).byteLength`(Workers 环境原生支持),变量名同步改为 `byteLength`。
- **验证 / 测试建议**:构造全 CJK 字符的 payload,断言其字节数超限时返回 413。
- **参考**:§12、Phase2-11 §1
- **置信度**:高

---

### [F-20] `VALIDATION_ERROR` 响应回显字段路径,存在轻微信息泄露

- **严重性**:低
- **类型 / CWE / OWASP**:信息暴露 / CWE-209
- **位置**:`server/src/middleware/errors.ts:24-36`
- **证据**:`describeZodError` 把 `${issue.path.join('.') || '(root)'}: ${issue.message}` 拼进**客户端可见**的 `message`。Zod 的 message 通常只描述期望形状(如 `Expected number, received string`),不含值本身,因此不直接泄露 secret;但字段路径会暴露内部 payload 结构(`meta.items.<id>.updatedAt` 之类),对攻击者侦察有益。
- **触发条件**:发送畸形的 `PUT /vault`。
- **影响**:轻微。不泄露 TOTP secret 或凭证(已核对:异常响应在 `api.test.ts:70-79` 有断言不含堆栈)。
- **修复建议**:响应体只返回稳定的 `code` + 通用 message(如 `invalid request`),把字段路径写入**服务端日志**(已有 `request_id` 可关联)。
- **验证 / 测试建议**:断言 `PUT /vault` 的畸形请求响应体不含 `data.` / `meta.` / 实体 id。
- **参考**:§14
- **置信度**:高

---

### [F-21] 登录限流缺失 + 状态 Map 无界(与 F-03/F-13 相关)

- **严重性**:低
- **类型 / CWE / OWASP**:资源管理 / CWE-770
- **位置**:`server/src/routes/auth.ts:108-127,149-162`
- **证据**:`pendingLogins` 只在 `/auth/login` 内 `pruneExpired(Date.now())`,没有条目数上限;`/auth/login` 与 `/auth/callback` 均无中间件限流(见 F-03)。每次登录还会生成 PKCE 对与 32 字节 state。
- **触发条件**:匿名高频 `GET /api/v1/auth/login`。
- **影响**:内存与 CPU 消耗,受 isolate 内存上限约束;更实际的风险是**向 Access 发起大量 302 跳转**形成侦察/骚扰面,以及占用 isolate 资源影响同一 isolate 上的正常请求。
- **修复建议**:在 `/auth/login` 挂 IP 维度的限流(可与 `authCallbackLimiter` 共用实现);`pendingLogins` 增加容量上限(LRU,如 10k 条)并在超限时淘汰最旧项。
- **验证 / 测试建议**:灌入超过容量上限的登录请求,断言 Map 大小有界且旧条目被淘汰。
- **参考**:§12
- **置信度**:高

### [F-22] `ACCESS_JWKS` 无环境守卫,可把 Access 验签降级为"信任内联公钥"

- **严重性**:中(配置面为运营受限;若在 production 被设置则升级为**严重**)
- **类型 / CWE / OWASP**:认证绕过风险 / CWE-290 / OWASP A07:2021 认证与鉴别失效
- **位置**:`server/src/services/access.ts:106-111`、`server/src/env.ts:20-24`、`server/test/access.test.ts:118-130`
- **证据**:
  ```ts
  function resolveJwks(env: AccessTokenEnv, options?: VerifyOptions): JwksResolver {
    if (options?.jwks) return options.jwks
    if (env.__jwksResolver) return env.__jwksResolver
    if (env.ACCESS_JWKS) return localResolverFromJson(env.ACCESS_JWKS) // ← 无环境判断
    return remoteResolverFor(env)
  }
  ```
  `env.ts:20-24` 只在**注释**里声明"Local dev / tests only — never set in staging or production",代码中没有任何运行时守卫。测试 `access.test.ts:118-130` 反而把"设了 `ACCESS_JWKS` 就用它验签"固化为**期望行为**。
- **触发条件**:production 环境的 `ACCESS_JWKS` 被写入任意攻击者自持公私钥的 JWK set。此时 `verifyAccessToken` 会用该公钥成功验证攻击者自签的 token,`iss`/`aud`/`sub`/`email` 可任意伪造 → **完全认证绕过**,可访问任意用户 vault。
- **影响**:这是本项目**唯一具备"完全绕过身份体系"潜力**的开关。它的危险在于"静默生效":没有任何启动断言、没有 `/capabilities` 暴露、没有日志告警,运维也不会从 `wrangler.toml` 看到它(`wrangler.toml` 里确实没有该 `vars`,但 `wrangler secret put ACCESS_JWKS` 或误提交的 `vars` 都能设置)。§13.1/§13.2 的配置清单里也**没有**列出 `ACCESS_JWKS`,即它是一份未受治理的配置项。
- **修复建议**:
  1. 增加显式环境判定:仅当 `ENVIRONMENT` / `WRANGLER_ENV` 为 `local`/`test` 时才允许 `ACCESS_JWKS`,否则**拒绝启动或忽略该变量并记录 error 级告警**;
  2. 把 `__jwksResolver` 与 `ACCESS_JWKS` 收敛到同一处"仅测试可达"的注入点(例如只在构建期以不同入口替换),避免生产代码里存在可被环境变量打开的后门分支;
  3. 在 `/capabilities` 或运维健康检查中暴露 `jwks_source: 'remote' | 'inline'`,让"是否被降级"可被监控;
  4. 把 `ACCESS_JWKS` 写入 `docs/Phase2.md` §13.2 配置清单并标注"禁止用于 staging/production"。
- **验证 / 测试建议**:新增测试——`resolveJwks` 在"生产环境标记"下即便传了 `ACCESS_JWKS` 也必须走远端解析(或抛错)。在 staging 部署后断言 `wrangler secret list --env production` 不含 `ACCESS_JWKS`。
- **参考**:§4.1、§12、§13.2、Phase2-03 §2
- **置信度**:高(代码路径与"无守卫"已确认;实际可利用性取决于配置面,已在"触发条件"中说明)

---

### [F-23] `run-tests-node.mjs` 所用的 vitest shim 不支持 `rejects`,无法支撑"测试全绿"的结论

- **严重性**:中
- **类型 / CWE / OWASP**:验证有效性问题(非产品代码缺陷)/ CWE-1059
- **位置**:
  - `server/test/vitest-shim.ts:14-31`(`Expectation` 接口**没有** `rejects`)、`:151`(`expect = (actual) => new ExpectationImpl(actual)`)
  - `server/scripts/run-tests-node.mjs:66`(经 loader 把 `vitest` 别名指向 shim)
  - 使用方:`server/test/crypto.test.ts:54,70,77,107,113`、`server/test/access.test.ts:42,48,53,106,113,138` 等大量 `await expect(...).rejects.toThrow()/toMatchObject()`
- **证据**:`ExpectationImpl` 上不存在 `rejects` 属性;`expect(x)` 直接返回 `ExpectationImpl`。因此任何 `expect(...).rejects` 表达式在取属性时得到 `undefined`,随后 `.toThrow` / `.toMatchObject` 会抛 `TypeError`,该用例**必然失败**。而 `vitest-shim.ts:1-6` 与 `run-tests-node.mjs:1-9` 都把自身定位为"受限沙箱内的开发便利",官方 runner 仍是 `vitest`(`server/package.json:9` `"test": "vitest run"`,CI 也用它)。
- **触发条件**:通过 `node scripts/run-tests-node.mjs` 运行任一含 `.rejects` 的用例。
- **影响**:
  - 该 runner 的"全绿"输出**不能**作为验收证据,却容易被当成"自动测试全绿"的依据(`docs/Phase2.md` 头部与各 task 的状态行正是这种表述);
  - 反过来,若某次报告中"全绿"来自该 runner,则说明失败用例计数被吞掉或未真正执行含 `.rejects` 的用例——无论哪种情况,加密与认证这两个**最关键的测试文件**(`crypto.test.ts`、`access.test.ts`)的有效性都存疑;
  - 这直接损害 §15.1"加密测试:DEK/KEK wrap/unwrap、AAD、错误密钥…"的可信度。
- **修复建议**:
  1. 若保留该沙箱 runner,为 shim 补齐 `rejects`(返回一个把同步断言适配到 Promise 的包装)、`resolves`、`toHaveBeenCalled*`、`vi.fn` 等实际被用到的 API;
  2. 更简单且更稳的做法:**删除该 runner**,只以 `vitest` 为准,并在 CI/验收记录中明确"绿=vitest 通过";
  3. 在 `docs/Phase2.md` §15.3 的完成门槛里,把测试命令收紧为 `npm run server:test`(vitest),避免 `run-tests-node.mjs` 被误用为证据。
- **验证 / 测试建议**:在 shim 下运行 `server/test/access.test.ts`,断言其通过数应与 vitest 一致;不一致即证明该 runner 不可用于验收。另可对 shim 做一次"故意破坏被测代码后测试应当失败"的变异验证。
- **参考**:§15.1、§15.3、Phase2-12
- **置信度**:高(接口缺失与调用方均已逐行确认;唯一未确认项是"实际用的是哪个 runner",故在"需要补充的信息"第 6 条已要求 CI 日志)

### [F-24] Android `FileProvider` 暴露整个外部存储与缓存目录

- **严重性**:中
- **类型 / CWE / OWASP**:权限配置过宽 / CWE-732 / OWASP A01:2021
- **位置**:`android/app/src/main/res/xml/file_paths.xml:2-5`
- **证据**:
  ```xml
  <paths xmlns:android="http://schemas.android.com/apk/res/android">
      <external-path name="my_images" path="." />
      <cache-path name="my_cache_images" path="." />
  </paths>
  ```
  `<external-path path="." />` 把**整个外部存储根**纳入 `FileProvider` 可授权 URI 范围;`<cache-path path="." />` 同理覆盖整个应用缓存目录。而 `AndroidManifest.xml:28-36` 已声明该 provider 且 `android:grantUriPermissions="true"`。
- **触发条件**:应用向其它 app(或通过 `Intent` 携带的 URI)授予某个 `content://${applicationId}.fileprovider/...` 的读权限时;或系统分享/下载流程中被诱导构造路径(存在路径穿越时影响放大)。
- **影响**:`FileProvider` 的本意是"只共享明确的少数文件"。当前配置使任何一次 URI 授权都可能让接收方读取**该 provider 指向目录下的任意文件**——包括其它应用写入的外部存储内容,以及应用缓存目录中可能存在的敏感中间产物。这与 Phase 1 声明的"最小权限原则"(见 `AndroidManifest.xml:43-47` 对 `ACCESS_NETWORK_STATE` 的 `tools:node="remove"`)自相矛盾。
- **修复建议**:把 `<external-path>` / `<cache-path>` 收窄到实际需要的子目录(例如仅导出/分享所需目录):
  ```xml
  <cache-path name="exports" path="exports/" />
  <files-path name="tmp_exports" path="tmp/" />
  ```
  并**移除** `<external-path path="." />`——本项目已有 `fileExport.ts`/`backup.ts` 的导出能力,应改为写入应用私有目录后经精确的 `files-path` 授权分享。
- **验证 / 测试建议**:静态断言 `file_paths.xml` 不出现 `path="."`;手工测试用另一 app 通过 `ACTION_VIEW` 打开一个未授权路径的 `content://` URI,应被拒绝。
- **参考**:§12(最小权限精神)、Android `FileProvider` 官方指南
- **置信度**:高(配置文件与 manifest 授权已确认;实际可利用性取决于应用如何发放 URI 权限,需结合导出流程确认)

---

### [F-25] `release.yml` 中标签输入被插值进 shell,且 Android `allowBackup` 未收紧

- **严重性**:低
- **类型 / CWE / OWASP**:CI 输入处理 + 平台配置 / CWE-78、CWE-312
- **位置**:`.github/workflows/release.yml:19-21,38-42,143,148`;`android/app/src/main/AndroidManifest.xml:6`
- **证据**:
  - `release.yml:143` 把 `TAG`(`workflow_dispatch` 的用户输入 `release_tag`)直接放进 bash:`ver="${TAG#v}"`,同文件 `:19-21` 定义 `TAG: ${{ inputs.release_tag || github.ref_name }}`。虽然 `TAG` 经 `$GITHUB_ENV` 传递(比直接 `${{ }}` 插值到 `run:` 安全),但 `scripts/release-notes.mjs` 与 `zip -r "...-${TAG}-web.zip"`(`:99`)也直接使用它,未做字符白名单校验(GitHub 允许 `release_tag` 含 `/`、`(`、`` ` `` 等)。触发该工作流需要仓库写权限,故实际风险低。
  - `AndroidManifest.xml:6` `android:allowBackup="true"`(未配 `dataExtractionRules`/`fullBackupContent`):Phase 2 要求 refresh token 存 Android 安全存储(`docs/Phase2.md` §4.3),而 `allowBackup=true` 允许通过 `adb backup`/云备份导出应用数据。若 Android 侧实现已落地,安全存储内容会进入备份面;`EncryptedSharedPreferences` 的主密钥在 Keystore 中,备份通常无法解密,故风险为低,但仍应与 §4.3 的安全目标对齐。
- **触发条件**:有仓库写权限者用畸形 `release_tag` 触发 `workflow_dispatch`;或具备设备物理/调试访问的攻击者利用备份导出。
- **影响**:CI 侧为输入卫生问题(不构成未授权利用);Android 侧为备份面扩大。二者均非当前最紧迫问题,但可作为"配置对齐"项清理。
- **修复建议**:
  1. 在 `checks` 作业中用 `[[ "$RELEASE_TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]] || exit 1` 校验标签格式,再允许其进入后续步骤;
  2. 把 `android:allowBackup` 设为 `false`,或显式提供 `android:dataExtractionRules` / `android:fullBackupContent` 排除安全存储与 vault 数据;
  3. 把 `cloudflare/wrangler-action@v3`、`softprops/action-gh-release@v2`、`actions/*@v4` 尽可能按 commit SHA 固定(zero-trust 供应链做法)。
- **验证 / 测试建议**:尝试用 `release_tag='v1.0.0;id'` 触发,应被格式校验拒绝;`adb backup` 后检查备份内容不含 vault/凭证。
- **参考**:§4.3、Phase2-12
- **置信度**:中(CI 输入路径已确认;Android 备份面的实际影响依赖尚未找到的 Android 侧实现)

---

## 附录 D:延伸发现(供应链、CI/CD、Android 与测试有效性)

> 本附录汇总三个定向并行审计的发现(CI/CD 与供应链、客户端同步引擎、自动化测试覆盖),**与上面的 F-xx 主发现列表同属本次审计结论**,只是为可读性按主题集中列此。编号 `C-nn` 与 `F-nn` 互不重叠,优先级表中两者并列引用。

以下条目来自三个定向并行审计(CI/CD 与供应链、客户端同步代码、自动化测试覆盖),均已由我在本机复核关键证据行号。汇总列此,细节不再展开为完整条目。

C-01～C-13 为供应链与 CI/CD;C-15 起为客户端同步引擎。

### D.1 供应链与 CI/CD

| ID   | 严重性 | 位置                                                                                   | 证据与影响                                                                                                                                                                                                                                                                                           | 修复建议                                                                                                                                        |
| ---- | ------ | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| C-01 | 高     | `.github/workflows/release.yml:90,101,227`;`server.yml:23,25,56,57,81,82`              | 全部第三方与官方 action 均以**可移动 tag** 固定(`cloudflare/wrangler-action@v3`、`softprops/action-gh-release@v2`、`actions/*@v4`),无 commit SHA。这些 job 持有 `CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID` 与 keystore 口令 → 上游 tag 被移动即可窃取生产发布凭据并污染发布产物(CWE-1357/494)。 | 全部改为 `@<40位SHA> # vX.Y.Z`;启用 Dependabot/Renovate 更新 SHA。                                                                              |
| C-02 | 高     | `release.yml:71,74-75,88,90-93`                                                        | `CLOUDFLARE_API_TOKEN` 以 **step 级 env** 注入,而同一 job 内 `npm install`(:71)与 `npm run build`(:88)先于它执行。任一依赖的 `postinstall` 或构建期插件即可读取该 token(CWE-522/200)。                                                                                                               | 构建与部署拆分为不同 job(artifact 传递产物);构建用 `npm ci --ignore-scripts`;token 只注入真正调用 wrangler 的 step。                            |
| C-03 | 高     | `release.yml:52-56,89-97`                                                              | `deploy-web` job **无** `environment:` 保护,却直接 `pages deploy … --branch=<生产分支>`;对照 `server.yml:79` 已有 `environment: production`。推送任意 `v*` tag 即可无审批发布生产前端(CWE-1188)。                                                                                                    | 给 `deploy-web` 加 `environment: production`(开启 required reviewers);生产分支取自 `vars` 而非 `master` 兜底。                                  |
| C-04 | 高     | `release.yml` 全文;`server.yml:64-96`                                                  | 前端发布(按 tag)与 Worker/migration(按 main push)之间**无依赖**、两 workflow 均无 `concurrency:`。tag 可在生产 migration 未完成时先发布前端,违反 §13.4 的"migration → Worker → 前端"顺序,回滚顺序亦无法执行。                                                                                        | 用 `workflow_run` / 手动门禁把前端发布挂在生产 Worker 部署之后;两 workflow 共用 `concurrency: group: prod-release, cancel-in-progress: false`。 |
| C-05 | 中高   | `android/app/build.gradle:53`(配合 `:39`)                                              | `signingConfig keystorePath ? signingConfigs.release : signingConfigs.debug`:缺少签名材料时**静默回退到 debug 签名**,而 debug 密钥为全体开发机共知。误配 CI 或本地 `npm run android:release` 产出的 APK 可被同 debug 密钥伪造"更新"接管(CWE-321)。同时 `:49` `minifyEnabled false` 降低逆向门槛。    | release 变体缺签名材料时直接 `throw new GradleException` 让构建失败;开启 `minifyEnabled true` + `shrinkResources true`。                        |
| C-06 | 中     | `server.yml:67,71,93,97`                                                               | staging 与 production 共用**同一个** `secrets.CLOUDFLARE_API_TOKEN`,与 §13.1 的隔离要求冲突;且 CI 不校验目标环境 `wrangler secret` 是否已配置(可能"部署成功"但运行时缺 KEK 而静默 500)。                                                                                                             | 按环境创建只授该环境资源的独立 token;部署后追加 `/api/v1/capabilities` + 一次鉴权冒烟检查。                                                     |
| C-07 | 中     | `release.yml:196-199,202`                                                              | keystore 以 `base64 --decode > keystore.jks` 写入 **runner workspace 根目录**且后续步骤不清理,`build-apk` job 同时持有 keystore 口令(CWE-522)。                                                                                                                                                      | 写入 `$RUNNER_TEMP`;用 `if: always()` 步骤 `rm -f`;口令仅经环境变量传递。                                                                       |
| C-08 | 中     | `server.yml:32,63,88`;`release.yml:47,71,133`                                          | 全部使用 `npm install` 而非 `npm ci`,lockfile 存在但可被就地改写 → 构建不可复现,利于依赖投毒持久化(CWE-1104)。                                                                                                                                                                                       | 全部改为 `npm ci`;lockfile 变更纳入评审。                                                                                                       |
| C-09 | 中     | `package-lock.json`(725 条 `resolved`)、`server/package-lock.json`(303 条)             | 两个 lockfile 的 `resolved` **100% 指向 `registry.npmmirror.com`**;CI 无 `npm audit`/SCA 步骤。`integrity` 字段存在可部分缓解,但审计与可追溯性下降。另:实测 `npm audit` 因该镜像未实现 audit 端点而失败(`[NOT_IMPLEMENTED]`),故**本报告不对任何依赖断言已知 CVE**。                                  | CI 改用官方 registry 或受控代理;新增 `npm audit --audit-level=high` / `osv-scanner` 质量门。                                                    |
| C-10 | 中     | `server/scripts/validate-migration.cjs:8`                                              | 迁移校验脚本**只读取 `0001_init.sql`**,`0002_device_client_key.sql` / `0003_idempotency.sql` 无任何校验;且该脚本未被任何 npm script 或 CI 调用。§15.1 要求的"旧 schema 升级与失败回滚"未被验证。                                                                                                     | 让校验脚本遍历 `migrations/*.sql` 并接入 CI;补 0002/0003 的升级与回滚测试。                                                                     |
| C-11 | 低     | `server.yml:89-96`                                                                     | 生产 migration 前的 D1 导出目前依赖运维按 OPERATIONS.md §3 手工执行;Free 计划 Time Travel 7 天和手工导出路径已确认,本项只保留"workflow 未强制导出门禁、也没有部署后健康检查"的运维加固缺口。                                                                                                         | 将 `wrangler d1 export` 作为生产部署前置 step(失败即中止)并上传 artifact;部署后补 capabilities/鉴权冒烟。                                       |
| C-12 | 中     | `android/app/src/main/java/cn/hy/mfaauthenticator/AppUpdateInstaller.java:24-70,58-60` | 应用内更新只校验路径不含 `/`、`\`、`..`,随后把 `FileProvider` URI 交给系统安装器,**无签名指纹或哈希校验**(CWE-345/494)。属 Phase 1 更新功能,但 Phase 2 在其上叠加了云端同步的信任假设。                                                                                                              | 下载后校验 APK 签名证书 SHA-256 与内置期望值(或 Release 资产的 sha256)一致,不匹配即删除并拒绝安装。                                             |
| C-13 | 低     | `android/gradle/wrapper/gradle-wrapper.properties:3,5`;`android/build.gradle:22-27`    | Gradle 分发包来自 `mirrors.aliyun.com` 且**无 `distributionSha256Sum`**、显式 `validateDistributionUrl=false`;Maven 仓库把 `mavenLocal()` 与 aliyun 镜像置于 `google()`/`mavenCentral()` 之前 → 构建工具链与依赖可被替换(CWE-494/1104)。                                                             | 补 `distributionSha256Sum`;移除 `validateDistributionUrl=false`;官方仓库优先;启用 Gradle dependency verification。                              |

### D.2 CSP 内联脚本哈希不匹配(本机复算确认)

- **严重性**:中(功能回归 + 削弱 CSP 的诱因)
- **位置**:`server/src/middleware/securityHeaders.ts:13`、`index.html:21-37`
- **证据**:我按 CSP 规范(取 `<script>` 与 `</script>` 之间的文本)对 `index.html` 的内联主题脚本实算 SHA-256:

  | 计算方式                   | 结果                                                      |
  | -------------------------- | --------------------------------------------------------- |
  | 原文(含首尾换行)           | `sha256-RvnXUQnYNuC1fPcE0cMT6IKmT/3UGAGt0IWHAlZnHs0=`     |
  | 仅去首尾换行(CSP 规范口径) | `sha256-QDusMtK0VVQ0ZgChxHSHVLUjLfuZHRt7E9Vt6X2o5hQ=`     |
  | `trim()` 全部空白          | `sha256-oaNeInqSFYx1QSf1+f/zk7IsOkJggaJzT2I3rtL8K2c=`     |
  | **代码中声明值**           | **`sha256-wu7TQ5wT2PZBGahsw2Um3uh0CbPQxOnsdSm3RvJXjos=`** |

  三种口径**均不等于**声明值,即该常量与 `index.html` 不同源。

- **影响**:一旦 F-15 让 CSP 真正下发到 HTML 文档,浏览器将**拦截**主题内联脚本(深色模式首帧闪白、`theme-color` 不再更新)。更危险的是修复动机:运维很可能直接把 `'unsafe-inline'` 加回 `script-src` 来"修好它",从而**彻底废掉 CSP 的 XSS 防护**。`server/test/securityOps.test.ts:109-111` 只断言哈希形如 `^sha256-[A-Za-z0-9+/]+=*$`,不比对 `index.html`,所以漂移不会被 CI 发现。
- **修复建议**:在构建期从 `index.html` 计算哈希并注入 Worker 配置(单一数据源),用脚本(如 `node:crypto`)生成/校验,纳入 `npm run lint` 或 CI;禁止手写常量。
- **验证 / 测试建议**:新增断言——`THEME_SCRIPT_HASH` 必须等于对 `index.html` 内联脚本实算的结果(`index.html` 的路径由构建期替换为 dist 产物)。
- **置信度**:高(本机独立复算,三种口径全部不匹配)

### D.3 自动化测试覆盖的有效性

| 判定                                                   | 说明                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **真实入口从未被测试**                                 | 全部服务端测试都自建 `Hono` 实例(`server/test/helpers.ts:27`、`vaultTestHelpers.ts:291`、`sessions.test.ts:176`、`devices.test.ts:132`),**没有任何测试 import `server/src/index.ts`**。因此"中间件是否挂载到路由"这一层(正是 F-03、F-04 所在)在 CI 中完全不可见。                                                                       |
| **vault/admin 鉴权被整体替换**                         | `server/test/vault.test.ts:19-33` 用 `vi.mock` 把 `requireUser` 变成 no-op;`vaultTestHelpers.ts` 又无条件 `c.set('userId', …)`,`void requireCsrf`。→ vault/admin 的 401/403、CSRF、设备绑定全部被绕过,路由即使漏挂鉴权也**必然绿灯**。                                                                                                  |
| **HTTP 状态码几乎未断言**                              | `vault.test.ts` 的用例名写着 "413"/"422",断言却只有 `rejects.toMatchObject({ code: … })`,不经 HTTP、不断言 `status`。全仓 `413                                                                                                                                                                                                          | 422` 仅命中这两处字符串;410/426/429 同样无 HTTP 断言。 |
| **设备撤销的强制力未端到端验证**                       | 已覆盖 service 层与"带 `X-Device-Id`"两条路径,但缺少:① 真实 app 上"`DELETE /devices/:id` 后 `PUT /vault`";② `GET /vault` 不校验设备撤销;③ bearer **不带** `X-Device-Id` 时撤销设备仍可调用;④ `auth.ts:108-110` 的 fail-open 无用例。                                                                                                    |
| **`createSession` 忽略 session 期环境变量**(对应 F-11) | `sessions.test.ts` 只断言默认 30/90/7 天,无 env 覆盖用例。                                                                                                                                                                                                                                                                              |
| **`ACCESS_JWKS` 行为被固化为期望**(对应 F-22)          | `access.test.ts:118-130` 断言"设了就生效",没有任何"生产禁用"用例。                                                                                                                                                                                                                                                                      |
| **弱断言 / 名不副实用例**                              | `securityOps.test.ts:144` 的 "continues when one step fails" 注释自承未制造失败,仅断言 `failures === []`;`:115` 的 "deletes expired sessions" 所依赖的 mock 中**没有 `webSessions` 数组**,删除数来自 `vaultTestHelpers.ts:254-256` 硬编码的 `changes: 1`;`:91` 只断言 `buildCsp()` 字符串,`securityHeaders()` 从未作用于任何 Response。 |
| **D1 / DO / 密码学均未在真实 workerd 下运行**          | `server/vitest.config.ts:6` `environment: 'node'`;无 `@cloudflare/vitest-pool-workers` 或 Miniflare。D1 用按 SQL 前缀分派的内存 mock(不执行唯一约束、`ON CONFLICT`、`batch` 原子性);DO 用假 storage;密码学走 Node 的 WebCrypto。**F-09 的唯一约束冲突因此不可能在测试中暴露。**                                                         |
| **CI 无 workerd 集成 smoke**                           | `server.yml` 只跑 lint/typecheck/vitest/dry-run/`d1 migrations apply --local`,没有 `wrangler dev` + Miniflare 冒烟,故路由装配类缺陷永不进 CI。                                                                                                                                                                                          |

**结论**:`docs/Phase2.md` §15.1 所列测试项在**服务层与纯函数层**覆盖较好(merge、crypto、snowflake、devices 路由较扎实),但**装配层与 HTTP 契约层**接近空白。这直接解释了 F-03、F-04、F-07、F-09、F-11 为何能与"全部任务已完成"的记录并存。建议把"针对真实 `src/index.ts` 的路由装配测试"列为下一迭代的**首要测试投资**。

### D.4 已确认干净、无需报告的供应链项

- 仓库内**未发现任何真实凭据、私钥、token 或 KEK 值**(全库扫描 `BEGIN … PRIVATE KEY`、`AKIA[0-9A-Z]{16}`、`ghp_*`、`github_pat_*`、`sk-*`、三段式 JWT 等);`KEK_V1/KEK_V2`、`ACCESS_OIDC_CLIENT_SECRET` 仅以**变量名/绑定名**出现在 `kek.ts:103-104`、`env.ts:40,45-46`、`auth.ts:200-201`,无值泄漏。
- 无 `pull_request_target`;无不可信输入直接插值进 `run:` 的 shell 拼接;Actions 权限仅 `release.yml` 需要 `contents: write`。
- `.gitignore` / `server/.gitignore` 对 `.env*`、`.dev.vars`、`*.jks`、`*.keystore`、`keystore.properties`、`dist/`、`.wrangler/` 的忽略规则正确。
- Android `usesCleartextTraffic` 未开启、无 `network_security_config`(默认禁明文),除 launcher 外无其它 `exported` 组件,`FileProvider` 为 `exported="false"`。
- 根与 server 的 `tsconfig` 均 `strict: true`;ESLint 无削弱安全规则的自定义覆盖。

### D.5 客户端同步引擎(Phase2-task09/10)

**前置事实(决定可达性)**:同步引擎**从未在装配层接入** —— `configure()` / `bindTotpStore()` / `sync.init()` 在全仓只出现于 `src/stores/sync.test.ts:62,63,221`;`src/App.vue:53-57` 只初始化 `settings` 与 `appUpdate`;`notifyLocalEdit` / `onOnline` / `onResume` 除定义处外无调用者。因此下列问题当前为**潜在缺陷**;一旦按 task09/10 完成接入即全部生效。**我在本机独立复核了 C-15 与 C-17 两条关键证据。**

| ID                                                                                                                                                                                                                                 | 严重性                                                                                                                                                                                              | 位置                                                                                                                                                                              | 证据与影响                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | 修复建议                                                                                                                                                                                                             |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C-15                                                                                                                                                                                                                               | **严重**                                                                                                                                                                                            | `src/stores/totp.ts:416-427`(实现)、`src/stores/sync.ts:197-207`(调用)、`server/src/services/merge.ts:137-138`(服务端确认胜出)                                                    | **"本地覆盖云端"的墓碑逻辑取反,会删除两端共有的全部条目(不可逆数据丢失)。** 注释写"把云端仍存在但本地缺失的条目标记 tombstone",实现却迭代**本地**实体:```js                                                                                                                                                                                                                                                                                                                                   |
| for (const ref of collectEntityRefs(data.value)) {                                                                                                                                                                                 |
| if (cloudIds.has(ref.id) && !m[ref.kind][ref.id]?.deletedAt) m = markTombstone(m, ref.kind, ref.id, by, now)                                                                                                                       |
| }                                                                                                                                                                                                                                  |
| ```迭代对象与判定条件**方向相反**,实际标记的是"本地∩云端"的交集。随后 `merge.ts:137-138` 让 tombstone 优先胜出 → 两端共有的密钥在云端与本地**同时被删除**。配合"云端仅保留 2 个历史版本且无回滚 UI"(§2 决策 12),用户无法自助恢复。 | 改为遍历 `cloudIds`(云端有、本地无 → `markTombstone`);对本地有而云端无的条目补 `fresh` meta 表示新增;对本地已有的条目用 `touchEntity`/`touchAllEntities` 推进 `updatedAt` 以确保本机在 LWW 中胜出。 |
| C-16                                                                                                                                                                                                                               | 高                                                                                                                                                                                                  | `src/stores/sync.test.ts:120-136`                                                                                                                                                 | **上述缺陷被一个恒真断言掩盖。** `expect(req.meta.items['gone1']?.deletedAt).not.toBeNull()`:当 `items['gone1']` 为 `undefined` 时,`undefined?.deletedAt` 求值为 `undefined`,`undefined !== null` 为 **true**,断言**永远通过**。用例名为 "local-over-cloud tombstones cloud-missing entries",却从未验证任何行为。                                                                                                                                                                             | 断言改为 `expect(req.meta.items['gone1']).toBeDefined()` + `deletedAt` 非空,并新增双向用例("本地缺失的云端条目被删除" / "两端共有的条目**不被**删除")。                                                              |
| C-17                                                                                                                                                                                                                               | 高                                                                                                                                                                                                  | `src/components/SyncSettings.vue:218-237`;文案 `src/locales/zh-CN.ts:223-226`                                                                                                     | **"覆盖前要求导出备份"只是弹窗,从不执行导出。** `ElMessageBox.confirm(t('sync.backupWarning'), …, { confirmButtonText: t('export.title') })` 的确认按钮文案虽是"导出",回调内**未调用** `buildExport`/`exportTextFile`;紧接着第 229 行还用 `t('sync.backupExported', { file: exportFilename() })` 向用户断言"我已导出备份并妥善保存(totp-backup-….totp)"——**用一个并不存在的文件名骗取确认**。违反 §9 与 task10 §2。                                                                           | 确认后真实调用导出流程,校验返回值(`'shared'`/`'downloaded'`)并记录时间戳,再进入第二次确认;导出失败或取消则中止覆盖分支。                                                                                             |
| C-18                                                                                                                                                                                                                               | 中                                                                                                                                                                                                  | `src/components/SyncSettings.vue:176-191`                                                                                                                                         | **向导"取消"被吞掉后仍执行上传。** `await ElMessageBox.confirm(...).catch(() => null)` 之后**无条件** `return 'local-over-cloud'`(另一分支同理返回 `'cloud-over-local'`),取消与确认的返回值被丢弃 → 用户点"取消"后仍会把本机密钥上传到云端。                                                                                                                                                                                                                                                  | 改为 `const ok = await ElMessageBox.confirm(...).then(() => true, () => false); if (!ok) return null`。                                                                                                              |
| C-19                                                                                                                                                                                                                               | 中                                                                                                                                                                                                  | `src/stores/sync.ts:320-330`;`src/stores/totp.ts:398-410`                                                                                                                         | **同步结果未落盘就清 `dirty`。** `sync.ts:320` 注释声称"服务端合并结果先落盘,再清 dirty(崩溃安全)",但 `push()` 全路径只调用 `totp.applyRemoteSnapshot(...)`,同步路径**无任何持久化调用**;而 `applyRemoteSnapshot` 设置 `hydrating = true`,`totp.ts` 的 `watch → schedulePersist` 在 `hydrating` 时直接 `return`。随后 `sync.ts:325-329` 已把 `dirty:false` 与新 `base_revision` 写入 `sync_state`。→ 崩溃/刷新后本地信封仍是同步前快照却带着新的 revision 与 clean 标记,违反 task09 §3 验收。 | 在 `applyRemoteSnapshot` 内(push 成功、清 dirty 之前)显式 `await saveEnvelope(data, meta)`;补测试:push 后直接读 localforage 的 `DATA_KEY` 断言含合并结果。**置信度中高**(基于 Vue flush 时序推断,需按上述测试验证)。 |
| C-20                                                                                                                                                                                                                               | 中                                                                                                                                                                                                  | `src/stores/sync.ts:308-309,323,429-439`;`server/src/services/vault.ts:152-155`                                                                                                   | **`request_id` 跨不同 payload 复用。** `inFlightPush` 只在成功分支置 `null`,而 `handlePushError` 对 401/403/410/426/413 等终态**不清空**。若某次推送已被服务端提交但响应丢失(NETWORK),期间用户继续编辑,重试会带同一 `request_id` + 新 payload;服务端 `vault.ts:152-155` 命中去重即返回**旧的**合并结果,客户端随即 `applyRemoteSnapshot` + `dirty:false` → 用户新编辑**静默丢失**且界面显示"已同步"。                                                                                          | 把 `request_id` 绑定到"待推送快照代次":本地快照变化时轮换 `inFlightPush`;或在终态(非可重试)错误时清空。补测试"payload 变化后 `request_id` 必须变化"。                                                                |
| C-21                                                                                                                                                                                                                               | 中                                                                                                                                                                                                  | `src/services/crypto.ts:236-245`、`src/services/backup.ts:15-17,91-99,132-137`、`src/components/ItemRow.vue:87`、`src/views/HomeView.vue:316`、`src/views/ImportView.vue:178-187` | **导入文件缺条目级校验,可致渲染期抛错、整份列表不可用。** `validateTotpData` 仅校验 `groups`/`ungrouped` 是数组,不校验条目字段类型;`fingerprint → normalizeSecret` 对非字符串调 `.replace` 抛 `TypeError`,而 `confirmImport()` 无 try/catch;`ItemRow.vue:87` 的 `compute(props.item, …)` 与 `HomeView.vue:316` 的 `item.issuer.toLowerCase()` 在渲染期无保护(对照 `AddEditView.vue:205-212` 有 try/catch)。→ 覆盖导入畸形 `.totp` 后首屏崩溃且 `corrupted` 不置位,用户无恢复入口。            | 在 `validateTotpData` 内逐条规范化(类型收敛 + secret 合法 Base32 校验),`overwriteData` 复用同一函数;`ItemRow`/`HomeView` 的渲染计算用 try/catch 兜底;`confirmImport` 包 try/catch 并提示。                           |
| C-22                                                                                                                                                                                                                               | 中                                                                                                                                                                                                  | `src/stores/sync.ts:161,305`;`src/services/sync/api.ts:188`                                                                                                                       | **首次推送到已注册 device_id 的链路断裂:** `completeBinding` 只写本地 `device_id = ensureLocalDeviceId()`(客户端生成的**占位** Snowflake,`state.ts:73-78`),`registerDevice` 从未被调用,而服务端 `vault.ts:140-143` 要求 device 已注册且属于该 user → 首次 `PUT /vault` 必然 403 `FORBIDDEN`,客户端把 403 映射为终态 `error` 不重试。                                                                                                                                                          | 首次绑定时调用 `registerDevice({name, platform, client_device_key})` 并把服务端签发的 Snowflake 作为 `device_id` 落库。                                                                                              |
| C-23                                                                                                                                                                                                                               | 低                                                                                                                                                                                                  | `src/services/sync/types.ts:107-114`(经 `:124-128` 调用)                                                                                                                          | **`normalizeRecord` 用 `out[key] = …` 赋值**,键为 `__proto__` 时走原型 setter(非全局污染,但不产生自有属性),可致 `meta.items[id]` 查找错乱。                                                                                                                                                                                                                                                                                                                                                   | 用 `Object.create(null)` 或 `Object.defineProperty`,并显式跳过 `__proto__`/`constructor`/`prototype`。**可达性需确认**:需服务端透传该 id。                                                                           |
| C-24                                                                                                                                                                                                                               | 低                                                                                                                                                                                                  | `src/services/sync/api.ts:25-35,165-171,107-112`                                                                                                                                  | `statusToCode(400)` 落到 `'INTERNAL_ERROR'`;而 `:167` 仅在"服务端 code 与状态映射完全相等"时才采用该 code → `VALIDATION_ERROR` 分支**不可达**,设备名超长等 400 会显示"服务端错误"。另 `decodeURIComponent` 遇非法百分号编码抛 `URIError` 且未被 `request()` 捕获。                                                                                                                                                                                                                            | 用已知 `SyncErrorCode` 白名单替代"必须等于状态映射"的判断;给 `decodeURIComponent` 加 try/catch。                                                                                                                     |

### D.6 客户端已确认干净的部分

- **无 XSS sink**:全仓唯一 `v-html` 是 `ExportDialog.vue:14` 的 `v-html="qrSvg"`,其值由本地 `QRCode.toString()` 生成、不含服务端数据;`webScanner.ts:82,124` 的 `innerHTML=''` 仅清空;全仓无 `eval` / `new Function` / `document.write` / 动态 `:is`;设备名、issuer/label、release notes 均走 `{{ }}` 转义。
- **Service Worker 策略实测正确**:`dist/sw.js` 只 precache 静态资源,唯一路由是带 `navigateFallbackDenylist` 的 NavigationRoute,无任何 runtime cache → API/vault/认证响应不会进入 Cache Storage(补强了 F-18 对"仅字符串断言"的保留:本次是**构建产物实测**)。
- **本地密钥处理**:secret 仅以 AES-GCM V2 信封 `{v,iv,ct}` 写入 localforage(`storage.ts:161-167`,IV 12 字节随机);localStorage 只存 `_dk`、`app-theme`、`_backup_reminded`;全仓无 `console.*`、无埋点上报;`sync_state` 只含 `user_id`/`device_id`/`revision` 等标识,不含 secret。
- **随机数**:`request_id`、设备密钥、`batchId`、UUID 均用 `crypto.getRandomValues`;全仓无 `Math.random`。
- **URL/导航**:API 路径固定,服务端返回的 id 一律 `encodeURIComponent`;router 为 hash 模式、跳转目标固定,无开放重定向。
- **状态机其余部分**:`meta.ts` 的 tombstone 不被普通更新复活、`pruneOrphanMeta` 保留 tombstone、`isExpanded` 同步前剥离/接收后按本机 id 恢复;401/403/410/426 不重试,429/5xx/网络按 5s→5min 退避;`syncNow` 用 `status === 'syncing'` 防并发;`base_revision` 更新顺序正确(除 C-19 的落盘缺失)。

---

## 修复优先级

### P0 —— 发布前必须修复(否则不得上线)

| ID          | 标题                              | 理由                                                                                                                                                                       |
| ----------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F-02        | D1 明文保存 vault 快照            | 唯一一项**直接推翻 Phase 2 核心安全承诺**的缺陷;利用条件仅为"读一次数据库",无需任何密钥。修复成本低(去掉响应缓存即可)。                                                    |
| C-15 / C-16 | "本地覆盖云端"墓碑取反 + 恒真断言 | **不可逆数据丢失**:用户选择该分支会删除两端共有的全部密钥,而测试因 `undefined !== null` 恒真完全掩盖了它。修复极小(改循环对象 + 改断言),但漏掉即可能造成用户密钥永久损失。 |
| F-01        | CSRF Cookie 名不一致              | 使 Web 写操作 100% 失败,且诱导运维削弱 CSRF 校验;必须先让功能正确,再谈安全验收。                                                                                           |
| F-04        | devices/admin 写路由缺 CSRF       | 高价值写操作(设备撤销、管理员删数据)无 CSRF 防护,违反文档强制要求。                                                                                                        |
| F-16        | staging/production 共用 D1        | 一次 `wrangler deploy --env production` 即可让 staging migration 作用于生产库;属"配置即事故"。                                                                             |

### P1 —— 首个发布窗口内必须修复

| ID                 | 标题                                                    | 理由                                                                                                                                     |
| ------------------ | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| F-03               | 限流未挂载                                              | 文档与 runbook 谎报控制存在;成本型 DoS 面明确。                                                                                          |
| F-07 / F-08 / C-22 | 客户端未装配 + `sync_identity` 未实现 + 未注册设备      | 三者是同一条断裂链路:不修则同步不可用;一旦只修装配而不修身份绑定,§9 的跨账号上传会立刻暴露(C-22 的 403 只是它的表象)。**必须同批完成。** |
| C-17 / C-18        | "覆盖前要求导出备份"是假弹窗 + 向导取消被吞             | 直接放大 C-15 的数据丢失后果,并违背"用户明确选择"的授权语义。                                                                            |
| C-19 / C-20        | 同步结果未落盘就清 dirty + `request_id` 跨 payload 复用 | 静默丢失用户编辑,且界面显示"已同步"。                                                                                                    |
| F-06               | 426 版本门缺失                                          | 协议演进期的静默数据损坏风险。                                                                                                           |
| F-13               | PKCE state 存内存                                       | 生产登录随机失败,阻塞 §15.2 的全部手工 smoke test。                                                                                      |
| C-05               | Release 回退 debug 签名                                 | 误配即产出可被同 debug 密钥伪造"更新"的 APK。                                                                                            |
| C-02 / C-03        | CI token 暴露给构建步骤 + 生产 Pages 无环境保护         | 发布链路凭据与生产前端完整性。                                                                                                           |

### P2 —— 稳定性与纵深防御

F-05(device_id 可选校验与 fail-open,降级)、F-09(revision CAS/历史唯一约束冲突)、F-10(ClockSkewError → 500 重试循环)、F-11(会话期配置不一致)、F-12(状态复位越权)、F-14(refresh stub + 变量名误导)、F-15 + D.2(HTML 缺 CSP + 内联哈希不匹配)、F-18/D.3(测试有效性)、F-22(`ACCESS_JWKS` 无环境守卫)、F-23(测试 runner 有效性)、C-01(action 未固定 SHA)、C-04(发布顺序)、C-06(单一 API Token)、C-07(keystore 落 workspace)、C-08/C-09/C-10(`npm install` / 镜像 / 迁移校验)、C-12(APK 无完整性校验)、C-21(导入条目级校验)。

### P3 —— 加固与卫生

F-19(字节 vs 码元)、F-20(校验错误回显)、F-21(登录限流/Map 有界)、C-11(导出门禁,降级)、C-13(Gradle 校验和)、C-23(原型键)、C-24(错误码映射)。

**排序理由**:P0 全部满足"单点、无需链式利用、影响核心安全或生产数据(或造成不可逆数据丢失)"三个特征;P1 均为"控制宣称存在但实际缺失",可在一次迭代内修复;P2 是需要并发/边界/部署条件才触发的正确性与纵深问题;P3 为优化项。

> **一条横切建议**:本次 47 项发现中,约三分之一属于"中间件/装配层缺失"而非"函数实现错误"。因此建议把 **"针对真实 `server/src/index.ts` 的路由装配测试 + HTTP 状态码断言"** 作为下一迭代的首要测试投资(详见附录 C.3)——这是唯一能在 CI 中捕获 F-03、F-04 这一类缺陷的层次。

---

## 已确认降级项与 Cloudflare 限流配置

### 已确认调整

- `C-14` 已移除:服务端代码尚未提交是用户已说明的交付状态,不计入代码缺陷;合并/发布前必须先提交 `server/`,否则 `server.yml` 不会生效。
- `F-05` 已降级:Q43/Q70 确认逻辑设备撤销、新设备无需已有设备批准、强撤销依赖 Access 会话撤销。保留的缺陷仅为 `X-Device-Id` 可缺失和数据库异常时 fail-open。
- `C-11` 已降级:Free 计划 D1 Time Travel 7 天恢复窗口和 migration 前手工导出路径已确认;保留的是 workflow 未强制导出门禁和缺少部署后健康检查,属于运维加固项。
- `C-15` 维持 P0:无用户可见回滚 UI 是已接受取舍,但“本地覆盖云端”的 tombstone 方向取反必须修复。
- `F-17` 已移除为独立发现,不在缺陷数量中重复计数;相关风险通过下述 Cloudflare WAF/Rate Limiting 配置治理。

### Cloudflare WAF / Rate Limiting 最低配置

生产与 staging 必须分别配置并导出规则用于审计。建议最低规则如下,数值作为初始值,压测后调整:

| 目标        | 方法/路径                                          | 建议规则                                               | 动作                         |
| ----------- | -------------------------------------------------- | ------------------------------------------------------ | ---------------------------- |
| 登录入口    | `GET /api/v1/auth/login`                           | 20 次/分钟/IP,突发 5                                   | 超限 Block 10 分钟           |
| 登录回调    | `GET /api/v1/auth/callback`                        | 20 次/分钟/IP,突发 5                                   | 超限 Block 10 分钟           |
| 设备注册    | `POST /api/v1/devices`                             | 10 次/小时/IP                                          | 超限 Block 1 小时            |
| Vault 推送  | `PUT /api/v1/vault`                                | 120 次/分钟/IP;有 `X-Device-Id` 时再加 30 次/分钟/设备 | 超限返回 429/Block 短时      |
| 危险删除    | `DELETE /api/v1/vault`, `DELETE /api/v1/devices/*` | 10 次/分钟/IP                                          | 超限 Block 10 分钟           |
| 管理员接口  | `/api/v1/admin/*`                                  | 5 次/分钟/IP + Access Group                            | 超限 Block 并告警            |
| 全 API 兜底 | `/api/*`                                           | 300 次/分钟/IP                                         | 超限 Managed Challenge/Block |

配置要点:

1. 在 Cloudflare 控制台启用 WAF Managed Rules,至少覆盖 OWASP Core Ruleset;对 `/api/*` 增加自定义规则,只允许预期 HTTP 方法。
2. 为 `/api/v1/auth/*` 使用更严格的 IP 规则和 Bot/Managed Challenge,避免匿名请求放大 Access token endpoint 调用。
3. Web 与 Android 正常同步频率远低于上述值;如正常用户触发限流,应先检查客户端重试风暴和 `request_id` 生命周期。
4. Cloudflare 边缘规则无法直接读取 Worker 内部 `user_id`。若需要严格“每用户全局配额”,应在边缘规则之外使用 Cloudflare Rate Limiting binding 或 Durable Object;这属于增强项,不再作为独立审计发现计数。
5. 每次规则变更后,在 staging 使用 `curl`/压测验证 429 与 Block 行为,并导出规则快照;生产中开启 Rate Limiting Analytics/告警。
6. `server/OPERATIONS.md` 和 `docs/Phase2.md` §12 应同步记录实际规则 ID、阈值、作用环境和验证日期。

---

## 需要补充的信息

以下信息缺失导致部分结论只能给出置信度而非定论:

1. **Cloudflare Access 实际配置**:`ACCESS_AUD`、`ACCESS_TEAM_DOMAIN`、Access Application 的 OIDC client 配置、以及 `groups` claim 是否真的包含 Access Group(决定 `adminAuth.ts:18-25` 的默认拒绝是否可被正确放行)。**需要 staging 配置快照。**
2. **边缘 WAF/Rate Limiting 规则是否已配置**:F-03 的严重性取决于边缘层是否真的在保护 `/api/*`;配置要求见“Cloudflare WAF / Rate Limiting 最低配置”。**需要 Cloudflare 规则导出或截图。**
3. **`vault_push_dedupe` 在真实环境中的数据形态**:F-02 已从代码确认写入明文,若生产已运行需**按 D1 Time Travel 检查历史快照是否同样含明文**。
4. **`APP_ORIGIN` 是否在 staging/production 设置**:未设置时 `csrf.ts:74-80` 的整体 Origin 校验会被跳过(仅剩 token 比对),直接决定 F-04 的可利用性。
5. **并发 CAS 的实际失败率**:F-09 的触发概率依赖 D1 的并发语义,**需要压测或 staging 双设备并发实测**。
6. **`docs/Phase2.md` §15.3 的五条命令是否真的执行过**:文档声称"自动测试全绿",但 F-03/F-04/F-07/F-08 均属"接线缺失"型缺陷,常规单元测试无法发现。**需要 CI 运行记录(构建号/日志链接)**,并明确"全绿"来自 `vitest` 还是沙箱 runner `run-tests-node.mjs`(后者缺 `rejects`,不能作为验收证据,见 F-23)。
7. **Android 侧实现位置**:本次审计**未在仓库中找到任何 Android 的 PKCE / custom scheme 回调 / EncryptedSharedPreferences 实现**:`AndroidManifest.xml:13-26` 的 `MainActivity` 只有 `MAIN`/`LAUNCHER` intent-filter,全库搜索 `cn.hy.mfaauthenticator://`、`CustomScheme`、`@capacitor/browser`、`Browser.open` **零命中**。因此 `docs/Phase2-task04` §3 的 Android 部分**无法评估,且高度疑似未实现**(与 §17.1 的验证门直接冲突)。**需要确认实现是否在其它仓库/分支。**
8. **`ACCESS_JWKS` 在 staging/production 的实际配置**:决定 F-22 是"低概率运维风险"还是"已存在的认证绕过"。**需要 `wrangler secret list --env production` 输出(仅需键名)。**
9. **GitHub / Cloudflare 侧配置**:仓库与 Environment 的 secrets 作用域(是否 staging 与 production 共用同一个 `CLOUDFLARE_API_TOKEN`)、`environment: production` 是否真的启用了 required reviewers、`vars.CLOUDFLARE_PAGES_PROJECT` 与 `CLOUDFLARE_PAGES_BRANCH` 的实际取值。**需要仓库设置截图或导出。**
10. **wrangler named-env 的实际绑定回落**:F-16 依据 `wrangler.toml` 文本判定 staging/production 会继承顶层 `database_id`,但该语义未在本机实测。**验证方法**:分别执行 `npx wrangler deploy --env staging --dry-run --outdir=/tmp/a` 与 `--env production --dry-run --outdir=/tmp/b`,比较产物中内联的 D1 `database_id` 是否相同。
11. **依赖 CVE**:本机 `npm audit` 因 lockfile 指向 `registry.npmmirror.com`(该镜像未实现 audit 端点,返回 `[NOT_IMPLEMENTED]`)而不可用,故**本报告不对任何依赖断言已知漏洞**。**验证方法**:联网环境执行 `npm ci && npm audit --json`(必要时临时 `--registry=https://registry.npmjs.org/`)或 `npx osv-scanner -r .`。
12. **`C-19`(合并结果落盘)的时序结论**:该条基于 Vue `watch` 的 pre-flush 时序推断,置信度中高。**验证方法**:push 成功后立即读取 localforage 的 `DATA_KEY`,断言其中已包含服务端合并结果。

---

## 附录

### A. 已检查项(确认无问题或已在本报告定级)

- **Access JWT 校验**(`server/src/services/access.ts`):签名走 JWKS(`createRemoteJWKSet`,10s 超时)、`iss`/`aud`/`exp`/`nbf` 由 jose 强制、`requiredClaims` 含 `sub/iss/aud/exp`、算法白名单 `['RS256','ES256']`、拒绝 `.access` service token 与空 `sub`/无 `email`、JWKS 获取失败拒绝而非降级、失败一律 401 且不回显 token。**实现正确**(唯一保留见 F-22)。
- **Hono 通配中间件覆盖面**:`use('/vault/*')` 是否覆盖 `/vault`?→ 本地实测**覆盖**(GET/PUT/DELETE `/vault` 均命中中间件),故 `vault.ts:33` 不构成鉴权绕过。`admin.ts:20` 同理。
- **加密原语**(`crypto.ts`):AES-256-GCM、IV 12 字节随机、DEK 32 字节 `getRandomValues`、AAD 绑定 purpose+userId+version(`vaultAad`)与 purpose+version(`dekWrapAad`),密文跨用户/版本替换会被 GCM 认证失败拒绝。**实现正确。**
- **云端删除**(`userVault.ts:104-120`):删 vault、历史、wrapped DEK、web session 并重置设备水位;幂等;保留 `auth_identities`。**符合 §10。**
- **Cloudflare 数据删除后语义**:`deleteVault` 置 `cloud_deleted`,后续请求 410。**符合 §10**(但见 F-12 的复位问题)。
- **Snowflake 分配器**(`idAllocator.ts` / `idAllocatorDo.ts`):布局 41+10+12 正确、BigInt 运算、十进制字符串输出、状态**先持久化后返回**、时钟回退时不重用旧值、DO 串行化。**实现正确。**
- **登录与错误响应脱敏**:`requestContext.ts` 单行日志仅含 `request_id/route/status/latency_ms/error_code`;`auth.ts:75-90` 仅记 `user_id/email_masked/email_ref`;`logSanitizer.ts` 的 HMAC 在 secret 缺失时抛错而非用空密钥;`api.test.ts:32-39,81-90` 有禁止字段断言。**未发现 token/payload 进日志。**
- **PWA 缓存策略**(`vite.config.ts:18-22` **+ `dist/sw.js` 构建产物实测**):`navigateFallbackDenylist: [/^\/api\//, /^\/auth\//]`、`runtimeCaching: []`,且产物的 SW 只 precache 静态资源、唯一路由为带同一 denylist 的 `NavigationRoute` → API/vault/认证响应不会进入 Cache Storage。**策略成立且经产物验证**(测试有效性的保留见 F-18)。
- **管理员默认拒绝**(`adminAuth.ts:18-25`):`ADMIN_ACCESS_GROUP` 未配置时返回 `false`。**符合 §12 最小权限。**
- **CSRF 中间件本体**(`csrf.ts`):SAFE_METHODS 白名单、Bearer 豁免语义正确、`secureEqual` 恒定时间比较、`APP_ORIGIN` 精确比对(去尾斜杠)、无 Origin/Referer 时 `requestOrigin` 返回 `null` 且与 `appOrigin` 不等 → 拒绝(不 fail-open)。**逻辑本身正确**,问题只在挂载(F-04)与 Cookie 名(F-01)。
- **vault 响应不泄露额外字段**:`GET/PUT /vault` 只返回 `revision/schema_version/data/meta(/merged_from_others)`。**符合 §7.3/§7.4。**
- **客户端渲染 sink**:无 `v-html`(唯一一处是本地 QR 生成)、无 `eval`/`new Function`/`document.write`/动态组件,服务端数据一律经 `{{ }}` 转义。
- **客户端随机数与本地密钥处理**:`request_id`/设备密钥/`batchId`/UUID 均用 WebCrypto,全仓无 `Math.random`;secret 仅以 AES-GCM V2 信封写入 localforage,`sync_state` 不含 secret,无 `console.*`、无埋点上报。
- **仓库密钥卫生**:全库扫描未发现任何真实凭据、私钥、token 或 KEK 值;`.gitignore` 对 `.env*`/`.dev.vars`/`*.jks`/`*.keystore`/`dist/`/`.wrangler/` 的规则正确。

### B. 未覆盖项

- Android 原生实现(PKCE、custom scheme 回调、EncryptedSharedPreferences):**仓库中未找到对应源码**,无法审计(见"需要补充的信息"第 7 条)。
- Cloudflare 侧配置本身:Access Application、WAF/Rate Limiting 规则、Pages 自定义域与 Worker Route 优先级(§17 的三个验证门)→ 属运行时/平台配置,需 staging 实测。
- 依赖漏洞(CVE):本机 `npm audit` 因镜像不支持 audit 端点而失败,**本报告不给出任何 CVE 断言**。
- `docs/Phase01.md` 范围内的本地加密与导入导出实现:仅在 Phase 2 交互点(如 `storage.ts` 的 V2 信封、`stripExpanded`、`backup.ts` 的覆盖导入)做了必要核对(C-21 即为其中之一),未做全量复审。
- 真实渗透测试与多设备并发最终一致性验证:属 §15.2 手工 smoke test 范围。

### C. 工具限制与置信度说明

- 本审计为**静态审计 + 本地只读验证**,未执行任何破坏性命令,未访问任何未授权系统。为确认两处争议点曾做本地实测:(1) Hono `use('/vault/*')` 是否覆盖 `/vault` —— 编写一次性探针脚本运行后删除;(2) 内联主题脚本的 SHA-256 —— 用 `System.Security.Cryptography` 在本机复算三种口径。`git status` 已确认工作区无审计残留文件。
- 触发概率依赖运行时的项已显式标注"需实测/需确认",未臆断为必然可利用:F-09(D1 并发语义)、F-10(具体可构造输入)、C-19(Vue flush 时序)、C-23(需服务端透传该 id)、F-16(wrangler named-env 回落语义)。
- F-12 与 F-22 在当前配置面下属**潜在**而非已发生漏洞,报告已明确说明前提条件,未按已发生漏洞定级。
- 本报告不含针对真实第三方系统的攻击指令或完整利用链;所有"触发条件"均用于本地/授权环境的防御性验证。
- 附录 C 的发现分布在三个并行子审计(客户端同步代码、CI/CD 与供应链、自动化测试覆盖)中,关键证据行号(尤其 C-15、C-16、C-17、C.2 的哈希、C-05 的签名回退)已由我在本机逐条复核;极少数标注为"置信度中/中高"的条目已注明推断依据与验证方法。
