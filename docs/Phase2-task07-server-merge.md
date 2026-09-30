# Task Phase2-07: 服务端 LWW、Tombstone 与排序合并

> 依赖: 06 | 被依赖: 09/10/11/12
> 对应 docs/Phase2.md: §5.3、§8

## 目标

在 Worker 内实现唯一权威的 vault 合并算法,处理实体级 LWW、删除优先、分组移动、排序列表、时间偏差和 isExpanded 剥离。

## 具体工作

1. 实现 `server/src/services/merge.ts` 纯函数:
   - 输入 current、incoming、merge time 和 device_id。
   - 输出 merged `VaultPayload`、变更摘要和是否需要新 revision。
   - 不直接访问 D1,不记录 payload。
2. 实体级 LWW:
   - 先比较 `updatedAt`。
   - 同一毫秒比较 `updatedBy` 的 Snowflake 数值。
   - 一侧新增/修改,另一侧未变化时直接采用变更侧。
   - 两侧都变化时采用较新版本。
3. Tombstone:
   - 任一实体存在 `deletedAt` 时删除优先。
   - 普通更新不能复活 tombstone。
   - 分组删除未删除条目时,为移动后的条目生成新的同步元数据。
   - 分组连带删除条目时同时写入 item tombstone。
4. 排序:
   - `groupOrder`、`itemOrder[groupId]`、`ungroupedOrder` 分别作为整体 LWW。
   - 条目移动和排序后同步更新对应 order 元数据。
5. UI 状态:
   - 服务端持久化前不保存 `isExpanded`;合并结果中的分组保持 schema 允许的中性值。
   - 客户端负责在接收后恢复本地展开状态。
6. 时间校正:
   - 偏差小于 5 分钟使用客户端时间。
   - 超过 5 分钟但不超过 24 小时钳制到服务端时间。
   - 超过 24 小时返回 `CLOCK_SKEW`。
7. 指纹:
   - 普通同步不使用 secret+issuer 指纹去重。
   - 仅首次认领/导入预览可使用现有指纹规则。

## 验收标准

- [ ] 单侧新增、修改、删除和排序均收敛到预期结果
- [ ] 双端并发同 ID 编辑按 LWW 规则稳定选择,时间相同有确定 tie-breaker
- [ ] 删除与编辑并发时删除优先,不会复活旧条目
- [ ] 删除分组时“移入未分组”和“连带删除”语义分别正确
- [ ] group/item/ungrouped 排序并发可确定收敛
- [ ] isExpanded 不进入服务端持久化 payload
- [ ] 时间偏差边界测试覆盖 5 分钟、24 小时和未来时间
- [ ] merge 纯函数测试覆盖新增、修改、删除、移动、排序、tombstone、重复运行幂等

## 状态: 待开始
