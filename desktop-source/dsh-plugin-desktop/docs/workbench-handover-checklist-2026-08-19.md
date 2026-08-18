# 工作台交接清单（2026-08-19）

> 新会话入口文档。新窗口先读本清单，再按需展开
> [交接文档](workbench-handover-2026-08-18.md)、
> [计划总结](workbench-build-plan-summary-2026-08-18.md) 与
> [未来完整计划](workbench-future-plan-2026-08-18.md)。

## 一、当前状态（已核验）

- 仓库根 `C:\YourWorkbench`，分支 `main`，HEAD 已包含 P2 风格页提交 `b8eb587`
  （主代理续聊 `918d32c` 在其前），工作区干净。
- 桌面端 DeepSeek Harness Desktop 2.0.1 正在运行；P2 风格页已部署并回归通过，本轮 API
  端口 `127.0.0.1:58915`（每次重启会变），GUI 回归期间带 `--remote-debugging-port=9224`。
- 任务库内"简历生成器剩余功能补全与打印美化"（id `174c2a92-…`）已从"执行异常"恢复并完成，当前为"等待验收"。
- 代码位置：
  - 开发源 `C:\YourWorkbench\plugins\workbench\lib\{client.js,host\index.js}`
  - 运行副本 `%LOCALAPPDATA%\Programs\DeepSeek Harness Desktop\resources\app.asar.unpacked\node_modules\dsh-workbench\lib`
  - 部署前备份 `C:\YourWorkbench\backups\workbench-runtime-before-panel-rework-20260818\lib`

## 二、已完成（含最近几轮）

### 任务面板（P1A，用户反馈驱动）

- 错误与网络层：统一 fetch 容错（空响应/超时/解析错误）；所有错误提示可一键复制；错误遮罩不再挡点击；busy 全路径复位。
- AI 协作页 Quick-Add：顶部直接发任务，Enter 创建并进入方案阶段。
- 想法库转交修复：跳转自动修正项目范围并按 id 选中；空态区分原因。
- 方案异步生成：先落盘 `planning` 再后台生成，规划中显示进度条 + 已用时；崩溃恢复逻辑已生效。
- 执行进度可视化：整体进度条、逐代理状态卡（含耗时）、阶段步骤条。
- 反馈语义修正：反馈只用于生成新方案版本，不再注入子代理 prompt。
- 反馈草稿与已提交反馈分离。
- 项目创建支持选文件夹（"浏览…"）。
- 会话列：置顶（★）、面板拖拽调宽（264–420px）、项目切换记忆、双端同会话风险提示。
- 中断任务"继续执行"：保留已完成代理产出，只重跑未完成代理，主代理再汇总。
- 想法库即时同步：保存想法立即刷新全局徽标与想法库；打开任务中心强制刷新。
- Windows 写入健壮性：任务库临时文件 rename 加自动重试（修复偶发 EPERM）。

### 主代理续聊（本轮新增，918d32c）

- 任务进入"等待验收"或"已验收"后，右侧出现"继续与主代理对话"输入框。
- 发送后任务进入"主代理优化中"，主代理携带完整上下文（原始想法 + 方案 + 子代理结果 + 上次报告 + 全部对话记录）继续工作，并可再次调用子代理修改对应部分。
- 每轮对话记录保存在任务 `thread` 里（交付页展示"你/主代理"对话），完成后回到"等待验收"。
- 失败/中断可复制原因；重启中断优化会提示在交付页重新发送优化要求。

### P2 风格页（本轮交付，b8eb587）

- 外观：主题（浅色/深色/跟随系统）、强调色（6 预设 + 自定义取色）、壁纸（本地图片缩放转
  WebP data URL，Host 校验类型与大小，不加载远程图片）、界面不透明度、暗色遮罩、毛玻璃、
  字体大小、圆角、界面密度（紧凑/标准/宽松），全部实时预览。
- 对话风格：默认/简洁/详尽/引导/自定义，与专家人格分离，经独立 `systemPrompt` 段全局生效。
- 预设：内置（专注/工作室/深夜）可直接应用，自定义预设最多 20 个，可保存/删除；
  预设不复制壁纸，应用预设保留当前壁纸。
- 持久化：`DSH_HOME/dsh-workbench-style.json`，串行队列 + 同目录原子替换；
  Host 路由 `GET /style/read`、`POST /style/write`（校验、revision 递增）。
- 验证：`smoke-style` / `smoke-client-load` 新增；eslint、`node --check`、tsc ×4 通过；
  全量 Vitest 249 通过（23 失败为既有 Windows 环境差异）。
- 运行端：已备份并部署两个文件（备份 `backups\workbench-runtime-before-style-p2-20260819`），
  重启后 API 往返验证通过；CDP GUI 回归（渲染、外观、壁纸、对话、预设、恢复默认）全部通过，
  截图见 `C:\Users\wang2\.codex\visualizations\2026\08\18\01a0172b-e0c6-7000-85b1-6caaee4593de\style-*.png`。

## 三、未完成与下一步

1. P1B 剩余 GUI 回归（需用户实测）：文件视图（盘符面包屑/保存/大文件/越界提示）、外壳（置顶/拖拽/重命名归档/默认收起）、专家页（调用/编辑/复制/删除/重启保留）、任务中心存量（看板/`/todo`/想法流转）。
2. P2 风格页已完成（b8eb587，见上）→ P3 监控页 → P4 工作流页 → P5 知识库与蒸馏 → P6 打磨文档。
3. P7 发布链路：数字签名（等证书）、覆盖安装怪癖、`version-baseline.md` 持续同步、发布 SOP。

## 四、待用户决策（D1–D13 摘要）

- D1 模型重写 vs 手动任务覆盖策略；D2 文件视图目录范围；D3 工作流首批模板；
- D4/D5 知识库形态与检索注入；D6 旧 DSH 数据迁移；D7 数字签名；
- D8 便携版；D9 mac/Linux 支持；D10 版本节奏（建议回归完成后发 2.1.0）；
- D11 选文件夹用 HTML 方案；D12 方案异步生成；D13 进度刷新保持轮询。

## 五、开发与验证工作流

```powershell
# 静态检查（node_modules 在沙箱外时需提权）
node --check C:\YourWorkbench\plugins\workbench\lib\client.js
node --check C:\YourWorkbench\plugins\workbench\lib\host\index.js
node C:\YourWorkbench\plugins\workbench\node_modules\eslint\bin\eslint.js C:\YourWorkbench\plugins\workbench\lib\client.js C:\YourWorkbench\plugins\workbench\lib\host\index.js

# 冒烟测试（异步规划 + 中断继续 + 主代理续聊全链路）
node C:\YourWorkbench\plugins\workbench\tools\smoke-orchestration.mjs

# 部署到运行端（需提权）：复制两个文件到 app.asar.unpacked 对应目录后重启应用
# 提交（git 根在 C:\YourWorkbench，沙箱外）：git add + git commit 需提权
```

客户端改动刷新/重启即生效；Host 改动必须重启桌面端。每次重启端口会变化，用
`netstat -ano` 按进程定位，或从页面 `/api/dsh-workbench/tasks/list` 验证。

## 六、持续遵守的约束

- A 端与 B 端不同时打开同一会话；B 端故障不影响 A 端；修改前先备份。
- profile JSON 无 BOM；发布前敏感审计；文件接口仅本机回环并限制在注册工作区内。
- 旧 DSH 数据（`~/.dsh`）不迁移不删除，除非用户决定。
- 计划变更先更新 [workbench-future-plan-2026-08-18.md](workbench-future-plan-2026-08-18.md) 并经确认。
