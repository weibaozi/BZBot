# 技能

所有部署共用的"做某类事的方法"。`cortico-world-skills` 把这里的技能列进 bot 的环境提示词，bot 用 `read_skill` 读取后照着做。

- 每个技能一个文件夹，文件夹名是技能 id（用英文和连字符），里面放 `SKILL.md`。
- `SKILL.md` 开头的 front matter：`name`（显示名）、`description`（一句话，会出现在 bot 的技能列表里）、`requires`（需要哪些 World 挂载，逗号分隔；缺一个就不列出）。
- 正文写什么时候用、步骤、诚实要求和禁止的操作。步骤里的工具名要和对应 World 的工具一致。
- 文件夹里可以放别的参考文件，`read_skill` 会列出它们的名字。
- 技能由人维护，bot 不能改；bot 自己的心得写在它记忆里的 `note/playbook/`，值得推广的再整理进这里。
- 改动下次 bot 重建前缀时生效（交接或重启），不用重启就能被 `read_skill` 读到。
