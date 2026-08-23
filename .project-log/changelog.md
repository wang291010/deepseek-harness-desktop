# 代码级变更明细

> 每条记录一次完整改动。编号连续（C0001 起）。由 project-log-update 技能维护。

## 记录格式（保留）

`编号 | 时间 | 模块 | 文件 | 改动内容 | 原因 | 验证 | 回滚`

- 时间：`YYYY-MM-DD HH:mm`
- 文件：项目根相对路径，多个用 `、` 分隔
- 改动内容：具体到函数/逻辑/配置
- 原因：bug 现象、需求、决策背景
- 验证：实际执行过的检查；没有就写"未验证"
- 回滚：撤销方式（git revert、备份恢复等）

---

| 编号 | 时间 | 模块 | 文件 | 改动内容 | 原因 | 验证 | 回滚 |
|---|---|---|---|---|---|---|---|
| C0001 | 2026-08-23 10:30 | 工程 | .project-log/、AGENTS.md | 初始化项目日志系统，迁移历史基线 | 建立可回溯修改历史 | 模板就绪、基线条目写入 | 删除 .project-log 目录 |
| C0002 | 2026-08-23 10:30 | 桌面打包 | desktop-source/patches/dsh-sandbox-windows-acl@0.1.1-rc.2.patch、desktop-source/package.json、tests/package.spec.ts | 重新生成并恢复 sandbox-windows-acl 隐藏控制台补丁，同步测试断言与 yarn.lock | 上游升级 0.1.1-rc.2 误删补丁，新版未内置 dwFlags/wShowWindow 修复，打包门禁失败 | dist:win 全流程通过，安装包验证通过 | git revert 4ae8692 |
| C0003 | 2026-08-22 06:48 | 会话管理 | plugins/workbench/lib/client.js、host/index.js | 切换会话时释放上一个会话实例（不删持久化历史），配合历史裁剪 | 第 4 个会话 signal timed out；官方 Session 长驻不释放导致渲染主线程超载 | 部署后待用户实测确认 | 恢复旧切换逻辑 |
| C0004 | 2026-08-22 | 工程 | desktop-source/upstream.json、desktop-source/dsh-plugin-desktop/scripts/apply-upstream-runtime-fixes.mjs | 上游核心 rc.6 → rc.2，AbortSignal 贯穿历史链路，历史事件裁剪 | 官方核心升级 + 历史数据过大导致渲染超时 | 构建部署完成，问题原样复现后判定非根因 | git revert |
| C0005 | 2026-08-18 ~ 08-22 | 工程 | desktop-source/、docs/ | 桌面壳开源化、2.0→2.1.1、win 打包门禁与冒烟体系 | 开源发布与可复现构建 | 2.1.1 安装包构建成功 | git revert |
| C0006 | 2026-08-17 ~ 08-19 | 工作台 | plugins/workbench/lib/host/index.js、client.js | 独立长期任务数据层、任务与 Agent 计划分离、按项目隔离、稳定任务 ID | 用户要求任务收进工作台且按项目隔离 | 静态检查 + 隔离数据测试通过 | 恢复旧任务面板 |
| C0007 | 2026-08-18 ~ 08-20 | 工作台 | plugins/workbench/lib/client.js、host/index.js、docs/style-system-v2-plan-2026-08-20.md | UI 风格 V2 改造（部分完成）、侧边栏/浮层/布局 | 用户要求 UI 修改 | 样式 smoke 通过 | 恢复样式 |
| C0008 | 2026-08-19 ~ 08-22 | 会话管理 | plugins/workbench/lib/client.js | 新建防抖、切换锁、串行打开队列、去重、失败重试 | 多会话创建竞态 | 功能级模拟通过 | 恢复旧逻辑 |
| C0009 | 2026-08-19 ~ 08-22 | 知识库 | plugins/workbench/lib/host/index.js、client.js | KB-RAG M1-M9：门控/路由/召回/后处理/联网/审计/自生长/成本/评测 | 知识库从前置注入升级为 AI 自决自适应检索 | 50 题评测 + smoke + 桌面 E2E | git revert |
| C0010 | 2026-08-21 ~ 08-22 | 知识库 | plugins/workbench/tools/run-knowledge-eval.mjs 等 | R1 路由与成本校准：阈值 0.42/0.55、迭代收紧、路由标签 | recall 提升与成本下降 | 50 题 recall@5=1.00、token -43%、延迟 -49% | 恢复旧阈值 |
| C0011 | 2026-08-22 | 知识库 | plugins/workbench/lib/host/index.js、tools/gui-knowledge-trace-e2e.mjs | R2 真实工具追踪：traces 存储、监听 execute、并行重叠计算 | 验证真实桌面行为而非模拟 | 真实桌面证据通过 | 关闭追踪 |
| C0012 | 2026-08-19 | 知识库 | docs/（经验沉淀） | 知识库部署 SOP：备份→复制→重启→定位端口→回归 | 反复部署踩坑 | 多次部署验证 | 无 |
| C0013 | 2026-08-22 | 知识库 | plugins/workbench/lib/client.js、host/index.js | 删除发送前自动检索拦截器与知识库参考浮窗 | 发送卡顿/浮窗残留/第三条消息卡死 | 发送链路修复 + 回归断言 | 恢复拦截器 |
| C0014 | 2026-08-22 | 知识库 | plugins/workbench/lib/host/index.js | 统一索引与磁盘发布判定（status 字段） | 旧 Atomic 条目无 status 报 not published | 读取修复 + 回归 | 恢复旧判定 |
