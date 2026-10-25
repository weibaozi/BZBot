# myBot

基于 [Cortico](https://github.com/Pal-AI-Lab/Cortico) 的自用陪伴 bot。仓库里是打在 Cortico 上的补丁、自己写的扩展包和一份部署模板；clone 下来跑一个脚本就能得到和作者同样配置的 bot，但不带任何个人设置。

## 从零开始

需要 Windows、Node.js 22 以上、git。在 myBot 文件夹里用 PowerShell 执行：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\setup.ps1
```

脚本拉取锁定版本的 Cortico、打上 `patches/cortico/` 的全部补丁、装好所有扩展，并在 myBot 旁边的 `myBot-data\yuki` 建一份部署。参数 `-CorticoHome`、`-BotName`、`-Port` 可以改部署目录、名字和端口。然后：

```powershell
cd vendor\cortico; node bin\cortico.mjs yuki
```

打开管理页（默认 http://127.0.0.1:7777/），补上模板里留空的东西：

- 模型供应商：登录 ChatGPT / Codex，其他供应商填 API key。
- QQ：连接地址、token、要监听的私聊和群。
- 设置 → 人格 → 全局变量：白名单 QQ。
- 主动聊天的对象、日程条目，以及人格提示词（宪法），按需填写。

## 模板从哪来

`deploy-template/` 由 `scripts/export-template.mjs` 从作者正在用的部署导出：World 的启用情况和设置照搬，白名单、QQ 号与群、QQ 连接和 token、主动聊天对象、日程条目清空；记忆（人格提示词和她记得的一切）、聊天数据、表情包图库、浏览器资料、密钥和登录状态都不导出。改了自己部署的设置后重新导出：

```bash
node scripts/export-template.mjs <部署目录>
```

导出时如果某个文件里还留着部署认识的 QQ 号或非空的 token / key，脚本会报错停下。

## 目录

- `packages/`：自己写的扩展包（World、模型供应商、bot 包）。
- `patches/cortico/`：对 Cortico 的补丁，按编号依次打；`patches/extensions/`：对第三方扩展的 pnpm 补丁。
- `deploy-template/`：部署模板和扩展清单。
- `skills/`：她能读的技能。
- `docs/`：设计文档；开工前先读 [AGENTS.md](AGENTS.md)。
