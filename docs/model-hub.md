# 模型中心设计

把 Cortico 的「模型供应商」页改成统一的模型中心：**按模型类型分页签，每个供应商下配多个模型，每个模型单独配置，所有模型对插件公开**。界面参考 AstrBot 的供应商页。

相关文档：[整体架构](architecture.md) · [记忆设计](memory.md)

## 1. 原则

- **只改管理代码，不改 agent 运行**。Core 只从配置里读两样东西：端点表 `config.providers`（名字 → `LLMProviderEntry`）和当前端点 `activeProvider`，然后调用 `providers.bind(name)`。我们在加载配置时把新的存储格式**展开成同样的端点表**，`core/core.ts`、`core/loop.ts`、session、前缀和 WakeBus 都不用改。
- **一份配置，所有地方共用**：主对话、做梦、表情包、知识库、语音都从这里选模型，插件不再各自填地址和 key。
- **旧数据不用手动迁移**：旧格式的端点目录照样能读，第一次在新界面保存时再转成新格式。

## 2. 概念

| 概念 | 是什么 | 例子 |
|---|---|---|
| **供应商（source）** | 一个地址 + 一把 key + 协议模块 | `deepseek`：`https://api.deepseek.com/v1`；`chatgpt`：ChatGPT 登录；`local`：本机 llama-server |
| **模型（model）** | 供应商下的一个模型，带**类型**和自己的参数 | `deepseek/deepseek-flash`（对话）、`local/bge-m3`（嵌入） |
| **模型引用（ref）** | `<供应商>/<模型 id>`，全局唯一 | 部署和插件的配置里存的都是它 |

模型类型：

生图使用 `image` 类型，与对话模型分开显示。插件通过 `ctx.models.generateImage(ref, prompt, { signal, timeoutSeconds })` 获取图片字节；配置选项使用 `x-options: models:image`。供应商可实现 `ProviderInstance.generateImage`（例如 Codex OAuth），其余支持生图的协议走 `/images/generations`。接口不自动发送图片，也不把图片模型设为主对话模型。

`cortico-provider-codex` 提供独立浏览器 OAuth 登录：保存供应商后点「登录 Codex」，在运行 bot 的电脑上完成授权，回调端口为 1455。原 ChatGPT 供应商保留。`cortico-world-images` 从模型中心选择生图模型，提供 `images_generate`；返回的图片句柄交给当前渠道发送工具。生图支持情况以实际账号请求为准。

| 类型 | 用途 | 调用方式 |
|---|---|---|
| `chat` 对话 | 主对话、做梦、给图片写描述（选支持图片输入的） | 现有协议模块的 `respond()`，和主对话走同一条路 |
| `embedding` 嵌入 | 表情包检索、知识库 | OpenAI 兼容的 `/embeddings` |
| `rerank` 重排序 | 知识库检索结果重排 | `/rerank`（Jina / Cohere 风格，llama-server 也支持） |
| `stt` 语音转文字 | QQ 语音识别 | OpenAI 兼容的 `/audio/transcriptions` |
| `tts` 文字转语音 | 以后的语音回复 | OpenAI 兼容的 `/audio/speech` |

协议模块声明自己支持哪些类型：`openai-responses-compat` 支持全部（按 OpenAI 兼容的路径调用），`chatgpt` 只支持对话，`llamacpp` 支持对话、嵌入和重排序。

## 3. 存储

仍然放在部署根的 `providers/` 下，所有部署共用：

```
providers/
├── deepseek/
│   ├── config.json      供应商配置 + 它下面的全部模型
│   └── .env             这个供应商的 key（只有一份，所有模型共用）
├── chatgpt/
│   ├── config.json
│   └── chatgpt-auth/    登录状态（模块自己管）
└── local/
    └── config.json
```

`config.json`：

```json
{
  "kind": "openai-responses-compat",
  "baseUrl": "https://api.deepseek.com/v1",
  "secret": "CORTICO_KEY_DEEPSEEK",
  "options": { "reasoningReplay": "plaintext" },
  "models": {
    "deepseek-flash": {
      "type": "chat", "enabled": true, "multimodal": true,
      "spec": { "model": "deepseek-flash", "thinking": true, "reasoningEffort": "low",
                "temperature": 0.65, "maxTokens": 8192, "contextWindow": 1000000 },
      "pricing": []
    },
    "deepseek-pro": { "type": "chat", "enabled": true, "spec": { "model": "deepseek-pro" } }
  }
}
```

