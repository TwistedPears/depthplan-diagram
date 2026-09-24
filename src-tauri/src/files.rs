use crate::validation;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    fs,
    io::Write,
    path::{Path, PathBuf},
};
use uuid::Uuid;
pub type Result<T> = std::result::Result<T, String>;
pub const SOURCE_CHANGED: &str = "The source file changed before it could be replaced.";
/// Desktop launchers may pass a path or a percent-encoded file URL.
pub fn open_path(argument: &std::ffi::OsStr, cwd: &Path) -> Option<PathBuf> {
    let path = Path::new(argument);
    if path.is_absolute() {
        Some(path.into())
    } else if let Ok(url) = tauri::Url::parse(&argument.to_string_lossy()) {
        url.to_file_path().ok()
    } else {
        Some(cwd.join(path))
    }
}
/// A Save As suggestion only: ordinary Save always uses its recorded source path.
pub fn document_name(path: &Path) -> String {
    let name = path.file_name().unwrap_or_default().to_string_lossy();
    let lower = name.to_ascii_lowercase();
    let stem = if lower.ends_with(".depthplan.json") {
        &name[..name.len() - ".depthplan.json".len()]
    } else if lower.ends_with(".depthplan") {
        &name[..name.len() - ".depthplan".len()]
    } else if lower.ends_with(".json") {
        &name[..name.len() - ".json".len()]
    } else {
        &name
    };
    format!(
        "{}.depthplan",
        if stem.is_empty() { "untitled" } else { stem }
    )
}
pub fn now() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}
pub fn fingerprint(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
pub fn hash(path: &Path) -> Result<Option<String>> {
    match fs::read(path) {
        Ok(bytes) => Ok(Some(fingerprint(&bytes))),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}
pub fn write_atomic(
    path: &Path,
    data: &[u8],
    expected: Option<Option<&str>>,
    before: &dyn Fn() -> Result<()>,
) -> Result<()> {
    let temporary = PathBuf::from(format!("{}.{}.tmp", path.display(), Uuid::new_v4()));
    let result = (|| {
        before()?;
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .map_err(|e| e.to_string())?;
        file.write_all(data).map_err(|e| e.to_string())?;
        if let Some(expected) = expected {
            if hash(path)?.as_deref() != expected {
                return Err(SOURCE_CHANGED.into());
            }
        }
        before()?;
        fs::rename(&temporary, path).map_err(|e| e.to_string())
    })();
    match fs::remove_file(&temporary) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(e.to_string()),
    }
    result
}
#[derive(Clone, Serialize, Deserialize)]
pub struct Source {
    pub id: String,
    pub path: String,
    pub fingerprint: Option<String>,
}
#[derive(Default)]
pub struct FileStore {
    records: HashMap<String, Source>,
    pub recovered: HashSet<String>,
}
impl FileStore {
    pub fn remember(&mut self, path: String, fingerprint: Option<String>) -> Source {
        let source = Source {
            id: Uuid::new_v4().to_string(),
            path,
            fingerprint,
        };
        self.records.insert(source.id.clone(), source.clone());
        source
    }
    pub fn record(&self, id: &str) -> Result<Source> {
        self.records
            .get(id)
            .cloned()
            .ok_or("File must be selected through a native dialog".into())
    }
    pub fn read(&mut self, path: &Path) -> Result<Value> {
        let bytes = fs::read(path).map_err(|e| e.to_string())?;
        let document: Value = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
        validation::document(&document)?;
        let source = self.remember(
            path.to_string_lossy().into_owned(),
            Some(fingerprint(&bytes)),
        );
        Ok(json!({"document":document,"source":source}))
    }
    pub fn save(
        &mut self,
        path: &Path,
        document: &Value,
        expected: Option<&str>,
        before: &dyn Fn() -> Result<()>,
    ) -> Result<Source> {
        validation::document(document)?;
        let mut document = document.clone();
        document["metadata"]["modified"] = now().into();
        let bytes = serde_json::to_vec_pretty(&document).map_err(|e| e.to_string())?;
        write_atomic(path, &bytes, Some(expected), before)?;
        Ok(self.remember(
            path.to_string_lossy().into_owned(),
            Some(fingerprint(&bytes)),
        ))
    }
    pub fn recover(&mut self, value: &Value) -> Result<Option<Source>> {
        if value.is_null() {
            return Ok(None);
        }
        let path = value["path"].as_str().ok_or("Invalid recovery source")?;
        let source = self.remember(
            path.into(),
            value["fingerprint"].as_str().map(str::to_string),
        );
        self.recovered.insert(source.id.clone());
        Ok(Some(source))
    }
    pub fn clear(&mut self) {
        self.records.clear();
        self.recovered.clear();
    }
}
pub fn export_name(name: &str, extension: &str) -> Result<()> {
    if name.is_empty()
        || name.contains(['\\', '/', ':', '\0'])
        || !name.to_lowercase().ends_with(&format!(".{extension}"))
    {
        return Err("Invalid export filename".into());
    }
    Ok(())
}
pub fn image_bytes(format: &str, value: &Value) -> Result<Vec<u8>> {
    match format {
        "svg" => {
            let text = value.as_str().ok_or("Invalid SVG export")?;
            let trimmed = text.trim_start();
            if !trimmed.starts_with("<svg")
                || trimmed
                    .as_bytes()
                    .get(4)
                    .is_some_and(|b| b.is_ascii_alphanumeric() || *b == b'_')
            {
                return Err("Invalid SVG export".into());
            }
            Ok(text.as_bytes().to_vec())
        }
        "png" => {
            let data: Vec<u8> =
                serde_json::from_value(value.clone()).map_err(|_| "Invalid PNG export")?;
            validate_png(&data)?;
            Ok(data)
        }
        _ => Err("Invalid image format".into()),
    }
}
pub fn validate_png(data: &[u8]) -> Result<()> {
    if data.len() < 24 || !data.starts_with(&[137, 80, 78, 71, 13, 10, 26, 10]) {
        return Err("Invalid PNG export".into());
    }
    Ok(())
}
#[cfg(test)]
pub fn fixture() -> Value {
    serde_json::from_str::<Vec<Value>>(include_str!("../generated/document-cases.json")).unwrap()[0]
        ["document"]
        .clone()
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn desktop_open_accepts_paths_and_file_urls_but_not_remote_urls() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("旧 diagram.depthplan");
        assert_eq!(open_path(path.as_os_str(), dir.path()), Some(path.clone()));
        assert_eq!(
            open_path(std::ffi::OsStr::new("旧 diagram.depthplan"), dir.path()),
            Some(path.clone())
        );
        let url = tauri::Url::from_file_path(&path).unwrap();
        assert_eq!(
            open_path(std::ffi::OsStr::new(url.as_str()), dir.path()),
            Some(path)
        );
        assert_eq!(
            open_path(
                std::ffi::OsStr::new("https://example.com/diagram.depthplan"),
                dir.path()
            ),
            None
        );
    }
    #[test]
    fn save_as_suggests_native_names_without_stacking_extensions() {
        for (old, new) in [
            ("Architecture.depthplan.json", "Architecture.depthplan"),
            ("Architecture.depthplan", "Architecture.depthplan"),
            ("Architecture.DEPTHPLAN.JSON", "Architecture.depthplan"),
            ("旧 diagram.json", "旧 diagram.depthplan"),
            ("Architecture.v2", "Architecture.v2.depthplan"),
            ("", "untitled.depthplan"),
        ] {
            assert_eq!(document_name(Path::new(old)), new);
        }
    }

    #[test]
    fn legacy_save_retains_its_path_and_save_as_leaves_the_original_intact() {
        let dir = tempfile::tempdir().unwrap();
        let old = dir.path().join("旧 diagram.depthplan.json");
        let new = dir.path().join(document_name(&old));
        let mut store = FileStore::default();
        store.save(&old, &fixture(), None, &|| Ok(())).unwrap();
        let opened = store.read(&old).unwrap();
        let source: Source = serde_json::from_value(opened["source"].clone()).unwrap();
        let mut edited = opened["document"].clone();
        edited["metadata"]["title"] = "Edited legacy file".into();
        store
            .save(
                Path::new(&source.path),
                &edited,
                source.fingerprint.as_deref(),
                &|| Ok(()),
            )
            .unwrap();
        assert!(!new.exists());
        let original = fs::read(&old).unwrap();
        store.save(&new, &edited, None, &|| Ok(())).unwrap();
        assert_eq!(fs::read(&old).unwrap(), original);
        let mut reopened = store.read(&new).unwrap()["document"].clone();
        reopened["metadata"]["modified"] = edited["metadata"]["modified"].clone();
        assert_eq!(reopened, edited);
    }
    #[test]
    fn round_trip_preserves_documents_and_rejects_invalid_replacement() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("document.json");
        let mut store = FileStore::default();
        let cases: Vec<Value> =
            serde_json::from_str(include_str!("../generated/document-cases.json")).unwrap();
        for case in cases.iter().filter(|c| c["valid"] == true) {
            let expected = hash(&path).unwrap();
            let source = store
                .save(&path, &case["document"], expected.as_deref(), &|| Ok(()))
                .unwrap();
            let reopened = store.read(&path).unwrap();
            let mut saved = reopened["document"].clone();
            saved["metadata"] = case["document"]["metadata"].clone();
            assert_eq!(saved, case["document"], "{}", case["name"]);
            assert_eq!(source.fingerprint, hash(&path).unwrap());
        }
        let bytes = fs::read(&path).unwrap();
        assert!(store
            .save(&path, &json!({"blocks":[]}), None, &|| Ok(()))
            .is_err());
        assert_eq!(fs::read(&path).unwrap(), bytes);
        assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 1);
    }
    #[test]
    fn rejects_unsupported_documents_without_registering_or_rewriting_them() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("unsupported.depthplan");
        let mut candidates = Vec::new();
        let mut unversioned = fixture();
        unversioned.as_object_mut().unwrap().remove("formatVersion");
        candidates.push(unversioned);
        for version in [1, 3] {
            let mut document = fixture();
            document["formatVersion"] = json!(version);
            candidates.push(document);
        }
        for language in ["js", "custom-language"] {
            let mut document = fixture();
            document["objects"]["app"]["content"] =
                json!([{"type":"code","text":"keep exactly","language":language}]);
            candidates.push(document);
        }
        for document in candidates {
            let bytes = serde_json::to_vec(&document).unwrap();
            fs::write(&path, &bytes).unwrap();
            let mut store = FileStore::default();
            assert!(store.read(&path).is_err());
            assert!(store.records.is_empty());
            assert!(store
                .save(
                    &path,
                    &document,
                    hash(&path).unwrap().as_deref(),
                    &|| Ok(())
                )
                .is_err());
            assert_eq!(fs::read(&path).unwrap(), bytes);
        }
    }
    #[test]
    fn conflict_and_revocation_preserve_the_destination() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("document.json");
        fs::write(&path, "original").unwrap();
        assert_eq!(
            write_atomic(&path, b"replacement", Some(None), &|| Ok(())).unwrap_err(),
            SOURCE_CHANGED
        );
        let calls = std::cell::Cell::new(0);
        assert!(write_atomic(&path, b"replacement", None, &|| {
            calls.set(calls.get() + 1);
            if calls.get() == 2 {
                Err("revoked".into())
            } else {
                Ok(())
            }
        })
        .is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), "original");
        assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 1);
        let observed = hash(&path).unwrap();
        let calls = std::cell::Cell::new(0);
        assert!(
            write_atomic(&path, b"replacement", Some(observed.as_deref()), &|| {
                calls.set(calls.get() + 1);
                if calls.get() == 1 {
                    fs::write(&path, "external").unwrap();
                }
                Ok(())
            })
            .is_err()
        );
        assert_eq!(fs::read_to_string(&path).unwrap(), "external");
    }
    #[test]
    fn invalid_paths_and_images() {
        for name in [
            "../outside.svg",
            "..\\outside.svg",
            "/tmp/outside.svg",
            "C:outside.svg",
            "wrong.json",
            "bad\0.svg",
        ] {
            assert!(export_name(name, "svg").is_err(), "{name}");
        }
        assert!(image_bytes("png", &json!([1, 2, 3])).is_err());
        assert!(image_bytes("svg", &json!("<svgscript>")).is_err());
        assert!(image_bytes("svg", &json!("<svg/>")).is_ok());
    }
}
