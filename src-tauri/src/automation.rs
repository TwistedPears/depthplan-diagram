use crate::{files::Result, private};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    sync::oneshot,
};
use uuid::Uuid;
pub fn failure(code: &str, message: &str) -> Value {
    json!({"ok":false,"state":null,"error":{"code":code,"message":message,"retryable":matches!(code,"APP_UNAVAILABLE"|"BUSY")}})
}
pub fn unavailable() -> Value {
    failure("APP_UNAVAILABLE","The app is unavailable. Query current state before retrying an interrupted command with the same request ID.")
}
pub struct Service {
    pub instance: String,
    pub generation: u64,
    pub token: Option<String>,
    directory: Option<tempfile::TempDir>,
    transport: Option<tauri::async_runtime::JoinHandle<()>>,
    pub pending: HashMap<String, oneshot::Sender<Value>>,
    leases: HashSet<String>,
    schemas: HashMap<String, (jsonschema::Validator, jsonschema::Validator)>,
}
impl Service {
    pub fn new(instance: String) -> Result<Self> {
        let tools: Vec<Value> = serde_json::from_str(include_str!("../generated/mcp-tools.json"))
            .map_err(|e| e.to_string())?;
        let mut schemas = HashMap::new();
        for t in tools {
            schemas.insert(
                t["name"].as_str().ok_or("Missing tool name")?.into(),
                (
                    jsonschema::validator_for(&t["inputSchema"]).map_err(|e| e.to_string())?,
                    jsonschema::validator_for(&t["outputSchema"]).map_err(|e| e.to_string())?,
                ),
            );
        }
        Ok(Self {
            instance,
            generation: 0,
            token: None,
            directory: None,
            transport: None,
            pending: HashMap::new(),
            leases: HashSet::new(),
            schemas,
        })
    }
    pub fn descriptor(&self) -> PathBuf {
        self.directory
            .as_ref()
            .map(|d| d.path().join("connection.json"))
            .unwrap_or_default()
    }
    fn endpoint(&self) -> PathBuf {
        #[cfg(unix)]
        {
            self.directory
                .as_ref()
                .expect("automation directory")
                .path()
                .join("ipc")
        }
        #[cfg(windows)]
        {
            PathBuf::from(format!("\\\\.\\pipe\\depthplan-{}", self.instance))
        }
    }
    fn publish(&self) -> Result<()> {
        if self.directory.is_none() {
            return Ok(());
        }
        let value = json!({"version":1,"appInstanceId":self.instance,"enabled":self.token.is_some(),"endpoint":self.endpoint(),"token":self.token});
        let temporary = self.descriptor().with_extension("tmp");
        std::fs::write(
            &temporary,
            serde_json::to_vec(&value).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        private::path(&temporary, true, false)?;
        std::fs::rename(temporary, self.descriptor()).map_err(|e| e.to_string())
    }
    pub fn disable(&mut self) -> Result<()> {
        self.token = None;
        self.generation += 1;
        self.leases.clear();
        if let Some(task) = self.transport.take() {
            task.abort();
        }
        for (_, sender) in self.pending.drain() {
            let _ = sender.send(failure("DISABLED", "Automation is disabled."));
        }
        #[cfg(unix)]
        if self.directory.is_some() {
            let _ = std::fs::remove_file(self.endpoint());
        }
        self.publish()
    }
    pub fn shutdown(&mut self) -> Result<()> {
        let disabled = self.disable();
        if let Some(directory) = self.directory.take() {
            directory.close().map_err(|e| e.to_string())?;
        }
        disabled
    }
    pub fn enable(&mut self, app: AppHandle) -> Result<()> {
        if self.token.is_some() {
            return Ok(());
        }
        if self.directory.is_none() {
            #[cfg(unix)]
            let root = Path::new("/tmp");
            #[cfg(windows)]
            let root = std::env::temp_dir();
            let directory = tempfile::Builder::new()
                .prefix("dp-")
                .tempdir_in(root)
                .map_err(|e| e.to_string())?;
            private::path(directory.path(), true, true)?;
            self.directory = Some(directory);
        }
        self.generation += 1;
        let generation = self.generation;
        #[cfg(unix)]
        {
            let endpoint = self.endpoint();
            if endpoint.as_os_str().len() > 103 {
                return Err("Local endpoint path is too long".into());
            }
            let listener =
                std::os::unix::net::UnixListener::bind(&endpoint).map_err(|e| e.to_string())?;
            private::path(&endpoint, true, false)?;
            listener.set_nonblocking(true).map_err(|e| e.to_string())?;
            self.transport = Some(tauri::async_runtime::spawn(async move {
                let Ok(listener) = tokio::net::UnixListener::from_std(listener) else {
                    return;
                };
                let slots = Arc::new(tokio::sync::Semaphore::new(32));
                loop {
                    let Ok((socket, _)) = listener.accept().await else {
                        break;
                    };
                    let Ok(permit) = slots.clone().try_acquire_owned() else {
                        continue;
                    };
                    let app = app.clone();
                    tauri::async_runtime::spawn(async move {
                        let _permit = permit;
                        let _ = tokio::time::timeout(
                            Duration::from_secs(5),
                            serve_socket(socket, app, generation),
                        )
                        .await;
                    });
                }
            }));
        }
        #[cfg(windows)]
        {
            use base64::Engine;
            use tokio::io::{AsyncBufReadExt, BufReader};
            let pipe = format!("depthplan-{}", self.instance);
            let mut command = tokio::process::Command::from(private::powershell(
                "serve",
                std::ffi::OsStr::new(&pipe),
            ));
            command
                .stdin(std::process::Stdio::piped())
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::null())
                .kill_on_drop(true);
            let mut child = command.spawn().map_err(|e| e.to_string())?;
            let input = child.stdin.take().ok_or("Pipe stdin unavailable")?;
            let output = child.stdout.take().ok_or("Pipe stdout unavailable")?;
            let (ready, started) = std::sync::mpsc::sync_channel(1);
            self.transport = Some(tauri::async_runtime::spawn(async move {
                let input = Arc::new(tokio::sync::Mutex::new(input));
                let mut lines = BufReader::new(output).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    if line == "READY" {
                        let _ = ready.send(());
                        continue;
                    }
                    let Some((id, data)) = line.split_once('\t') else {
                        continue;
                    };
                    if id.len() != 32
                        || !id.bytes().all(|b| b.is_ascii_hexdigit())
                        || data.len() > 87384
                    {
                        continue;
                    }
                    let Ok(data) = base64::engine::general_purpose::STANDARD.decode(data) else {
                        continue;
                    };
                    let id = id.to_owned();
                    let app = app.clone();
                    let input = input.clone();
                    tauri::async_runtime::spawn(async move {
                        let response = answer(app, generation, &data).await;
                        let encoded = base64::engine::general_purpose::STANDARD
                            .encode(serde_json::to_vec(&response).unwrap_or_default());
                        let _ = input
                            .lock()
                            .await
                            .write_all(format!("{id}\t{encoded}\n").as_bytes())
                            .await;
                    });
                }
                let _ = child.kill().await;
                {
                    let state = app.state::<crate::host::Host>();
                    let mut service = state.service.lock().unwrap();
                    if service.generation == generation {
                        let _ = service.disable();
                    }
                }
            }));
            if started.recv_timeout(Duration::from_secs(5)).is_err() {
                let _ = self.disable();
                return Err("Private Windows pipe could not start".into());
            }
        }
        // Two independent UUIDs provide 244 random bits without another RNG dependency.
        self.token = Some(format!(
            "{}{}",
            Uuid::new_v4().simple(),
            Uuid::new_v4().simple()
        ));
        if let Err(error) = self.publish() {
            let _ = self.disable();
            return Err(error);
        }
        Ok(())
    }
    pub fn lease(&mut self) -> Result<Value> {
        if self.token.is_none() {
            return Err("MCP access was revoked".into());
        }
        if self.leases.len() >= 64 {
            return Err("Too many active file operations".into());
        }
        let id = Uuid::new_v4().to_string();
        self.leases.insert(id.clone());
        Ok(json!({"id":id,"generation":self.generation}))
    }
    pub fn check(&self, lease: &Value) -> Result<()> {
        if self.token.is_none()
            || lease["generation"] != self.generation
            || lease["id"]
                .as_str()
                .is_none_or(|s| !self.leases.contains(s))
        {
            return Err("MCP access was revoked".into());
        }
        Ok(())
    }
    pub fn release(&mut self, lease: &Value) {
        if let Some(id) = lease["id"].as_str() {
            self.leases.remove(id);
        }
    }
}
async fn serve_socket<S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin>(
    mut socket: S,
    app: AppHandle,
    generation: u64,
) -> Result<()> {
    let mut bytes = Vec::new();
    loop {
        let b = socket.read_u8().await.map_err(|e| e.to_string())?;
        if b == b'\n' {
            break;
        }
        if bytes.len() >= 65535 {
            return Err("Request too large".into());
        }
        bytes.push(b);
    }
    let response = answer(app, generation, &bytes).await;
    socket
        .write_all(&serde_json::to_vec(&response).map_err(|e| e.to_string())?)
        .await
        .map_err(|e| e.to_string())?;
    socket.shutdown().await.map_err(|e| e.to_string())
}
async fn answer(app: AppHandle, generation: u64, bytes: &[u8]) -> Value {
    let Ok(request) = serde_json::from_slice::<Value>(bytes) else {
        return failure("INVALID_REQUEST", "Malformed local request.");
    };
    let state = app.state::<crate::host::Host>();
    let id = Uuid::new_v4().to_string();
    let tool = request["tool"].as_str().unwrap_or("").to_owned();
    let receiver = {
        let mut service = state.service.lock().unwrap();
        if generation != service.generation || service.token.is_none() {
            return failure("DISABLED", "Automation is disabled.");
        }
        if request.as_object().is_none_or(|o| o.len() != 4)
            || request["token"].as_str().is_none_or(|s| s.len() != 64)
        {
            return failure("INVALID_REQUEST", "Invalid local request.");
        }
        let token = request["token"].as_str().unwrap();
        let expected = service.token.as_ref().unwrap();
        let diff = token
            .bytes()
            .zip(expected.bytes())
            .fold(0u8, |diff, (a, b)| diff | (a ^ b));
        if diff != 0 {
            return failure("DISABLED", "Local authorization failed.");
        }
        if request["appInstanceId"] != service.instance {
            return failure("STALE_APP", "The app instance has changed.");
        }
        if service
            .schemas
            .get(&tool)
            .is_none_or(|(input, _)| !input.is_valid(&request["input"]))
        {
            return failure("INVALID_REQUEST", "Invalid tool input.");
        }
        let (sender, receiver) = oneshot::channel();
        service.pending.insert(id.clone(), sender);
        receiver
    };
    if app
        .emit_to(
            "main",
            "automation:request",
            json!({"id":id,"generation":generation,"tool":tool,"input":request["input"]}),
        )
        .is_err()
    {
        state.service.lock().unwrap().pending.remove(&id);
        return unavailable();
    }
    let result = tokio::time::timeout(Duration::from_secs(5), receiver).await;
    let mut service = state.service.lock().unwrap();
    service.pending.remove(&id);
    if generation != service.generation {
        return failure("DISABLED", "Automation is disabled.");
    }
    let Ok(Ok(value)) = result else {
        return unavailable();
    };
    if !service.schemas[&tool].1.is_valid(&value) {
        return failure("INTERNAL_ERROR", "Invalid application response.");
    }
    if serde_json::to_vec(&value).map_or(true, |b| b.len() > 1024 * 1024) {
        return failure("RESPONSE_TOO_LARGE", "Response exceeds the size limit.");
    }
    value
}
struct Grant {
    path: PathBuf,
    identity: same_file::Handle,
}
#[derive(Default)]
pub struct Folders(Mutex<HashMap<String, Grant>>);
fn identity(path: &Path) -> Result<same_file::Handle> {
    if !path.is_dir() {
        return Err("Choose a folder".into());
    }
    same_file::Handle::from_path(path).map_err(|e| e.to_string())
}

