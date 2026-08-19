# 工作台任务交接（2026-08-19 v6，新会话续作用）

> 新会话先读本文档即可无缝续作；详细计划见
> [未来完整计划](workbench-future-plan-2026-08-18.md)，历史交接见
> [交接清单](workbench-handover-checklist-2026-08-19.md)。

## 一、当前状态（2026-08-19 17:40 已核验）

- 仓库根 `C:\YourWorkbench`，分支 `main`，工作区干净；HEAD = `9ad3acd`
  （B1 修复 + 知识库 v6 一并提交）。
- 桌面端正在运行：API 端口 `127.0.0.1:65474`，CDP `9224`（每次重启会变；
  API 端口可从 CDP 页面 URL 或 `netstat -ano` 定位）。
- 运行端插件：`%LOCALAPPDATA%\Programs\DeepSeek Harness Desktop\resources\app.asar.unpacked\node_modules\dsh-workbench\lib`
  （含 client.js、host/index.js、tools/knowledge_embed.py）。
- 知识库真实数据：21 条（20 知识 + 项目经验模板），向量 = 本地 BGE
  （bge-small-zh-v1.5，512 维，已重建），评测 recall@5 = **1.0**（25/25）；
  experiences=0（尚无真实项目经验条目）。

## 二、最近完成的重点（新会话必须知道）

### 知识库 v4（质量门 + 多路召回）

- 存储分层：`00-Raw/` 源材料（默认不进检索）、`05-Archive/` 归档；
  frontmatter 升级 status/claimType/assumptions/verifiedBy/verifiedAt/staleness；
  旧条目按目录推导状态，只有 `published` 参与默认检索。
- 六步质量门接口：`knowledge/raw|precheck|publish|archive|quality`；写入/蒸馏自动预检；
  reviewMode=auto 时低风险蒸馏自动发布。
- 置信度 = 来源 × 验证 × 一致性 × 新鲜度 × 使用历史，界面/CLI 显示依据。
- 召回路由：auto/bm25-graph/graph/vector/hybrid；本地 BGE 默认开启。
- BGE 桥修复：stdin UTF-8 解码、token_type_ids 输入、首次自动下载 Xenova ONNX 版。

### 知识库 v5（总览分类中心）

- 总览 = 分类中心：技能 / 项目经验 / 项目 / 知识点 / 工作流 五个 Tab（带数量）。
- 条目卡片可展开详情（标签/用途/来源/置信度依据/正文预览）+ 查看编辑 / Obsidian 打开该文件 / 复制路径。
- 移除"专家专属技能"板块；分组互斥；工作区项目可一键打开；模板可跳工作流页。

### 知识库 v6（项目经验 + 半自动提炼，D40–D43 已拍板）

- 新增条目类型 `experience`（中文"项目经验"）：frontmatter
  context（情境）/ result（验证结果）/ reusable（可复用结论）；
  99-Templates 新增「项目经验模板.md」。
- 蒸馏自动判别：项目决策/踩坑/复盘 → experience；概念问答/学习 → note。
- 项目经验默认沉淀 02-Atomic；04-Projects 收敛为"项目档案"。
- 半自动提炼：维护器自动生成「经验 → 知识点」草稿 → 维护页「确认提炼」落盘
  （02-Atomic + 双向回链 + precheck 排除源条目）或「忽略」；失效建议自动清理。
- 全自动预案（未启用）：门槛 = precheck 无阻塞 + 置信度≥中 + 源经验命中≥3 次 + 审计日志。

### B1 修复（新窗口残留旧子代理）

- 根因：`WorkbenchOrchestration` 在无选中时回退 `items[0]`，且 scope=all 返回全项目编排。
- 修复：仅当前会话拥有编排 / 显式全部或全局 / 指定 initialId 时才自动选中，否则空态提示。
- 已部署；若用户实测仍复现，检查是否有入口绕过了 `allowAutoPick` 守卫。

### 其他收尾

- Obsidian 打开按钮已走 Host `shell.openExternal`（渲染层拦截 obsidian:// 已解决）。
- 直接编辑 vault 文件：文本索引自动重建 + 向量自动增量同步（无需手动重建）。
- 运行端向量路实测：语义查询走向量路、精确词走 BM25+图谱、关系类走图谱。

## 三、下一步（按优先级）

1. **P2.6 对话窗口多AI模式**（当前清单第一位）：
   普通对话窗口单/多AI 开关 + 主代理编排 + 自动测模型分配 + 对话流折叠卡片 + 引用浮层 +
   项目上下文设置 + 生成侧自纠错门（引用知识强制溯源）。D23–D25 已确认。
2. 知识库使用期积累：用户实际用 v6 后反馈（体验问题优先修；继续向评测集补题）。
3. P6 打磨与文档（视觉统一/安全复查/用户手册）。
4. P7 发布链路 + 朋友安装包大更新（攒够进度再打包；安装包需内置 Node 运行时问题待解决）。

## 四、关键路径与工具

- 开发源：`C:\YourWorkbench\plugins\workbench\lib\{client.js,host\index.js}`
- 工具：`tools/`（smoke-knowledge、knowledge-query、run-knowledge-eval、
  seed-knowledge-workbench、knowledge_embed、gui-knowledge-regression 等）
- 计划文档：`docs/workbench-future-plan-2026-08-18.md`（含决策清单 D1–D43、
  3.5 Bug 队列、各阶段完成记录）
- 部署前备份：`C:\YourWorkbench\backups\`（最近：workbench-b1-plus-kb-v6-20260819-173452、
  workbench-kb-v6-fix-20260819-173601）
- 真实 vault：`C:\Users\wang2\AppData\Roaming\DeepSeek Harness Desktop\harness-home\knowledge`

## 五、验证工作流（每步固定循环）

现状核验 → 方案（决策点）→ 备份 → 实施 → 回归（smoke/eslint/tsc/评测集/GUI）→
更新文档 → 提交（git 在 `C:\YourWorkbench`，沙箱外需提权）→ 部署运行端（备份 + 复制 + 重启）。

```powershell
node --check C:\YourWorkbench\plugins\workbench\lib\client.js
node --check C:\YourWorkbench\plugins\workbench\lib\host\index.js
node C:\YourWorkbench\plugins\workbench\tools\smoke-knowledge.mjs
# eslint / tsc / 部署 在沙箱外需提权
```

Host 改动必须重启桌面端；Client 改动刷新即生效。每次重启端口会变。

## 六、持续约束

- 不修改 `deepseek-harness/` 子模块；旧 DSH 数据不迁移不删除。
- 文件接口仅本机回环 + 注册工作区限制；profile JSON 无 BOM；发布前敏感审计。
- 计划变更先更新 future-plan 并经用户确认。
- 用户偏好：中文交流、本地自用不因打包妥协、先总结再方案审核再执行。
