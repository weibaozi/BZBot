# Codex 生图 (`world.ts`, `server/library.ts`)

在模型中心添加 Codex OAuth 生图模型，在本扩展中选择它；对应的文本模型在模型中心的生图模型设置里选择。

`images_generate(prompt, images?, reference_ids?, bot_identity?)` 支持文生图和参考图编辑。对话图片传入原始 `log:` / `mem:` 句柄，宿主读取字节后通过模型中心交给 Codex。图片失效时明确报错，不猜路径、不抓任意 URL。有图片时使用 `input_image` 和 `image_generation.action=edit`。返回图片句柄，随后由当前渠道工具发送。

## 自设与本地资料

进入「Codex 生图 → 参考资料」，新增条目，填写名称、别名、说明并上传 PNG/JPEG/WebP。勾选「这是 bot 自设」后，模型在画自己时设置 `bot_identity=true`，插件自动附上这些条目。提示词出现登记名称或别名时也自动匹配。图片按聊天图片、资料参考图顺序传入，并附编号和用途。

`images_references(query)` 按名称、别名、说明检索；空查询列出前 20 条。其他知识可保存为纯文字条目，并通过 `reference_ids` 在生图时使用。这是操作员维护的资料库，不写 people 或人格记忆。名称/别名采用字面匹配，语义相关条目由模型检索后选取。

资料保存在 `<deployment>/image-references/entries.json` 和同目录 `images/`，备份整个目录即可。保存后下一次调用生效，不改固定系统前缀。删除条目/移除图片关联不会物理清除图片文件。

每个条目最多 8 张图，上传单图最多 6 MB；一次生成最多 8 张参考图、合计 20 MB。过多时明确报错，需减少参考图。默认超时 180 秒，停用或取消会中断调用，不自动重试。

文生图仍兼容普通 `/images/generations` 供应商；图生图优先支持 Codex，其他供应商不支持时明确拒绝，不丢弃参考图。账号实际生图权限以服务端为准。
