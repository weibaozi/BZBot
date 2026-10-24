# `definition.ts` / `QqextrasWorld`：QQ 功能扩展

表情包是本扩展的第一个功能模块，通过 `worlds.qqextras.memes.enabled` 独立开关。
它向主模型提供语义检索和图片读取工具，选图后的发送沿用 QQ World 的 `qq_draft`、`qq_confirm`。
不修改现有 QQ 连接、人设、Memory 或 session，不自动给每条消息配图。

## 安装和导入

1. 在扩展页安装本目录，重启后启用「QQ 功能」World。
2. 打开「QQ 功能 → 表情包」，选择服务器本机的 AstrBot ZIP 导出文件。ZIP 读取使用 Python 3 标准库，配置中可指定 Python 路径。
3. 支持 `manifest.json`、`memes/<分类>/<图片>`、`semantic_metadata.json` 的分享包或备份包；也支持外面多包一层目录。保留分类、描述、标签、配字和来源文件。未带语义描述的图片可浏览，但不参与语义检索；标为 `needs_review` 或存在分类冲突的图片不参与检索。
4. 导入只写本扩展数据目录，不调用模型，也不加载备份中的 FAISS 二进制索引。原 ZIP 保持不变。同一 ZIP 重复导入会创建独立资源包。
5. 配置 OpenAI 兼容 embedding 基础地址、模型名。`BAAI/bge-small-zh-v1.5` 是初始模型名，服务端实际模型名须一致。查询前缀默认留空，应与服务器的预处理约定一致，避免服务端和客户端重复添加。
6. 点击「生成向量索引」。复用导入的语义描述，分批调用 embedding；成功后原子替换索引。无需重新识图。
7. 使用「测试检索」查看候选及耗时。`Embedding` 包含本地索引与目录准备和查询向量化时间；`Search` 是本地候选评分时间。这不等于完整 QQ 回复延迟。

若服务需要密钥，在部署 `.env` 配置 `CORTICO_MEME_EMBEDDING_KEY`。密钥不进入配置 JSON、表情包和向量索引。

## 运行流程

主模型结合会话决定是否配图，调用 `qqextras_search_memes` 表达回复意图。查询向量化后，本地余弦相似度返回默认 5 条候选。
主模型可选择候选，也可不发图；选中后调用 `qqextras_get_meme`，图片作为工具附件落入 Cortico 事件/附件存储，返回 `log:` 句柄。
模型通过现有 QQ 工具起草并确认发送。图片描述和检索结果追加在工具回执中，不改写固定前缀。

查询向量缓存最多 128 条。索引保存在部署的 `qqextras/memes/index.json`，图片在 `qqextras/memes/packs/`；模型、基础地址或查询前缀改变后要求重建索引。新增资源包也需重新生成索引才能搜索新增图片。
管理面板移植原插件的样式与资源包/分类/图片网格布局，支持缩略图懒加载、分类筛选、文字搜索、大图预览、分类说明及图片描述/标签/配字编辑。保存使用版本校验，避免多个页面互相覆盖；改过的条目在索引重建前不参与语义检索。
不包含自动收集、云同步、独立视觉标注或任意 AstrBot Python 插件执行。原版 CSS 及 MIT 许可保存在 `webui/upstream/`，控制器适配 Cortico 的面板接口，不加载 AstrBot 页面 SDK。
管理入口目前是独立的「QQ 功能」World 页面，尚未嵌入内置 QQ 页面。

## 验证

`pnpm test` 使用临时目录、真实 ZIP 和本机 OneBot 测试服务，只有 LLM/embedding 使用脚本响应；不连接外部模型或真实 QQ。
`pnpm run typecheck`、`pnpm run typecheck:web` 检查两侧类型。
`pnpm run build:web` 构建管理面板，运行中的部署停止后才可覆盖它正在使用的构建产物。

导入格式参考 MIT 授权的 [astrbot_plugin_meme_manager](https://github.com/anka-afk/astrbot_plugin_meme_manager)，这是面向其数据格式的独立实现，不是完整插件兼容层。表情图片本身的来源和许可沿用各资源包声明。