- 没有 `models` 字段的就是**旧格式**：整个目录当作一个供应商加一个对话模型，模型 id 取 `spec.model`。
- 部署的 `config.json` 里，`activeProvider` 改存模型引用，比如 `"deepseek/deepseek-flash"`。旧值（目录名，比如 `"test"`）照样能用，解析为这个目录下唯一的那个对话模型。

## 4. 和 Core 的衔接（不改 agent 运行）

| 文件 | 改动 |
|---|---|
| `deploy.ts` 的 `globalProviders()` | 读新格式时，把每个**启用的对话模型**展开成一条 `LLMProviderEntry`，名字是模型引用 `deepseek/deepseek-flash`：供应商的 `kind`、`baseUrl`、`secret`、`options` 加上模型的 `spec`、`pricing`、`multimodal`。旧格式原样读入 |
| `providers/registry.ts` | 端点名带 `/` 时，状态目录和 `.env` 取**供应商目录** `providers/deepseek/`，不再用 `providers/<名字>/`。同一个供应商的多个模型共用 key 和登录状态 |
| `providers/name.ts` | 校验规则分成供应商名和模型 id 两段，引用里允许一个 `/` |
| `launcher.ts` | 启动提示里的「主模型」改为显示模型引用 |

`core/core.ts` 照常按 `activeProvider` 取端点、读 `spec`、调 `bind()`，看到的数据结构和现在一模一样。用量日志里的 `origin.instance` 会变成模型引用，正好能看出用的是哪个模型。

## 5. 给插件的接口

### 5.1 选模型：配置项下拉框

Cortico 现有的 `x-options` 机制可以直接用。插件的配置项写：

```ts
'worlds.memes.memes.embeddingModel': { type: 'string', title: '嵌入模型', 'x-options': 'models:embedding' }
'worlds.memes.memes.captionModel':   { type: 'string', title: '图片描述模型', 'x-options': 'models:chat:image' }
```

框架为 `models:<类型>[:image]` 提供选项：列出这个类型下所有启用的模型；加 `:image` 只列出支持图片输入的。配置里存的是模型引用。

### 5.2 调模型：`ctx.models`

`WorldContext` 新增一个字段 `models`，bot 包的 Persona 通过 `onStart` 里的 core 也能拿到：

```ts
interface ModelHub {
  list(type?: ModelType): ModelInfo[];
  chat(ref: string, request: Request, overrides?: Partial<ModelSpec>): Promise<Generation>;
  embed(ref: string, texts: string[]): Promise<number[][]>;
  rerank(ref: string, query: string, documents: string[]): Promise<Array<{ index: number; score: number }>>;
  transcribe(ref: string, audio: { bytes: Uint8Array; mime: string }): Promise<string>;
  speak(ref: string, text: string, voice?: string): Promise<{ bytes: Uint8Array; mime: string }>;
}
```

- `chat()` 走和主对话同一个协议模块，ChatGPT 登录、计价、用量记录都照常生效。用量记录标明来源插件。
- **插件按需改参数**：模型的参数是全局默认值，插件调用时可以传 `overrides` 临时改，比如给图片写描述时关掉推理、把输出上限设成 1024，不影响主对话和其他插件。插件也可以把自己的覆盖值放进自己的配置项。
- key 只在模型中心里读取，插件拿不到。

## 6. 界面

```
┌ 对话 │ 语音转文字 │ 文字转语音 │ 嵌入 │ 重排序 ┐   ← 按类型分页签
├──────────────┬──────────────────────────────────┤
│ 供应商  + 新增 │ deepseek                  [保存] │
│ ▸ deepseek    │ https://api.deepseek.com/v1      │
│   chatgpt     │ 协议 / 地址 / key / 高级选项      │
│   local       ├──────────────────────────────────┤
│               │ 模型  [搜索] [获取模型列表] [自定义] │
│               │ 已配置的模型 3                    │
│               │  deepseek/deepseek-flash          │
│               │  [图片][工具][1M]   ⏻ 测试 ⚙ 删除 │
│               │ 可用模型（从列表获取）            │
└──────────────┴──────────────────────────────────┘
```

