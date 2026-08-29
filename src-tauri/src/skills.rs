use flate2::read::GzDecoder;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{self, Cursor, Read},
    path::{Component, Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
use tar::Archive;
use zip::ZipArchive;

const ANTHROPIC_INDEX: &[u8] = include_bytes!("../resources/anthropic-skills.json");
const MAX_INDEX_BYTES: usize = 4 * 1024 * 1024;
const MAX_PACKAGE_BYTES: usize = 20 * 1024 * 1024;
const MAX_SINGLE_FILE_BYTES: usize = 20 * 1024 * 1024;
const MAX_EXTRACTED_BYTES: u64 = 100 * 1024 * 1024;
const MAX_PACKAGE_FILES: usize = 4096;
const HTTP_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(60);

#[derive(Debug, Deserialize)]
struct AnthropicIndex {
    schema_version: u32,
    repository: String,
    #[serde(rename = "ref")]
    git_ref: String,
    tree_url: String,
    skills: Vec<AnthropicSkill>,
}

#[derive(Debug, Clone, Deserialize)]
struct AnthropicSkill {
    id: String,
    name: String,
    description: String,
    tags: Vec<String>,
    skill_url: String,
    homepage: String,
    license: String,
    redistributable: bool,
}

#[derive(Debug)]
struct JucodeSkill {
    id: String,
    name: String,
    description: String,
    content: String,
    package_url: Option<String>,
    package_sha256: Option<String>,
    package_type: Option<String>,
    tags: Vec<String>,
    enabled: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogSkill {
    id: String,
    name: String,
    description: String,
    tags: Vec<String>,
    source: &'static str,
    is_default: bool,
    installed: bool,
    license: String,
    redistributable: bool,
    homepage: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillCatalog {
    skills: Vec<CatalogSkill>,
    warnings: Vec<String>,
    install_dir: String,
}

#[derive(Debug, Deserialize)]
struct GithubTree {
    #[serde(default)]
    truncated: bool,
    tree: Vec<GithubTreeEntry>,
}

#[derive(Debug, Deserialize)]
struct GithubTreeEntry {
    path: String,
    mode: String,
    #[serde(rename = "type")]
    kind: String,
    size: Option<u64>,
}

pub fn catalog(
    jucode_marketplace: Result<Value, String>,
    backend: &str,
) -> Result<SkillCatalog, String> {
    let index = parse_anthropic_index(ANTHROPIC_INDEX)?;
    let skills_dir = skills_dir(backend).map_err(|error| error.to_string())?;
    let mut skills = Vec::new();
    let mut warnings = Vec::new();

    match jucode_marketplace {
        Ok(value) => match parse_jucode_marketplace(&value) {
            Ok((jucode, defaults)) => {
                skills.extend(jucode.into_iter().map(|skill| {
                    let installed = installed_at(&skills_dir, &skill.id);
                    CatalogSkill {
                        id: skill.id.clone(),
                        name: skill.name,
                        description: skill.description,
                        tags: skill.tags,
                        source: "jucode",
                        is_default: defaults.iter().any(|id| id == &skill.id),
                        installed,
                        license: String::new(),
                        redistributable: true,
                        homepage: String::new(),
                    }
                }));
            }
            Err(error) => warnings.push(format!("JuCode marketplace: {error}")),
        },
        Err(error) => warnings.push(format!("JuCode marketplace: {error}")),
    }

    skills.extend(index.skills.into_iter().map(|skill| CatalogSkill {
        installed: installed_at(&skills_dir, &skill.id),
        id: skill.id,
        name: skill.name,
        description: skill.description,
        tags: skill.tags,
        source: "anthropic",
        is_default: false,
        license: skill.license,
        redistributable: skill.redistributable,
        homepage: skill.homepage,
    }));
    skills.sort_by(|left, right| {
        left.source
            .cmp(right.source)
            .then_with(|| left.name.cmp(&right.name))
    });

    Ok(SkillCatalog {
        skills,
        warnings,
        install_dir: skills_dir.display().to_string(),
    })
}

pub fn install(
    source: &str,
    id: &str,
    backend: &str,
    jucode_marketplace: Option<&Value>,
) -> Result<String, String> {
    let destination = skills_dir(backend)
        .map_err(|error| error.to_string())?
        .join(validated_skill_id(id)?);

    match source {
        "anthropic" => {
            let index = parse_anthropic_index(ANTHROPIC_INDEX)?;
            let skill = index
                .skills
                .iter()
                .find(|skill| skill.id == id)
                .ok_or_else(|| format!("Anthropic skill not found: {id}"))?;
            install_anthropic_skill(&index, skill, &destination).map_err(|e| e.to_string())?;
        }
        "jucode" => {
            let marketplace = jucode_marketplace
                .ok_or_else(|| "JuCode marketplace is unavailable".to_string())?;
            let (skills, _) = parse_jucode_marketplace(marketplace)?;
            let skill = skills
                .iter()
                .find(|skill| skill.id == id)
                .ok_or_else(|| format!("JuCode skill not found: {id}"))?;
            install_jucode_skill(skill, &destination).map_err(|e| e.to_string())?;
        }
        other => return Err(format!("unknown skill source: {other}")),
    }

    Ok(destination.display().to_string())
}

fn parse_anthropic_index(bytes: &[u8]) -> Result<AnthropicIndex, String> {
    if bytes.len() > MAX_INDEX_BYTES {
        return Err(format!(
            "Anthropic skills index exceeds {MAX_INDEX_BYTES} byte limit"
        ));
    }
    let index =
        serde_json::from_slice::<AnthropicIndex>(bytes).map_err(|error| error.to_string())?;
    if index.schema_version != 1 {
        return Err(format!(
            "unsupported Anthropic skills index schema {}",
            index.schema_version
        ));
    }
    if index.repository != "https://github.com/anthropics/skills" {
        return Err("unexpected Anthropic skills repository".to_string());
    }
    if index.git_ref.trim().is_empty() || index.tree_url.trim().is_empty() {
        return Err("Anthropic skills index is missing its GitHub ref or tree URL".to_string());
    }
    for skill in &index.skills {
        validated_skill_id(&skill.id)?;
        if skill.name.trim().is_empty()
            || skill.description.trim().is_empty()
            || !skill
                .skill_url
                .starts_with("https://raw.githubusercontent.com/anthropics/skills/")
            || !skill
                .homepage
                .starts_with("https://github.com/anthropics/skills/")
        {
            return Err(format!(
                "invalid Anthropic skills index entry: {}",
                skill.id
            ));
        }
    }
    Ok(index)
}

fn parse_jucode_marketplace(value: &Value) -> Result<(Vec<JucodeSkill>, Vec<String>), String> {
    let rows = value
        .get("skills")
        .and_then(Value::as_array)
        .ok_or_else(|| "response missing skills".to_string())?;
    let skills = rows
        .iter()
        .filter_map(parse_jucode_skill)
        .filter(|skill| skill.enabled)
        .collect();
    let defaults = value
        .get("default_skill_ids")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(str::trim)
        .filter(|id| !id.is_empty())
        .map(str::to_string)
        .collect();
    Ok((skills, defaults))
}

fn parse_jucode_skill(value: &Value) -> Option<JucodeSkill> {
    let id = json_string(value, "id")?;
    validated_skill_id(&id).ok()?;
    let name = json_string(value, "name")?;
    let description = json_string(value, "description")?;
    let content = json_string(value, "content").unwrap_or_default();
    let package_url = json_string(value, "package_url");
    if content.is_empty() && package_url.is_none() {
        return None;
    }
    Some(JucodeSkill {
        id,
        name,
        description,
        content,
        package_url,
        package_sha256: json_string(value, "package_sha256"),
        package_type: json_string(value, "package_type"),
        tags: value
            .get("tags")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .map(str::trim)
            .filter(|tag| !tag.is_empty())
            .map(str::to_string)
            .collect(),
        enabled: value
            .get("enabled")
            .and_then(Value::as_bool)
            .unwrap_or(true),
    })
}

fn json_string(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn install_anthropic_skill(
    index: &AnthropicIndex,
    skill: &AnthropicSkill,
    destination: &Path,
) -> io::Result<()> {
    let tree_bytes = http_get_bounded(&index.tree_url, MAX_INDEX_BYTES)?;
    let mut tree = serde_json::from_slice::<GithubTree>(&tree_bytes)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
    if tree.truncated {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "GitHub returned a truncated Anthropic skills tree",
        ));
    }

    let mut files = Vec::new();
    let mut declared_bytes = 0_u64;
    for entry in tree.tree.drain(..) {
        let Some(relative) = anthropic_relative_path(&entry.path, &skill.id)? else {
            continue;
        };
        match entry.kind.as_str() {
            "tree" => continue,
            "blob" if entry.mode == "100644" || entry.mode == "100755" => {}
            _ => {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    format!("unsupported GitHub tree entry: {}", entry.path),
                ));
            }
        }
        let size = entry.size.ok_or_else(|| {
            io::Error::new(
                io::ErrorKind::InvalidData,
                format!("GitHub tree entry has no size: {}", entry.path),
            )
        })?;
        if size > MAX_SINGLE_FILE_BYTES as u64 {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                format!("skill file exceeds {MAX_SINGLE_FILE_BYTES} byte limit"),
            ));
        }
        declared_bytes = declared_bytes.saturating_add(size);
        if declared_bytes > MAX_EXTRACTED_BYTES {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                format!("skill exceeds {MAX_EXTRACTED_BYTES} byte limit"),
            ));
        }
        files.push((entry, relative));
        if files.len() > MAX_PACKAGE_FILES {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                format!("skill exceeds {MAX_PACKAGE_FILES} file limit"),
            ));
        }
    }
    if files.is_empty() {
        return Err(io::Error::new(
            io::ErrorKind::NotFound,
            format!("Anthropic skill files not found: {}", skill.id),
        ));
    }
    files.sort_by(|left, right| left.0.path.cmp(&right.0.path));

    let staging = staging_dir(destination, "download");
    recreate_dir(&staging)?;
    let result = (|| {
        let mut actual_bytes = 0_u64;
        for (entry, relative) in files {
            let url = format!(
                "https://raw.githubusercontent.com/anthropics/skills/{}/{}",
                encode_url_path(&index.git_ref),
                encode_url_path(&entry.path)
            );
            let bytes = http_get_bounded(&url, MAX_SINGLE_FILE_BYTES)?;
            actual_bytes = actual_bytes.saturating_add(bytes.len() as u64);
            if actual_bytes > MAX_EXTRACTED_BYTES {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    format!("skill exceeds {MAX_EXTRACTED_BYTES} byte limit"),
                ));
            }
            let path = staging.join(relative);
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent)?;
            }
            fs::write(&path, bytes)?;
            apply_download_permissions(&path, entry.mode == "100755")?;
        }
        if !staging.join("SKILL.md").is_file() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "Anthropic skill does not contain SKILL.md",
            ));
        }
        atomic_replace_dir(&staging, destination)
    })();
    if result.is_err() {
        let _ = fs::remove_dir_all(&staging);
    }
    result
}