impl Folders {
    pub fn list(&self) -> Value {
        Value::Array(
            self.0
                .lock()
                .unwrap()
                .iter()
                .map(|(id, g)| json!({"id":id,"path":g.path}))
                .collect(),
        )
    }
    pub fn add(&self, path: &Path) -> Result<()> {
        let path = std::fs::canonicalize(path).map_err(|e| e.to_string())?;
        let identity = identity(&path)?;
        let mut grants = self.0.lock().unwrap();
        if !grants.values().any(|g| g.path == path) {
            grants.insert(Uuid::new_v4().to_string(), Grant { path, identity });
        }
        Ok(())
    }
    pub fn revoke(&self, id: &str) {
        self.0.lock().unwrap().remove(id);
    }
    pub fn resolve(&self, target: &str) -> Result<PathBuf> {
        let path = Path::new(target);
        if !path.is_absolute() || target.len() > 4096 || target.contains('\0') {
            return Err("Use an absolute path inside an approved folder".into());
        }
        let parent = std::fs::canonicalize(path.parent().ok_or("Invalid path")?)
            .map_err(|e| e.to_string())?;
        let resolved = parent.join(path.file_name().ok_or("Invalid path")?);
        let grants = self.0.lock().unwrap();
        let grant = grants
            .values()
            .find(|g| resolved != g.path && resolved.starts_with(&g.path))
            .ok_or(
                "Path is outside approved folders. Approve its folder in the MCP Server controls.",
            )?;
        if identity(&grant.path)? != grant.identity
            || std::fs::canonicalize(&grant.path).map_err(|e| e.to_string())? != grant.path
        {
            return Err("Approved folder changed; revoke it and approve the current folder".into());
        }
        match std::fs::symlink_metadata(&resolved) {
            Ok(info) if !info.is_file() || info.file_type().is_symlink() => {
                return Err("Target must be a regular file, not a symlink or directory".into())
            }
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => return Err(e.to_string()),
            _ => {}
        }
        Ok(resolved)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn shutdown_removes_descriptor_after_disable() {
        let mut service = Service::new(Uuid::new_v4().to_string()).unwrap();
        service.directory = Some(tempfile::tempdir().unwrap());
        service.token = Some("a".repeat(64));
        service.publish().unwrap();
        let descriptor = service.descriptor();
        service.disable().unwrap();
        assert!(descriptor.exists());
        service.shutdown().unwrap();
        assert!(!descriptor.parent().unwrap().exists());
        service.shutdown().unwrap();
    }
    #[test]
    fn native_grants_and_leases_fail_closed() {
        let root = tempfile::tempdir().unwrap();
        let folder = root.path().join("approved");
        std::fs::create_dir(&folder).unwrap();
        let target = folder.join("file.json");
        let folders = Folders::default();
        folders.add(&folder).unwrap();
        assert_eq!(
            folders.resolve(target.to_str().unwrap()).unwrap(),
            std::fs::canonicalize(&folder).unwrap().join("file.json")
        );
        assert!(folders
            .resolve(root.path().join("outside.json").to_str().unwrap())
            .is_err());
        assert!(folders
            .resolve(folder.join("../outside.json").to_str().unwrap())
            .is_err());
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(root.path().join("outside.json"), &target).unwrap();
            assert!(folders.resolve(target.to_str().unwrap()).is_err());
            std::fs::remove_file(&target).unwrap();
        }
        std::fs::rename(&folder, root.path().join("old")).unwrap();
        std::fs::create_dir(&folder).unwrap();
        assert!(folders.resolve(target.to_str().unwrap()).is_err());
        let mut service = Service::new(Uuid::new_v4().to_string()).unwrap();
        assert!(service.lease().is_err());
        service.token = Some("a".repeat(64));
        let lease = service.lease().unwrap();
        service.check(&lease).unwrap();
        assert!(service
            .check(&json!({"generation":0,"id":"forged"}))
            .is_err());
        service.disable().unwrap();
        assert!(service.check(&lease).is_err());
    }
}
