# `ProactiveWorld` · QQ 私聊主动聊天

独立 World 扩展。只负责调度内部提醒，主模型沿用当前 session 的上下文、人设、记忆和工具，QQ World 负责发送。无需额外模型或密钥，也不修改 Cortico 核心。

## 设置

安装后启用 `proactive` World，在它的配置页填接收者 QQ 号。目标还须在 QQ World 的私聊监听名单中，才能用收到的消息清除未回复计数。

- 默认随机间隔 30–90 分钟，每次收到目标用户消息或发出消息后重新计时。
- 连续未回复上限 2 次，每日主动发送上限 6 次；用户回复清除未回复计数，但不清除当日计数。
- 免打扰默认关闭；开启后按部署时区使用 HH:mm 起止时间。支持跨午夜，相同起止时间表示全天免打扰。
- 配置热更新。区间下限必须小于等于上限；无效 QQ 号或时间会停止调度并显示配置无效。
- 状态页显示下一次考虑时间和计数。「立即考虑」仍遵守暂停、免打扰和次数限制；「重新计时」撤销尚未投递的提醒并重新安排。

到点后通过 `pushDeferred` 在原会话末尾追加 `proactive.due`。投递前重新核对配置和目标用户的新消息，不改写系统前缀、不伪造用户消息。模型可以选择沉默；需要表情包时沿用 `search_meme` → `qq_send`，文字先发、图片后发。

计数基于真实 `qq.self` 成功记录，同一主动轮的分段和图片只计一次。发送失败、模型沉默不计入未回复次数；部分发送成功计一次。提醒轮中目标用户的新消息会取消主动计数，后续作为普通回复处理。

状态写入部署 `data/proactive/state.json`，只保存游标、时间和计数，不复制聊天内容。重启恢复计数；过期提醒重新随机排期，不集中补发。已入模型上下文的提醒由提示词约束有效期与使用方式；扩展的限制控制提醒调度，并非对所有 QQ 发送工具的全局拦截。

现有 Persona 心跳保持原样；本扩展的模板要求主动 QQ 联系依据当前提醒，普通心跳不另行发起，用户新消息仍正常回复。与已有私聊发送工具共用同一个主 session，不为联系人另开 session。

## 安装与验证

在 `vendor/cortico/extensions` 执行 `corepack pnpm add link:../../../packages/cortico-world-proactive`，停止 bot 后运行本包 `node scripts/build-webui.mjs`，重启并启用 World。前端修改发布时须提升版本号，以更新带版本的浏览器缓存地址。

在本包运行 `test`、`typecheck`、`typecheck:web` 脚本。集成测试用真实 SQLite 事件库与本机 OneBot，仅替换 LLM，不使用真实部署。

机制参考 [astrbot_plugin_proactive_chat](https://github.com/Pancakes-Labs/astrbot_plugin_proactive_chat) 的沉默间隔、未回复计数与免打扰设计；本包为独立 TypeScript 实现，未复制其源码。
