# `DelegateWorld` · 本地 Codex 异步委派

`delegate({agent:"codex",task:"任务说明"})` 立即持久化并返回任务编号。Codex 在独立子进程和任务目录执行，主 session 继续聊天；完成后把结果作为 `delegate.completed` 外部事件追加到现有上下文，由主模型向原请求者反馈。

## 使用

- 当前支持 Codex CLI 0.163.0 已验证的 `exec --json` 接口，复用本机 Codex 登录。无须在 bot 中填 Codex 密钥。
- 安装并启用 `delegate` World。能委派的人是设置页「全局变量」的白名单 QQ，加上本插件配置里「额外的 QQ 私聊白名单」（逗号分隔，默认空）；两处都是每次现读，改完立即生效。需要补丁 `0023-persona-settings-globals.patch` 提供全局变量，没有时只看本插件的名单。
- 身份取自本轮已投递的 QQ 私聊事件，校验发送者、会话、时间和白名单，不接受模型传入的用户 ID。群聊、非白名单、委派结果、心跳以及已结束轮次不能发起任务。需要补丁 `0011-world-delivery-hints.patch` 的 Persona 适配。
- 每条真实用户消息最多一项任务。同一消息重复调用返回原任务编号；相关步骤写在同一份任务说明中。
- 默认串行执行、最多排队 3 项、每项超时 1200 秒。配置热更新对后续执行生效；关闭「接受新任务」也暂停队列启动，已有任务可继续或手动取消。
- `delegate_status({id})` 与 `delegate_cancel({id})` 只允许当前白名单用户访问自己的任务。管理页可查看全部任务和结果、取消任务。

## 执行边界

任务默认位于 `<部署 data>/delegate/tasks/<编号>/workspace`，也可在配置中指定绝对根目录。工作目录由服务端生成，模型不能选择任意 cwd。Codex 使用 `workspace-write` 沙箱、`approval_policy=never`，无审批提升或全盘写入选项；Windows 使用本机已采用的 `unelevated` 沙箱实现。不能完成的任务回报阻碍。

CLI 参数由数组传入，不经过 shell；任务正文通过 stdin 传入。子进程只继承定位程序、用户目录和临时目录所需的环境变量，不继承 bot 的供应商密钥。CLI 不加载用户 config.toml、不加载第三方 Apps/Plugins；仍使用原 Codex 登录和规则。模型配置留空使用 CLI 内置默认，也可以指定本机 Codex 支持的模型名。命令联网和网页搜索默认关闭，可分别在设置中开启；该限制不阻止 Codex 本身调用模型。

沙箱限制写入范围，并非所有本机文件的读取隔离。任务不自动应用到 myBot、不自动安装扩展、不自动发送文件或对外发布。产物路径在结果和任务页显示；实际分发由后续用户要求决定。

额外可写目录使用绝对路径，多个目录用分号或换行分隔；目录必须已经存在。任务目录始终可写，额外目录通过 Codex `--add-dir` 授权。权限在任务启动时读取，修改后不影响正在执行的任务。网页搜索开启时使用实时搜索，与命令联网开关分别控制。Windows unelevated 后端的网络隔离能力受本机沙箱实现限制。

## 状态与恢复

`data/delegate/jobs.sqlite` 保存编号、原请求者、原事件游标、任务、状态和最终结果。CLI 原始命令输出不写入 bot 日志。成功指 Codex 正常结束一轮，不能代替产物正确性检查。

正常停止时终止运行中的进程树；队列和运行任务标为 interrupted。启动时也把遗留的未完成任务标为 interrupted，不自动重跑。结果通知以任务编号与事件库对照，修复事件已入库但数据库尚未确认时的重复通知。异常杀掉整个 bot 时，插件无法保证操作系统立即回收孤立子进程，应检查原任务目录；不会自行启动第二份同一任务。

结果作为不可信外部数据交回原 session，不构成下一次委派授权；系统前缀不随进度改写。

## 安装和验证

在 `vendor/cortico/extensions` 执行 `corepack pnpm add link:../../../packages/cortico-world-delegate`。停止 bot 后运行本包 `node scripts/build-webui.mjs`，重启并启用 World。Node.js 需支持内置 `node:sqlite`（本机 Node 24 已验证）。

`test`、`typecheck`、`typecheck:web` 脚本使用仓库的工具。测试使用真实 Codex CLI、真实 SQLite、真实事件库和本机 OneBot；只替换 LLM 为本地 Responses 服务，不访问真实部署或外部模型。需本机已安装 Codex CLI。

接口依据：[OpenAI 非交互模式](https://learn.chatgpt.com/docs/non-interactive-mode)、[Windows 沙箱](https://learn.chatgpt.com/docs/windows/windows-sandbox)。