fn anthropic_relative_path(path: &str, skill_id: &str) -> io::Result<Option<PathBuf>> {
    let safe = safe_path_components(Path::new(path)).ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::InvalidData,
            format!("unsafe path in GitHub tree: {path}"),
        )
    })?;
    let components = safe.components().collect::<Vec<_>>();
    if components.len() < 2
        || components[0].as_os_str() != "skills"
        || components[1].as_os_str() != skill_id
    {
        return Ok(None);
    }
    if components.len() == 2 {
        return Ok(None);
    }
    let mut relative = PathBuf::new();
    for component in &components[2..] {
        relative.push(component.as_os_str());
    }
    Ok(Some(relative))
}

fn install_jucode_skill(skill: &JucodeSkill, destination: &Path) -> io::Result<()> {
    if let Some(url) = skill.package_url.as_deref() {
        install_jucode_package(skill, destination, url)
    } else {
        let content = normalized_content(skill);
        if content.len() > MAX_SINGLE_FILE_BYTES {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                format!("skill content exceeds {MAX_SINGLE_FILE_BYTES} byte limit"),
            ));
        }
        let staging = staging_dir(destination, "inline");
        recreate_dir(&staging)?;
        if let Err(error) = fs::write(staging.join("SKILL.md"), content) {
            let _ = fs::remove_dir_all(&staging);
            return Err(error);
        }
        atomic_replace_dir(&staging, destination)
    }
}

