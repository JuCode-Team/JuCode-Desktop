//! At-rest encryption for the credentials the desktop app writes into
//! `~/.jucode/auth.json` (provider API keys and the JuCode OAuth token pair).
//!
//! Threat model: this protects against *casual reads* — a backup, a synced
//! home directory, a screen share, a support bundle. The key sits next to the
//! app's own config in `app_config_dir/secret.key` with `0600`, so anything
//! running as the user can still decrypt. It is deliberately not an OS keychain
//! integration and is not a defence against local malware.
//!
//! `auth.json` is a shared contract with the `jucode` CLI engine, which reads
//! the same file and knows nothing about this envelope, so encryption is
//! opt-in (`encrypt_secrets` in `config.json`). See `docs/secrets.md`.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use base64::Engine as _;
use chacha20poly1305::aead::Aead;
use chacha20poly1305::{ChaCha20Poly1305, Key, KeyInit, Nonce};
use serde_json::Value;

/// Prefix marking a JSON string as an encrypted envelope. Values keep their
/// JSON *shape* (still a string), so a file written by a newer desktop still
/// parses everywhere — it just carries ciphertext the reader can't use.
const ENVELOPE_PREFIX: &str = "jcenc1:";
const KEY_FILE: &str = "secret.key";
const KEY_LEN: usize = 32;
const NONCE_LEN: usize = 12;

/// Tauri's bundle identifier, mirrored so the key lands in the same directory
/// `AppHandle::path().app_config_dir()` would pick without threading a handle
/// through every call site.
const APP_IDENTIFIER: &str = "com.jucode.desktop";

/// Serializes first-run key creation so two threads can't each generate a key
/// and have one silently overwrite the other's (which would strand secrets
/// encrypted under the discarded key).
static KEY_INIT: Mutex<()> = Mutex::new(());

pub struct SecretStore {
    dir: PathBuf,
}

impl SecretStore {
    /// The store backing the running app: `app_config_dir/secret.key`.
    pub fn app_local() -> Result<Self, String> {
        Ok(Self {
            dir: app_config_dir()?,
        })
    }

    #[cfg(test)]
    pub fn in_dir(dir: impl Into<PathBuf>) -> Self {
        Self { dir: dir.into() }
    }

    fn key_path(&self) -> PathBuf {
        self.dir.join(KEY_FILE)
    }

    /// Reads the machine-local key, generating it on first use. A short or
    /// unreadable key file is an error rather than a silent regeneration: the
    /// caller must not overwrite still-encrypted secrets with a fresh key.
    fn key(&self) -> Result<[u8; KEY_LEN], String> {
        let path = self.key_path();
        if let Some(key) = read_key(&path)? {
            return Ok(key);
        }
        let _guard = KEY_INIT
            .lock()
            .map_err(|e| format!("secret key lock poisoned: {e}"))?;
        if let Some(key) = read_key(&path)? {
            return Ok(key);
        }
        let mut key = [0u8; KEY_LEN];
        getrandom::getrandom(&mut key)
            .map_err(|e| format!("failed to generate secret key: {e}"))?;
        write_key(&path, &key)?;
        Ok(key)
    }

    fn cipher(&self) -> Result<ChaCha20Poly1305, String> {
        let key = self.key()?;
        Ok(ChaCha20Poly1305::new(Key::from_slice(&key)))
    }

    /// `jcenc1:<base64(nonce || ciphertext||tag)>`.
    pub fn encrypt(&self, plaintext: &str) -> Result<String, String> {
        let cipher = self.cipher()?;
        let mut nonce = [0u8; NONCE_LEN];
        getrandom::getrandom(&mut nonce).map_err(|e| format!("failed to generate nonce: {e}"))?;
        let sealed = cipher
            .encrypt(Nonce::from_slice(&nonce), plaintext.as_bytes())
            .map_err(|_| "failed to encrypt secret".to_string())?;
        let mut blob = Vec::with_capacity(NONCE_LEN + sealed.len());
        blob.extend_from_slice(&nonce);
        blob.extend_from_slice(&sealed);
        Ok(format!(
            "{ENVELOPE_PREFIX}{}",
            base64::engine::general_purpose::STANDARD.encode(&blob)
        ))
    }

    pub fn decrypt(&self, envelope: &str) -> Result<String, String> {
        let body = envelope
            .strip_prefix(ENVELOPE_PREFIX)
            .ok_or_else(|| "value is not an encrypted envelope".to_string())?;
        let blob = base64::engine::general_purpose::STANDARD
            .decode(body.as_bytes())
            .map_err(|e| format!("malformed secret envelope: {e}"))?;
        if blob.len() <= NONCE_LEN {
            return Err("malformed secret envelope: truncated".to_string());
        }
        let (nonce, sealed) = blob.split_at(NONCE_LEN);
        let plain = self
            .cipher()?
            .decrypt(Nonce::from_slice(nonce), sealed)
            .map_err(|_| "failed to decrypt secret (wrong key or tampered file)".to_string())?;
        String::from_utf8(plain).map_err(|e| format!("decrypted secret is not utf-8: {e}"))
    }

