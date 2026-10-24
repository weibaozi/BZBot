# Cortico 补丁

`scripts/m0-setup.ps1` 在把 `vendor/cortico` 切到锁定的 commit 之后，按文件名顺序打上这里的补丁；已经打过的会跳过。规则见根目录 `AGENTS.md` 第 1 条。

| 补丁 | 基于 | 改了什么 | 上游状态 |
|---|---|---|---|
| `0001-provider-model-picker.patch` | `e3b214e` | 端点编辑页的选模型流程：填好地址和 key 后自动获取模型列表；列表可搜索、点一行即选中（显示上下文长度和是否支持图片）；没选模型时「测试连接」直接提示，不发请求。服务端：草稿还没选模型时也能获取模型列表（以前会报"模型名不能为空"，导致无法从列表里选模型）。界面文案改齐 11 种语言，补了测试。 | 未提交；提 PR 前先给用户过目 |
| `0002-provider-generation-options.patch` | `e3b214e` + `0001` | 供应商编辑页按协议模块声明的主机和模型档位显示推理强度下拉框；DeepSeek 使用 `none/low/high/max`，已知 OpenAI 模型使用各自官方档位，未知兼容端点可自定义。温度可恢复模型默认；新端点默认输出 8192、上下文 1,000,000。包含 11 种语言和真实 HTTP/临时配置保存测试。 | 未提交；提 PR 前先给用户过目 |
| `0003-console-image-attachments.patch` | `e3b214e` + `0001` + `0002` | `console_send` 支持已有图片附件句柄，消息和图片先落库再广播，重连可回放。工具契约和模型提示为固定英文，无新增界面文案。包含 QQ 关闭时的真实事件库、WebSocket 和图片读取测试。 | 未提交；提 PR 前先给用户过目 |
| `0004-provider-sources.patch` | `e3b214e` + `0001` + `0002` + `0003` | 模型中心第 1 步（存储与加载，见 docs/model-hub.md）：`providers/<目录>/config.json` 新增供应商格式，带 `models` 表，一个供应商下挂多个模型、各带类型与参数；启用的对话模型展开成名为 `<供应商>/<模型 id>` 的端点，Core 看到的端点表不变。同一供应商的模型共用目录、密钥与登录状态；旧格式照常读写；`activeProvider` 存目录名时指向其中唯一的对话模型。WebUI 编辑供应商下的模型时只改参数，删除只删这个模型。新增错误文案改齐 11 种语言，带读写、registry、加载与 WebUI 服务端测试。 | 未提交；不一定提上游 |
| `0005-model-hub.patch` | `e3b214e` + `0001`–`0004` | 模型中心第 2 步（给插件的接口，见 docs/model-hub.md）：新增 `ModelHub`（`src/providers/model-hub.ts`，实现在 `models.ts`），按模型引用 `list` / `chat` / `embed` / `rerank` / `transcribe` / `speak`。对话经 registry 的 `bind()`，可临时覆盖生成参数；其余类型按 OpenAI 兼容路径直连供应商地址，带供应商的密钥和附加请求头。协议模块用 `modelTypes` 声明支持的类型（缺省只有对话）。`WorldContext.models` 与 bot `build()` 的第三个参数 `services.models` 提供它；配置项 `x-options: models:<类型>[:image]` 列出可选模型。带本机 HTTP 服务与 registry 的测试，没有新增界面文案。 | 未提交；不一定提上游 |

## 重新导出补丁

每个补丁只包含自己相对前序补丁的增量。重新导出时，在 `scratch/` 的隔离副本中应用前序补丁，
将前序状态按明确路径暂存，再修改目标补丁的内容。新文件先用 `git add -N -- <路径>` 纳入 diff；
使用 `git diff --binary --output=<补丁绝对路径>` 导出未暂存的增量。
不要把含全部补丁的 `vendor/cortico` diff 写回 `0001`，否则后序补丁会重复应用。
