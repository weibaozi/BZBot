# myBot 整体架构

自用的陪伴型 bot。主要在 QQ 上聊天，能主动找你，有分层记忆，能把做不到的事委派给 Codex / Claude Code 写成新插件。

相关文档：[记忆设计](memory.md) · [管理后台设计](admin-webui.md)

## 1. 选型结论

| 决定 | 选择 | 理由 |
|---|---|---|
| 内核 | [Cortico](https://github.com/Pal-AI-Lab/Cortico)（MIT），锁定版本，**不直接改源码**，必要的改动以补丁文件管理并提给上游 | 事件驱动、常驻会话、交接机制和 QQ 接入都是现成的；实测缓存命中 89–97% |
| 人格底座 | Cortico 自带的 `corti-soulmate` | 已有 memo 三级、做梦、读写权限分离、作息、闹钟、人物档案 |
| 模型接入 | Coopanion 的 `cortico-provider-coo` 扩展（AGPL，自用） | 覆盖 DeepSeek、Claude、Gemini、Kimi、通义、智谱等，按 base URL 自动选协议 |
| 第一版前端 | QQ（日常聊天）+ Cortico WebUI（管理） | 后端放在家里的服务器上；桌宠需要拆成两端，放到后面 |
| 设计参考 | DeepSeek Harness（MIT）的缓存安全上下文、子 Agent 层；AstrBot 的平台适配层 | 只借鉴思路或摘取代码，不作为依赖 |

主对话模型必须能**稳定地通过工具说话**。Cortico 的 bot 只能用 `qq_draft` / `console_send` 这类工具开口，正文输出不会发给任何人。本地 9B 模型实测做不到，所以主模型用 API 上的强模型，本地模型只做 embedding 和后台杂活。

## 2. 组成

```
家里服务器（Windows，常驻）
├── Cortico（vendor，锁定版本）
│   └── 部署根 CORTICO_HOME
│       ├── providers/            共享的模型端点（密钥在各端点的 .env）
│       ├── <profile-a>/          一个 profile = 一份部署（见第 4 节）
│       └── <profile-b>/
├── 扩展
│   ├── cortico-bot-mybot         我们的 bot 包：继承 CortiSoulmate，加知识库、状态、主动性闸门
│   ├── cortico-world-mcp         MCP 客户端 World：把 MCP server 的工具接进来
│   ├── cortico-world-delegate    委派 World：异步调用 Codex / Claude Code
│   └── cortico-provider-coo      模型服务
├── NapCat（OneBot v11 协议端）── QQ 小号
├── embedding 服务（OpenAI 兼容的 /v1/embeddings，本地 bge-m3 或 API）
└── MCP server 们（生图、搜索、语音识别……）

你的手机 / 电脑
├── QQ
└── 浏览器 → Cortico WebUI（经 Tailscale）
```

### 各部分归属

Cortico 只有三类扩展，每样东西放进哪一类按下表：

| 东西 | 扩展类型 | 说明 |
|---|---|---|
| 人格、分层记忆、知识库、`recall`、状态、上下文策略、主动性闸门 | **bot**（`cortico-bot-mybot`） | 记忆相关的工具按 Cortico 的约定属于 Persona |
| QQ | World（Cortico 自带） | 配置 `worlds.qq` |
| MCP 工具 | World（`cortico-world-mcp`） | 只放几秒内能返回的工具 |
| Codex / Claude Code 委派 | World（`cortico-world-delegate`） | 异步：工具立刻返回，完成后用 `pushEvent` 推事件唤醒 |
| 以后：桌宠、游戏、语音输入 | World | 桌宠要拆成服务器端逻辑 + PC 端窗口 |
| 模型服务 | provider | 现成的够用就不写 |

## 3. 上下文和缓存规则

所有模块都遵守以下规则，它们决定缓存命中率：

1. **前缀只放几乎不变的东西**：人格宪法、长期记忆、环境说明、工具表。前缀只在会话开始、交接、World 挂载或卸载、手动重载时重建。
2. **会变的东西都追加到末尾**：时间（写在事件正文里）、状态变化、检索结果、委派结果、做梦交回的摘要。
3. **不改写历史**：不剥离过去的思维链，不做滑动窗口截断。上下文满了就交接。
4. **改了前缀的东西要明说代价**：后台上凡是会触发前缀重建的操作（立即生效、启停插件），都标注"损失一次缓存"。
5. **工具表顺序固定**：新增的工具要排在固定的位置，不要每次启动都打乱顺序。

## 4. 多个机器人（完全不同的人格和记忆）

**每个机器人对应一个主 session，而且这个主 session 在它自己的部署里：一个机器人 = 一份 Cortico 部署 = 一个主 session。**

- Cortico 规定每个 bot 进程恰好有一个接收事件的常驻 session（主 session）。其他 session 只是这个 bot 临时开的 fork，比如做梦。
- 同一个进程里的所有 session 共用同一份 Persona 和 Memory。所以**不能在一个进程里用多个 session 来跑多个机器人**，那样记忆会混在一起。每个机器人要单独一份部署、单独一个进程。
- 一份部署有自己的 `config.json`（人格配置、QQ 配置、心跳等）、工作区（长期和短期记忆）、`data/`（事件库，也就是原始记录）和知识库文件。**三层记忆天然各自独立**。
- 所有部署共用部署根下的 `providers/`，模型端点和密钥只配一次。
- 多份部署可以引用同一个 bot 包，各自配不同的 `web.port`；单实例锁按 `data/` 目录隔离，互不影响。

两种用法：

| 用法 | 做法 | 限制 |
|---|---|---|
| 同时运行 | 每个 profile 一个进程、一个端口、**一个 QQ 号** | 一个 QQ 号不能同时接两个 bot，否则两个都会回复 |
| 切换使用 | 停掉 A，启动 B（启动器或后台里的切换按钮） | 同一时刻只有一个在线 |

文档里说的"profile"指的就是一个机器人的这份部署。新建 profile 时从模板复制：`deployment.json`（指向 `cortico-bot-mybot`）、初始人格宪法、空的工作区。迁移一个 profile 就是复制它的部署目录（见[记忆设计 · 打包迁移](memory.md#7-打包迁移)）。

## 5. 部署

### 服务器（家里的 Windows 主机：7950X / 32GB / RX 6600）

- **常驻**：关闭睡眠；开机自动登录；Cortico、NapCat、embedding 服务都做成开机自启（任务计划程序或 NSSM）。
- **重启后恢复**：Cortico 会补投重启前没处理的事件，闹钟和心跳持久化，Windows 更新重启后能接着跑。
- **远程访问**：Tailscale 组内网。WebUI 的 `web.host` 设为 Tailscale 地址（或 `0.0.0.0` 加 `web.allowedHosts`），并设置 `web.password`。**不开公网端口**。
- **QQ**：用 NapCat 的 Windows 版登录小号（家宽 IP），正向 WebSocket 只监听本机。
- **embedding**：用 llama-server 加载 bge-m3 的 GGUF，开 `--embedding`（Vulkan 或 CPU），或者直接用 API。对外只认 OpenAI 兼容的 `/v1/embeddings`，换实现不影响代码。

### 密钥

- 模型密钥放在 `providers/<端点>/.env`；World 用的密钥放在 `<部署>/.env`；MCP server 的密钥放在各自的配置里。
- 编程 Agent 的工作目录（`plugins/`）里不放任何密钥。插件需要密钥时，在 manifest 里声明密钥名，由 MCP World 在启动时注入。

### 备份

- 每个 profile 的工作区是一个 git 仓库，定时推送到私有远程仓库。
- `data/`（事件库）定时打包备份。

## 6. 代码仓库布局（建议）

```
myBot/
├── AGENTS.md                   给 Codex / Claude Code 的工作规则
├── docs/                       本目录
├── vendor/cortico/             普通 clone（不进 myBot 的 git），由 scripts/m0-setup.ps1 锁定 commit
├── patches/cortico/            需要 Cortico 改动时的补丁文件，安装脚本自动打上（见 AGENTS.md 第 1 条）
├── packages/
│   ├── cortico-bot-mybot/
│   ├── cortico-world-mcp/
│   └── cortico-world-delegate/
├── plugins/                    委派写出的 MCP 插件（每个一个子目录，独立 git 历史）
├── templates/profile/          新建 profile 的模板
└── scripts/                    安装、链接扩展、备份
```

部署根（`CORTICO_HOME`）放在仓库外，因为里面是数据和密钥。

## 7. 开工顺序

| 阶段 | 内容 | 完成标准 |
|---|---|---|
| M0 环境 | 服务器常驻配置、Tailscale、NapCat + QQ 小号、Cortico 锁定版本、安装 provider-coo、先用**原版** corti-soulmate 跑通 | QQ 私聊能对话；WebUI 上看到缓存命中 |
| M1 bot 包骨架 | `cortico-bot-mybot` 继承 CortiSoulmate，有自己的人格种子和测试 | 部署切到新包后行为和原版一致 |
| M2 知识库 | 索引器、`recall`、自动附带、后台记忆页 | 检索测试能召回一周前的对话 |
| M3 状态与主动性 | 状态工具、免打扰和每日上限闸门、后台状态页 | 免打扰时段内主动发送被拒，并告诉模型原因 |
| M4 MCP World | 接入生图、搜索 | bot 能在 QQ 里发出生成的图 |
| M5 委派 World | Codex / Claude Code 异步委派、插件审批流程 | bot 委派写出一个插件，你审批后它能用上 |
| M6 多 profile 和迁移 | profile 模板、切换、bundle 导出导入 | 一个 profile 复制到另一台机器能原样跑起来 |
| 以后 | 桌宠两端拆分、在线状态路由、语音、游戏 | — |

## 8. 待验证的技术点

1. **bot 包怎么继承 CortiSoulmate（已解决）**：`cortico-bot-mybot` 用相对路径导入 `vendor/cortico/bots/corti-soulmate`（Coopanion 的做法），以 link 方式装进 `vendor/cortico/extensions`。服务端和浏览器端都已验证。代价是这个包离开 myBot 仓库就跑不起来，对我们没有影响。
2. **provider-coo 能不能单独装**：确认它是否已发布到 npm；没发布就从 Coopanion 仓库的本地目录 link 进来。
3. **主动性闸门放在哪一层**：计划在 Persona 里覆写拼装 World 工具的方法，给 `qq_draft` / `qq_confirm` 包一层检查。需要确认 Cortico 允许这样包装，或者有更合适的钩子。
4. **SQLite 选型**：优先用 Node 内置的 `node:sqlite` 加载 sqlite-vec 扩展；不行再换 better-sqlite3。
5. **Cortico 不能作为 git submodule 使用（已确认，待提 issue）**：在 submodule 里，`src/paths.ts` 的 `resolveMainRepoRoot` 用 `git rev-parse --git-common-dir` 求主仓库根，得到的是 `<myBot>\.git\modules\vendor`，于是找不到 `bots/` 下的 bot 包，启动失败。目前的绕法是用普通 clone，由安装脚本锁定 commit。
6. **QQ 语音格式**：QQ 语音是 SILK 格式。协议端转写失败、需要自己识别时，要让 NapCat 转成 mp3 或 wav 再送识别。
