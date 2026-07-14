//! Login-shell environment snapshot.
//!
//! GUI 进程从 launchd 继承的环境和用户终端里的环境差异很大（PATH、代理、
//! NODE_EXTRA_CA_CERTS 等都可能缺失），导致「终端里能跑、桌面里跑不了」。
//! 这里在应用启动时用用户的登录 shell 捕获一次完整环境快照，后端子进程
//! 用 `env_clear()` + 快照从零构建环境 —— 子进程看到的就是终端看到的。
//!
//! 捕获失败/超时/Windows 平台一律回退为现状（继承 GUI 环境），绝不阻塞启动。

use serde::Serialize;
use std::collections::HashMap;
use std::io::Read;
use std::process::{Command, Stdio};
use std::sync::{OnceLock, RwLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

/// 输出流里的快照起始标记（NUL 包裹，正常 rc 输出不可能撞上）。
const MARKER: &[u8] = b"\x00__JUCODE_ENV__\x00";
const CAPTURE_TIMEOUT: Duration = Duration::from_secs(8);

#[derive(Clone)]
pub struct ShellEnv {
    pub vars: HashMap<String, String>,
    pub captured_at_ms: u64,
    pub shell: String,
}

#[derive(Serialize, Clone)]
pub struct ShellEnvStatus {
    /// 平台是否支持捕获（Windows 为 false）。
    pub supported: bool,
    pub captured: bool,
    pub count: usize,
    pub captured_at_ms: Option<u64>,
    pub shell: Option<String>,
}

static STATE: OnceLock<RwLock<Option<ShellEnv>>> = OnceLock::new();

fn state() -> &'static RwLock<Option<ShellEnv>> {
    STATE.get_or_init(|| RwLock::new(None))
}

/// 进程性/危险变量：注入子进程只会造成困扰或风险，从快照剔除。
fn is_denied(name: &str) -> bool {
    name.starts_with("DYLD_")
        || name.starts_with("LD_")
        || name.starts_with("XPC_")
        || name.starts_with("Apple_PubSub")
        || matches!(name, "SHLVL" | "PWD" | "OLDPWD" | "_" | "TERM_SESSION_ID")
}

/// 从捕获输出里解析 NUL 分隔的 KEY=VALUE（值可含换行）。
/// 若整段找不到 NUL 分隔（env 不支持 -0 的降级情形），退回按行解析。
pub(crate) fn parse_env_output(bytes: &[u8]) -> Option<HashMap<String, String>> {
    let pos = bytes
        .windows(MARKER.len())
        .position(|w| w == MARKER)?;
    let rest = &bytes[pos + MARKER.len()..];
    let mut vars = parse_entries(rest.split(|b| *b == 0));
    if vars.len() <= 1 {
        vars = parse_entries(rest.split(|b| *b == b'\n'));
    }
    // 没有 PATH 的快照没有意义，视为捕获失败。
    vars.contains_key("PATH").then_some(vars)
}

fn parse_entries<'a>(entries: impl Iterator<Item = &'a [u8]>) -> HashMap<String, String> {
    let mut vars = HashMap::new();
    for entry in entries {
        if entry.is_empty() {
            continue;
        }
        let s = String::from_utf8_lossy(entry);
        let Some((k, v)) = s.split_once('=') else {
            continue;
        };
        if k.is_empty() || is_denied(k) {
            continue;
        }
        vars.insert(k.to_string(), v.to_string());
    }
    vars
}

fn default_shell() -> String {
    std::env::var("SHELL").ok().filter(|s| !s.trim().is_empty()).unwrap_or_else(|| {
        if cfg!(target_os = "macos") {
            "/bin/zsh".to_string()
        } else {
            "/bin/bash".to_string()
        }
    })
}

