# 自动更新（tauri-plugin-updater）发布指南

桌面端通过 [tauri-plugin-updater](https://v2.tauri.app/plugin/updater/) 实现应用内自动更新。
`src-tauri/tauri.conf.json` 中的 `plugins.updater` 配置了：

- **endpoint**：`https://github.com/JuCode-Team/JuCode-Desktop/releases/latest/download/latest.json`
  —— 指向 GitHub Release 最新版附带的 `latest.json` 清单（由 tauri-action 自动生成并上传）。
- **pubkey**：已配置为真实公钥（密钥对生成于 2026-07-13，私钥在维护者本机
  `~/.tauri/jucode-desktop.key`，**空密码**）。

## 1. 生成签名密钥（已完成）

密钥对已用下面的命令生成，公钥已写入 `tauri.conf.json`：

```sh
pnpm tauri signer generate -w ~/.tauri/jucode-desktop.key --password ""
```

- 私钥文件 `~/.tauri/jucode-desktop.key`（**绝不能提交进仓库**，务必异地备份）；
- 公钥即 `plugins.updater.pubkey` 当前值。

若需轮换密钥：重新生成、替换 pubkey、更新 CI secret——但注意已分发的旧客户端
内置旧公钥，无法验证新签名，等于放弃对存量用户的推送。

## 2. CI 配置（GitHub Actions）

在仓库 Settings → Secrets and variables → Actions 里添加（或用 gh CLI）：

```sh
gh secret set TAURI_SIGNING_PRIVATE_KEY -R JuCode-Team/JuCode-Desktop < ~/.tauri/jucode-desktop.key
gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD -R JuCode-Team/JuCode-Desktop --body ""
```

| Secret | 内容 |
| --- | --- |
| `TAURI_SIGNING_PRIVATE_KEY` | 私钥文件的**内容**（或私钥文件路径，CI 里用内容） |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | 私钥密码（生成时没设密码则留空字符串） |

`.github/workflows/release.yml` 已把这两个 secret 注入 tauri-action 的环境。
当 `TAURI_SIGNING_PRIVATE_KEY` 存在且 `bundle.createUpdaterArtifacts: true` 时，
tauri-action 会自动：

1. 为每个平台构建更新包（macOS `.app.tar.gz`、Windows NSIS `.exe`/`.zip`、Linux `.AppImage`）
   并生成对应的 `.sig` 签名文件；
2. 汇总各平台的版本号、下载地址和签名，生成 `latest.json` 并上传到该 Release。

之后已安装的客户端访问
`releases/latest/download/latest.json` 即可发现并下载新版本。

## 3. 发布流程

1. 更新 `package.json`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml` 中的版本号；
2. 打 tag 并推送（如 `git tag v0.2.0 && git push origin v0.2.0`）；
3. Release workflow 构建、签名并上传安装包 + 更新包 + `latest.json`。

## 4. 本地验证签名构建（可选）

```sh
export TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/jucode-desktop.key)"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="<密码，若无则空>"
pnpm tauri build
```

构建产物旁会出现 `.sig` 文件；`latest.json` 只有 tauri-action（或手工拼装）才会生成。

## 注意事项

- **私钥丢失 = 无法再向存量用户推送更新**（公钥内置在已分发的安装包里），务必妥善备份。
- macOS 更新包仍受 Gatekeeper 约束：未做 Apple 公证的更新在部分机器上可能被拦截，
  与首次安装的限制一致。
- 更新界面入口：设置 → 概览 →「应用更新」，另有启动约 5 秒后的静默后台检查，
  发现新版本时侧栏设置入口会显示小圆点。
