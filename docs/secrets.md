# 凭据静态加密（auth.json）

桌面端会把 provider 的 API key 和 JuCode 的 OAuth token 写进 `~/.jucode/auth.json`。
默认它们是明文。打开 `encrypt_secrets` 之后，桌面端在**下一次写入** `auth.json` 时
会把这些字段就地加密。

## 安全边界（先读这一段）

这是**防"顺手看一眼"的加密，不是威胁模型意义上的安全存储**。

密钥是一个 32 字节随机数，放在应用配置目录里的 `secret.key`（`0600`），
和密文躺在同一台机器上。任何以当前用户身份运行的进程都能读到密钥、解出明文。

它挡得住的是：备份文件、同步到网盘的 home 目录、录屏 / 共享屏幕时被瞄到、
贴给别人的排查日志和支持包——也就是凭据以明文形式**离开**这台机器的那些路径。

它挡不住的是：本机恶意软件、拿到你用户身份的攻击者、有 root 的人。
需要那一档的防护得接系统钥匙串（macOS Keychain / Windows DPAPI / libsecret），
这次没做。

## 默认关闭的原因

`~/.jucode/auth.json` 是和 `jucode` CLI 引擎**共享**的文件：引擎自己也会读里面的
provider key 和 OAuth token，而且桌面端驱动的是用户机器上任意版本的 CLI
（应用不再内置引擎）。CLI 不认识这里的密文封装格式，所以默认开启会让引擎直接
拿到一串密文当 API key 用，聊天和登录全断。

因此：**只有当你只通过桌面端使用引擎、不直接跑 `jucode` 命令行时，才建议打开。**
等 CLI 侧支持同一套封装格式后，这个开关可以改成默认开启。

## 打开 / 关闭

在 `~/.jucode/config.json` 里加一个顶层布尔字段：

```json
{
  "encrypt_secrets": true
}
```

生效方式是"写时加密"：改完设置后，下一次保存凭据（在设置里填写 / 清除某个
provider 的 key、退出登录、或者 OAuth access token 到期自动续期）会把整份
`auth.json` 里的凭据字段一起加密。想立刻生效就随便存一次 key。

改回 `false` 是对称的：下一次写入会把凭据以明文写回去。

读取永远是双向兼容的——明文值原样读出，密文值解密后读出，所以：

- 升级前的老 `auth.json` 照常可用，不需要迁移步骤；
- CLI 在开关打开前后写进去的明文值也照常可用。

## 加密的字段

只加密凭据本身：

- `providers.*` 的每一个字符串值（各家 API key）
- `jucode.access_token`、`jucode.refresh_token`

`jucode.access_expires_at` 之类的记账字段保持明文，这样"登录状态""要不要续期"
这些判断不需要密钥也能做。

## 格式

密文值仍然是 JSON 字符串，只是带上前缀：

```
jcenc1:<base64(nonce ‖ ciphertext‖tag)>
```

- 算法：ChaCha20-Poly1305（AEAD，`chacha20poly1305` crate），每个值一个随机
  12 字节 nonce；
- 密钥：`secret.key` 的 32 字节，首次使用时用 OS 随机源生成，以 `0600` 创建
  （不是先写再 chmod，避免中间有一瞬间是全局可读的）;
- AEAD 的 tag 意味着被改过的密文会解密失败，而不是悄悄解出垃圾。

值保持"字符串"这个 JSON 形状是刻意的：即使某个只认明文的读者拿到加密后的文件，
它至少还能正常解析 JSON，而不是炸在类型上。

## 密钥所在目录

和 Tauri 的 `app_config_dir()` 一致（bundle identifier `com.jucode.desktop`）：

| 平台    | 路径                                                          |
| ------- | ------------------------------------------------------------- |
| macOS   | `~/Library/Application Support/com.jucode.desktop/secret.key` |
| Linux   | `$XDG_CONFIG_HOME/com.jucode.desktop/secret.key`（默认 `~/.config/...`） |
| Windows | `%APPDATA%\com.jucode.desktop\secret.key`                     |

`0600` 只在 Unix 上生效；Windows 依赖 `%APPDATA%` 本身的用户目录 ACL。

## 丢了密钥会怎样

解不开的值会被**原样保留**，不会被清空或覆盖，桌面端表现为"没配置 key / 未登录"：
重新填一次 API key、重新登录一次即可。这么设计是为了让密钥丢失表现成一次重新登录，
而不是一次静默的文件损坏。

同理，`secret.key` 存在但长度不对时，代码会直接报错而不是重新生成一把新密钥——
否则那些还在用旧密钥的密文就永久打不开了。