/// 用指定 shell 捕获一次环境。测试用假 shell 脚本注入即可覆盖全链路。
pub(crate) fn capture_with(shell: &str) -> Option<ShellEnv> {
    if cfg!(windows) {
        return None;
    }
    // -i：加载交互式 rc（zshrc 等，代理/包装方案的变量多在这里）；
    // -l：登录 shell（zprofile/profile）；-c：执行捕获脚本。
    // zsh/bash/fish 都接受这三个参数。
    let script = "printf '\\000__JUCODE_ENV__\\000'; exec /usr/bin/env -0";
    let mut child = Command::new(shell)
        .args(["-ilc", script])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let mut out = child.stdout.take()?;
    let reader = std::thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = out.read_to_end(&mut buf);
        buf
    });
    let deadline = Instant::now() + CAPTURE_TIMEOUT;
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) => {
                if Instant::now() >= deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    break;
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(_) => break,
        }
    }
    let bytes = reader.join().ok()?;
    let vars = parse_env_output(&bytes)?;
    Some(ShellEnv {
        vars,
        captured_at_ms: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0),
        shell: shell.to_string(),
    })
}

fn capture_and_store() -> ShellEnvStatus {
    let shell = default_shell();
    let captured = capture_with(&shell);
    *state().write().unwrap() = captured;
    status()
}

/// 应用启动时异步捕获，不阻塞 setup。
pub fn init_async() {
    std::thread::spawn(|| {
        let _ = capture_and_store();
    });
}

pub fn status() -> ShellEnvStatus {
    let guard = state().read().unwrap();
    match guard.as_ref() {
        Some(env) => ShellEnvStatus {
            supported: !cfg!(windows),
            captured: true,
            count: env.vars.len(),
            captured_at_ms: Some(env.captured_at_ms),
            shell: Some(env.shell.clone()),
        },
        None => ShellEnvStatus {
            supported: !cfg!(windows),
            captured: false,
            count: 0,
            captured_at_ms: None,
            shell: None,
        },
    }
}

/// 快照的 PATH（供二进制解析优先使用）。
pub fn snapshot_path() -> Option<String> {
    state().read().unwrap().as_ref().and_then(|e| e.vars.get("PATH").cloned())
}

/// 在不清空现有环境的前提下合并快照（git/gh 这类命令用：既要终端 PATH/
/// 凭据环境，又不值得为它们做全清重建）。
pub fn merge_into(cmd: &mut Command) {
    if let Some(env) = state().read().unwrap().as_ref() {
        cmd.envs(env.vars.iter());
    }
}

/// 后端子进程环境构建。`use_shell_env` 且快照可用时：清空 GUI 环境，
/// 从快照重建（终端等价环境）；否则维持现状（继承 GUI 环境）。
/// 优先级：快照 < `custom`（用户每后端自定义变量）< `explicit`
///（应用协议关键变量，如 JUCODE_DESKTOP —— 永远最后断言，不可被覆盖）。
pub fn apply_to_command(
    cmd: &mut Command,
    use_shell_env: bool,
    explicit: &[(&str, &str)],
    custom: &[(String, String)],
) {
    let snapshot = if use_shell_env && !cfg!(windows) {
        state().read().unwrap().clone()
    } else {
        None
    };
    if let Some(env) = snapshot {
        cmd.env_clear();
        // 兜底：快照理论上必含这些，缺失时从父进程补齐基础身份变量。
        for key in ["HOME", "USER", "LOGNAME", "TMPDIR"] {
            if !env.vars.contains_key(key) {
                if let Ok(v) = std::env::var(key) {
                    cmd.env(key, v);
                }
            }
        }
        cmd.envs(env.vars.iter());
    }
    for (k, v) in explicit {
        cmd.env(k, v);
    }
    for (k, v) in custom {
        cmd.env(k, v);
    }
    // 协议关键变量最后再断言一次，用户自定义无法覆盖。
    for (k, v) in explicit {
        cmd.env(k, v);
    }
}

#[tauri::command]
pub fn shell_env_status() -> ShellEnvStatus {
    status()
}

