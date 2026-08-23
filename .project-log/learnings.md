# 心得与决策

> 记录方案取舍、经验、坑与方法评价。这是蒸馏技能的输入源；已蒸馏的条目标注"（已蒸馏 日期）"。

## 记录格式（保留）

```markdown
## C编号 · 短标题

- 场景/触发词：
- 做了什么：
- 结果：
- 评价（可选）：
```

---

## C0003 · signal timed out 排查方法论

- 场景/触发词：第 N 个会话卡死 / 历史加载失败 / signal timed out
- 做了什么：先查发送链路，再查会话创建竞态，再升级核心，再查取消信号，最后查渲染层会话实例生命周期；同步检索网上同类 issue（dofine/deepseek-harness #1、PR #2）
- 结果：根因是官方 Session 长驻 Map 不释放、历史数据过大压垮渲染主线程；修复 = 切换时释放旧实例 + 历史裁剪
- 评价：官方 issue 检索 + 本机证据（Host 日志无错、渲染层证据）双线收敛是高效路径；前几轮修发送层/竞态是必要排除法，但判断"是不是根因"应尽早用 Host 日志佐证

## C0013 · 发送前拦截器是高风险模式

- 场景/触发词：发送卡顿 / 浮窗残留 / 消息丢失 / 输入框竞态
- 做了什么：删除整个发送前自动检索拦截器，改回原生提交
- 结果：发送链路恢复稳定
- 评价：拦截"发送"这种高频核心路径做异步前置逻辑，极易引入竞态；新功能应挂到结果侧（发送后/生成中），不要劫持输入提交

## C0002 · 依赖补丁升级后要回归门禁

- 场景/触发词：上游升级 / 补丁丢失 / 打包门禁失败 / node_modules 链接不一致
- 做了什么：上游 0.1.1-rc.2 升级时误删 sandbox-windows-acl 补丁（新版未内置修复）；且 electron-builder 补丁链接指向未打补丁副本
- 结果：恢复补丁 + 清理不一致链接 + 重装依赖后 dist:win 通过
- 评价：升级上游后必须跑 `check:win-package` 门禁；删除 resolutions 补丁前先确认新版源码是否真的内置了修复（读实际安装包代码，不要只看版本号）

## C0009 · 知识库改造要留回归证据

- 场景/触发词：KB 改造 / 召回方式 / 评测
- 做了什么：50 题评测 + smoke 套件 + 真实桌面 E2E + 部署前备份
- 结果：recall@5=1.00，真实证据链完整，能区分"KB 引入的 bug"与"官方运行时 bug"
- 评价：评测集和 trace 是判断"改造是否引入 bug"的关键证据，长期保留

## C0015 · 蒸馏入库要走人工审核门禁

- 场景/触发词：蒸馏 / 知识库 / 01-Inbox / 02-Atomic / 审核
- 做了什么：把蒸馏目标从 02-Atomic 改为 01-Inbox，蒸馏产物一律 status: draft；此前直接进 02-Atomic 的 2 条经验移回收件箱
- 结果：未审核内容不再进入检索，与知识库 README 约定（AI 写入区 → 人工审核 → 人类审核区）一致
- 评价：知识库按区域分信任等级，AI 写入区与人工审核区必须分开；只配目标不改流程，AI 产物会绕过审核直接发布。审核入口 = 01-Inbox 内 status: draft 的文件

## C0016 · 覆盖安装旧版后启动静默失败：先拿 stderr 日志再判断

- 场景/触发词：安装包分发 / 覆盖安装 / 双击无反应 / 单实例锁 / profile 加载失败
- 做了什么：本机实测安装包启动正常（隔离 userData），排除安装包问题；让朋友用 `exe 2> startup.log` 重定向 stderr，捕获到 cannot resolve profile bundle "@abcdefu_cja/dsh-usage-stats"
- 结果：根因 = 旧版 profile（harness-home/profiles/desktop）依赖记录里残留旧混淆包名，新版内置插件名不一致，启动加载 profile 时失败，failLoud 错误不可见
- 评价：GUI 应用的启动失败必须先想办法拿到 stderr（重定向/事件查看器），不要猜；覆盖安装类问题先查 profile/数据状态残留，再考虑卸载重装；修法 = 改名备份 profiles/desktop 让新版重建

