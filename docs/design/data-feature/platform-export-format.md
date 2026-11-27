# platform.deepseek.com 用量导出格式

> 基于 2026-11 的三份官方导出样本分析。样本未做解压、改写或重新压缩。

## 1. 文件结构

官方导出是 zip：

```text
usage_data_<start>_<end>.zip
  cost-<start>_<end>.csv
  amount-<start>_<end>.csv
```

CSV 特征：

- UTF-8 **带 BOM**
- CRLF
- 金额币种 CNY
- `start_time_iso` / `end_time_iso` 为 `+08:00`
- 日期按天，`start` 当天 00:00 到 `end` 次日 00:00
- 没有用量的日期不会产生行

样本覆盖（只列实际有行的日期）：

| 文件 | 实际日期 | 总额 |
|---|---:|---:|
| 2026-10-01～2026-10-31 | 10-24～10-29，6 天 | ¥5.847955 |
| 2026-10-27～2026-11-25 | 10-27～11-25，26 天 | ¥96.895392 |
| 2026-11-01～2026-11-25 | 11-01～11-25，23 天 | ¥94.375895 |

## 2. cost CSV

```text
user_id,start_time_iso,end_time_iso,model,name,wallet_type,cost,currency
```

| 字段 | 含义 |
|---|---|
| user_id | 平台账号 UUID |
| start_time_iso / end_time_iso | 统计日边界，+08:00 |
| model | 模型名；工具/服务行可能为空 |
| name | 模型名或服务名（如 `server-tool-search`、`tool-search`） |
| wallet_type | `Granted`（赠送额度）或 `Paid`（付费余额） |
| cost | 当天该模型/服务在该钱包的扣费 |
| currency | 目前为 CNY |

30 天样本钱包分布：

- Granted：¥1.748923
- Paid：¥95.146469

30 天样本类别：

- `deepseek-flash`：¥96.495392
- 工具/服务：¥0.400000

## 3. amount CSV

```text
user_id,start_time_iso,end_time_iso,model,name,api_key_name,api_key,type,price,amount
```

| 字段 | 含义 |
|---|---|
| api_key_name | API key 名称，样本为 `DeepSeek Harness (App-managed)` |
| api_key | API key 标识；样本为空 |
| type | 计费项 |
| price | 单价 |
| amount | token 数 / 请求数 / 调用次数，不是金额 |

`type` 取值：

- `input_cache_hit_tokens`：命中缓存的输入 token
- `input_cache_miss_tokens`：未命中缓存的输入 token
- `output_tokens`：输出 token
- `request_count`：API 请求次数
- `function_call`：工具/搜索调用次数

金额关系：

```text
行金额 = amount × price
cost 总额 = 所有 amount 行金额之和
```

三份样本逐日核对后，`cost` 与 `amount × price` 完全一致。

## 4. 峰谷

同一个 `type` 存在两档单价，正好相差 2 倍：

| type | 低价 | 高价 |
|---|---:|---:|
| input_cache_hit_tokens | 0.00000002 | 0.00000004 |
| input_cache_miss_tokens | 0.000001 | 0.000002 |
| output_tokens | 0.000004 | 0.000008 |

高价位对应高峰时段。30 天样本：

- 低价段模型费用：¥83.2182
- 高价段模型费用：¥13.2772
- 工具/服务：¥0.4000
- request_count：6101
- function_call：31 次零价 + 80 次 ¥0.005

`cost` 只给每天/模型/钱包总额，不能直接拆峰谷；`amount` 的 `price` 可用于还原峰谷 token/费用。

## 5. 服务项

`model` 为空、`name` 为服务名时，不是模型：

- `server-tool-search`
- `tool-search`

导入后必须显示为「工具/服务」，不能归到「未知模型」。

## 6. 去重键

同一天可能被多个导出覆盖，必须按键去重，不能按日期追加。

cost：

```text
user_id + start_time_iso + end_time_iso + model + name + wallet_type + currency
```

amount：

```text
user_id + start_time_iso + end_time_iso + model + name + api_key_name + api_key + type + price
```

三份样本去重结果：

- cost：37 个唯一键，34 个键在多个文件中出现
- amount：146 个唯一键，134 个键在多个文件中出现
- 相同键的金额/数量全部一致，没有冲突

## 7. 官方数据不含什么

官方导出没有：

- session ID
- 对话标题
- 每轮记录
- 本地 DSH 的模型明细/对话统计

因此官方数据不能生成「按对话」视图，也不能和本地逐轮事件一一对应。

## 8. 官方格式导出限制

能做的：

- 保存从官方 zip 导入的原始 cost/amount 行；
- 按官方 CSV 列、BOM、CRLF、zip 成员名重新生成；
- 可选 zip 名加 `_pet` 后缀，例如 `usage_data_..._pet.zip`。

不能做的：

- 把纯本地数据无损写成官方 CSV；
- 补齐 `user_id`、`wallet_type`、`api_key`、cache 命中/未命中拆分、`request_count`、`function_call`；
- 保证 platform.deepseek.com 接受反向导入（格式相同不等于平台支持）。

因此官方格式导出仅适用于官方来源行；本地数据走插件 JSON。官方格式导出暂缓实现。

## 9. 平台反向导入

没有找到 platform.deepseek.com 官方提供的“导入用量/账单 CSV/zip”入口；目前看到的相关导入都是第三方工具导入官方导出文件。

结论：

- 官方导出基本是单向的；
- 生成结构相同的 zip 只代表“格式兼容”，不代表平台会接受导入；
- 它的用途是适配只认官方格式的第三方插件/软件，而不是反向写回官方平台。
