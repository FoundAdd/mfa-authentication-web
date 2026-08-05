# Task Phase1-03: TOTP 计算核心

> 依赖: 01 (类型可先行) | 被依赖: 04/05/06
> 对应 README: 模块 2 要求 1

## 目标
实现基于 otpauth 库的 TOTP 实时计算封装与全局计时器。

## 具体工作
1. `src/services/totp.ts`:
   - `compute(item: TotpItem, timestampMs: number): string` — 原始数字串
   - `format(digits: string): string` — 6 位 `123 456`,8 位 `1234 5678`,随 digits 自适应分组
   - `remainingSeconds(period: number, timestampMs: number): number` — 倒计时
   - `preview(item: TotpItem): { code, period, remaining }` — 保存前预览用
2. 全局计时器 (Pinia `useClockStore`): `setInterval` 1 秒 tick,暴露当前时间戳与剩余秒数,组件订阅而非各自开定时器
3. Base32 校验工具: `isValidBase32(secret)` + 规范化 (去空格、转大写)
4. otpauth-migration protobuf 解析的纯函数部分在本任务预留接口 (实现见 06)

## 验收标准
- [ ] Vitest 使用 RFC 6238 / otpauth 官方测试向量验证 SHA1/SHA256/SHA512、6/8 位、30/60s 组合
- [ ] format 输出符合分组规则,复制内容不含空格
- [ ] 倒计时跨周期时正确归零并进入下一周期
- [ ] isValidBase32 拒绝非法字符、长度不合法输入