fn install_jucode_package(skill: &JucodeSkill, destination: &Path, url: &str) -> io::Result<()> {
    let expected = skill.package_sha256.as_deref().ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            "marketplace package is missing required package_sha256",
        )
    })?;
    let bytes = download_package(url)?;
    verify_sha256(&bytes, expected)?;
    let extract_dir = staging_dir(destination, "extract");
    recreate_dir(&extract_dir)?;
    let package_type = skill
        .package_type
        .as_deref()
        .filter(|kind| !kind.trim().is_empty())
        .unwrap_or_else(|| infer_package_type(url));
    let extracted = match package_type {
        "zip" => extract_zip(&bytes, &extract_dir),
        "tar.gz" | "tgz" => extract_tar_gz(&bytes, &extract_dir),
        other => Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("unsupported skill package type: {other}"),
        )),
    };
    if let Err(error) = extracted {
        let _ = fs::remove_dir_all(&extract_dir);
        return Err(error);
    }
    let root = find_skill_root(&extract_dir).ok_or_else(|| {
        let _ = fs::remove_dir_all(&extract_dir);
        io::Error::new(
            io::ErrorKind::InvalidData,
            "skill package does not contain SKILL.md",
        )
    })?;
    if root == extract_dir {
        return atomic_replace_dir(&extract_dir, destination);
    }

    let ready = staging_dir(destination, "ready");
    recreate_dir(&ready)?;
    if let Err(error) = copy_dir_contents(&root, &ready) {
        let _ = fs::remove_dir_all(&extract_dir);
        let _ = fs::remove_dir_all(&ready);
        return Err(error);
    }
    let _ = fs::remove_dir_all(&extract_dir);
    atomic_replace_dir(&ready, destination)
}