    /// Encrypts every plaintext credential in an `auth.json` value in place.
    /// Values that are already envelopes are left alone, so re-saving a file
    /// whose key went missing can't double-encrypt it.
    pub fn protect(&self, auth: &mut Value) -> Result<(), String> {
        let mut result = Ok(());
        for_each_secret(auth, |slot| {
            if result.is_err() || slot.trim().is_empty() || is_envelope(slot) {
                return;
            }
            match self.encrypt(slot) {
                Ok(envelope) => *slot = envelope,
                Err(e) => result = Err(e),
            }
        });
        result
    }

    /// Decrypts every envelope in an `auth.json` value in place. Plaintext
    /// values (pre-encryption files, or files the CLI wrote) pass through
    /// untouched, and an envelope we can't open is left as-is so a lost key
    /// surfaces as "not logged in" instead of a corrupted save.
    pub fn reveal(&self, auth: &mut Value) {
        for_each_secret(auth, |slot| {
            if !is_envelope(slot) {
                return;
            }
            if let Ok(plain) = self.decrypt(slot) {
                *slot = plain;
            }
        });
    }
}

pub fn is_envelope(value: &str) -> bool {
    value.starts_with(ENVELOPE_PREFIX)
}

/// Visits every string in `auth` that holds a credential: each entry of the
/// `providers` map plus the JuCode OAuth token pair. Expiry timestamps and any
/// other bookkeeping stay in the clear so `read_auth_providers` and the refresh
/// check still work without a key.
fn for_each_secret(auth: &mut Value, mut visit: impl FnMut(&mut String)) {
    if let Some(providers) = auth.get_mut("providers").and_then(Value::as_object_mut) {
        for (_, value) in providers.iter_mut() {
            if let Value::String(s) = value {
                visit(s);
            }
        }
    }
    if let Some(jucode) = auth.get_mut("jucode").and_then(Value::as_object_mut) {
        for field in ["access_token", "refresh_token"] {
            if let Some(Value::String(s)) = jucode.get_mut(field) {
                visit(s);
            }
        }
    }
}

fn read_key(path: &Path) -> Result<Option<[u8; KEY_LEN]>, String> {
    match std::fs::read(path) {
        Ok(bytes) if bytes.len() == KEY_LEN => {
            let mut key = [0u8; KEY_LEN];
            key.copy_from_slice(&bytes);
            Ok(Some(key))
        }
        Ok(_) => Err(format!(
            "{} is not a {KEY_LEN}-byte key; refusing to replace it",
            path.display()
        )),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("failed to read {}: {e}", path.display())),
    }
}

fn write_key(path: &Path, key: &[u8; KEY_LEN]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("failed to create {}: {e}", parent.display()))?;
    }
    // Create with the restrictive mode up front: a chmod after the write would
    // leave the key world-readable for an instant.
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(path)
        .map_err(|e| format!("failed to create {}: {e}", path.display()))?;
    use std::io::Write as _;
    file.write_all(key)
        .map_err(|e| format!("failed to write {}: {e}", path.display()))
}

/// Restricts an existing file to owner-only. Best effort: no-op on Windows,
/// where the app config directory already lives under the user's profile.
pub fn restrict_to_owner(path: &Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
    }
    #[cfg(not(unix))]
    let _ = path;
}

