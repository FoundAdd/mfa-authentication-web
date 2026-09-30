# Task Phase2-05: 设备注册、命名与撤销

> 依赖: 03 | 被依赖: 06/09/10/11/12
> 对应 docs/Phase2.md: §5.1、§10、§11

## 目标

为每个已认证用户签发 Snowflake `device_id`,记录设备平台、名称和同步水位,提供设备列表、重命名与撤销能力。

## 具体工作

1. D1 migration 增加 `devices` 表及索引:
   - 唯一 ID 为 Snowflake 字符串。
   - 索引 `user_id`、`revoked_at` 和 `last_seen_at`。
2. 设备注册服务:
   - 首次认证后或首次启用同步时调用 `POST /api/v1/devices`。
   - 客户端提交 `name`、`platform`;服务端校验长度和枚举,生成 Snowflake ID。
   - 限制单用户设备数量,默认值待压测确定。
3. 设备命名:
   - Android 优先使用设备型号和 OS 版本,例如 `Android 15`。
   - Web 优先使用浏览器和 OS,例如 `Chrome (Ubuntu 22.04)`。
   - 获取失败回退 `Android App`、`Chrome` 等通用名。
   - 不采集硬件指纹,不把名称作为鉴权依据。
4. 设备接口:
   - `GET /api/v1/devices`: 返回当前用户设备、最近同步 revision、最后活跃时间和状态。
   - `PATCH /api/v1/devices/:id`: 重命名自己的设备。
   - `DELETE /api/v1/devices/:id`: 撤销自己的设备;撤销后拒绝该 device 的普通同步请求。
5. 与 session 关联:
   - Web session 可绑定 device_id;设备撤销时失效关联 session。
   - Android 被撤销后仍清除 Access token 之外的状态由客户端处理。
6. stale 设备:
   - 超过 90 天未同步标记为 `stale`。
   - stale 只影响 tombstone 清理判断,不自动删除设备记录。

## 验收标准

- [ ] 新设备收到唯一 Snowflake 字符串 `device_id`,重试注册具备幂等行为
- [ ] 设备名称按型号/系统优先生成,失败时使用回退名;客户端不能设置其他用户的设备
- [ ] 用户只能列出、重命名和撤销自己的设备
- [ ] 已撤销设备的同步请求返回 403 `FORBIDDEN`,Web session 同步失效
- [ ] 90 天未活跃设备被标记为 stale 且仍保留列表记录
- [ ] 单元/集成测试覆盖注册、重命名、撤销、跨用户拒绝和 stale 判定
- [ ] typecheck/lint/test 通过

## 状态: 待开始
