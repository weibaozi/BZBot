# AGENTS.md

myBot 是基于 Cortico 的自用陪伴 bot。开工前先读：

- [docs/architecture.md](docs/architecture.md)：整体架构、各部分归属、开工顺序
- [docs/memory.md](docs/memory.md)：三层记忆和知识库
- [docs/admin-webui.md](docs/admin-webui.md)：管理后台
- [docs/model-hub.md](docs/model-hub.md)：模型中心（供应商、模型类型、给插件的接口）

## 规则

1. **不直接改 Cortico 源码**。`vendor/cortico` 是普通 clone（不是 submodule，原因见 docs/architecture.md 第 8 节），由 `scripts/setup.ps1` 锁定在某个 commit。我们的代码写在 `packages/` 下的扩展包里。
   - **唯一的例外是补丁文件**：确实需要改 Cortico 时，改动存成 `patches/cortico/NNNN-<名字>.patch`（`git diff` 导出，含测试），并在 `patches/cortico/README.md` 里登记用途和上游状态。安装脚本在锁定 commit 后按文件名顺序打上补丁。
   - **能改什么**：Cortico 的管理代码可以改，包括 WebUI、配置读写、模型供应商管理、扩展接口（如 `WorldContext`）。**agent 运行的核心不改，或只做很少的改动**：`core/core.ts`、`core/loop.ts`、session、前缀、WakeBus 和 World 的运行逻辑。确实要动核心时，先说明原因并让用户确认。
   - 补丁遵守 Cortico 的 AGENTS.md，界面文案改齐 11 种语言，带测试。新逻辑尽量放进新文件，对已有文件只做小的接入改动，以减少升级时的冲突。补丁不要求一定能被上游接受；适合上游的再整理成 PR（提之前先给用户过目），上游合并后删掉补丁、更新锁定的 commit。
   - 改 `vendor/cortico` 里的补丁内容后，重新导出补丁文件；升级锁定的 commit 前，先 `git -C vendor/cortico checkout .` 去掉旧补丁再重跑脚本。
2. **Cortico 改代码的规矩同样适用于我们的扩展**：遵守 `vendor/cortico/AGENTS.md` 和 `PHILOSOPHY.md` 的约定，尤其是"最小先验"（能用提示词约束的，就不写死控制流）和"诚实认知"（事件和回执只陈述能确认的事实）。
3. **保护缓存**：会变的内容（时间、状态、检索结果、委派结果）只能追加到上下文末尾，不能放进前缀。见 [docs/architecture.md](docs/architecture.md) 第 3 节。
4. **测试**：用真实的事件库、真实的 SQLite、真实的端口测。只有 LLM 和 embedding 可以用假数据。测试里不访问网络。
   - **小改动不跑全量**：只跑改动涉及的测试文件和两个 typecheck（`tsconfig.json`、`tsconfig.web.json`）。Cortico 全量一次要两分多钟，攒几次改动再跑一次；改动跨很多模块、动到共享接口，或升级锁定的 commit 时才每次都跑。
   - 全量里 `tests/web/provider-stream.test.ts` 偶发 "Worker exited unexpectedly"（未打补丁的 Cortico 也会），单独重跑通过即可。
5. **不碰真实部署**：验证时用单独的部署目录（`CORTICO_HOME` 指向一个空目录），不要用正在运行的 profile 的数据。
6. **密钥**：不写进代码、测试、日志和 `plugins/` 目录。
7. **一次性的脚本和实验**放在 `scratch/` 下（不纳入版本控制）。
