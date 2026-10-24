# AGENTS.md

myBot 是基于 Cortico 的自用陪伴 bot。开工前先读：

- [docs/architecture.md](docs/architecture.md)：整体架构、各部分归属、开工顺序
- [docs/memory.md](docs/memory.md)：三层记忆和知识库
- [docs/admin-webui.md](docs/admin-webui.md)：管理后台

## 规则

1. **不改 Cortico 源码**。`vendor/cortico` 是普通 clone（不是 submodule，原因见 docs/architecture.md 第 8 节），由 `scripts/m0-setup.ps1` 锁定在某个 commit。需要 Cortico 改动时，记录下来另行处理；我们的代码只写在 `packages/` 下的扩展包里。
2. **Cortico 改代码的规矩同样适用于我们的扩展**：遵守 `vendor/cortico/AGENTS.md` 和 `PHILOSOPHY.md` 的约定，尤其是"最小先验"（能用提示词约束的，就不写死控制流）和"诚实认知"（事件和回执只陈述能确认的事实）。
3. **保护缓存**：会变的内容（时间、状态、检索结果、委派结果）只能追加到上下文末尾，不能放进前缀。见 [docs/architecture.md](docs/architecture.md) 第 3 节。
4. **测试**：用真实的事件库、真实的 SQLite、真实的端口测。只有 LLM 和 embedding 可以用假数据。测试里不访问网络。
5. **不碰真实部署**：验证时用单独的部署目录（`CORTICO_HOME` 指向一个空目录），不要用正在运行的 profile 的数据。
6. **密钥**：不写进代码、测试、日志和 `plugins/` 目录。
7. **一次性的脚本和实验**放在 `scratch/` 下（不纳入版本控制）。
