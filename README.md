# dsh-jev-adapter

[English](#english) | [中文](#中文)

---

<a id="english"></a>

Use the **Jev (System One) decision-model paradigm with any OpenAI-compatible LLM** — no TypeSafe API key required. Registers a `jev_decide` tool on [DeepSeek Harness (dsh)](https://github.com/deepseek-ai/deepseek-harness).

Jev ([TypeSafe AI](https://typesafe.ai)) is a decision model: you send a state plus typed questions (choice / score / boolean), it returns calibrated, probability-distributed answers — no text generation. This plugin brings that **paradigm** to any chat model you already have, and can also talk to the real Jev API if you have a key.

## Why

- `zhangxaochen/dsh-jev` (worth checking out) integrates the **official** TypeSafe API — great if you have a key and can reach `api.typesafe.ai`.
- This plugin covers everyone else: **any OpenAI-compatible endpoint works** — DeepSeek's own API, Ollama, vLLM, OpenRouter, SiliconFlow, LM Studio, or an air-gapped internal gateway.
- Probabilities on the `openai` channel are the model's self-reported estimates (not mathematically calibrated — every result carries this caveat). On the `typesafe` channel you get the real thing.

## What you get

One tool, `jev_decide`, callable by the agent:

| Question type | You provide | You get back |
|---|---|---|
| `choice` | options map (≤255) | picked option + full probability distribution + confidence |
| `score` | ordered levels (2–10) | fractional score + per-level probabilities + confidence |
| `boolean` | a statement | P(true) |

Ask many questions in one call — 1 and 10 questions cost about the same.

## Install

```bash
dsh plugin --profile <profile> add github:BetterZflyee/dsh-jev-adapter
# or, once published on npm:
dsh plugin --profile <profile> add dsh-jev-adapter
```

Then set one environment variable and restart dsh:

```bash
# openai channel (default) — point at any OpenAI-compatible endpoint
export JEV_OPENAI_API_KEY="sk-..."
# optional overrides:
# export JEV_BASE_URL="https://api.deepseek.com/v1"   # or Ollama/vLLM/OpenRouter/...
# export JEV_MODEL="deepseek-chat"
```

Or configure in `cordis.patch.yml` instead of env vars (see below).

## Configure

All settings live in the plugin row in `cordis.patch.yml`:

```yaml
- id: dsh-jev-adapter
  name: dsh-jev-adapter
  config:
    channel: openai          # "openai" (default) | "typesafe"
    # ---- openai channel ----
    # baseURL: https://api.deepseek.com/v1     # any OpenAI-compatible endpoint
    # apiKey: sk-...                            # or env JEV_OPENAI_API_KEY / OPENAI_API_KEY
    # model: deepseek-chat
    # ---- typesafe channel (real Jev) ----
    # channel: typesafe
    # apiKey: ...                              # or env JEV_TYPESAFE_API_KEY / TYPESAFE_API_KEY
    # model: jev-latest
    # ---- shared ----
    # maxTokens: 4000
    # timeoutMs: 120000
    # retries: 3
```

## Use

Just talk to your agent — it decides when to call the tool:

```
Classify these 12 support tickets: department + urgency + customer frustration.
```

The agent sends all judgements as typed questions in one `jev_decide` call and gets back a table of probabilities.

**Routing on confidence** (the whole point of the paradigm):

```
confidence ≥ 0.85  → act automatically
0.5 – 0.85         → draft, ask a human to confirm
< 0.5              → escalate to a human
```

Tune thresholds to the risk of the action, and remember the caveat: on the `openai` channel these are self-reported probabilities, not calibrated ones.

## Details worth knowing

- **Honesty prompt.** The adapter explicitly instructs the model to spread probability when uncertain instead of forcing a fake 1.0 — without this, confidence saturates and the routing signal is lost (validated on real Chinese-language work items; see the prompt in `lib/adapter.js`).
- **Thinking models.** Models that leave `content` empty and answer in `reasoning_content` are handled.
- **Normalisation.** Probabilities that don't sum to 1 are renormalised; an all-zero answer degrades to uniform rather than failing.
- **Retries.** 429/5xx retried with exponential backoff (default 3 attempts).

## Relation to other Jev plugins

| | `zhangxaochen/dsh-jev` | this plugin |
|---|---|---|
| Real TypeSafe Jev | ✅ | ✅ (`typesafe` channel) |
| Any OpenAI-compatible LLM | ❌ | ✅ (default) |
| Tool pruning / loop guard / safety gate | ✅ | ❌ (different scope) |

They are complementary: pick his for the guard suite with a real Jev key, this one for the decision paradigm on any model.

## License

MIT

---

<a id="中文"></a>

# dsh-jev-adapter（中文）

把 **Jev（System One）决策模型范式套在任何 OpenAI 兼容的 LLM 上**——不需要 TypeSafe API key。在 [DeepSeek Harness (dsh)](https://github.com/deepseek-ai/deepseek-harness) 上注册一个 `jev_decide` 工具。

Jev（[TypeSafe AI](https://typesafe.ai)）是决策模型：发一段状态加一组类型化问题（choice / score / boolean），返回带概率分布的结构化答案——不生成文字。本插件把这个**范式**带到你已有的任意聊天模型上；如果你有 key，也可以直连真 Jev。

## 为什么做这个

- `zhangxaochen/dsh-jev`（推荐一看）对接的是 **官方** TypeSafe API——有 key 且能访问 `api.typesafe.ai` 时很好。
- 本插件覆盖其他人：**任何 OpenAI 兼容端点都能跑**——DeepSeek 官方 API、Ollama、vLLM、OpenRouter、硅基流动、LM Studio、或内网网关。
- `openai` 通道的概率是模型自述的估计值（非数学校准，每个结果都带此提示）；`typesafe` 通道给你真货。

## 你得到什么

一个工具 `jev_decide`，Agent 可直接调用：

| 问题类型 | 你提供 | 返回 |
|---|---|---|
| `choice` | 选项映射（≤255 项） | 选中的选项 + 完整概率分布 + 置信度 |
| `score` | 有序等级（2–10 级） | 分数 + 各等级概率 + 置信度 |
| `boolean` | 一个陈述 | P(为真) |

一次调用可以并行问多个问题——问 1 个和问 10 个代价几乎一样。

## 安装

```bash
dsh plugin --profile <profile> add github:BetterZflyee/dsh-jev-adapter
# npm 发布后也可以：
dsh plugin --profile <profile> add dsh-jev-adapter
```

设一个环境变量后重启 dsh：

```bash
# openai 通道（默认）—— 指向任意 OpenAI 兼容端点
export JEV_OPENAI_API_KEY="sk-..."
# 可选覆盖：
# export JEV_BASE_URL="https://api.deepseek.com/v1"   # 或 Ollama/vLLM/OpenRouter/...
# export JEV_MODEL="deepseek-chat"
```

也可以在 `cordis.patch.yml` 里配置（见英文节的 Configure）。

## 使用

直接跟 Agent 说话，它自己决定何时调用：

```
把这 12 条工单分类：部门 + 紧急度 + 客户情绪
```

Agent 会把所有判断作为类型化问题放进一次 `jev_decide` 调用，拿到一张概率表。

**按置信度路由**（这套范式的意义所在）：

```
confidence ≥ 0.85  → 自动执行
0.5 – 0.85         → 生成草稿，请人确认
< 0.5              → 转人工
```

阈值按操作风险调；记住提示：`openai` 通道的概率是自述值，不是校准值。

## 值得知道的细节

- **诚实性提示词**。适配器明确要求模型不确定时如实分散概率、不要硬给 1.0——没有这条，置信度会饱和，路由信号失效（在真实中文工作事项上验证过，见 `lib/adapter.js`）。
- **思考模型兼容**。`content` 为空、答案在 `reasoning_content` 的模型已处理。
- **归一化**。概率之和不为 1 时重新归一化；全零答案退化为均匀分布而不是报错。
- **重试**。429/5xx 指数退避重试（默认 3 次）。

## 与其他 Jev 插件的关系

| | `zhangxaochen/dsh-jev` | 本插件 |
|---|---|---|
| 真 TypeSafe Jev | ✅ | ✅（`typesafe` 通道） |
| 任意 OpenAI 兼容 LLM | ❌ | ✅（默认） |
| 工具剪枝 / 死循环阻断 / 安全门禁 | ✅ | ❌（定位不同） |

互补关系：要护栏套件 + 真 Jev 用他的；要在任意模型上用决策范式用本插件。

## 许可证

MIT
