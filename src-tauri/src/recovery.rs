use crate::{
    files::{self, FileStore, Result},
    validation,
};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
};
use uuid::Uuid;
struct Session {
    covered: i64,
    revision: i64,
    closed: bool,
}
impl Default for Session {
    fn default() -> Self {
        Self {
            covered: -1,
            revision: -1,
            closed: false,
        }
    }
}
struct Entry {
    file: PathBuf,
    hash: String,
    original: Option<PathBuf>,
}
pub struct Recovery {
    root: PathBuf,
    directory: PathBuf,
    instance: String,
    entries: HashMap<String, Entry>,
    claims: HashSet<String>,
    adopted: HashMap<String, String>,
    sessions: HashMap<String, Session>,
}
fn identity(value: &Value) -> Result<&str> {
    let id = value.as_str().ok_or("Invalid recovery identity")?;
    if id.len() != 36 {
        return Err("Invalid recovery identity".into());
    }
    Uuid::parse_str(id).map_err(|_| "Invalid recovery identity")?;
    Ok(id)
}
fn revision(value: &Value) -> Result<u64> {
    value
        .as_f64()
        .filter(|n| n.fract() == 0.0 && (0.0..=9007199254740991.0).contains(n))
        .map(|n| n as u64)
        .ok_or("Invalid recovery revision".into())
}
fn checkpoint(v: &Value) -> Result<()> {
    if v["version"] != 1 {
        return Err("Unsupported recovery checkpoint".into());
    }
    identity(&v["instanceId"])?;
    identity(&v["sessionId"])?;
    revision(&v["revision"])?;
    validation::document(&v["document"])?;
    if v["documentId"] != v["document"]["id"]
        || v["capturedAt"]
            .as_str()
            .is_none_or(|s| chrono::DateTime::parse_from_rfc3339(s).is_err())
    {
        return Err("Invalid recovery metadata".into());
    }
    if v.get("source").is_none() {
        return Err("Invalid recovery source".into());
    }
    if !v["source"].is_null() {
        let source = &v["source"];
        let path = source["path"].as_str().ok_or("Invalid recovery source")?;
        if !Path::new(path).is_absolute()
            || path.contains('\0')
            || source.get("fingerprint").is_none()
            || (!source["fingerprint"].is_null()
                && source["fingerprint"].as_str().is_none_or(|s| {
                    s.len() != 64
                        || !s
                            .bytes()
                            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
                }))
        {
            return Err("Invalid recovery source".into());
        }
    }
    Ok(())
}
fn mkdir(path: &Path) -> Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        fs::DirBuilder::new()
            .recursive(true)
            .mode(0o700)
            .create(path)
            .map_err(|e| e.to_string())
    }
    #[cfg(not(unix))]
    {
        fs::create_dir_all(path).map_err(|e| e.to_string())
    }
}
fn remove(path: &Path) -> Result<()> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}
fn alive(pid: u32) -> bool {
    if pid == 0 || pid > i32::MAX as u32 {
        return true;
    }
    #[cfg(unix)]
    {
        let result = unsafe { libc::kill(pid as i32, 0) };
        result == 0 || std::io::Error::last_os_error().raw_os_error() != Some(libc::ESRCH)
    }
    #[cfg(windows)]
    {
        std::process::Command::new(
            PathBuf::from(std::env::var_os("SystemRoot").unwrap_or_else(|| "C:\\Windows".into()))
                .join("System32/tasklist.exe"),
        )
        .args(["/FI", &format!("PID eq {pid}"), "/NH", "/FO", "CSV"])
        .output()
        .map(|out| {
            !out.status.success()
                || String::from_utf8_lossy(&out.stdout).contains(&format!("\"{pid}\""))
        })
        .unwrap_or(true)
    }
}
impl Recovery {
    pub fn new(root: PathBuf, instance: String) -> Self {
        let directory = root.join(format!("{}-{instance}", std::process::id()));
        Self {
            root,
            directory,
            instance,
            entries: HashMap::new(),
            claims: HashSet::new(),
            adopted: HashMap::new(),
            sessions: HashMap::new(),
        }
    }
    pub fn write(&mut self, input: &Value, files: &FileStore) -> Result<()> {
        let session_id = identity(&input["sessionId"])?.to_owned();
        let rev = revision(&input["revision"])? as i64;
        validation::document(&input["document"])?;
        let source = if let Some(source_id) = input.get("sourceId") {
            let s = files.record(source_id.as_str().ok_or("Invalid source ID")?)?;
            json!({"path":s.path,"fingerprint":s.fingerprint})
        } else {
            Value::Null
        };
        let checkpoint_value = json!({"version":1,"instanceId":self.instance,"sessionId":session_id,"documentId":input["document"]["id"],"revision":rev,"capturedAt":files::now(),"source":source,"document":input["document"]});
        checkpoint(&checkpoint_value)?;
        let bytes = serde_json::to_vec(&checkpoint_value).map_err(|e| e.to_string())?;
        let session = self.sessions.entry(session_id.clone()).or_default();
        if session.closed || rev <= session.covered {
            return Ok(());
        }
        if rev <= session.revision {
            return self.retire(&session_id);
        }
        mkdir(&self.directory)?;
        files::write_atomic(
            &self.directory.join(format!("{session_id}.json")),
            &bytes,
            None,
            &|| Ok(()),
        )?;
        session.revision = rev;
        self.retire(&session_id)
    }
    pub fn remove(&mut self, id: &str, through: Option<u64>) -> Result<()> {
        if id.len() != 36 {
            return Err("Invalid recovery identity".into());
        }
        Uuid::parse_str(id).map_err(|_| "Invalid recovery identity")?;
        let state = self.sessions.entry(id.into()).or_default();
        let old = state.closed;
        if let Some(through) = through {
            if through > 9007199254740991 {
                return Err("Invalid recovery revision".into());
            }
            state.covered = state.covered.max(through as i64);
        } else {
            state.closed = true;
        }
        let closed = state.closed;
        if closed || state.revision <= state.covered {
            if let Err(e) = remove(&self.directory.join(format!("{id}.json"))) {
                state.closed = old;
                return Err(e);
            }
        }
        if closed {
            self.retire(id)?;
        }
        Ok(())
    }
    fn retire(&mut self, session_id: &str) -> Result<()> {
        if let Some(id) = self.adopted.get(session_id).cloned() {
            self.discard(&id)?;
            self.adopted.remove(session_id);
        }
        Ok(())
    }
    pub fn discover(&mut self) -> Result<Value> {
        mkdir(&self.root)?;
        let mut entries = Vec::new();
        let mut warnings = Vec::new();
        for dir in fs::read_dir(&self.root).map_err(|e| e.to_string())? {
            let dir = dir.map_err(|e| e.to_string())?;
            if !dir.file_type().map_err(|e| e.to_string())?.is_dir() {
                continue;
            }
            let name = dir.file_name().to_string_lossy().into_owned();
            let Some((pid, instance)) = name.split_once('-') else {
                continue;
            };
            let Ok(pid) = pid.parse::<u32>() else {
                continue;
            };
            if Uuid::parse_str(instance).is_err() || alive(pid) {
                continue;
            }
            let mut paths = Vec::new();
            for (folder, pending) in [(dir.path(), false), (dir.path().join("pending"), true)] {
                let children = match fs::read_dir(folder) {
                    Ok(c) => c,
                    Err(e) if pending && e.kind() == std::io::ErrorKind::NotFound => continue,
                    Err(e) => return Err(e.to_string()),
                };
                for child in children {
                    let child = child.map_err(|e| e.to_string())?;
                    if child.file_type().map_err(|e| e.to_string())?.is_file()
                        && child.path().extension().is_some_and(|x| x == "json")
                    {
                        paths.push((child.path(), pending));
                    }
                }
            }
            for (path, pending) in paths {
                let bytes = match fs::read(&path) {
                    Ok(bytes) => bytes,
                    Err(e) if e.kind() == std::io::ErrorKind::NotFound => continue,
                    Err(e) => return Err(e.to_string()),
                };
                let parsed: Result<Value> = (|| {
                    let value: Value = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
                    checkpoint(&value)?;
                    if !pending
                        && (value["instanceId"] != instance
                            || path.file_name().and_then(|s| s.to_str())
                                != Some(&format!(
                                    "{}.json",
                                    value["sessionId"].as_str().ok_or("Invalid session")?
                                )))
                    {
                        return Err("Recovery identity does not match its storage location".into());
                    }
                    Ok(value)
                })();
                match parsed {
                    Ok(value) => {
                        let id = Uuid::new_v4().to_string();
                        self.entries.insert(
                            id.clone(),
                            Entry {
                                file: path,
                                hash: files::fingerprint(&bytes),
                                original: None,
                            },
                        );
                        entries.push(json!({"id":id,"title":value["document"]["metadata"]["title"],"sourcePath":value["source"]["path"],"capturedAt":value["capturedAt"],"sessionId":value["sessionId"],"instanceId":value["instanceId"],"revision":value["revision"]}));
                    }
                    Err(error) => {
                        let quarantine =
                            PathBuf::from(format!("{}.invalid-{}", path.display(), Uuid::new_v4()));
                        fs::rename(&path, &quarantine).map_err(|e| e.to_string())?;
                        warnings.push(format!("Recovery file quarantined at {}: {error}. Keep it for manual inspection.",quarantine.display()));
                    }
                }
            }
        }
        Ok(json!({"entries":entries,"warnings":warnings}))
    }
    fn claim(&mut self, id: &str) -> Result<()> {
        let entry = self
            .entries
            .get_mut(id)
            .ok_or("Recovery entry is no longer available. Refresh the recovery list.")?;
        if self.claims.contains(id) {
            return Ok(());
        }
        let pending = self.directory.join("pending");
        mkdir(&pending)?;
        let destination = pending.join(format!("{}.json", Uuid::new_v4()));
        fs::rename(&entry.file, &destination).map_err(|e| e.to_string())?;
        entry.original = Some(entry.file.clone());
        entry.file = destination;
        self.claims.insert(id.into());
        Ok(())
    }
    pub fn release(&mut self, id: &str) -> Result<()> {
        if !self.claims.contains(id) {
            return Ok(());
        }
        let entry = self
            .entries
            .get_mut(id)
            .ok_or("Recovery entry unavailable")?;
        let original = entry
            .original
            .as_ref()
            .ok_or("Recovery claim unavailable")?;
        fs::rename(&entry.file, original).map_err(|e| e.to_string())?;
        entry.file = original.clone();
        entry.original = None;
        self.claims.remove(id);
        self.adopted.retain(|_, entry_id| entry_id != id);
        Ok(())
    }
    pub fn prepare(&mut self, id: &str, files: &mut FileStore) -> Result<Value> {
        self.claim(id)?;
        let result = (|| {
            let entry = self.entries.get(id).ok_or("Recovery entry unavailable")?;
            let bytes = fs::read(&entry.file).map_err(|e| e.to_string())?;
            if files::fingerprint(&bytes) != entry.hash {
                return Err("Recovery file changed. Refresh the list.".into());
            }
            let value: Value = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
            checkpoint(&value)?;
            let session_id = Uuid::new_v4().to_string();
            let source = files.recover(&value["source"])?;
            self.adopted.insert(session_id.clone(), id.into());
            Ok(json!({"document":value["document"],"source":source,"sessionId":session_id}))
        })();
        if result.is_err() {
            self.release(id)?;
        }
        result
    }
    pub fn discard(&mut self, id: &str) -> Result<()> {
        self.claim(id)?;
        let entry = self.entries.get(id).ok_or("Recovery entry unavailable")?;
        remove(&entry.file)?;
        self.claims.remove(id);
        self.entries.remove(id);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn store(root: &Path, orphan: bool) -> Recovery {
        let mut store = Recovery::new(root.into(), Uuid::new_v4().to_string());
        if orphan {
            store.directory = root.join(format!("2147483647-{}", store.instance));
        }
        store
    }
    #[test]
    fn zero_revision_ordering_and_close_keep_the_last_checkpoint() {
        let root = tempfile::tempdir().unwrap();
        let files = FileStore::default();
        let mut recovery = store(root.path(), false);
        let session = Uuid::new_v4().to_string();
        let mut request = json!({"sessionId":session,"revision":0,"document":files::fixture()});
        let path = recovery.directory.join(format!("{session}.json"));
        recovery.write(&request, &files).unwrap();
        assert!(path.exists());
        request["revision"] = 2.into();
        recovery.write(&request, &files).unwrap();
        request["revision"] = 1.into();
        recovery.write(&request, &files).unwrap();
        recovery.remove(&session, Some(1)).unwrap();
        assert_eq!(
            serde_json::from_slice::<Value>(&fs::read(&path).unwrap()).unwrap()["revision"],
            2
        );
        recovery.remove(&session, None).unwrap();
        request["revision"] = 3.into();
        recovery.write(&request, &files).unwrap();
        assert!(!path.exists());
    }
    #[test]
    fn orphan_claims_are_exclusive_cancelable_and_retired_after_replacement() {
        let root = tempfile::tempdir().unwrap();
        let mut files = FileStore::default();
        let mut orphan = store(root.path(), true);
        let mut first = store(root.path(), false);
        let mut second = store(root.path(), false);
        let document = files::fixture();
        orphan
            .write(
                &json!({"sessionId":Uuid::new_v4().to_string(),"revision":9,"document":document}),
                &files,
            )
            .unwrap();
        fs::write(orphan.directory.join("broken.json"), "bad").unwrap();
        let found = first.discover().unwrap();
        assert_eq!(found["warnings"].as_array().unwrap().len(), 1);
        assert_eq!(first.discover().unwrap()["warnings"], json!([]));
        let other = second.discover().unwrap();
        let id = found["entries"][0]["id"].as_str().unwrap();
        let candidate = first.prepare(id, &mut files).unwrap();
        assert!(second
            .prepare(other["entries"][0]["id"].as_str().unwrap(), &mut files)
            .is_err());
        assert_eq!(second.discover().unwrap()["entries"], json!([]));
        first.release(id).unwrap();
        assert_eq!(
            second.discover().unwrap()["entries"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
        first.prepare(id, &mut files).unwrap();
        let adopted = first
            .adopted
            .iter()
            .find(|(_, entry)| *entry == id)
            .unwrap()
            .0
            .clone();
        first
            .write(
                &json!({"sessionId":adopted,"revision":0,"document":candidate["document"]}),
                &files,
            )
            .unwrap();
        assert!(first.directory.join(format!("{adopted}.json")).exists());
        assert_eq!(second.discover().unwrap()["entries"], json!([]));
    }
    #[test]
    fn changed_or_invalid_recovery_is_never_silently_adopted() {
        let root = tempfile::tempdir().unwrap();
        let mut files = FileStore::default();
        let mut orphan = store(root.path(), true);
        let mut current = store(root.path(), false);
        let session = Uuid::new_v4().to_string();
        orphan
            .write(
                &json!({"sessionId":session,"revision":1,"document":files::fixture()}),
                &files,
            )
            .unwrap();
        let found = current.discover().unwrap();
        let path = orphan.directory.join(format!("{session}.json"));
        fs::write(&path, "changed").unwrap();
        assert!(current
            .prepare(found["entries"][0]["id"].as_str().unwrap(), &mut files)
            .is_err());
        assert!(path.exists());
        assert_eq!(
            current.discover().unwrap()["warnings"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
        assert!(current
            .write(
                &json!({"sessionId":"../escape","revision":0,"document":files::fixture()}),
                &files
            )
            .is_err());
        assert!(current
            .write(
                &json!({"sessionId":session,"revision":-1,"document":files::fixture()}),
                &files
            )
            .is_err());
    }
}