#[tauri::command]
pub fn refresh_shell_env() -> ShellEnvStatus {
    capture_and_store()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn wrap(body: &[u8]) -> Vec<u8> {
        let mut out = b"rc noise before\n".to_vec();
        out.extend_from_slice(MARKER);
        out.extend_from_slice(body);
        out
    }

    #[test]
    fn parses_nul_separated_pairs_including_newlines_in_values() {
        let bytes = wrap(b"PATH=/usr/bin:/bin\0MULTI=line1\nline2\0FOO=bar\0");
        let vars = parse_env_output(&bytes).unwrap();
        assert_eq!(vars["PATH"], "/usr/bin:/bin");
        assert_eq!(vars["MULTI"], "line1\nline2");
        assert_eq!(vars["FOO"], "bar");
    }

    #[test]
    fn missing_marker_means_capture_failed() {
        assert!(parse_env_output(b"PATH=/usr/bin\0FOO=bar\0").is_none());
    }

    #[test]
    fn snapshot_without_path_is_rejected() {
        assert!(parse_env_output(&wrap(b"FOO=bar\0BAZ=qux\0")).is_none());
    }

    #[test]
    fn denylisted_vars_are_stripped() {
        let bytes = wrap(
            b"PATH=/bin\0DYLD_INSERT_LIBRARIES=/evil.dylib\0LD_PRELOAD=/evil.so\0SHLVL=3\0PWD=/tmp\0_=/usr/bin/env\0XPC_SERVICE_NAME=x\0KEEP=1\0",
        );
        let vars = parse_env_output(&bytes).unwrap();
        assert_eq!(vars.len(), 2);
        assert!(vars.contains_key("PATH") && vars.contains_key("KEEP"));
    }

    #[test]
    fn falls_back_to_line_parse_when_env_lacks_nul_support() {
        let bytes = wrap(b"PATH=/usr/bin:/bin\nFOO=bar\nBAZ=qux");
        let vars = parse_env_output(&bytes).unwrap();
        assert_eq!(vars["FOO"], "bar");
        assert_eq!(vars["BAZ"], "qux");
    }

    #[cfg(unix)]
    #[test]
    fn full_capture_round_trip_via_fake_shell() {
        use std::io::Write;
        use std::os::unix::fs::PermissionsExt;
        let dir = std::env::temp_dir().join(format!("jucode-shellenv-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let fake = dir.join("fakeshell");
        // 模拟真实 shell：吃掉 -ilc <script> 并执行脚本，附带 rc 噪音输出。
        let mut f = std::fs::File::create(&fake).unwrap();
        writeln!(f, "#!/bin/sh").unwrap();
        writeln!(f, "echo 'plugin banner noise'").unwrap();
        writeln!(f, "export SNAP_TEST_VAR=hello").unwrap();
        writeln!(f, "shift; exec /bin/sh -c \"$1\"").unwrap();
        drop(f);
        std::fs::set_permissions(&fake, std::fs::Permissions::from_mode(0o755)).unwrap();

        let env = capture_with(fake.to_str().unwrap()).expect("capture should succeed");
        assert_eq!(env.vars.get("SNAP_TEST_VAR").map(String::as_str), Some("hello"));
        assert!(env.vars.contains_key("PATH"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn apply_precedence_snapshot_then_custom_explicit_wins() {
        // 直接对 Command 环境断言：优先级 快照 < custom < explicit(最终断言)。
        *state().write().unwrap() = Some(ShellEnv {
            vars: HashMap::from([
                ("PATH".into(), "/snap/bin".into()),
                ("SHARED".into(), "from-snapshot".into()),
                ("JUCODE_DESKTOP".into(), "0".into()),
            ]),
            captured_at_ms: 1,
            shell: "test".into(),
        });
        let mut cmd = Command::new("true");
        apply_to_command(
            &mut cmd,
            true,
            &[("JUCODE_DESKTOP", "1")],
            &[
                ("SHARED".to_string(), "from-custom".to_string()),
                ("JUCODE_DESKTOP".to_string(), "hack".to_string()),
            ],
        );
        let envs: HashMap<_, _> = cmd
            .get_envs()
            .filter_map(|(k, v)| Some((k.to_string_lossy().to_string(), v?.to_string_lossy().to_string())))
            .collect();
        assert_eq!(envs["PATH"], "/snap/bin");
        assert_eq!(envs["SHARED"], "from-custom");
        // 协议关键变量不可被用户自定义覆盖。
        assert_eq!(envs["JUCODE_DESKTOP"], "1");
        *state().write().unwrap() = None;
    }

    #[test]
    fn apply_without_snapshot_or_disabled_keeps_inherited_env() {
        *state().write().unwrap() = None;
        let mut cmd = Command::new("true");
        apply_to_command(&mut cmd, true, &[("A", "1")], &[]);
        // 未 env_clear：get_envs 只包含显式设置的变量。
        assert_eq!(cmd.get_envs().count(), 1);
    }
}
