# Changelog

## 0.3.0

- 参考资料移到单独的图像资料扩展 `cortico-world-visual`（记忆里的 `visual/<id>/`），本扩展不再存资料、没有管理页。
- 去掉 `reference_ids`：参考图由她挑好，以 `mem:visual/<id>/<文件名>` 放进 `images`；认出这类句柄时按 id 向图像资料取外貌说明附上。
- 去掉 `bot_identity`、按名字/别名自动附图和 `images_references` 工具；旧的 `image-references/` 不再读取。

## 0.2.0

- 支持 Codex 图生图，参考图以图片输入传入。
- 新增本地资料管理、角色自设自动附图与参考信息检索。

## 0.1.0

- 新增通过模型中心生图的工具与模型选择设置，返回通用图片句柄。