/// Mirrors `AppHandle::path().app_config_dir()` for the bundle identifier.
fn app_config_dir() -> Result<PathBuf, String> {
    let base = if cfg!(windows) {
        std::env::var_os("APPDATA").map(PathBuf::from)
    } else if cfg!(target_os = "macos") {
        home_dir().map(|h| h.join("Library").join("Application Support"))
    } else {
        std::env::var_os("XDG_CONFIG_HOME")
            .map(PathBuf::from)
            .filter(|p| p.is_absolute())
            .or_else(|| home_dir().map(|h| h.join(".config")))
    };
    base.map(|b| b.join(APP_IDENTIFIER))
        .ok_or_else(|| "could not locate the app config directory".to_string())
}

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    struct TempDir(PathBuf);

    impl TempDir {
        fn new(name: &str) -> Self {
            let dir =
                std::env::temp_dir().join(format!("jucode-secrets-{}-{name}", std::process::id()));
            let _ = std::fs::remove_dir_all(&dir);
            std::fs::create_dir_all(&dir).unwrap();
            Self(dir)
        }

        fn store(&self) -> SecretStore {
            SecretStore::in_dir(&self.0)
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn encrypt_decrypt_roundtrip() {
        let dir = TempDir::new("roundtrip");
        let store = dir.store();
        let envelope = store.encrypt("sk-secret-key").unwrap();
        assert!(is_envelope(&envelope));
        assert!(!envelope.contains("sk-secret-key"));
        assert_eq!(store.decrypt(&envelope).unwrap(), "sk-secret-key");
    }

    #[test]
    fn same_plaintext_encrypts_to_different_envelopes() {
        let dir = TempDir::new("nonce");
        let store = dir.store();
        assert_ne!(
            store.encrypt("same").unwrap(),
            store.encrypt("same").unwrap()
        );
    }

    #[test]
    fn tampered_envelope_is_rejected() {
        let dir = TempDir::new("tamper");
        let store = dir.store();
        let envelope = store.encrypt("sk-secret-key").unwrap();
        let body = envelope.strip_prefix(ENVELOPE_PREFIX).unwrap();
        let mut blob = base64::engine::general_purpose::STANDARD
            .decode(body.as_bytes())
            .unwrap();
        let last = blob.len() - 1;
        blob[last] ^= 0x01;
        let forged = format!(
            "{ENVELOPE_PREFIX}{}",
            base64::engine::general_purpose::STANDARD.encode(&blob)
        );
        assert!(store.decrypt(&forged).is_err());
    }

    #[test]
    fn plaintext_value_is_not_treated_as_an_envelope() {
        let dir = TempDir::new("plain");
        assert!(!is_envelope("sk-plain"));
        assert!(dir.store().decrypt("sk-plain").is_err());
    }

    #[test]
    fn key_is_reused_across_stores() {
        let dir = TempDir::new("reuse");
        let envelope = dir.store().encrypt("token").unwrap();
        assert_eq!(dir.store().decrypt(&envelope).unwrap(), "token");
    }

    #[cfg(unix)]
    #[test]
    fn key_file_is_owner_only() {
        use std::os::unix::fs::PermissionsExt;
        let dir = TempDir::new("perms");
        let store = dir.store();
        store.encrypt("x").unwrap();
        let mode = std::fs::metadata(store.key_path())
            .unwrap()
            .permissions()
            .mode();
        assert_eq!(mode & 0o777, 0o600);
    }

    #[test]
    fn truncated_key_file_errors_instead_of_regenerating() {
        let dir = TempDir::new("short-key");
        let store = dir.store();
        std::fs::write(store.key_path(), b"too short").unwrap();
        assert!(store.encrypt("x").is_err());
    }

    #[test]
    fn protect_then_reveal_roundtrips_auth() {
        let dir = TempDir::new("auth-roundtrip");
        let store = dir.store();
        let original = json!({
            "providers": { "deepseek": "sk-deepseek", "mimo": "sk-mimo" },
            "jucode": {
                "access_token": "at-1",
                "refresh_token": "rt-1",
                "access_expires_at": 1234,
            }
        });
        let mut auth = original.clone();
        store.protect(&mut auth).unwrap();

        let on_disk = serde_json::to_string(&auth).unwrap();
        assert!(!on_disk.contains("sk-deepseek"));
        assert!(!on_disk.contains("rt-1"));
        // Non-secret bookkeeping stays readable so the refresh check works
        // without touching the key.
        assert_eq!(auth["jucode"]["access_expires_at"], json!(1234));

        store.reveal(&mut auth);
        assert_eq!(auth, original);
    }

    #[test]
    fn plaintext_auth_still_loads_and_migrates_on_save() {
        let dir = TempDir::new("migrate");
        let store = dir.store();
        // A file written before this feature existed: nothing is an envelope.
        let mut auth = json!({ "providers": { "deepseek": "sk-legacy" } });
        store.reveal(&mut auth);
        assert_eq!(auth["providers"]["deepseek"], json!("sk-legacy"));

        store.protect(&mut auth).unwrap();
        assert!(is_envelope(auth["providers"]["deepseek"].as_str().unwrap()));
        store.reveal(&mut auth);
        assert_eq!(auth["providers"]["deepseek"], json!("sk-legacy"));
    }

    #[test]
    fn protect_leaves_existing_envelopes_alone() {
        let dir = TempDir::new("no-double");
        let store = dir.store();
        let mut auth = json!({ "providers": { "deepseek": "sk-1" } });
        store.protect(&mut auth).unwrap();
        let once = auth["providers"]["deepseek"].as_str().unwrap().to_string();
        store.protect(&mut auth).unwrap();
        assert_eq!(auth["providers"]["deepseek"].as_str().unwrap(), once);
    }

    #[test]
    fn protect_skips_empty_values() {
        let dir = TempDir::new("empty");
        let store = dir.store();
        let mut auth = json!({ "providers": { "deepseek": "" } });
        store.protect(&mut auth).unwrap();
        assert_eq!(auth["providers"]["deepseek"], json!(""));
    }

    #[test]
    fn envelope_from_another_key_is_left_intact() {
        let mine = TempDir::new("key-a");
        let theirs = TempDir::new("key-b");
        let foreign = theirs.store().encrypt("sk-theirs").unwrap();
        let mut auth = json!({ "providers": { "deepseek": foreign.clone() } });
        mine.store().reveal(&mut auth);
        assert_eq!(auth["providers"]["deepseek"], json!(foreign));
    }
}