## C0017 · 逐句 groundedness 的轻量实现路径

- 场景/触发词：R3 / 逐句审计 / groundedness / 引用修正 / 未验证 / 自动修正
- 做了什么：句级评分 = 断言句检测（断言词/数字启发式）+ 证据匹配（中文字/词重叠，可选本地 BGE 余弦取 max），分 grounded/weak/uncited/unsupported 四档；失败后只自动修正一次（LLM 重写优先，规则兜底：补引用、把错引替换成证据匹配更高的条目、实在无证据标“未验证”），再审计并把逐句结果写入 knowledge_audit trace；`run-groundedness-eval.mjs --generate/--gate` 提供 20+ 样本与 ≥0.85 的失败退出门禁
- 结果：进程内自检通过（fully-cited=1.00、flawed 修正后 violations=1 并标未验证、traces 落库）；hybrid 评分待桌面应用内复验
- 评价：规则评分离线可跑、零依赖，但语义匹配有限，生产建议 hybrid（本地 BGE 余弦）+ LLM 修正兜底；auto-fix 只做一次避免模型反复改写；审计结果必须落 trace，否则在线汇总无从采样；注意 `missing` 是数组，`!missing` 恒为假——deep audit 的 valid/abstainRequired 要按数组长度判断
（已蒸馏 2026-08-23 → 01-Inbox 草稿区）

## C0020 · 逐句 groundedness 门禁校准（首轮 0.829 → 1.0）

- 场景/触发词：groundedness 门禁不达标 / 逐句误判 / 引子句 / 未验证句 / LLM 修正不彻底
- 做了什么：用真实 20 题跑桌面门禁，首轮 0.829；逐条看失败句后校准：① 以“是：/包括：”结尾的引子句不算结论句；② 已标“（未验证）/无法确认”的句子计 abstain，不进分母也不计违规；③ weak 句用 LLM 二值判定（supported→grounded，否则→unsupported）；④ LLM 修正后规则兜底总补跑一次，unsupported 句强制标“未验证”；⑤ 修正匹配前把原文与句子的空白统一，否则换行会把句子拆成“句+引用”两段导致 includes 匹配失败；⑥ 在线汇总从 trace 逐句统计（不能只统计编排审计）
- 结果：校准后 20/20 题 rate=1，33 个逐句样本 groundedness=1.0，门禁通过；auditLevel 已切 ref+groundedness
- 评价：门禁不过先别调阈值——把失败句导出逐条归类（引子/未验证/错引/真缺证据），大多数是判定口径问题；LLM“修正”不可信，必须保留规则兜底并复验
（已蒸馏 2026-08-23 → 更新 01-Inbox 草稿区）

## C0021 · cross-encoder 重排在小知识库性价比低

- 场景/触发词：重排 / rerank / cross-encoder / bge-reranker / top1 / context relevance / 对比评测
- 做了什么：实现 bge-reranker-v2-m3（ONNX int8）重排，接入 rerank:'cross'；在桌面应用跑 50 题三组对比（关闭 vs BGE 余弦 vs cross-encoder），新增 top1 命中率与 avg top1 相关性（BGE 余弦）指标
- 结果：关闭 recall=1.00/top1=0.78/648ms；local recall=0.98/top1=0.86/1120ms；cross recall=0.96/top1=0.84/2611ms。cross 无优势且慢 2.3 倍，不默认开启；local 有 top1 提升但 recall 略降，保留可选，默认保持关闭
- 评价：知识库只有几十条时 recall@5 本来就饱和，重排只能改善 top1 精度却牺牲 recall 并增加延迟；cross-encoder 的优势要在大候选池/大语料下才显现。transformers.js 里跨编码器没有 rerank 管道，text-classification 单标签概率恒 1，必须用 AutoModelForSequenceClassification 读 logits；pair 编码要 `tokenizer(queries, { text_pair: docs, padding, truncation })`，传对象数组会被当成单文本导致形状 [2,2]
（已蒸馏 2026-08-23 → 01-Inbox 草稿区）