- **页签按类型过滤模型**；左边列出全部供应商，但不支持当前类型的显示为灰色。
- **供应商详情**：协议模块、地址、key。有 key 的供应商打开时自动获取一次模型列表。
- **模型列表**：开关、测试、设置（⚙）、删除；用小标签显示能力（图片、音频、工具、上下文长度）。
- **⚙ 单个模型的设置**：弹窗，只列推理强度（按模块与主机的档位）、温度、最大输出、上下文上限、图片输入、计价、模块选项；地址、key 和测试不重复显示。
- **账号登录的供应商**（ChatGPT）：新建时不填地址和 key，保存后在供应商页登录，再从账号的模型列表添加模型；它下面的模型共用这一份登录。
- **当前对话模型**：对话页签顶部显示「当前部署使用：deepseek/deepseek-flash」，可以从下拉框切换，写入部署的 `activeProvider`。
- **哪些地方在用**：每个模型显示被哪些部署、哪些插件引用；被引用的模型不能删除。

原来改旧编辑页的两个补丁（选模型、推理档位）已并进界面补丁 `0004-model-hub-ui.patch`。

## 7. 要改的 Cortico 文件

| 范围 | 文件 | 性质 |
|---|---|---|
| 存储与加载 | `deploy.ts`、`providers/registry.ts`、`providers/name.ts`、`core/types.ts`（新增类型，不改已有类型） | 管理代码 |
| 模型中心接口 | 新文件 `providers/models.ts`；`world.ts` 的 `WorldContext` 加 `models`；`x-options` 的 `models:*` 选项 | 扩展接口 |
| 设置页服务端 | `providers/webui/hub.ts`、`providers/webui/settings.ts` | 管理代码 |
| 设置页前端 | `web/client/features/providers/*`，11 种语言 | 管理代码 |
| 协议模块 | 各模块声明支持的类型；`openai-responses-compat` 加嵌入、重排序、语音的调用 | 管理代码 |
| **不改** | `core/core.ts`、`core/loop.ts`、`core/session.ts`、`core/prefix.ts`、`core/bus.ts`、World 运行逻辑 | agent 运行 |

尽量把新逻辑放在新文件里，对已有文件只做小的接入改动，这样升级 Cortico 锁定版本时冲突少。

## 8. 分步实施

| 步骤 | 内容 | 完成标准 |
|---|---|---|
| 1 存储与加载 | 新格式读写、旧格式兼容、展开成端点表、registry 按供应商取 key | 旧部署不改配置照常启动；新格式下主对话正常，缓存命中不变 |
| 2 接口 | `ModelHub`、`WorldContext.models`、`x-options: models:*` | 测试里一个假 World 能列出、调用嵌入和对话模型 |
| 3 界面 | 新的模型中心页，并入选模型与推理档位补丁 | 在浏览器里按截图的流程配好 DeepSeek 和本地 bge-m3 |
| 4 插件改用 | memes 去掉自己的地址、key 配置，改选模型引用；删掉 `CORTICO_MEME_*` 密钥 | 表情包检索和图片描述都走模型中心 |

第 1–3 步分别是 `patches/cortico/0002-provider-sources.patch`、`0003-model-hub.patch`、`0004-model-hub-ui.patch`，各带测试；第 1–3 步已完成，第 4 步未做。

## 9. 待确认

1. **ChatGPT 供应商**是我们自己的扩展（`cortico-provider-chatgpt`），也要按新格式声明「只支持对话」，并改成一个供应商下挂多个模型。
2. **做梦用不同模型**：Cortico 目前所有 session 共用 `activeProvider`。让做梦单独选一个更便宜的模型需要改 Core 选端点的逻辑，不在这次范围内，以后单独评估。
3. **上游**：这套改动比较大，上游未必接受。先作为我们自己的补丁维护，跑稳了再决定要不要提 PR。
