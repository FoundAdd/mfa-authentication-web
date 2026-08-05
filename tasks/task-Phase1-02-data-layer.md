# Task Phase1-02: 数据模型与加密存储层

> 依赖: 01 | 被依赖: 03/04/05/06
> 对应 README: §3.1、模块 2 要求 2/3

## 目标
实现 TotpData 数据模型、localforage 持久化、设备级密钥透明加密封装与全部 CRUD。

## 具体工作
1. 类型定义 `src/types.ts`: `TotpItem` / `TotpGroup` / `TotpData` (含 `ungrouped: TotpItem[]`)
2. 设备密钥模块:
   - 启动时检测 localStorage `_dk`;无则生成 256 位随机值 (base64)
   - 检测到 `totp_data` 存在但 `_dk` 缺失 → 抛出"数据损坏"错误,UI 提供"清空并重置"入口
3. 加密存储层 `src/services/storage.ts`:
   - `save(data: TotpData)`: JSON → AES-256-GCM (设备密钥) → localforage.setItem('totp_data', 密文信封)
   - `load(): TotpData`: 逆过程,业务层无感知
   - 信封格式: `{ v: 1, iv: "<base64>", ct: "<base64>" }`
4. CRUD 封装 (Pinia actions):
   - 分组: 增 / 删 (含"同时删除组内条目"语义由调用方传参,默认条目移入 ungrouped) / 改名 / 排序
   - 条目: 增 (追加末尾) / 删 / 批量删 / 单删 / 排序 / 移动到分组 / 修改 (secret 只读不可改)
   - 搜索过滤为视图层职责,不在存储层实现
5. 首次创建数据后一次性备份提示 (flag 存 localStorage,中英文文案)
6. UUID 生成封装 (`crypto.randomUUID()`)

## 验收标准
- [ ] 数据保存后重启应用可正常读取
- [ ] localStorage 中 `totp_data` 为密文,无明文 secret
- [ ] 清除 `_dk` 后启动,出现数据损坏提示与重置入口
- [ ] 删除分组默认不删条目,条目出现在"未分组"
- [ ] Vitest 覆盖: 加解密往返、分组删除语义、批量移动