## C0022 · LLM 评估器的三个稳定性坑

- 场景/触发词：LLM 评估 / completeness / 门禁不达标 / 评分恒 0 / 空返回 / 诚实 abstain
- 做了什么：实现 completeness（LLM 打分）、faithfulness（=逐句 groundedness）、缓存命中率、真实调用计数，并建离线/真实运行双门禁；调试中踩到三个坑：① JS 里 `Number(null)===0`，评分器返回 null 被存成 0 分，看似"答案质量差"实为解析失败；② 评估调用 maxTokens 设 20 时模型频繁空返回，必须用 256 以上并加重试；③ 完整度评分器最初按"回答是否覆盖问题所有要点"打 0，但问题要点在知识库中没有时，诚实的"（未验证）"才是合格回答——评分口径必须改为"对照知识条目可答要点评估，诚实 abstain 不算遗漏"，且只传精简条目摘要而非整块
- 结果：门禁从 groundedness 1.0 / completeness 0.271 校准到 groundedness 0.929 / completeness 0.871，双门禁通过；缓存命中率 0.5 实测正确
- 评价：门禁数字异常先怀疑评估链路本身（解析/截断/空返回），再怀疑模型或答案；评估器输出契约越简单越好（只输出数字+正则兜底），JSON+长 reason 在高频调用下不稳定
（已蒸馏 2026-08-23 → 01-Inbox 草稿区）

## C0023 · 最终回归要分层执行

- 场景/触发词：R5 / 全量回归 / GUI E2E / smoke / 门禁 / 在线应用
- 做了什么：C1 回归分四层：进程内 smoke（9 个，全部沙箱可跑，client-load 需沙箱外因 pnpm 链接）→ 离线门禁（50 题 recall=1.0）→ 真实运行门禁（groundedness/completeness）→ 轻量 GUI 回归（知识库页自建自清理）；重型对话/编排 E2E（p26/p27/trace-e2e）会在线发消息、跑多代理编排、消耗 LLM，留给用户实测时顺带验证
- 结果：C1-C3 完成，验收 8 条 7/8 收口；第 7 条（自生长）必须靠观察期真实使用数据，无法自动化代答
- 评价：对"正在使用中的桌面应用"做回归要分层：能离线/门禁/轻量页面验证的先跑，会污染会话状态或烧 LLM 的重型 E2E 留给用户实测；自生长类验收项没有捷径，只能等真实使用数据

## C0024 · "零结果"判定在融合检索下几乎不触发

- 场景/触发词：未命中 / 候选池 / 自生长 / lexicalCoverage / 覆盖不足 / 融合检索
- 做了什么：用户实测"聊天未命中没进候选池"；排查发现 knowledge_search 工具与 /knowledge/search 路由已有"零结果进候选池"逻辑，但多路召回+RRF 融合几乎总是返回 top5（乱码查询也有 5 条 gray、lexicalCoverage=0），"零结果"实际不可达，自生长闭环失效；修复为：未命中 = 零结果 OR 覆盖不足(insufficient) OR（gray 且词面零覆盖），并让候选去重忽略空白差异
- 结果：真实应用验证乱码查询自动进候选池（1→2），验证后清理；smoke-knowledge-auto 增加零结果断言
- 评价：判断"是否命中"不能只看返回条数——融合检索永远给 top-N；要看覆盖信号（level、lexicalCoverage、maxConfidence）。测"未命中"场景时，乱码/完全无关词比"库里没有的常见词"更容易复现，因为常见词往往有词面重叠

## C0025 · 编排任务状态同步与"改真实数据要拿准 id"

