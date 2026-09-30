# Task Phase2-01: Worker、Hono、D1 与 ID 基础设施

> 依赖: Phase 1 | 被依赖: 02/03/04/05/06/11/12
> 对应 docs/Phase2.md: §2、§3、§5.1、§7.1、§13

## 目标

建立独立 `server/` Worker 工程,接通 Hono、D1、Wrangler、Zod、测试环境和 Snowflake ID 分配器,为后续认证、设备和 vault API 提供稳定基础设施。

## 具体工作

1. 新增 `server/` 工程:
   - `server/src/index.ts` 使用 Hono 创建 Worker 入口。
   - `server/wrangler.toml` 配置 `main`、compatibility date、D1 binding、Durable Object binding 和环境占位。
   - 增加独立 `server/tsconfig.json`、测试配置和脚本。
2. 根 `package.json` 增加服务端开发脚本,但保持前端构建脚本行为不变:
   - `server:dev`
   - `server:typecheck`
   - `server:test`
   - `server:lint`
   - `server:dry-run`
3. D1 migration 基础设施:
   - 所有 schema 通过编号 SQL migration 管理。
   - 本地使用 `wrangler d1 migrations apply <DB> --local`。
   - repository/service 封装 prepared statements,路由中不直接散落 SQL。
4. API 基础中间件:
   - 请求 ID 生成与响应头。
   - 统一错误响应 `{ code, message, request_id }`,不返回堆栈。
   - Zod 请求校验错误转换为稳定业务错误。
   - 基础 CORS 策略仅在确实需要跨源时启用;生产使用同源 `/api/*`。
5. Snowflake ID 分配器:
   - 使用单个 Durable Object `IdAllocator` 串行分配。
   - 布局 `41-bit timestamp + 10-bit node + 12-bit sequence`。
   - 持久化 `last_ms` 和 `sequence`,支持同毫秒溢出等待/进位。
   - API 只返回十进制字符串,不返回 JavaScript `number`。
6. `/api/v1/capabilities` 基础接口:
   - 返回 `sync_enabled`、`min_client_version`、`schema_version`、`crypto_version` 占位。
   - 该接口不返回任何用户或 vault 数据。

## 验收标准

- [ ] `wrangler dev` 可在本地启动 Worker,`/api/v1/capabilities` 返回结构化 JSON
- [ ] `wrangler d1 migrations apply --local` 可创建/升级本地 D1,重复执行无副作用
- [ ] Snowflake 分配器在并发测试中无重复 ID,顺序单调,恢复实例后不重复
- [ ] API 使用 Zod 校验 body/params/query,非法输入返回统一错误码
- [ ] `server:typecheck` / `server:test` / `server:lint` / Wrangler dry-run 通过
- [ ] 不记录 secret、JWT、Cookie 或完整请求 body

## 状态: 待开始