fn download_package(url: &str) -> io::Result<Vec<u8>> {
    if let Some(path) = url.strip_prefix("file://") {
        return read_bounded(fs::File::open(path)?, MAX_PACKAGE_BYTES);
    }
    if !url.contains("://") {
        return read_bounded(fs::File::open(url)?, MAX_PACKAGE_BYTES);
    }
    http_get_bounded(url, MAX_PACKAGE_BYTES)
}

fn http_get_bounded(url: &str, limit: usize) -> io::Result<Vec<u8>> {
    let response = ureq::get(url)
        .timeout(HTTP_TIMEOUT)
        .set("Accept", "application/vnd.github+json")
        .set("User-Agent", "JuCode-Desktop")
        .call()
        .map_err(|error| io::Error::other(error.to_string()))?;
    read_bounded(response.into_reader(), limit)
}

fn read_bounded(reader: impl Read, limit: usize) -> io::Result<Vec<u8>> {
    let mut reader = reader.take((limit + 1) as u64);
    let mut bytes = Vec::new();
    reader.read_to_end(&mut bytes)?;
    if bytes.len() > limit {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            format!("download exceeds {limit} byte limit"),
        ));
    }
    Ok(bytes)
}

fn verify_sha256(bytes: &[u8], expected: &str) -> io::Result<()> {
    let actual = Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    if actual.eq_ignore_ascii_case(expected.trim()) {
        Ok(())
    } else {
        Err(io::Error::new(
            io::ErrorKind::InvalidData,
            format!(
                "skill package sha256 mismatch: expected {}, got {actual}",
                expected.trim()
            ),
        ))
    }
}

fn extract_zip(bytes: &[u8], destination: &Path) -> io::Result<()> {
    let mut archive = ZipArchive::new(Cursor::new(bytes)).map_err(zip_error)?;
    if archive.len() > MAX_PACKAGE_FILES {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            format!("skill package exceeds {MAX_PACKAGE_FILES} file limit"),
        ));
    }
    let mut extracted_bytes = 0_u64;
    for index in 0..archive.len() {
        let mut file = archive.by_index(index).map_err(zip_error)?;
        if let Some(mode) = file.unix_mode() {
            let file_type = mode & 0o170000;
            if file_type != 0 && file_type != 0o100000 && file_type != 0o040000 {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "skill package links and special files are not allowed",
                ));
            }
        }
        extracted_bytes = extracted_bytes.saturating_add(file.size());
        if extracted_bytes > MAX_EXTRACTED_BYTES {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                format!("extracted skill exceeds {MAX_EXTRACTED_BYTES} byte limit"),
            ));
        }
        let relative = safe_path_components(Path::new(file.name())).ok_or_else(|| {
            io::Error::new(
                io::ErrorKind::InvalidData,
                format!("unsafe path in skill package: {}", file.name()),
            )
        })?;
        let path = destination.join(relative);
        if file.is_dir() {
            fs::create_dir_all(&path)?;
            continue;
        }
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        let mut output = fs::File::create(&path)?;
        io::copy(&mut file, &mut output)?;
        apply_zip_permissions(file.unix_mode(), &path)?;
    }
    Ok(())
}