- 场景/触发词：编排任务 / 状态被覆盖 / locked 失效 / 任务中心 / 验证时误删
- 做了什么：修复 syncOrchestrationTask 无条件覆盖任务状态的问题：任务 locked 时保留手动状态（活动阶段自动解锁跟随编排），客户端在编排任务卡/详情/聚焦面板改状态时自动加锁；smoke-orchestration 加锁定回归断言
- 结果：3 条失败编排任务置 completed+locked 后经全量同步保持；但同时踩了一个验证事故——用 tasks/mutate 的返回 `orchestrations[0]` 当"新建的编排 id"去清理，而该接口返回的是**整个列表**，`[0]` 是旧记录，结果误删了已有 accepted 编排 174c2a92（简历生成器 HTML→PDF），tasks.json 无备份不可恢复
- 评价：① 在真实应用上做"建了再删"的验证前，必须从响应里精确取出本次创建的记录 id（按 title/idea 匹配或取最后一条），不能想当然用 `[0]`；② 对用户数据做任何写操作前先看接口返回契约；③ 任务状态类 bug 排查先看"谁在覆盖它"——syncOrchestrationTask 这类派生同步要尊重用户显式操作（locked），并给 UI 的"防止被覆盖"承诺落实实际语义

## C0026 · 编排必须绑定来源会话，执行时用当前会话兜底

- 场景/触发词：编排 / source session required / 无会话 / 执行失败 / 兜底
- 做了什么：orchestration_start 在编排无 sourceSessionId 时接受请求体里的当前会话并回填记录；客户端三个启动入口（旧编排视图/协作面板/自动续跑）在编排缺会话时自动传 store.sessionId；smoke 增加"无会话编排：规划→无会话启动报错→带会话启动成功"回归
- 结果：修复后用户可重新点执行；原编排 phase=planned、方案完好，未丢数据
- 评价：编排创建入口应尽量绑定来源会话（agent 执行需要父会话）；对历史/异常创建的无会话编排，执行时用"当前激活会话"兜底并持久化，比直接报错更符合用户预期

## C0027 · 编排失败排查要翻会话事件，别只看任务状态

- 场景/触发词：编排失败 / 主代理结束原因 error / 上游 502 / 会话 zstd
- 做了什么：用户编排执行一半失败，任务存储只显示"主代理结束原因：error"；解压主代理会话（session.jsonl.zstd，bsdtar 不认裸 zstd 流，用 pip 装 zstandard 解压）看最后事件：assistant/chunk finish 报 `502 {"message":"Upstream request failed","type":"upstream_error"}`，llm/retry 重试 5 次后 turn/end error → stopReason=error；修复：orchestrationFailureDetail 增加 failure/reason 提取，主代理失败路径透传完整详情
- 结果：根因 = gpt-5.5（ai-gateway）上游服务临时 502，非工作台 bug；两个子代理均成功；重试/换模型即可；界面后续会显示真实错误
- 评价：① 编排失败先分层：子代理状态 → 主代理 error → 会话事件尾部（turn/end reason）才是最终真相；② 任务存储的 error 字段要保留底层 failure message，不能只存 stopReason；③ Windows 下解 zstd：`pip install zstandard`（阿里云镜像可用），bsdtar 解不了裸 zstd 流

## C0028 · 规划要挂在"官方能力 × 已有入口"的交点上

- 场景/触发词：官方更新 / 子代理并行 / 单多AI切换 / 重新规划 / 多代理 UX
- 做了什么：用户提醒"DeepSeek Harness 官方更新提到子代理并行"，且工作台早已有"单 AI / 多 AI 切换"；核实官方 RC.7/RC.8（Codex/Claude Code 子代理 Profile Bundle、Codex 多命名实例并行、reportDelivery 完成即唤醒父任务、web_search 并发、@ 历史会话引用、/goal /plan 图文输入），对照工作台现状（ChatModeSwitch、MultiAiConversationShell、WorkbenchOrchestration、host 单一 spawn provider + maxParallel≤4），把两者合成阶段 E-H 重规划：E 会话内并行（并行气泡+写操作确认+面板降级为抽屉）、F 并行引擎升级（多 provider/reportDelivery/Job Panel/web_search 并发/多模态）、G 自动并行（只读自动、写操作建议卡、数据驱动调优）、H 回归收尾
- 结果：计划文档与日志已更新（C0028）；无代码改动；三个默认值待用户拍板（写操作默认确认、只读自动并行默认开、是否现在装 Codex/Claude Code bundle）
- 评价：工作台自己造过一遍的"多代理编排"正在被官方收编成原生能力——规划时先盘点"官方已有什么、我们已有什么、差在哪"，再决定"哪些自建逻辑可以退给官方（provider/reportDelivery/Job Panel）"，避免重复造轮子；官方"多实例并行"恰好补上我们"单 provider + maxParallel≤4"的天花板，两者不是替代而是叠加

