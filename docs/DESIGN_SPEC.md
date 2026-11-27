# DSH Widget Pet 设计规范（开发基线）

> 当前代码版本：2.2.1  
> 本文件记录开发约束与已确认设计，不代替 README。

## 1. 开发安全要求（强制）

开发新版插件时，**必须使用独立测试平台**，禁止未经外部测试直接把新版安装到生产 DSH。

测试平台要求：

- 使用隔离的 `DSH_HOME` / 数据目录，不读写生产 `.dshcp-usage.json`；
- 使用测试账本、测试设置、测试官方导出样本；
- 至少在测试平台验证：
  - 启动/退出
  - 设置保存与迁移
  - 导入/导出
  - 备份/还原
  - 清理
  - 高危弹窗
  - 数据迁移/版本兼容
- 测试通过后才允许安装到生产 DSH；
- 测试脚本/原型放在 `testdata/prototype/` 或独立测试目录，不混入正式数据。

## 2. 数据功能

详见 [数据页 UI](design/data-feature/data-page-ui.md) 和 [已定规则](design/data-feature/open-decisions.md)。

核心：

- 默认展示口径：官方账号；
- 主货币：CNY，可切换常见货币；
- 官方数据优先，无官方行回退本地，同一天绝不相加；
- 官方与本地都有但不同时弹窗，逐项选择；
- 官方没有对话明细，按对话回退本地并标记；
- 图表总跨度 7/30/90/180/365；每柱 1天/1周/2周/1月/3月；
- 365 天默认按周；
- 自动备份/自动清理默认关闭；
- 自动备份默认范围全部，内容只含不可还原数据；
- 手动备份默认保护；
- 上次还原点只保留 1 个，由数据操作更新，导入强制全量备份。

## 3. 弹窗系统

详见 [弹窗等级](design/ui/dialog-levels.md)。

- 0 提示：主题色
- 1 完成：绿色
- 2 注意：橙色
- 3 危险：红色
- 4 严重：深紫/深红
- 5 系统：黑色

统一接口，同一时间只显示一个，后续排队。  
高危弹窗设置按等级配置倒数/短语/备份；Level 5 固定 15 秒。

## 4. 实验功能

详见 [实验设置](design/ui/experimental-settings.md)。

- 「实验」独立大类，顶部风险说明；
- 总开关「启用实验性选项」默认关闭；
- 总开关开启强制 Level 5 固定 15 秒；
- 每个实验功能启用 Level 4，不强制备份；
- 底部「关闭实验性选项警告弹窗」只在总开关开启后可用；
- 它只压制本页非 15 秒强制的实验功能确认，不管总开关/自己/任何 Level 5。

## 5. 暂缓/不加入

- OOBE 首次启动向导（仅记录）
- 角色大小滑块（仅记录）
- 官方格式导出（暂缓）
- platform 加密 token 同步（实验候选，默认关闭）
- 其他未明确要求的功能

## 6. 设计文档索引

- [数据功能设计索引](design/data-feature/README.md)
- [平台导出格式](design/data-feature/platform-export-format.md)
- [数据页 UI](design/data-feature/data-page-ui.md)
- [备份与还原点](design/data-feature/backup-strategy.md)
- [时区导入](design/data-feature/timezone-import.md)
- [同名对话问题](design/data-feature/known-issues.md)
- [确认弹窗等级](design/ui/dialog-levels.md)
- [确认弹窗设置](design/ui/high-risk-countdown.md)
- [实验设置](design/ui/experimental-settings.md)
- [第三方价格](design/ui/third-party-pricing.md)
- [OOBE](design/ui/oobe-wizard.md)
- [角色大小滑块](design/ui/character-size-slider.md)
- [点击显示设置](design/ui/click-panel-settings.md)
