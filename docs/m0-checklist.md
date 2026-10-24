# M0 清单：在服务器上用原版 corti-soulmate 跑通 QQ

完成标准：用你的 QQ 私聊 bot 的小号，它能回复；Cortico WebUI 的用量页能看到缓存命中。

标 **[你]** 的步骤涉及登录、密钥或系统设置，需要你亲手操作。其余步骤由脚本完成。

## 1. [你] 服务器常驻设置
- 电源计划：关闭睡眠和休眠，"关闭显示器"不受影响。
- 设置开机自动登录（Windows 更新重启后能自己回到桌面，QQ 客户端才能启动）。
- Windows 更新：设置好"使用时段"，避免在你常用的时间重启。

## 2. [你] 安装基础软件
- Node.js 22 或更新版本（LTS 即可），安装时勾选 corepack。
- Git for Windows。
- Tailscale：登录你的账号，手机和主力电脑也加入同一个网络。

## 3. [你] QQ 小号和 NapCat
1. 准备一个 QQ 小号，不要用主号（非官方协议有被风控的可能）。
2. 从 NapCat 官方 GitHub（NapNeko/NapCatQQ）的 Releases 下载 Windows 版，按它的说明启动，扫码登录小号。
3. 在 NapCat 的 WebUI 里添加一个 **OneBot 11 网络配置 → WebSocket 服务端（正向 WS）**：
   - 地址 `127.0.0.1`，端口 `3001`（和 Cortico 的默认值一致）。
   - 设置一个 **access token**，记下来，第 6 步要填。
4. 如果 NapCat 有"状态命令"或自动回复类功能，先关掉，避免绕过 bot 自己回复。

## 4. 运行安装脚本
把 `myBot` 文件夹复制到服务器上，在 PowerShell 里执行：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\m0-setup.ps1 -CorticoHome D:\mybot-data -BotName yuki
```

脚本会：
- 检查 Node 和 git。
- 把 Cortico 拉到 `vendor\cortico`，切到锁定的 commit `e3b214e`，安装依赖。
- 在 `D:\mybot-data` 下建一份部署 `yuki`，引用 corti-soulmate。
- 装上模型供应商扩展 `cortico-provider-coo`。

它不改任何系统设置。`-CorticoHome` 和 `-BotName` 可以换成你想要的路径和名字。

## 5. 启动并配置模型
```powershell
cd vendor\cortico
node bin\cortico.mjs yuki
```

第一次启动会先构建 WebUI，需要等一会儿。启动后默认处于**暂停**状态，然后：
1. 在服务器上打开 `http://127.0.0.1:7777/`。
2. **[你]** 进入「模型供应商」页，新建一个端点：选择服务（比如 DeepSeek），填入 API key，选择模型，点「测试连接」，再点「设为当前」。
   - 主模型一定要选强模型（DeepSeek、Claude、GPT 这一档）。本地小模型不会用工具说话，bot 会一直沉默。

## 6. 接上 QQ
1. 进入 QQ World 页的「接入门」，填写：
   - WS 地址 `ws://127.0.0.1:3001`。
   - **[你]** token：第 3 步记下的 access token。
2. 在私聊名单里加上**你自己的 QQ 号**，并启用。先不加群。
3. 在「World 总览」里激活 QQ World。
4. 回到控制台，点 ▶ 解除暂停。

## 7. 验证
- 用你的 QQ 给小号发一句话。corti-soulmate 会先起草，再确认发送，所以回复会比普通聊天机器人慢一点。
- 在「用量与成本」页看到请求记录；连续聊几句后，缓存命中应该在 90% 左右。
- 等一个心跳间隔不说话，看它会不会主动找你（不一定会，这由它自己判断）。

## 8. 远程访问（可选，M0 末尾做）
- **[你]** 在 WebUI 里设置访问密码（`web.password`）。
- 在 `D:\mybot-data\yuki\config.json` 里把 `web.host` 设为服务器的 Tailscale IP，重启。之后在手机或主力电脑上用 `http://<Tailscale IP>:7777/` 访问。
- 不要开公网端口。

## 9. 开机自启（可选）
- **[你]** 用任务计划程序新建任务："用户登录时"运行 `node`，参数 `bin\cortico.mjs yuki`，起始目录 `<myBot>\vendor\cortico`。
- NapCat 也设成登录后自启。

## 遇到问题时
- 启动日志在命令行窗口里；也可以在 WebUI「运行诊断」里导出诊断包。
- QQ 连不上：确认 NapCat 已登录、正向 WS 端口是 3001、token 一致。在 QQ World 页能看到连接状态。
- bot 不说话：先看控制台里模型有没有调用 `qq_draft`。如果它只输出了正文，就换一个更强的模型。