## C0029 · 版本线、子代理分类与"装过的东西"都要先核实再规划

- 场景/触发词：rc.2 vs rc.8 / 版本号困惑 / Claude Code 与 Claude CLI / 产品子代理 vs in-process 子代理 / 是否删页面
- 做了什么：用户四点疑问逐一核实——① Claude Code 就是 Claude CLI（命令行工具，命令 `claude`），与 Claude Desktop（桌面聊天 App）是两个东西；本机已装 `@anthropic-ai/claude-code` 2.1.238（npm 全局 shim + `~/.claude`），且 settings.json 把 ANTHROPIC_BASE_URL 指向 https://api.deepseek.com/anthropic、模型 deepseek-v4-pro/flash，即"Claude Code 外壳 + DeepSeek 模型"；② 应用内嵌核心全部为 @deepseek-ai/dsh 0.1.1-rc.2（npm latest/next 线，2026-08-23 更新），GitHub 标签 v0.1.0-rc.8（2026-08-19）是另一条编号线，核心不落后；全局 dsh CLI 反而还是 0.1.0-rc.6（旧）；③ 现有 AI 编排子代理 = harness 同进程 spawn（同一软件、可分配不同模型、状态/日志/重试完整、可审计），Codex/Claude Code 子代理 = 独立产品进程（不同软件、各自模型路由与工具链、只回最终文本）；网页版"子代理正在运行"就是 harness 原生同进程子代理 UI，与工作台编排同类；④ 据此修订计划：E4 保留 AI 协作整页 + 新增对话流详情抽屉（实验可回退），F1 双轨 provider（A 默认 in-process、B 产品 bundle 按需）
- 结果：C0029 已入库；计划文档更新"版本基线/Claude Code 已装/E4/F1"四处
- 评价：① 判断"是否最新"先分清 GitHub release tag 与 npm 包版本线，且 CLI 与内嵌核心版本可能不一致，别用旧 CLI 改新 profile；② "子代理"至少要分 in-process（同软件多实例/多模型，可见性好）与 product（不同软件，黑盒只回最终文本）两类，能力边界完全不同；③ 用户"装过什么"要以本机证据（npm 全局、~/.claude、配置指向）为准，PATH 里找不到不等于没装

## C0030 · 多 Agent 协作设计：先调研行业范式，再定"双轨"与展示形态

- 场景/触发词：多agent协作 / 子代理 / 方案调研 / 行业参照 / 双轨 / 单多AI切换 / dsh CLI 升级
- 做了什么：先上网调研 14+ 来源（Anthropic 多代理研究系统与工作流模式、OpenAI Codex/ChatGPT Subagents、Claude Code Agents/Task、Devin Manage Devins、Cursor 2.0、Google Jules、Magentic-One、CrewAI、Manus、GitHub Copilot Agents Panel、LangChain Subagents、LukeW 界面研究、Cognition"别做多代理"反方、DeepSeek Harness RC.8），按实现模式（编排者-工作者/任务账本/同步异步/依赖拓扑/上下文隔离/工件落盘/隔离执行/产品子代理/规模规则）、使用模式（主线程指挥中心/方案先行/中途干预/结果工件化）、展示模式（渐进披露/侧栏/计划勾选/集中面板/卡片）三维归纳；对照工作台现状（AI 协作整页、单/多 AI 切换、in-process 编排），产出 7 条设计原则并细化为阶段 E-H + UX 展示规格；同时把全局 dsh CLI 从 0.1.0-rc.6 升到 0.1.1-rc.2（与内嵌核心对齐）
- 结果：方案文档 docs/多Agent协作改造方案-2026-08-24.md 已落盘，5 个决策点待用户审核（写操作确认=开、只读自动并行=开、轨道 B 先不装、详情抽屉实验、并行上限默认 3）；CLI 版本核实通过
- 评价：① 多代理展示的行业共识 = "主线程对话 + 子代理折叠卡片 + 完成汇总"，过程默认不刷屏，这是调和"过程刷屏派/可监控派"之争的关键；② 成本上多代理约 15 倍聊天 token，必须"按需路由"而非默认开启，G3 智能分流与 E5 成本护栏是方案的兜底；③ 双轨（in-process 可审计 vs 产品黑盒）不是重复建设：前者服务过程可见/可干预/可审计，后者服务借力成熟产品能力，能力边界不同，用户明确要求两者都保留；④ 沙箱内"命令找不到"可能只是 PATH 不含 npm 全局目录，先查 npm prefix/node_modules 再下结论