fn extract_tar_gz(bytes: &[u8], destination: &Path) -> io::Result<()> {
    let decoder = GzDecoder::new(Cursor::new(bytes));
    let mut archive = Archive::new(decoder);
    let mut extracted_bytes = 0_u64;
    for (index, entry) in archive.entries()?.enumerate() {
        if index >= MAX_PACKAGE_FILES {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                format!("skill package exceeds {MAX_PACKAGE_FILES} file limit"),
            ));
        }
        let mut entry = entry?;
        let source = entry.path()?;
        let relative = safe_path_components(&source).ok_or_else(|| {
            io::Error::new(
                io::ErrorKind::InvalidData,
                format!("unsafe path in skill package: {}", source.display()),
            )
        })?;
        let kind = entry.header().entry_type();
        if !kind.is_file() && !kind.is_dir() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "skill package links and special files are not allowed",
            ));
        }
        extracted_bytes = extracted_bytes.saturating_add(entry.header().size()?);
        if extracted_bytes > MAX_EXTRACTED_BYTES {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                format!("extracted skill exceeds {MAX_EXTRACTED_BYTES} byte limit"),
            ));
        }
        let path = destination.join(relative);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        entry.unpack(path)?;
    }
    Ok(())
}

fn safe_path_components(path: &Path) -> Option<PathBuf> {
    let mut safe = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Normal(part) => safe.push(part),
            Component::CurDir => {}
            _ => return None,
        }
    }
    (!safe.as_os_str().is_empty()).then_some(safe)
}

fn find_skill_root(directory: &Path) -> Option<PathBuf> {
    if directory.join("SKILL.md").is_file() {
        return Some(directory.to_path_buf());
    }
    for entry in fs::read_dir(directory).ok()? {
        let path = entry.ok()?.path();
        if path.is_dir() {
            if let Some(found) = find_skill_root(&path) {
                return Some(found);
            }
        }
    }
    None
}

fn copy_dir_contents(source: &Path, destination: &Path) -> io::Result<()> {
    fs::create_dir_all(destination)?;
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let source_path = entry.path();
        let destination_path = destination.join(entry.file_name());
        if source_path.is_dir() {
            copy_dir_contents(&source_path, &destination_path)?;
        } else {
            fs::copy(&source_path, &destination_path)?;
            fs::set_permissions(&destination_path, fs::metadata(&source_path)?.permissions())?;
        }
    }
    Ok(())
}

fn recreate_dir(directory: &Path) -> io::Result<()> {
    if directory.exists() {
        fs::remove_dir_all(directory)?;
    }
    fs::create_dir_all(directory)
}

fn atomic_replace_dir(staging: &Path, destination: &Path) -> io::Result<()> {
    let parent = destination
        .parent()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "skill has no parent"))?;
    if staging.parent() != Some(parent) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "skill staging path escapes skills directory",
        ));
    }
    fs::create_dir_all(parent)?;
    let backup = staging_dir(destination, "backup");
    let had_destination = destination.exists();
    if had_destination {
        fs::rename(destination, &backup)?;
    }
    if let Err(error) = fs::rename(staging, destination) {
        if had_destination {
            let _ = fs::rename(&backup, destination);
        }
        let _ = fs::remove_dir_all(staging);
        return Err(error);
    }
    if had_destination {
        let _ = fs::remove_dir_all(backup);
    }
    Ok(())
}

fn staging_dir(destination: &Path, label: &str) -> PathBuf {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    let name = destination
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("skill");
    destination.with_file_name(format!(".{name}-{label}-{nonce}"))
}

fn skills_dir(backend: &str) -> io::Result<PathBuf> {
    let home = std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "home directory not found"))?;
    Ok(skills_dir_for_home(Path::new(&home), backend))
}

fn skills_dir_for_home(home: &Path, backend: &str) -> PathBuf {
    if backend == "claude" {
        home.join(".claude").join("skills")
    } else {
        home.join(".jucode").join("skills")
    }
}

fn installed_at(skills_dir: &Path, id: &str) -> bool {
    validated_skill_id(id)
        .map(|id| skills_dir.join(id).join("SKILL.md").is_file())
        .unwrap_or(false)
}

fn validated_skill_id(id: &str) -> Result<&str, String> {
    let id = id.trim();
    if id.is_empty()
        || id.len() > 128
        || !id
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
        || id.starts_with('-')
        || id.ends_with('-')
    {
        return Err(format!("invalid skill id: {id}"));
    }
    Ok(id)
}

fn normalized_content(skill: &JucodeSkill) -> String {
    let content = skill.content.trim_end();
    if content.starts_with("---") {
        format!("{content}\n")
    } else {
        format!(
            "---\nname: {}\ndescription: {}\n---\n\n{content}\n",
            skill.name, skill.description
        )
    }
}

