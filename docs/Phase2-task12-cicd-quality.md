# Task Phase2-12: CI/CD、三环境发布与 Phase 2 全量验收

> 依赖: 全部 Phase 2 任务 | 被依赖: 无
> 对应 docs/Phase2.md: §13、§15、§17

## 目标

建立 Worker 独立发布流程、Local/Staging/Production 三环境、D1 migration 顺序和 Phase 2 全量自动/手工验收。

## 具体工作

1. Worker CI:
   - 新增 `.github/workflows/server.yml`。
   - 执行服务端 lint、typecheck、Vitest/Worker integration tests、Wrangler dry-run。
   - Staging D1 migration 和 Worker 部署在受控环境执行。
   - Production migration 前检查兼容性并保留导出;依次 deployment Worker,再发布前端。
2. 环境隔离:
   - Local: Wrangler/Miniflare + 本地 D1 + mock JWT。
   - Staging: 独立 Worker、D1、Access App、KEK、LOG_EMAIL_SECRET。
   - Production: 独立资源;GitHub Environment 保护生产 Secrets。
3. 同源路由验证:
   - 部署 staging 后验证 `app.example.com/api/*` 由 Worker 处理,静态路径仍由 Pages 处理。
   - Worker Route 冲突时按文档改为 Workers Static Assets,不退回 Pages Functions。
4. 发布兼容:
   - `/api/v1/capabilities` 发布 min client version。
   - 至少兼容上一发布客户端一个窗口。
   - 回滚顺序为 Worker -> 必要时 D1 Time Travel/导出,不先回滚数据库。
5. 自动化测试:
   - 前端全量测试、Worker integration、D1 migration、crypto、merge、CAS、幂等、限流和 Cron。
   - 不使用 Playwright 作为强制 CI 门槛。
6. 发布前手工 smoke:
   - Web/Android 登录、刷新、退出、CSRF、custom scheme。
   - 两客户端并发编辑/删除/排序。
   - 首次绑定三分支、覆盖导入、云端删除、设备撤销、Access 会话撤销。
   - PWA 离线后再恢复网络。
7. 文档与仓库收口:
   - README 文档区链接 `docs/Phase2.md` 和 `Phase2-task*.md`。
   - 记录 Cloudflare Access custom scheme 与 public-client 风险验证结果。
   - 记录 Free 计划 D1 Time Travel 7 天窗口和升级条件。

## 验收标准

- [ ] `server.yml` 在 PR/main/tag 场景按设计执行,失败可阻断发布
- [ ] Local 全自动测试、Staging smoke、Production 发布均有记录
- [ ] D1 migration 可重复执行,生产回滚顺序和恢复步骤经过演练
- [ ] 同源 Worker Route/Pages 路由在 staging 验证通过
- [ ] 两设备最终一致;删除不复活;排序收敛;覆盖导入影响所有设备
- [ ] Web 与 Android Access 登录链路均通过真实 staging 验证
- [ ] 所有敏感日志/Cache/CSP/限流检查通过
- [ ] `npm run lint` / `typecheck` / `test` / `build` / `cap:sync` 全绿
- [ ] `server:lint` / `server:typecheck` / `server:test` / `server:dry-run` 全绿
- [ ] `docs/Phase2.md`、任务文档和 README 链接与实际实现一致

## 状态: 待开始
