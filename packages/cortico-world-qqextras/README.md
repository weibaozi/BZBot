# `definition.ts` / `QqextrasWorld`：表情包管理与辅助选图

表情包管理、语义化和设置中心通过一个独立 World 提供。运行模式为「辅助模型语义搜索」，QQ 关闭时也可使用。为兼容已有部署，保留包名 `cortico-world-qqextras`、World id `qqextras`、`worlds.qqextras.memes` 配置和 `qqextras/memes/` 数据目录。

## 管理

管理页支持创建资源包、改名、选择用于对话的包、分类增删改名与说明、批量移动图片、上传 PNG/JPEG/GIF/WebP、回收站恢复、搜索、分页、大图预览和语义编辑。图片单文件上限 25 MiB；删除只移入回收站。页面保存使用 revision 校验，过期编辑不会覆盖新内容。

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

模式页提供配图开关、概率、每次选图上限 0/1、参考对话轮数、人设摘要开关、辅助模型、视觉模型、embedding、候选数、最低相似度、超时和导入程序设置。字段来自同一份 ConfigGroup，保存走 Cortico 配置校验与热更新。三类密钥分别存入部署 `.env` 的 `CORTICO_MEME_AUXILIARY_KEY`、`CORTICO_MEME_VISION_KEY`、`CORTICO_MEME_EMBEDDING_KEY`；界面只返回是否配置，不回显密钥。

辅助模型与视觉模型使用 OpenAI 兼容 `/chat/completions` 地址和模型名；embedding 使用 `/embeddings`。此扩展不会自动借用主模型的登录凭据。模型温度使用服务默认值。bge-small-zh 的查询前缀须与服务器预处理约定一致，避免重复添加。

主模型准备好回复后，按需调用 `qqextras_choose_meme(reply, context?, persona?)`。辅助模型第一次调用生成检索词，向量召回后，第二次调用选择候选或放弃。只有当前启用的包参与检索；概率未命中或没有候选时提前结束。`context` 是主模型显式提供的当前对话参考，按配置截取最近轮数，并非直接读取整个主 session。图片描述、上下文和候选作为数据追加到模型请求末尾，不改写主 session 前缀。

选中后 `qqextras_get_meme` 返回工具图片附件和 `log:` 句柄，主模型再调用当前渠道的发送工具。QQ 使用既有 draft/confirm；控制台图片发送由 `patches/cortico/0003-console-image-attachments.patch` 提供。其他渠道需自身支持图片附件。不会拦截或改写所有消息，也不会把没有发送的图片报告为已发送。

查询向量缓存最多 128 条。测试选图显示检索词、候选、选择结果及 query/embedding/search/select 耗时，不发送消息。模型地址、名称或查询前缀改变后需建立匹配索引。

## 验证与来源

`pnpm test` 使用临时目录、真实 ZIP、本机 HTTP/OneBot 服务和真实事件库，只有 LLM/embedding 使用脚本响应。`pnpm run typecheck`、`pnpm run typecheck:web` 检查类型。`pnpm run build:web` 在 bot 停止后构建面板。

界面样式、导入格式和辅助语义流程参考 MIT 授权的 [astrbot_plugin_meme_manager](https://github.com/anka-afk/astrbot_plugin_meme_manager)，版本 `88b8a1b`，许可保留在 `webui/upstream/LICENSE`。本扩展不执行 AstrBot 插件，不包含资源广场、自动收集和云同步。图片许可沿用资源包声明。