fn infer_package_type(url: &str) -> &str {
    let lowercase = url.to_ascii_lowercase();
    if lowercase.ends_with(".tar.gz") || lowercase.ends_with(".tgz") {
        "tar.gz"
    } else {
        "zip"
    }
}

fn encode_url_path(path: &str) -> String {
    let mut output = String::with_capacity(path.len());
    for byte in path.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~' | b'/') {
            output.push(byte as char);
        } else {
            output.push_str(&format!("%{byte:02X}"));
        }
    }
    output
}

#[cfg(unix)]
fn apply_download_permissions(path: &Path, executable: bool) -> io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(
        path,
        fs::Permissions::from_mode(if executable { 0o755 } else { 0o644 }),
    )
}

#[cfg(not(unix))]
fn apply_download_permissions(_path: &Path, _executable: bool) -> io::Result<()> {
    Ok(())
}

#[cfg(unix)]
fn apply_zip_permissions(mode: Option<u32>, path: &Path) -> io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    if let Some(mode) = mode {
        fs::set_permissions(path, fs::Permissions::from_mode(mode))?;
    }
    Ok(())
}

#[cfg(not(unix))]
fn apply_zip_permissions(_mode: Option<u32>, _path: &Path) -> io::Result<()> {
    Ok(())
}

fn zip_error(error: zip::result::ZipError) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_vendored_anthropic_index() {
        let index = parse_anthropic_index(ANTHROPIC_INDEX).unwrap();
        assert_eq!(index.repository, "https://github.com/anthropics/skills");
        assert!(index
            .skills
            .iter()
            .any(|skill| skill.id == "frontend-design"));
        let restricted = index
            .skills
            .iter()
            .filter(|skill| !skill.redistributable)
            .map(|skill| skill.id.as_str())
            .collect::<Vec<_>>();
        assert_eq!(restricted, ["docx", "pdf", "pptx", "xlsx"]);
    }

    #[test]
    fn backend_selects_confined_personal_install_path() {
        let home = Path::new("/home/tester");
        assert_eq!(
            skills_dir_for_home(home, "jucode").join("review"),
            Path::new("/home/tester/.jucode/skills/review")
        );
        assert_eq!(
            skills_dir_for_home(home, "claude").join("review"),
            Path::new("/home/tester/.claude/skills/review")
        );
        assert!(validated_skill_id("../escape").is_err());
        assert!(validated_skill_id("nested/escape").is_err());
    }

    #[test]
    fn github_tree_paths_cannot_escape_selected_skill() {
        assert_eq!(
            anthropic_relative_path("skills/frontend-design/SKILL.md", "frontend-design").unwrap(),
            Some(PathBuf::from("SKILL.md"))
        );
        assert_eq!(
            anthropic_relative_path("skills/pdf/SKILL.md", "frontend-design").unwrap(),
            None
        );
        assert!(
            anthropic_relative_path("skills/frontend-design/../../escape", "frontend-design")
                .is_err()
        );
        assert!(anthropic_relative_path("/tmp/escape", "frontend-design").is_err());
    }

    #[test]
    fn catalog_combines_sources_and_marks_target_install() {
        let root = test_dir("jucode-desktop-skill-catalog");
        let skills = skills_dir_for_home(&root, "claude");
        fs::create_dir_all(skills.join("frontend-design")).unwrap();
        fs::write(
            skills.join("frontend-design/SKILL.md"),
            "---\nname: frontend-design\ndescription: test\n---\n",
        )
        .unwrap();
        let jucode = json!({
            "skills": [{
                "id": "review",
                "name": "Review",
                "description": "Review code",
                "content": "Review carefully.",
                "tags": ["code"]
            }],
            "default_skill_ids": ["review"]
        });
        let index = parse_anthropic_index(ANTHROPIC_INDEX).unwrap();
        let (market, defaults) = parse_jucode_marketplace(&jucode).unwrap();
        assert_eq!(market.len(), 1);
        assert_eq!(defaults, ["review"]);
        assert!(installed_at(&skills, &index.skills[8].id));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn package_download_has_a_hard_size_limit() {
        let error = read_bounded(
            Cursor::new(vec![0_u8; MAX_PACKAGE_BYTES + 1]),
            MAX_PACKAGE_BYTES,
        )
        .unwrap_err();
        assert!(error.to_string().contains("byte limit"));
    }

    fn test_dir(prefix: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "{prefix}-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }
}
