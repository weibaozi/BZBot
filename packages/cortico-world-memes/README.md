# `definition.ts` / `MemesWorld`：表情包管理与向量召回

表情包管理、语义化和设置中心通过一个独立 World 提供。运行模式为「向量召回 · 主模型选图」，QQ 关闭时也可使用。包名为 `cortico-world-memes`，World id 为 `memes`，配置位于 `worlds.memes.memes`，数据位于部署的 `memes/` 目录。工具按下游要求命名为 `search_meme`、`get_meme`。

## 管理

管理页支持创建资源包、改名、选择用于对话的包、分类增删改名与说明、批量移动图片、上传 PNG/JPEG/GIF/WebP、回收站恢复、搜索、分页、大图预览和语义编辑。图片单文件上限 25 MiB；删除只移入回收站。页面保存使用 revision 校验，过期编辑不会覆盖新内容。

图片按分类分区显示为方形缩略图网格，卡片叠加选择框与分类标签；描述和语义标签在预览弹窗编辑。分类区提供本页本类选择和上传入口。布局依据面板宽度调整，窄面板使用两列；嵌入样式与上游整页布局分离。

导入支持 AstrBot 的 `manifest.json`、`memes/<分类>/<图片>` 和 `semantic_metadata.json`，包括外层多一个目录的分享包或备份包。保留分类、描述、标签、配字、来源许可及人工编辑标记，不执行包内程序、不加载 FAISS 索引。导入不会调用模型；重复导入产生独立资源包。

导出保存到选择的服务器目录，包含当前有效图片、最新语义、空分类与许可，不含回收站和向量，导出的 ZIP 可以重新导入。导入导出使用 Python 3 标准库，可在设置中心指定 Python 路径。

## 语义化

- 补全语义描述：用视觉模型处理当前包中没有描述的图片。
- 一键完整语义化：先补描述，再补当前包向量。
- 重试失败项：仅重试保存了错误的图片。
- 重新生成自动描述：重跑当前包的自动描述，保留人工编辑。
- 仅补生成向量：复用内容哈希及模型配置均未变化的向量。
- 重建全部向量：重新计算全部包，成功后原子替换旧索引。

描述逐张保存，任务可停止，重启后可用补全或重试继续。并发人工修改和删除优先于在途模型结果。视觉模型指出分类冲突或不确定时，图片进入待审核状态；人工保存描述可审核，保留分类为 `needs_review` 的图片仍不能检索。GIF 可能仅识别首帧。修改分类、描述或标签后，旧向量立即退出检索，补生成后恢复。

## 设置中心与运行

模式页提供配图开关、每次配图上限 0/1、语义检索、视觉标注和导入程序设置。语义检索包括嵌入模型、查询前缀、候选数、最低相似度；视觉标注包括能看图的对话模型和调用超时。字段来自同一份 ConfigGroup，保存走 Cortico 配置校验与热更新。模型地址、密钥或登录授权统一在模型中心配置。

`ENV_PROMPT.md` 是可编辑的表情使用预设模板：主模型在准备回复时结合当前 session 中的人设、对话与收件人偏好，决定是否配图；配图频率（约每 5 条回复 1 张）写在模板里，由主模型把握，代码不做随机拦截。要配图时调用 `search_meme({keywords: ["安慰对方", "温柔抱抱", "陪伴"]})`，给出 1–8 个短词或短语。工具只进行一次查询 embedding 和向量召回，按候选数与最低相似度返回 id、描述、标签、配字和相似度；不调用辅助模型，不做最终选择。功能关闭或没有候选时返回原因。

候选通过普通工具回执追加到同一个 session，主模型复用已有上下文判断选一张或不选，无需复制聊天历史、人设或启动另一个模型会话。相似度只用于召回，主模型可以选择较低排名的候选。动态候选不进入系统前缀；编辑预设模板后，按 Cortico 的提示词加载流程生效，立即重载前缀会损失一次缓存。

搜索候选带有 `image: "meme:<图片ID>"`。选中后，主模型把该字段与文字一次交给 `qq_send` 或 `console_send`，无需调用 `get_meme`。发送工具通过按部署隔离的通用图片来源接口取图；表情插件校验启用状态、图片是否仍可用，QQ 完成先文字后独立图片，回执和事件附件记录实际结果。禁用或删除的图片在发送前拒绝，文字也不会先发出去。插件停止时注销来源。`get_meme` 保留用于查看图片或尚不支持引用解析的渠道。需要补丁 `0010-world-image-sources.patch`；修改部署覆盖的提示词并重载后生效。