## C0031 · 会话内多代理落地：原生直发 + 折叠卡片 + 计划级写门

- 场景/触发词：多AI 快速问答 / 直发主代理 / 并行卡片 / 写操作确认 / 审批浮层 / 详情抽屉 / 成本护栏
- 做了什么：按确认后的方案实施 E1-E5：① E1 用 SessionRuntime 的 `session.prompt([{type:'text',text}], 'queue')` 直发原生会话（从 dsh-client-runtime 源码确认方法签名），自动低复杂度问题零编排记录；② E2 在对话流（portal 到原生会话滚动区）每行编排记录下方渲染并行状态卡：默认一行摘要、展开显示子代理列表，终态自动折叠；③ E3 采用"计划级写门"：host 端 cleanOrchestrationAgent 默认 readOnly=true、workerPrompt 注入只读约束、orchestration_start 支持 readOnlyOverride，客户端在自动启动前拦截含写子代理的方案出确认卡；另实现审批浮层（轮询各会话 getSnapshot().pending 中 kind=approval 的 PendingWait，用 respond({ok:true,value:{sessionId,approvalId,outcome:'allowed-once'|'rejected'}})，从 dsh-host-apiproxy 的 approvalResponsePayloadSchema 确认响应契约）；④ E4 新增 OrchestrationDrawer 抽屉（方案/代理/日志/记忆/决策五 Tab）；⑤ E5 复用已有 maxParallel=3 默认与 cancel/resume，卡片增加预计 LLM 调用与 token 量级
- 结果：全部 smoke（client-load/orchestration/collab/workflow/style）+ node --check + eslint 通过；已部署到安装目录且 SHA-256 一致；待应用重启实测
- 评价：① 关键 API 契约（prompt 签名、approval 响应 schema、PendingWait.respond 是实例方法不可展开拷贝）都从应用内嵌核心源码核实，避免"猜接口"；② 写操作确认在"计划级"落地比逐次工具调用拦截更稳（子代理审批帧对 in-process 子代理的可见性存疑，审批浮层做成最佳努力，官方审批 UI 兜底）；③ 折叠卡片默认态 + 终态自动折叠是控制"过程刷屏"的关键实现点；④ 单文件 client.js（518KB）改动必须紧跟 node --check + eslint + client-load 冒烟三连，任何一步不过都要回退

## C0032 · 前端依赖"数据契约"的开关，必须把契约写进生成提示词

- 场景/触发词：写操作确认卡 / readOnly / 方案生成 / 提示词契约 / E3 无法触发
- 做了什么：排查"写门永不出现"时发现，host 端 cleanOrchestrationAgent 已支持 readOnly（默认 true），但方案生成提示词既没在规则里声明、也没在 workers JSON 模板里给出该字段，LLM 永远输出 readOnly=false；修复 = 编排器系统提示补 readOnly 规则 + workers 模板补 readOnly: true 示例，并重新部署
- 结果：写门现在可被含"写入文件/实现代码"工作包的方案触发；node --check + smoke-orchestration 通过
- 评价：凡是 UI 行为依赖"模型输出的数据字段"，必须同时把该字段写进提示词规则和 JSON 模板并给默认值示例，否则实现得再完整也到不了用户面前；E 阶段验收问题列表应包含"每个新开关/卡片都能被真实输入触发"的检查项

