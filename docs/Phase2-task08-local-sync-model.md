# Task Phase2-08: 本地 V2 信封、SyncMeta 与变更记录

> 依赖: Phase2-06;Phase1-02/06 | 被依赖: 09/10/11/12
> 对应 docs/Phase2.md: §5.2、§5.3、§9

## 目标

在不改变 `TotpData` 业务结构和 `.totp` 导出格式的前提下,升级本地加密存储为同时保存数据与 SyncMeta 的原子信封,并让所有同步相关 CRUD 生成准确的实体元数据。

## 具体工作

1. 本地存储升级:
   - 定义 `LocalEnvelopeV2 = { v: 2, iv, ct }`,解密后为 `{ data, meta }`。
   - 现有 V1 信封在读取时迁移到 V2;失败仍抛现有 DataCorruptedError。
   - 导出只读取 `data`,不包含 `meta`、revision、device 或 tombstone。
2. SyncMeta 类型与工具:
   - 实现 `EntitySyncMeta`、`ListSyncMeta` 和 schema 校验/规范化。
   - 为旧数据首次进入同步时补全初始 meta。
   - 提供 `touchEntity`、`touchList`、`markTombstone`、`markDirty` 等纯函数。
3. 修改 `stores/totp.ts`:
   - 新增、修改、删除、批量操作、移动和排序通过统一 mutation helper 更新 meta。
   - `isExpanded` 变化不更新 meta。
   - `setData` 用于导入时必须补全/生成 meta,并保留可合并的旧同步信息。
   - 保留现有 150ms 本地持久化防抖,但保存 `{ data, meta }` 一体对象。
4. 本地同步状态:
   - 持久化 `sync_identity=(issuer, subject)`、`user_id`、`device_id`、`base_revision`、`dirty` 和 `last_attempt_at`。
   - 首次绑定/解绑/删除本机数据时提供原子更新与恢复入口。
5. 导入语义:
   - 合并导入保留现有指纹去重,但新条目生成 meta。
   - 同步开启时覆盖导入把缺失条目转换为 tombstone,并标记 dirty。
   - 同步关闭时覆盖仍按 Phase1 本地语义执行。

## 验收标准

- [ ] V1 本地数据升级后不丢失条目,导出文件仍符合 `.totp` v1 格式
- [ ] 所有同步相关 CRUD 正确生成 updatedAt/updatedBy/tombstone/order meta
- [ ] 折叠/展开分组不改变 dirty,不触发上传
- [ ] 覆盖导入在同步开启时生成删除 tombstone
- [ ] 数据与 meta 在一次 localforage 写入中保存,模拟中途失败不产生半状态
- [ ] 测试覆盖 V1→V2、CRUD meta、导入分支和本地状态持久化

## 状态: 待开始