`embeddingModel`、`captionModel` 保存模型中心的模型引用，默认均为空。下拉选项分别由框架的 `x-options: models:embedding`、`models:chat:image` 提供；选项按模型类型和图片能力过滤。插件调用 `ctx.models.embed`、`ctx.models.chat`，模型中心负责协议和凭据。选择失效时报告错误，不静默切回其他模型。

视觉标注通过 `input_image` 传入图片 data URL，单次调用关闭思考、最大输出设为 1024，其余参数沿用所选模型。用量通过 `generationUsage` 转换后交给 World 宿主记账，JSON 解析失败的生成也计入用量。查询向量缓存最多 128 条；查询前缀须与模型服务的预处理约定一致。索引指纹由模型引用和查询前缀决定，任一变化都需要重建。管理页测试和会话工具使用同一召回方法，显示候选与 embedding/search 耗时，不执行主模型选图、不发送消息。

### 本机 BGE-M3

已安装 Ollama 的机器可运行 `ollama pull bge-m3`。在模型中心建立供应商 `local`，地址为 `http://127.0.0.1:11434/v1`，添加类型为「嵌入」的 `bge-m3` 模型；在表情设置中选择引用 `local/bge-m3`，查询前缀留空，再生成向量。BGE-M3 输出 1024 维；原有其他模型的向量需要重建。保持 Ollama 服务运行，查询会复用已加载模型及最多 128 条查询向量缓存。

### 升级到模型中心版 0.6.0

在模型中心建好嵌入模型和能看图的对话模型，在表情包设置里选上，然后执行「重建全部向量」。图片、分类、语义标签与人工编辑保留。旧的端点选择、地址、视觉模型名称及插件密钥配置不再使用；旧索引的指纹与新版不兼容。

### 从 0.3.x 升级

重启扩展以加载新工具声明；`qqextras_choose_meme(reply, context?, persona?)` 替换为 `search_meme(keywords)`。已保存的 `auxiliaryUrl`、`auxiliaryModel`、`contextTurns`、`injectPersona` 及辅助模型密钥不再使用，可自行清理；图片和语义继续复用，向量按 0.6.0 升级说明重建。`timeoutSeconds` 现在只控制视觉标注。若部署已有 `prompts/MEMES.md` 自定义覆盖，将其中的旧选图流程更新为本包 `ENV_PROMPT.md` 的关键词召回流程，保留自定义配图偏好。

### 从 qqextras 改名

停止 bot 后，先运行 `node packages/cortico-world-memes/scripts/migrate-qqextras.mjs <profile目录>` 预览，追加 `--apply` 执行。脚本将 `worlds.qqextras` 改为 `worlds.memes`，把 `qqextras/memes/` 移到 `memes/`，并从旧 `prompts/QQEXTRAS.md` 生成 `prompts/MEMES.md`（更新搜图、取图工具名，保留自定义文案与旧文件）。原配置备份到同一部署的 `config.before-memes.json`；目标配置或图库已存在时拒绝覆盖。迁移使用 Node 24 的 TypeScript 支持；较早的 Node 可通过 tsx 运行。

将扩展依赖从 `cortico-world-qqextras` 替换为 `cortico-world-memes` 并链接新包目录，构建面板后重启。管理页面为 `#/provider/world%3Amemes`。不再注册旧工具别名，重启后系统前缀和工具声明使用新名称；已有会话的历史回执保持原样。

## 验证与来源

`pnpm test` 使用临时目录、真实 ZIP、本机 OneBot 服务和真实事件库，只有 ModelHub 的 LLM/embedding 使用脚本响应。视觉标注用量通过真实 World 宿主写入用量日志。`pnpm run typecheck`、`pnpm run typecheck:web` 检查类型。`pnpm run build:web` 在 bot 停止后构建面板。

界面样式、导入格式和图片标注流程参考 MIT 授权的 [astrbot_plugin_meme_manager](https://github.com/anka-afk/astrbot_plugin_meme_manager)，版本 `88b8a1b`，许可保留在 `webui/upstream/LICENSE`。本扩展不执行 AstrBot 插件，不包含资源广场、自动收集和云同步。图片许可沿用资源包声明。
