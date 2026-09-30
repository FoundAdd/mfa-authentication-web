# Task Phase2-02: 服务端密钥托管与 Envelope Encryption

> 依赖: 01 | 被依赖: 03/06/07/11
> 对应 docs/Phase2.md: §5.1、§6、§12

## 目标

实现每用户 DEK、KEK 包装、VaultPayload 加解密和密钥版本管理,保证 D1 中不出现 TOTP 明文或未包装 DEK。

## 具体工作

1. D1 migration 建立用户与当前 vault 基础表:
   - `users` 包含 `wrapped_dek`、`dek_wrap_iv`、`dek_version`。
   - `vaults` 包含当前 `revision`、ciphertext、IV 和 crypto version。
   - 首次创建用户时由业务服务初始化 DEK 和空 vault,不允许客户端提交密钥材料。
2. 实现 `server/src/services/crypto.ts`:
   - `generateDek()` 使用 `crypto.getRandomValues(32)`。
   - `wrapDek(dek, kekVersion)` / `unwrapDek(row)` 使用 AES-256-GCM。
   - `ensureUserVault(userId)` 创建 revision=1 的空加密 vault。
   - `encryptVaultPayload(userId, payload)` / `decryptVaultPayload(userId, row)`。
   - AAD 至少绑定 `user_id`、`crypto_version` 和用途标签。
3. 密钥版本:
   - KEK 从 Worker Secret `KEK_V1`、`KEK_V2` 读取。
   - `dek_version` 记录包装 DEK 的 KEK 版本。
   - 实现管理员/CLI rewrap 流程: 解包旧 DEK、重新包装、更新版本。
   - Phase 2 不主动轮换 DEK。
4. 删除语义:
   - 删除云端数据时删除 wrapped DEK、vault、历史版本和关联 session。
   - 删除操作必须幂等。
5. 日志:
   - 捕获加密异常但不输出 key、iv、ciphertext 或 payload。
   - 对外统一返回 `INTERNAL_ERROR` 或稳定的解密错误码。

## 验收标准

- [ ] 每个用户拥有独立随机 DEK,数据库只保存包装后的 DEK
- [ ] VaultPayload 加密后可正确解密;AAD 不匹配或密钥错误时解密失败
- [ ] KEK 从 V1 轮换到 V2 后,用户无需重新上传 vault 即可继续同步
- [ ] 用户删除云端数据后 D1 中不存在其 vault、历史版本和 wrapped DEK
- [ ] 单元/集成测试覆盖 wrap/unwrap、AAD、错误密钥、版本切换和删除幂等
- [ ] 服务端测试、typecheck、lint 通过

## 状态: 待开始
