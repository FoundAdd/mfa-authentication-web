# Task Phase2-06: Vault API、Revision CAS 与历史版本

> 依赖: 02/03/05 | 被依赖: 07/08/09/10/11/12
> 对应 docs/Phase2.md: §5、§7、§10、§14

## 目标

实现单用户逻辑 vault 的读取、完整快照推送、revision CAS、幂等写入、当前版本和最近 2 个历史版本,以及云端数据删除状态。

## 具体工作

1. 在 Task 02 已建立的 `users`/`vaults` 基础上增加:
   - `vault_revisions` 历史版本表。
   - 幂等记录表或等价 CAS 幂等存储。
2. 定义 `VaultPayload`、`SyncMeta` 和 API Zod schema:
   - `schema_version = 1`。
   - data 使用现有 `TotpData` 结构。
   - meta 校验实体 ID、时间和设备 ID 格式。
3. `GET /api/v1/vault`:
   - 返回当前 revision、schema_version、解密后的 data/meta。
   - 用户没有 vault 时返回明确状态,不创建半初始化记录。
4. `PUT /api/v1/vault`:
   - 接收 `request_id`、`device_id`、`base_revision`、schema_version、data、meta。
   - 拒绝超过 payload/条目上限的请求。
   - 先查幂等记录;重复请求返回同一合并结果。
   - 使用 `WHERE user_id = ? AND revision = ?` CAS 更新。
   - CAS 失败时重新读取并交给 merge service 重试。
   - 成功返回完整合并后的 `revision + data + meta`。
5. 历史版本:
   - 成功写入前把旧 current 复制到 `vault_revisions`。
   - 最新排前,仅保留当前版本加 2 个历史版本,共 3 个可恢复版本。
   - 历史 ID 使用 Snowflake。
   - Phase 2 不提供历史查询或用户回滚 API。
6. `DELETE /api/v1/vault`:
   - 级联删除 current、history、wrapped DEK、web session 和设备同步状态。
   - 标记用户为 cloud-deleted,后续设备收到 `410 CLOUD_DELETED`。
   - 保留本地数据,不删除 `users` 的身份映射。
7. 上传统计:
   - 更新 `devices.last_sync_revision` 和 `last_seen_at`。
   - 不把 payload 明文写入日志或审计。

## 验收标准

- [ ] 新用户开启同步后获得 revision=1 的加密 vault
- [ ] 相同 `request_id` 重试不会重复增加 revision 或生成重复历史
- [ ] 并发 PUT 通过 CAS 收敛,不丢失已接受写入
- [ ] 每次成功写入后历史版本最多 2 条,当前版本可正确解密
- [ ] payload 超限、schema 不支持、设备撤销、非本人 user_id 等请求返回稳定错误
- [ ] 删除云端数据后 current/history/DEK/session 清理,后续请求返回 410
- [ ] 集成测试覆盖 CAS、幂等、历史裁剪、删除和错误码;typecheck/lint/test 通过

## 状态: 待开始
