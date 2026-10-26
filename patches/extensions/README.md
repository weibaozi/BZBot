# 第三方扩展补丁

从扩展市场（npm）装进 `vendor/cortico/extensions` 的第三方扩展，需要改动时用 pnpm 自带的补丁机制：
补丁文件放在 `vendor/cortico/extensions/patches/`，在 `vendor/cortico/extensions/pnpm-workspace.yaml` 的
`patchedDependencies` 里登记，之后每次安装同一版本都会自动打上。`extensions/` 在 `vendor/cortico` 里、不进 myBot 仓库，
所以补丁在这里留一份副本；在新机器上装好扩展后照下面的步骤恢复。

| 补丁 | 扩展与版本 | 改了什么 | 上游状态 |
|---|---|---|---|
| `cortico-world-agenda@0.2.3.patch` | `cortico-world-agenda` 0.2.3（[biliye/cortico-world-agenda](https://github.com/biliye/cortico-world-agenda)） | 「日程条目」表格：状态列与「停用 / 启用」按钮合成一个开关（按控制台主题变量补的开关样式，浅色深色都跟着走），切换被拒时重读列表让开关回到真实状态；节律、下次触发、操作按钮不再逐字折行；节律去掉「节律」前缀，下次触发显示成 `10-25 11:30`。改 `src/webui/client.ts`，`dist/webui.js` 用 esbuild 重新打包。 | 未提交；可整理成 PR，提之前先给用户过目 |

## 恢复

1. 在 `vendor/cortico/extensions` 里装好对应版本的扩展（版本必须一致）。
2. 把补丁复制到 `vendor/cortico/extensions/patches/`。
3. 在 `vendor/cortico/extensions/pnpm-workspace.yaml` 里登记：

   ```yaml
   patchedDependencies:
     cortico-world-agenda@0.2.3: patches/cortico-world-agenda@0.2.3.patch
   ```

4. 在 `vendor/cortico/extensions` 运行 `corepack pnpm install`，补丁随安装打上。
5. 扩展的界面资源按版本号缓存，浏览器里 Ctrl+F5 刷新一次才会看到新界面。

## 修改补丁

1. 在 `vendor/cortico/extensions` 运行 `corepack pnpm patch <包>@<版本> --edit-dir <scratch 下的目录>`，打开的是已打上现有补丁的副本。
2. 改源码；改了界面就用 `vendor/cortico/node_modules/.bin/esbuild src/webui/client.ts --bundle --format=esm --outfile=dist/webui.js` 重新打包。
3. `corepack pnpm patch-commit <那个目录>` 写回补丁并重装，再把新补丁复制到这里、更新上表。

升级扩展版本时补丁不会自动跟上：先看新版本是否已经修好，没修好再在新版本上重做补丁，登记的版本号一并改掉。

`cortico-world-browser@0.4.0.patch`：浏览器家的相对路径按当前部署目录解析，启动浏览器和搜索历史均使用同一个路径。安装脚本随 pnpm 安装自动应用，模板默认 `browser-home`。
