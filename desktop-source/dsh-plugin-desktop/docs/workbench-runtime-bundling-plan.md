# 朋友安装包：内置运行时技术方案（2026-08-20）

> 目标：朋友拿到 DeepSeek Harness Desktop + 工作台安装包即可用，
> 不要求预装 Node.js / Python。

## 1. 依赖盘点

- 工作台功能除 BGE 向量外全部为 Node 内实现，运行在桌面端内置 Electron/Node 进程中，
  **无需任何外部运行时**。
- 唯一外部依赖：知识库本地 BGE 向量（`tools/knowledge_embed.py`），需要系统 Python +
  `onnxruntime / tokenizers / numpy / huggingface_hub`；缺失时向量路自动降级
  （BM25 + 图谱 + 可选 LLM 重排仍可用），但向量 recall 与速度会受影响。
- 桌面端已内置 Node/pnpm 运行时（`app.asar.unpacked/lib/pnpm.js` 等），
  但这是宿主进程内部能力，不对工作台提供独立 python 运行时。

## 2. 方案选项

| 方案 | 做法 | 体积 | 风险 | 结论 |
|---|---|---|---|---|
| A | 打包嵌入式 Python + onnxruntime wheel，Host 用内置 python 调 `knowledge_embed.py` | +40–80 MB | 双运行时、维护两份、启动慢 | 不推荐 |
| B | 用 `onnxruntime-node` 重写嵌入桥为 JS，复用 `.onnx + tokenizer.json` 模型；模型随包内置或首次下载 | +40–60 MB（native 包） | 需要验证 tokenizer 对齐（BPE 同源） | **推荐（长期）** |
| C | 不内置：无 Python 时自动降级 + 设置页清晰提示（可选安装 Python 增强） | 0 | 无 | **过渡（最快交付）** |

## 3. 推荐路径

1. **过渡（C）**：向量配置检测 Python/onnxruntime 失败时返回明确错误与安装指引，
   界面标注“向量路未就绪，当前使用 BM25+图谱”，不产生困惑；此步改动小、随下次发布即可。
2. **长期（B）**：新增 `tools/knowledge_embed.mjs`（onnxruntime-node）：
   - 读同一模型目录（`~/.cache/knowledge-bge/bge-small-zh-v1.5`，含 onnx + tokenizer.json）；
   - tokenizer 用 `@xenova/transformers`（已评估可加载该模型）或 onnxruntime 的
     `tokenizers-js` 对齐；与 Python 版做 10 条向量余弦一致性回归；
   - Host 向量路配置增加 `provider: 'bge-node'`，优先 Node 桥，Python 桥保留为备选；
   - 朋友版把模型（约 100MB）放入安装包资源目录，首次启动复制到缓存（或按需下载）。
3. 打包：`dist:win` 的 asar 内容新增 Node 桥与模型资源；发布 SOP 的“朋友安装包大更新”
   使用此版本产物。

## 4. 验收标准

- 全新朋友机器（无 Node/Python）安装后：六页、多 AI、任务中心、项目配置全部可用；
  知识库检索（BM25+图谱）可用；向量路在 B 完成后可用并 recall 与 Python 版一致。
- BGE 一致性：Node 桥与 Python 桥对同一批文本余弦相似度 ≥ 0.999。
- 安装包体积增量在可接受范围；自动更新与覆盖安装不受影响。

## 5. 实施顺序

1. C（降级提示）→ 2. B（Node 桥 + 一致性回归）→ 3. 打包与朋友机器实测。
   当前先做 1；2/3 在下次要出“朋友安装包”时集中实施。
