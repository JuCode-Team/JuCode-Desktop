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

之后已安装的客户端即可发现新版本。检查和下载在 Rust 侧（`src-tauri/src/app_update.rs`）：

- 先读 GitHub 的 `releases/latest/download/latest.json`，并试下载更新包开头 512 KB；
- GitHub 不通，或 4 秒内下不完这 512 KB，就改用 JuCode 服务器的镜像
  `{jucode_api_url}/v1/public/releases/desktop/latest.json`（`jucode_api_url` 取自
  `~/.jucode/config.json`，默认 `https://api.jucode.net`）。镜像由后端每 10 分钟从
  GitHub 同步（后台「版本发布」也可手动同步），签名与 GitHub 上的完全相同；
- 从 GitHub 下载中途失败时，再从镜像重试一次。

启动约 5 秒后检查一次，之后每 10 分钟检查一次。
发现更新后自动下载并安装到待应用状态；为了避免中断未保存工作，应用不会自动退出，
用户可在设置 → 概览 →「应用更新」中点击「重启并安装」完成切换。手动点击「检查更新」
仍只检查版本，不会自动下载。

## 3. 发布流程

安装包内置 JuCode CLI：Release workflow 从 JuCode-CLI 的 GitHub Release 下载
`src-tauri/jucode-cli.version` 指定版本的二进制（`jucode-<target>`）和
`jucode-third-party-notices.txt`，作为 sidecar 打进安装包。所以先发 CLI，再发桌面端：

1. JuCode-CLI：改 `Cargo.toml` 版本号，打 tag 推送，等两个 Release workflow 跑完；
2. 把 `src-tauri/jucode-cli.version` 改成这个 CLI 版本；
3. 更新 `package.json`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml` 中的版本号；
4. 打 tag 并推送（如 `git tag v0.4.0 && git push origin v0.4.0`）；
5. Release workflow 构建、签名并上传安装包 + 更新包 + `latest.json`；
   10 分钟内后端镜像会同步这个版本。

## 4. 本地验证签名构建（可选）

```sh
export TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/jucode-desktop.key)"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="<密码，若无则空>"
# 内置 CLI：放一个本平台的 jucode 到 src-tauri/binaries/jucode-<target>
cp ../JuCode-CLI/target/release/jucode src-tauri/binaries/jucode-aarch64-apple-darwin
pnpm tauri build --config src-tauri/tauri.bundle.conf.json
```

构建产物旁会出现 `.sig` 文件；`latest.json` 只有 tauri-action（或手工拼装）才会生成。

## 注意事项

- **私钥丢失 = 无法再向存量用户推送更新**（公钥内置在已分发的安装包里），务必妥善备份。
- macOS 更新包仍受 Gatekeeper 约束：未做 Apple 公证的更新在部分机器上可能被拦截，
  与首次安装的限制一致。
- 更新界面入口：设置 → 概览 →「应用更新」，另有启动约 5 秒后的静默后台检查，
  发现新版本时侧栏设置入口会显示小圆点。

## 强制更新

后台「版本发布」页可以把某个版本设为强制更新。客户端每次检查时读取
`{jucode_api_url}/v1/public/releases/desktop/policy` 的 `min_version`：当前版本低于它，
就自动下载更新，并弹出不能关闭的对话框，装好后只能重启。服务器连不上时不强制
（不会因为网络问题把应用锁住）。

## 更新提示与后台服务

- 更新装好后弹窗提示「已就绪」，可以「稍后」；下次启动自动生效。会话在后台服务里，
  重启应用不会中断任务。
- 新版应用自带新版 CLI。连上后台服务时比较版本：不同就请它在没有任务运行时退出，
  应用随后启动新版（`restart_when_idle`）；旧到不支持这个请求的后台服务直接结束进程
  （macOS、Linux、Windows 都适用）。

## macOS 签名（固定自签名证书）

macOS 包用一张固定的自签名证书签名（未公证，首次打开仍需在「隐私与安全性」里放行）。
签名身份固定后，系统记住的麦克风、录屏等授权在更新后仍然有效；ad-hoc 签名每次构建都不同，
每次更新都要重新授权。

- 证书：`JuCode Self-Signed`，有效期到 2036 年，公钥证书在 `src-tauri/macos-signing-cert.pem`。
- 私钥与 p12：维护者本机 `~/.tauri/macos-signing/`（`jucode-macos-signing.p12`、
  `p12-password.txt`），**务必备份**。丢失后换新证书，用户需要重新授权一次。
- CI secret：`APPLE_CERTIFICATE`（p12 的 base64）、`APPLE_CERTIFICATE_PASSWORD`。
  Release workflow 在 macOS 上把它导入临时钥匙串并设为代码签名可信，再由 tauri-action 签名
  （`APPLE_SIGNING_IDENTITY`）。不开 hardened runtime（不做公证就不需要，也免去麦克风等
  entitlement 配置）。
- 手动运行 Release workflow 只构建 macOS 包，不发布，用来检查签名：
  `codesign -d -r- JuCode.app` 应显示 `certificate leaf = H"..."`，而不是 `cdhash`。
