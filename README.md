# 包子的bot中控 / myBot

基于 [Cortico](https://github.com/Pal-AI-Lab/Cortico) 的陪伴 bot。仓库包含锁定的内核补丁、扩展、可复现的依赖清单和当前使用的行为默认配置。安装后可直接打开管理页；聊天前需自行配置模型、QQ 接入及白名单。

## 从零开始（Windows）

安装 Git、Node.js 22+（推荐 24）和 Corepack。Node 未附带 Corepack 时先执行 `npm install -g corepack`。表情包 ZIP 导入导出需要 Python 3；浏览器功能需要 Chrome；委派功能需要另装并登录 Codex CLI。

```powershell
git clone --branch m0-local-setup https://github.com/weibaozi/BZBot.git
cd BZBot
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\setup.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\start.ps1
```

安装脚本获取锁定的 Cortico `e3b214e`，依次应用全部补丁，以 frozen lockfile 安装依赖，构建 WebUI 和扩展，在仓库旁的 `myBot-data\yuki` 创建部署。需要访问 GitHub 和 npm 下载依赖；仓库不包含 node_modules 或模型权重。已有部署不会被模板覆盖。

打开 [管理页](http://127.0.0.1:7777/)：

1. **模型中心**：新增供应商并登录或填密钥，添加模型，再选择主对话模型。模板不带任何模型配置或模型引用。
2. **QQ**：运行并登录 NapCat，填写 OneBot WebSocket 地址和 Token，添加要监听的私聊、群聊。
3. **设置 → 全局变量**：填写自己的白名单 QQ；按需设置主动聊天目标。
4. **表情包 / 知识库 / 生图**：选择对应嵌入、视觉或生图模型。表情包图库需自行导入，标注后重建向量。
5. **人格与日程**：自行填写宪法和日程；点击继续运行开始聊天。

没有 Chrome 时，安装脚本暂时关闭浏览器扩展；装好 Chrome 后，在设置填写可执行文件并启用。浏览器“家”默认 **`browser-home`**，相对于当前部署目录解析，不依赖启动命令所在目录，也不会携带作者的浏览器登录资料。

自定义部署：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\setup.ps1 -CorticoHome D:\bots -BotName mybot -Port 7788
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\start.ps1 -BotName mybot
```

安装脚本把部署根写入该 checkout 的 `.env`。同一仓库所有部署共用 WebUI，更新/重建前先停止该仓库的 bot。新增多个部署时，每个部署使用不同的 WebUI 端口、浏览器调试端口和 QQ 账号。

## 默认配置与隐私

`deploy-template/home/bot/config.json` 是当前行为配置的公开快照，包括消息合并、分段回复、群聊触发、休眠、超时、主动聊天及表情包设置。安装脚本还会安装相同的扩展；不是把整个私人部署复制给别人。

**不包含** QQ 白名单、私聊/群名单、QQ 地址和 Token、模型供应商与模型引用、密钥、OAuth 登录态、个人日程、聊天记录、记忆、人格宪法、图库和浏览器资料。主动聊天对象、可写目录及本机工具路径也留空，由使用者填写。管理页默认仅监听本机。

导出新的行为默认值（可选 `--web-url` 同时读取尚未落盘的默认配置）：

```powershell
node scripts/export-template.mjs <部署目录> --web-url http://127.0.0.1:7777
node --test scripts/tests/deployment.test.mjs
```

导出器会验证所有输出后再替换模板；检测到残留私人 QQ、凭据或绝对路径会停止。底层规则和 World 的环境提示词覆盖作为配置保留，发布前仍应审阅文字内容。

## 目录

- `packages/`：bot、World 和供应商扩展。
- `patches/cortico/`：内核管理功能补丁，按编号应用。
- `patches/extensions/`：第三方扩展补丁。
- `deploy-template/`：公开配置、扩展清单及 lockfile。
- `skills/`：bot 可用的技能。
- `docs/`：设计文档；开发前阅读 [AGENTS.md](AGENTS.md)。
