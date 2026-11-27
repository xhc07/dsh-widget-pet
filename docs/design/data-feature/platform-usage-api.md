# 能否自动同步 platform.deepseek.com 的今日已用

> 仅分析，未改代码。

## 结论

- **公开 API**：没有按天/按账号查询“今日已用”的稳定接口。公开 API 的 usage 是每次请求返回的 token 用量，不是账号日账单。
- **platform 网页内部接口**：存在 `platform.deepseek.com/api/v0/usage/...` 这类接口，但需要网页登录态/token，不是普通的 `DEEPSEEK_API_KEY`，也不属于公开稳定 API。
- 因此：
  - 仅靠官方 API key，不能可靠自动同步今日已用；
  - 现有余额下降观测仍是主要自动来源；
  - 官方导出 zip 仍是可靠账单来源。

## 官方是否开放登录 token

没有。

- 官方公开 API 只提供 API key；
- 没有开放 OAuth2 授权端点；
- 没有公开的“platform 登录 token”供第三方读取用量；
- platform 网页登录态是浏览器会话，不是公开 API；
- DSH 自己的账号授权 token 只用于 DSH 的 profile/balance，不是公开的 usage 凭据。

## 内部接口示例

第三方工具中出现的接口：

- `/api/v0/usage/amount`
- `/api/v0/usage/cost`
- `/api/v0/usage/by_api_key/amount`
- `/api/v0/usage/by_api_key/cost`
- `/api/v0/usage/export`

这些通常需要登录态，且可能随平台改版变化，不适合作为稳定依赖。

参考：

- [DeepSeek API Docs — Token Usage](https://api-docs.deepseek.com/zh-cn/quick_start/token_usage/)
- [CodexBar DeepSeek docs](https://github.com/steipete/CodexBar/blob/main/docs/deepseek.md)
- [dsh-deepseek-usage](https://github.com/AzureHalcyon/dsh-deepseek-usage)
- [deepseek-usage export code](https://raw.githubusercontent.com/shajanjp/deepseek-usage/main/lib/deepseek.js)

## DSH 账号能否提供用量

DSH 的 `deepseekAccount` 目前只暴露：

- `getProfile`
- `getBalance`

它用保存的授权 token 请求 `platformOrigin` 的：

- `/auth-api/v0/users/current`
- `/api/v0/users/get_user_summary`

没有看到公开的 usage 查询方法。也就是说：

- 可以用 DSH 账号读资料/余额；
- 不能假定它能读 platform 的逐日用量；
- 插件里做“网页登录并抓取”会引入 cookie/token 存储、跨域、反爬和账号安全问题。

## 可选实验功能：加密保存 platform 会话 token

不建议保存 platform 账号密码，也不建议嵌入浏览器做登录。

更现实的做法：

1. 用户在浏览器登录 platform，手动取得会话 token（或 cookie）；
2. 插件只保存 token，不保存账号密码；
3. 用用户设置的解锁密码派生密钥，加密后落盘；
4. 每次启动必须输入解锁密码；
5. 解锁成功才启用 platform 用量同步；
6. 解锁失败则功能关闭，不影响本地账本。

技术：

- Node `crypto.scryptSync` 派生密钥；
- AES-256-GCM 加密；
- 不保存密码，只保存盐/密文/tag；
- token 只在内存中解密使用；
- 退出/锁定清除内存 token。

风险：

- 仍是 platform 内部接口，可能改版/失效；
- token 可能过期；
- 本机进程被攻破时，加密不能完全保护；
- 不是官方支持功能，必须最高风险提示；
- 默认关闭。

资源：

- 代码增量小；
- 不引入浏览器内核；
- 一次同步只是一个 HTTP 请求；
- 主要风险是稳定性和账号安全，不是体积。

## 可选方案

1. **不自动同步**：余额观测 + 手动导入官方 zip（推荐）。
2. **让用户提供 platform 登录 token**：可调用内部接口，但需要明确“非公开、可能失效、凭据敏感”。
3. **只同步当日汇总**：如果内部接口稳定，可作为可选实验功能。
4. **插件内登录抓取**：不建议。需要嵌入/代理 platform 登录，跨域和凭据风险高，且平台无公开 OAuth。

## 结论

最现实的是：

- 继续用余额下降观测；
- 用官方 zip 做账单修正；
- 不把“插件内登录抓 platform 用量”作为首版功能。

## 风险

- 网页 token 过期/改版；
- 账号安全；
- 时区（+08/UTC）差异；
- 日界不同；
- 频率限制。