## C0033 · 对话区浮窗治理：主信息进侧栏页签，对话区只留"入口胶囊"

- 场景/触发词：子代理运行情况 / 浮窗挡视野 / 右侧工具栏 / 协作页签 / 状态胶囊
- 做了什么：把对话区底部的"子代理运行情况"浮窗（折叠/展开都挡视野）整体移入右侧工具栏新增的"协作"页签（ToolbarCollab：进度条 + 子代理列表 + 停止/继续/详情抽屉/任务中心操作，忙碌时 1.5s 轮询）；对话区只在任务忙碌且工具栏关闭时显示一个右上角小胶囊（点击打开详情抽屉）；用 wb:open-chat-drawer 自定义事件做工具栏→抽屉桥接，AgentWorkspace 把 detailsOpen 下传以便胶囊自动隐藏
- 结果：对话区不再有常驻浮窗；实时状态在工具栏常驻可看；工具栏关闭时仍有小胶囊入口；smoke 全过并已部署
- 评价：① "高频实时信息进侧栏、对话区只留入口"比"浮窗折叠开关"更符合用户对视野的诉求；② 跨组件联动优先用 window CustomEvent 桥接（open-chat-drawer），避免把 store 层层下传；③ 工具栏组件（WbToolbar）自己拉一份 useWorkbenchTasks 数据即可，任务事件推送保证变更即刷新，忙碌轮询只做兜底

## C0034 · 模型分配三档 + 失败自愈：把"用户想干预的点"都变成可见控件

- 场景/触发词：手动选主代理 / 全手动模型 / 子代理失败卡住 / 换模型重试 / 单子代理重试 / 停止整个流程
- 做了什么：① 模型策略从"全自动/全手动"扩成三档（balanced/quality/economy 自动、main-manual 主代理手动子代理自动、manual 全手动），host validateAgentModel 按 isMain 分支，客户端对话流加"模型:全自动/主手动/全手动"循环按钮 + 协作页下拉补"主代理手动"档；② 失败自愈：runOrchestrationWorker 重写为失败优先从模型目录挑健康候选自动换模型重跑（优先同 provider、避开 7 天内失败≥2 的模型、最多 2 次），再加 orchestration_worker_retry 支持对单个失败子代理重试（保留已完成子代理、重跑失败者+主代理）；③ 子代理超时 15 分钟→10 分钟，卡片操作行常驻（停止/继续执行），失败子代理在卡片/工具栏/抽屉三处可单独重试
- 结果：新增 smoke-worker-failover（首次失败→自动切 test-model→成功，断言 modelReason 与日志）与 smoke-orchestration 的单子代理重试用例，全绿并已部署
- 评价：① "用户想干预的点"要同时满足"可发现（控件常驻/循环按钮）+ 可解释（modelReason/日志写明切换原因）+ 可恢复（单子代理重试不推倒重来）"三要素；② 失败自愈顺序应为"换模型 > 同模型重试"，且换模型前必须先记录失败（recordModelFailure），否则下次规划还会选同一个坏模型；③ 长任务"卡住感"多半来自超时过长与重试不可见，把超时调短 + 执行日志带模型名 + 卡片显示重试中，比单纯加按钮更治本

## C0035 · 浮层宁可删，不跟原生 UI 抢位置

- 场景/触发词：状态胶囊 / 用量详情重叠 / 浮层冗余 / 对话区无浮层
- 做了什么：C0033 为"工具栏关闭时也能看进度"加了右上角小胶囊，实测发现它与原生"用量详情"按钮重叠、对话栏下方还有原生可展开模块；既然对话流并行卡片和工具栏"协作"页签已完整承担实时状态，直接删除胶囊（CSS/渲染/detailsOpen prop 全清）
- 结果：对话区零浮层，无重叠；smoke 通过并已部署
- 评价：① 给原生界面加浮层前先确认原生右上角/底栏是否已有控件，位置冲突时优先砍自己的浮层而不是挪原生；② 一个功能入口只要存在两个以上等价入口就容易制造重叠与困惑，删除前确认"主入口"确实覆盖全部场景（并行卡片=看进度、工具栏=盯状态、抽屉=查细节）
