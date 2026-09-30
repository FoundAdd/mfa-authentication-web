# Task Phase2-09: 客户端同步引擎与状态机

> 依赖: 04/07/08 | 被依赖: 10/11/12
> 对应 docs/Phase2.md: §7、§9、§10、§11、§14

## 目标

实现 Web 与 Android 共用的前端同步状态机、触发策略、幂等推送、错误恢复和本地写回,不复制服务端 LWW 合并算法。

## 具体工作

1. `services/sync/api.ts`:
   - 封装 capabilities、auth me、devices、vault GET/PUT/DELETE。
   - Web 请求携带 credentials 和 CSRF header;Android 使用 Bearer token。
   - 统一映射 API 错误码,禁止在错误对象中保留响应明文。
2. `stores/sync.ts`:
   - 状态: `disabled / unauthenticated / offline / syncing / synced / error / cloud_deleted / upgrade_required`。
   - 保存 `sync_identity`、`user_id`、`device_id`、`base_revision`、`dirty`、`last_success_at`。
   - 提供 `enableSync`、`disableSync`、`pull`、`push`、`syncNow`、`unbind`、`deleteCloudData` 等 action。
3. 状态型同步:
   - 本地变更只标记 dirty,不保存逐条操作队列。
   - 推送前生成随机 opaque `request_id`;成功后更新 base revision 和 last_success。
   - 服务端返回完整合并结果后,先持久化 data/meta 再清 dirty,防止崩溃丢失。
4. 触发:
   - 应用启动、恢复前台、`online`、本地编辑防抖和手动同步。
   - 指数退避,网络错误可重试;401 进入需要登录;403 设备撤销停止重试;410 进入 cloud_deleted。
5. 首次绑定:
   - 检测本地/云端是否有数据,调用 UI 向导后执行上传、下载或合并。
   - 合并使用完整快照推送;云端覆盖本地和本地覆盖云端走明确 action。
   - 切换不同 `(issuer, sub)` 时阻止同步并要求显式解绑。
6. 本地写回:
   - 接收远端 data 后保留本机 `isExpanded`。
   - 合并导致本地变化时生成可展示的摘要计数,不暴露 secret。
   - 同步刷新失败时保留本地 dirty,不误报成功。

## 验收标准

- [ ] 两类平台都可完成 capabilities/auth/device/vault 调用并共享同一状态机
- [ ] 离线编辑后恢复网络可自动推送,重复请求使用同一 request_id
- [ ] 服务端返回合并结果后本地 data/meta/base_revision 一致,dirty 清除
- [ ] 401/403/410/426/429/网络错误进入正确状态并采用正确重试策略
- [ ] 切换云身份不会自动上传本地 vault
- [ ] 首次绑定三个数据分支均有测试,失败时保留可恢复本地状态
- [ ] 前端 Vitest 覆盖动作、触发、重试、错误和写回;lint/typecheck/test 通过

## 状态: 待开始
