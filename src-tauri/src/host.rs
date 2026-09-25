use crate::png_export::PngExport;
use crate::{
    automation::{self, Folders, Service},
    files::{self, FileStore, Result, Source},
    recovery::Recovery,
    validation,
};
use base64::Engine;
use serde_json::{json, Value};
use std::borrow::Cow;
use std::{
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicUsize, Ordering},
        Mutex,
    },
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogResult};
use tauri_plugin_opener::OpenerExt;
use uuid::Uuid;
struct Storage {
    files: FileStore,
    recovery: Recovery,
}
#[derive(Default)]
struct Closing {
    allowed: bool,
    pending: Option<(String, bool)>,
    prompt: bool,
}
/// Only OS/launch-selected paths enter this list; renderer callers receive opaque IDs.
#[derive(Default)]
struct OpenRequests(Mutex<Vec<(String, PathBuf)>>);

fn open_paths(app: &AppHandle, paths: impl IntoIterator<Item = PathBuf>) {
    let requests = app.state::<OpenRequests>();
    let mut requests = requests.0.lock().unwrap();
    for path in paths {
        if !path.extension().is_some_and(|ext| {
            ext.eq_ignore_ascii_case("depthplan") || ext.eq_ignore_ascii_case("json")
        }) || requests.iter().any(|(_, pending)| pending == &path)
        {
            continue;
        }
        let id = Uuid::new_v4().to_string();
        requests.push((id.clone(), path));
        let _ = app.emit_to("main", "file:open-request", id);
    }
    drop(requests);
    if app.get_webview_window("main").is_none() && app.try_state::<Host>().is_some() {
        if let Err(error) = create_window(app) {
            log::error!("Could not open editor: {error}");
        }
    }
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}
pub struct Host {
    dialogs: AtomicUsize,
    storage: Mutex<Storage>,
    pub service: Mutex<Service>,
    folders: Folders,
    closing: Mutex<Closing>,
    png: Mutex<Option<PngExport>>,
}
fn string(value: &Value) -> Result<&str> {
    value.as_str().ok_or("Expected text".into())
}
fn status(app: &AppHandle) -> Value {
    let host = app.state::<Host>();
    let service = host.service.lock().unwrap();
    let binary = std::env::current_exe()
        .unwrap_or_default()
        .with_file_name(if cfg!(windows) {
            "depthplan-mcp.exe"
        } else {
            "depthplan-mcp"
        });
    json!({"enabled":service.token.is_some(),"descriptor":service.descriptor(),"executable":binary,"folders":host.folders.list()})
}
fn announce(app: &AppHandle) {
    let host = app.state::<Host>();
    let service = host.service.lock().unwrap();
    let _ = app.emit_to(
        "main",
        "automation:state",
        json!({"enabled":service.token.is_some(),"generation":service.generation}),
    );
}
struct DialogGuard<'a>(&'a AtomicUsize);
impl<'a> DialogGuard<'a> {
    fn new(count: &'a AtomicUsize) -> Self {
        count.fetch_add(1, Ordering::SeqCst);
        Self(count)
    }
}
impl Drop for DialogGuard<'_> {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::SeqCst);
    }
}
fn choice(app: &AppHandle, title: &str, message: &str, yes: &str, no: &str) -> String {
    let host = app.state::<Host>();
    let _guard = DialogGuard::new(&host.dialogs);
    #[cfg(feature = "automation")]
    if let Some(value) = test_dialog(app, "message") {
        return value.as_str().unwrap_or("Cancel").into();
    }
    let mut dialog = app.dialog().message(message).title(title).buttons(
        MessageDialogButtons::YesNoCancelCustom(yes.into(), no.into(), "Cancel".into()),
    );
    if let Some(window) = app.get_webview_window("main") {
        dialog = dialog.parent(&window);
    }
    match dialog.blocking_show_with_result() {
        MessageDialogResult::Custom(value) => value,
        _ => "Cancel".into(),
    }
}
fn select(app: &AppHandle, kind: &str, name: &str) -> Result<Option<PathBuf>> {
    let host = app.state::<Host>();
    let _guard = DialogGuard::new(&host.dialogs);
    #[cfg(feature = "automation")]
    {
        *app.state::<TestDialogs>().1.lock().unwrap() = json!({"kind":kind,"name":name});
        let test_kind = if kind == "document-save" {
            "save"
        } else {
            kind
        };
        if let Some(value) = test_dialog(app, test_kind) {
            return Ok(value.as_str().map(PathBuf::from));
        }
    }
    let mut dialog = app.dialog().file();
    if let Some(window) = app.get_webview_window("main") {
        dialog = dialog.set_parent(&window);
    }
    let value = match kind {
        "folder" => dialog.blocking_pick_folder(),
        "open" => dialog
            .add_filter("DepthPlan documents", &["depthplan", "json"])
            .blocking_pick_file(),
        "document-save" => dialog
            .add_filter("DepthPlan document", &["depthplan"])
            .set_file_name(name)
            .blocking_save_file(),
        _ => dialog.set_file_name(name).blocking_save_file(),
    };
    value
        .map(|p| p.into_path().map_err(|e| e.to_string()))
        .transpose()
}
fn save(app: &AppHandle, document: &Value, id: &Value, save_as: bool) -> Result<Value> {
    validation::document(document)?;
    let host = app.state::<Host>();
    let mut source = if id.is_null() {
        None
    } else {
        Some(host.storage.lock().unwrap().files.record(string(id)?)?)
    };
    let mut name = source
        .as_ref()
        .map(|s| files::document_name(Path::new(&s.path)))
        .unwrap_or_else(|| "untitled.depthplan".into());
    if save_as {
        source = None;
    }
    loop {
        if source.is_none() {
            let Some(path) = select(app, "document-save", &name)? else {
                return Ok(json!({"status":"canceled"}));
            };
            let hash = files::hash(&path)?;
            source = Some(Source {
                id: String::new(),
                path: path.to_string_lossy().into_owned(),
                fingerprint: hash,
            });
        }
        let current = source.as_ref().unwrap();
        let observed = files::hash(Path::new(&current.path))?;
        let recovered = host
            .storage
            .lock()
            .unwrap()
            .files
            .recovered
            .contains(&current.id);
        if observed != current.fingerprint || recovered {
            match choice(
                app,
                if recovered {
                    "Confirm recovered source"
                } else {
                    "File changed outside DepthPlan"
                },
                &format!(
                    "{}\nSave a separate copy, explicitly overwrite the current file, or cancel.",
                    current.path
                ),
                "Save As",
                "Overwrite",
            )
            .as_str()
            {
                "Save As" => {
                    name = files::document_name(Path::new(&current.path));
                    source = None;
                    continue;
                }
                "Overwrite" => {
                    host.storage
                        .lock()
                        .unwrap()
                        .files
                        .recovered
                        .remove(&current.id);
                    source.as_mut().unwrap().fingerprint = observed;
                    continue;
                }
                _ => return Ok(json!({"status":"canceled"})),
            }
        }
        match host.storage.lock().unwrap().files.save(
            Path::new(&current.path),
            document,
            current.fingerprint.as_deref(),
            &|| Ok(()),
        ) {
            Ok(source) => return Ok(json!({"status":"success","source":source})),
            Err(error) if error == files::SOURCE_CHANGED => continue,
            Err(error) => return Err(error),
        }
    }
}
fn file_operation(app: &AppHandle, method: &str, args: &[Value]) -> Result<Value> {
    let host = app.state::<Host>();
    match method {
        "file:open-requests" => Ok(json!(app
            .state::<OpenRequests>()
            .0
            .lock()
            .unwrap()
            .iter()
            .map(|(id, _)| id.clone())
            .collect::<Vec<_>>())),
        "file:release-open-request" => {
            let id = string(arg(args, 0))?;
            app.state::<OpenRequests>()
                .0
                .lock()
                .unwrap()
                .retain(|(pending, _)| pending != id);
            Ok(Value::Null)
        }
        "file:open-request" => {
            let id = string(arg(args, 0))?;
            let path = app
                .state::<OpenRequests>()
                .0
                .lock()
                .unwrap()
                .iter()
                .find(|(pending, _)| pending == id)
                .map(|(_, path)| path.clone())
                .ok_or("File open request is no longer available")?;
            let mut value = host.storage.lock().unwrap().files.read(&path)?;
            value["status"] = "success".into();
            Ok(value)
        }
        "file:open" => {
            let Some(path) = select(app, "open", "")? else {
                return Ok(json!({"status":"canceled"}));
            };
            let mut value = host.storage.lock().unwrap().files.read(&path)?;
            value["status"] = "success".into();
            Ok(value)
        }
        "file:reload-document" => {
            let mut storage = host.storage.lock().unwrap();
            let source = storage.files.record(string(arg(args, 0))?)?;
            let mut value = storage.files.read(Path::new(&source.path))?;
            value["status"] = "success".into();
            Ok(value)
        }
        "file:save" => save(
            app,
            arg(args, 0),
            arg(args, 1),
            arg(args, 2).as_bool().unwrap_or(false),
        ),
        _ => Err("Unknown file operation".into()),
    }
}
fn arg(args: &[Value], i: usize) -> &Value {
    args.get(i).unwrap_or(&Value::Null)
}
fn mcp_path(host: &Host, path: &str, lease: &Value) -> Result<PathBuf> {
    host.service.lock().unwrap().check(lease)?;
    let target = host.folders.resolve(path)?;
    host.service.lock().unwrap().check(lease)?;
    Ok(target)
}
fn io_command(
    app: &AppHandle,
    method: &str,
    args: &[Value],
    binary: Option<&[u8]>,
) -> Result<Value> {
    let host = app.state::<Host>();
    let a = arg(args, 0);
    let b = arg(args, 1);
    if method.starts_with("file:") {
        return Ok(file_operation(app, method, args)
            .unwrap_or_else(|error| json!({"status":"error","error":error})));
    }
    match method {
        "transition:confirm" => {
            let kind = string(a)?;
            let label = string(b)?;
            let apply = arg(args, 2).as_bool().ok_or("Invalid transition prompt")?;
            if !["draft", "document"].contains(&kind) {
                return Err("Invalid transition prompt".into());
            }
            let title = if kind == "draft" {
                "Unfinished editor draft"
            } else {
                "Unsaved changes"
            };
            let yes = if kind == "draft" {
                if apply {
                    "Apply"
                } else {
                    "Cancel"
                }
            } else {
                "Save"
            };
            let no = if kind == "draft" {
                "Discard draft"
            } else {
                "Discard"
            };
            let answer=choice(app,title,&format!("Finish {label} before continuing? Cancel keeps the current editor and document open."),yes,no);
            Ok(json!(if answer == "Apply" || answer == "Save" {
                "save"
            } else if answer.starts_with("Discard") {
                "discard"
            } else {
                "cancel"
            }))
        }
        "recovery:discover" => host.storage.lock().unwrap().recovery.discover(),
        "recovery:prepare" => {
            let mut storage = host.storage.lock().unwrap();
            let Storage { files, recovery } = &mut *storage;
            recovery.prepare(string(a)?, files)
        }
        "recovery:release" => {
            host.storage.lock().unwrap().recovery.release(string(a)?)?;
            Ok(Value::Null)
        }
        "recovery:discard" => {
            host.storage.lock().unwrap().recovery.discard(string(a)?)?;
            Ok(Value::Null)
        }
        "recovery:write" => {
            let mut storage = host.storage.lock().unwrap();
            let Storage { files, recovery } = &mut *storage;
            recovery.write(a, files)?;
            Ok(Value::Null)
        }
        "recovery:remove" => {
            let revision = if b.is_null() {
                None
            } else {
                Some(b.as_u64().ok_or("Invalid revision")?)
            };
            host.storage
                .lock()
                .unwrap()
                .recovery
                .remove(string(a)?, revision)?;
            Ok(Value::Null)
        }
        "png:start" => {
            let width = a
                .as_u64()
                .and_then(|n| u32::try_from(n).ok())
                .ok_or("Invalid PNG width")?;
            let height = b
                .as_u64()
                .and_then(|n| u32::try_from(n).ok())
                .ok_or("Invalid PNG height")?;
            let mut active = host.png.lock().unwrap();
            if active.is_some() {
                return Err("A PNG export is already active".into());
            }
            let export = PngExport::new(width, height)?;
            let id = export.id.clone();
            *active = Some(export);
            Ok(json!(id))
        }
        "png:abort" => {
            let mut active = host.png.lock().unwrap();
            if active
                .as_ref()
                .is_some_and(|e| a.as_str() == Some(e.id.as_str()))
            {
                *active = None;
            }
            Ok(Value::Null)
        }
        "export:image" => {
            let format = string(a)?;
            let bytes = match binary {
                Some(bytes) if format == "png" => {
                    files::validate_png(bytes)?;
                    Cow::Borrowed(bytes)
                }
                Some(_) => return Err("Binary exports must be PNG".into()),
                None => Cow::Owned(files::image_bytes(format, b)?),
            };
            let name = string(arg(args, 2))?;
            files::export_name(name, format)?;
            let Some(mut path) = select(app, "save", name)? else {
                return Ok(Value::Null);
            };
            if !path
                .to_string_lossy()
                .to_lowercase()
                .ends_with(&format!(".{format}"))
            {
                path = PathBuf::from(format!("{}.{format}", path.display()));
            }
            files::write_atomic(&path, &bytes, None, &|| Ok(()))?;
            Ok(json!(path))
        }
        "export:json" => {
            validation::document(a)?;
            let name = b.as_str().unwrap_or("diagram_export.depthplan");
            files::export_name(name, "depthplan")?;
            let Some(path) = select(app, "document-save", name)? else {
                return Ok(Value::Null);
            };
            let hash = files::hash(&path)?;
            host.storage
                .lock()
                .unwrap()
                .files
                .save(&path, a, hash.as_deref(), &|| Ok(()))?;
            Ok(json!(path))
        }
        "mcp:approve-folder" => {
            if let Some(path) = select(app, "folder", "")? {
                host.folders.add(&path)?;
            }
            Ok(status(app))
        }
        "mcp:inspect" => {
            let path = mcp_path(&host, string(a)?, b)?;
            let hash = files::hash(&path)?;
            mcp_path(&host, path.to_str().ok_or("Invalid path")?, b)?;
            Ok(json!({"path":path,"fingerprint":hash}))
        }
        "mcp:read" => {
            let path = mcp_path(&host, string(a)?, b)?;
            let candidate = host.storage.lock().unwrap().files.read(&path)?;
            mcp_path(&host, path.to_str().ok_or("Invalid path")?, b)?;
            Ok(candidate)
        }
        "mcp:write" => {
            let path = mcp_path(&host, string(&a["path"])?, &a["lease"])?;
            let expected = match &a["expected"] {
                Value::Null if a.get("expected").is_some() => None,
                Value::String(s)
                    if s.len() == 64
                        && s.bytes()
                            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)) =>
                {
                    Some(s.as_str())
                }
                _ => return Err("Invalid fingerprint".into()),
            };
            let check = || {
                if mcp_path(&host, string(&a["path"])?, &a["lease"])? != path {
                    return Err("Target path changed".into());
                }
                Ok(())
            };
            let kind = string(&a["kind"])?;
            if kind == "save" {
                let source = host
                    .storage
                    .lock()
                    .unwrap()
                    .files
                    .save(&path, &a["data"], expected, &check)?;
                return Ok(json!({"source":source}));
            }
            let bytes = if let Some(bytes) = binary {
                if kind != "png" {
                    return Err("Binary exports must be PNG".into());
                }
                files::validate_png(bytes)?;
                Cow::Borrowed(bytes)
            } else if kind == "json" {
                validation::document(&a["data"])?;
                Cow::Owned(serde_json::to_vec_pretty(&a["data"]).map_err(|e| e.to_string())?)
            } else {
                Cow::Owned(files::image_bytes(kind, &a["data"])?)
            };
            if !path
                .to_string_lossy()
                .to_lowercase()
                .ends_with(&format!(".{kind}"))
            {
                return Err(format!("Export path must end in .{kind}"));
            }
            files::write_atomic(&path, &bytes, Some(expected), &check)?;
            Ok(json!({"path":path,"bytes":bytes.len(),"fingerprint":files::fingerprint(&bytes)}))
        }
        "mcp:recovery" => {
            let lease = arg(args, 2);
            host.service.lock().unwrap().check(lease)?;
            let mut storage = host.storage.lock().unwrap();
            let Storage { files, recovery } = &mut *storage;
            let result = match string(a)? {
                "list" => recovery.discover()?,
                "prepare" => recovery.prepare(string(b)?, files)?,
                "discard" => {
                    recovery.discard(string(b)?)?;
                    Value::Null
                }
                _ => return Err("Invalid recovery action".into()),
            };
            if let Err(error) = host.service.lock().unwrap().check(lease) {
                if a == "prepare" {
                    recovery.release(string(b)?)?;
                }
                return Err(error);
            }
            Ok(result)
        }
        _ => Err(format!("Unsupported desktop command: {method}")),
    }
}
#[tauri::command]
async fn desktop(
    app: AppHandle,
    window: WebviewWindow,
    method: String,
    args: Vec<Value>,
) -> Result<Value> {
    if window.label() != "main" || !trusted(&window.url().map_err(|e| e.to_string())?) {
        return Err("Untrusted command sender".into());
    }
    let host = app.state::<Host>();
    let a = arg(&args, 0);
    let b = arg(&args, 1);
    match method.as_str() {
        "app:instance-id" => Ok(json!(host.service.lock().unwrap().instance)),
        "clipboard:read-text" => app
            .clipboard()
            .read_text()
            .map(Value::String)
            .map_err(|e| e.to_string()),
        "clipboard:write-text" => {
            app.clipboard()
                .write_text(string(a)?)
                .map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }
        "link:open" => {
            let url = string(a)?;
            if !validation::valid_link(url) {
                return Err("Unsupported link".into());
            }
            app.opener()
                .open_url(url, None::<&str>)
                .map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }
        "automation:status" => Ok(status(&app)),
        "automation:enable" => {
            let enabled = a.as_bool().ok_or("Invalid automation state")?;
            let task_app = app.clone();
            // Windows waits for a pipe task on the async runtime to report ready.
            // Keep that runtime free while startup and ACL commands block.
            tauri::async_runtime::spawn_blocking(move || {
                let host = task_app.state::<Host>();
                let mut service = host.service.lock().unwrap();
                if enabled {
                    service.enable(task_app.clone())
                } else {
                    service.disable()
                }
            })
            .await
            .map_err(|e| e.to_string())??;
            announce(&app);
            Ok(status(&app))
        }
        "automation:reply" => {
            if let Some(sender) = host.service.lock().unwrap().pending.remove(string(a)?) {
                let _ = sender.send(b.clone());
            }
            Ok(Value::Null)
        }
        "mcp:folders" => Ok(host.folders.list()),
        "mcp:revoke-folder" => {
            host.folders.revoke(string(a)?);
            let _ = app.emit_to("main", "mcp:revoked", ());
            Ok(status(&app))
        }
        "mcp:lease" => host.service.lock().unwrap().lease(),
        "mcp:release" => {
            host.service.lock().unwrap().release(a);
            Ok(Value::Null)
        }
        "mcp:check" => {
            host.service.lock().unwrap().check(a)?;
            Ok(Value::Null)
        }
        "transition:reply" => {
            let approved = b.as_bool().ok_or("Invalid close response")?;
            let mut closing = host.closing.lock().unwrap();
            if closing.pending.as_ref().is_some_and(|(id, _)| a == id) {
                let (_, quit) = closing.pending.take().unwrap();
                if approved {
                    closing.allowed = true;
                    drop(closing);
                    if quit {
                        app.exit(0);
                    } else {
                        window.close().map_err(|e| e.to_string())?;
                    }
                }
            }
            Ok(Value::Null)
        }
        #[cfg(feature = "automation")]
        "test:focus" => {
            let was_focused = window.is_focused().map_err(|e| e.to_string())?;
            window.unminimize().map_err(|e| e.to_string())?;
            window.show().map_err(|e| e.to_string())?;
            window.set_focus().map_err(|e| e.to_string())?;
            Ok(
                json!({"wasFocused": was_focused, "focused": window.is_focused().map_err(|e| e.to_string())?}),
            )
        }
        #[cfg(feature = "automation")]
        "test:dialogs" => {
            *app.state::<TestDialogs>().0.lock().unwrap() =
                a.as_array().ok_or("Expected dialog queue")?.clone().into();
            Ok(Value::Null)
        }
        #[cfg(feature = "automation")]
        "test:last-file-dialog" => Ok(app.state::<TestDialogs>().1.lock().unwrap().clone()),
        #[cfg(feature = "automation")]
        "test:open-files" => {
            let paths = a
                .as_array()
                .ok_or("Expected paths")?
                .iter()
                .map(|v| string(v).map(PathBuf::from))
                .collect::<Result<Vec<_>>>()?;
            open_paths(&app, paths);
            Ok(Value::Null)
        }
        #[cfg(feature = "automation")]
        "test:close" => {
            request_close(&app, false);
            Ok(Value::Null)
        }
        #[cfg(feature = "automation")]
        "test:quit" => {
            request_close(&app, true);
            Ok(Value::Null)
        }
        #[cfg(all(feature = "automation", target_os = "macos"))]
        "test:processes" => crate::test_processes::identifiers(&window).await,
        _ => {
            let app = app.clone();
            tauri::async_runtime::spawn_blocking(move || io_command(&app, &method, &args, None))
                .await
                .map_err(|e| e.to_string())?
        }
    }
}
#[tauri::command]
async fn desktop_binary(
    app: AppHandle,
    window: WebviewWindow,
    request: tauri::ipc::Request<'_>,
) -> Result<tauri::ipc::Response> {
    if window.label() != "main" || !trusted(&window.url().map_err(|e| e.to_string())?) {
        return Err("Untrusted command sender".into());
    }
    let header = request
        .headers()
        .get("x-depthplan-request")
        .ok_or("Missing binary request")?;
    let metadata = base64::engine::general_purpose::STANDARD
        .decode(header.as_bytes())
        .map_err(|e| e.to_string())?;
    let (method, args): (String, Vec<Value>) =
        serde_json::from_slice(&metadata).map_err(|e| e.to_string())?;
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("Expected binary body".into());
    };
    let bytes = bytes.clone();
    tauri::async_runtime::spawn_blocking(move || {
        if method == "png:write" || method == "png:finish" {
            let host = app.state::<Host>();
            let mut active = host.png.lock().unwrap();
            let export = active
                .as_mut()
                .filter(|e| arg(&args, 0).as_str() == Some(e.id.as_str()))
                .ok_or("PNG export expired")?;
            if method == "png:write" {
                if let Err(error) = export.write(&bytes) {
                    *active = None;
                    return Err(error);
                }
                return Ok(tauri::ipc::Response::new("null".to_owned()));
            }
            return active
                .take()
                .unwrap()
                .finish()
                .map(tauri::ipc::Response::new);
        }
        if method != "export:image" && method != "mcp:write" {
            return Err("Unsupported binary command".into());
        }
        let result = io_command(&app, &method, &args, Some(&bytes))?;
        Ok(tauri::ipc::Response::new(
            serde_json::to_string(&result).map_err(|e| e.to_string())?,
        ))
    })
    .await
    .map_err(|e| e.to_string())?
}
fn trusted(url: &tauri::Url) -> bool {
    url.scheme() == "tauri" && url.host_str() == Some("localhost")
        || ["http", "https"].contains(&url.scheme()) && url.host_str() == Some("tauri.localhost")
        || cfg!(debug_assertions)
            && url.scheme() == "http"
            && url.host_str() == Some("localhost")
            && url.port() == Some(1420)
}
fn request_close(app: &AppHandle, quit: bool) {
    if app.get_webview_window("main").is_none() {
        if quit {
            app.exit(0);
        }
        return;
    }
    let host = app.state::<Host>();
    let mut closing = host.closing.lock().unwrap();
    if closing.prompt {
        return;
    }
    if let Some((_, pending_quit)) = closing.pending.as_mut() {
        *pending_quit |= quit;
        return;
    }
    let id = Uuid::new_v4().to_string();
    closing.pending = Some((id.clone(), quit));
    let _ = app.emit_to("main", "transition:request", &id);
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(30)).await;
            let host = app.state::<Host>();
            let pending = host
                .closing
                .lock()
                .unwrap()
                .pending
                .as_ref()
                .is_some_and(|(pending, _)| pending == &id);
            if !pending {
                break;
            }
            if host.dialogs.load(Ordering::SeqCst) > 0 {
                continue;
            }
            failure_prompt(&app);
            break;
        }
    });
}
fn failure_prompt(app: &AppHandle) {
    {
        let host = app.state::<Host>();
        let mut closing = host.closing.lock().unwrap();
        if closing.allowed || closing.prompt {
            return;
        }
        closing.prompt = true;
        closing.pending = None;
        let mut service = host.service.lock().unwrap();
        for (_, sender) in service.pending.drain() {
            let _ = sender.send(automation::unavailable());
        }
    }
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let answer=choice(&app,"Editor unavailable","The editor stopped or is not responding. Restart DepthPlan to recover the last available checkpoint. More recent edits and unfinished text may be lost. Quit keeps the checkpoint for the next launch. Cancel leaves the app open.","Restart DepthPlan","Quit");
        let host = app.state::<Host>();
        let mut closing = host.closing.lock().unwrap();
        closing.prompt = false;
        if answer == "Restart DepthPlan" || answer == "Quit" {
            closing.allowed = true;
            drop(closing);
            if answer == "Restart DepthPlan" {
                app.restart();
            } else {
                app.exit(0);
            }
        }
    });
}
fn create_window(app: &AppHandle) -> tauri::Result<()> {
    let mut builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
        .title("DepthPlan")
        .inner_size(1024.0, 728.0)
        // WKWebView ignores data_directory. Non-production WebViews must still
        // stay separate from the user's persisted website data on every OS.
        .incognito(cfg!(debug_assertions) || cfg!(feature = "automation"))
        .on_navigation(trusted)
        .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny);
    #[cfg(feature = "automation")]
    if let Some(profile) = std::env::var_os("DEPTHPLAN_TEST_PROFILE") {
        builder = builder.data_directory(PathBuf::from(profile).join("webview"));
    }
    #[cfg(not(feature = "automation"))]
    {
        builder = builder.data_directory(app.path().app_local_data_dir()?.join("webview"));
    }
    builder.build()?;
    app.state::<Host>().closing.lock().unwrap().allowed = false;
    Ok(())
}
fn menu(app: &AppHandle) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
    let menu = Menu::new(app)?;
    #[cfg(target_os = "macos")]
    {
        let native = Submenu::new(app, "DepthPlan", true)?;
        native.append(&PredefinedMenuItem::about(
            app,
            Some("About DepthPlan"),
            None,
        )?)?;
        native.append(&PredefinedMenuItem::hide(app, None)?)?;
        native.append(&PredefinedMenuItem::hide_others(app, None)?)?;
        native.append(&MenuItem::with_id(
            app,
            "app:quit",
            "Quit DepthPlan",
            true,
            Some("CmdOrCtrl+Q"),
        )?)?;
        menu.append(&native)?;
    }
    let file = Submenu::new(app, "File", true)?;
    for (id, title, key) in [
        ("menu:new", "New", Some("CmdOrCtrl+N")),
        ("menu:open", "Open…", Some("CmdOrCtrl+O")),
        ("menu:reload-document", "Reload document", None),
        ("menu:save", "Save", Some("CmdOrCtrl+S")),
        ("menu:save-as", "Save As…", Some("CmdOrCtrl+Shift+S")),
        ("menu:export-svg", "Export Image…", Some("CmdOrCtrl+E")),
        (
            "menu:export-json",
            "Export DepthPlan…",
            Some("CmdOrCtrl+Shift+E"),
        ),
        ("app:close", "Close", Some("CmdOrCtrl+W")),
    ] {
        file.append(&MenuItem::with_id(app, id, title, true, key)?)?;
    }
    menu.append(&file)?;
    let edit = Submenu::new(app, "Edit", true)?;
    edit.append(&MenuItem::with_id(
        app,
        "menu:undo",
        "Undo",
        true,
        Some("CmdOrCtrl+Z"),
    )?)?;
    edit.append(&MenuItem::with_id(
        app,
        "menu:redo",
        "Redo",
        true,
        Some(if cfg!(windows) {
            "Ctrl+Y"
        } else {
            "CmdOrCtrl+Shift+Z"
        }),
    )?)?;
    edit.append(&PredefinedMenuItem::cut(app, None)?)?;
    edit.append(&PredefinedMenuItem::copy(app, None)?)?;
    edit.append(&PredefinedMenuItem::paste(app, None)?)?;
    edit.append(&PredefinedMenuItem::select_all(app, None)?)?;
    menu.append(&edit)?;
    let view = Submenu::new(app, "View", true)?;
    view.append(&PredefinedMenuItem::fullscreen(app, None)?)?;
    #[cfg(debug_assertions)]
    view.append(&MenuItem::with_id(
        app,
        "app:devtools",
        "Developer Tools",
        true,
        None::<&str>,
    )?)?;
    menu.append(&view)?;
    let help = Submenu::new(app, "Help", true)?;
    help.append(&MenuItem::with_id(
        app,
        "help:docs",
        "DepthPlan Documentation",
        true,
        None::<&str>,
    )?)?;
    help.append(&MenuItem::with_id(
        app,
        "help:issues",
        "Report an Issue",
        true,
        None::<&str>,
    )?)?;
    menu.append(&help)?;
    app.set_menu(menu)?;
    Ok(())
}
#[cfg(feature = "automation")]
#[derive(Default)]
struct TestDialogs(Mutex<std::collections::VecDeque<Value>>, Mutex<Value>);
#[cfg(feature = "automation")]
fn test_dialog(app: &AppHandle, kind: &str) -> Option<Value> {
    let mut queue = app.state::<TestDialogs>().inner().0.lock().unwrap();
    queue.front().filter(|v| v["kind"] == kind)?;
    Some(queue.pop_front().unwrap()["value"].clone())
}
pub fn run() {
    let builder = tauri::Builder::default().manage(OpenRequests::default());
    // Development/automation processes must not forward test files to an installed app.
    #[cfg(all(
        not(debug_assertions),
        not(feature = "automation"),
        any(windows, target_os = "linux")
    ))]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
        open_paths(
            app,
            args.iter()
                .skip(1)
                .filter_map(|arg| files::open_path(arg.as_ref(), Path::new(&cwd))),
        );
    }));
    let builder = builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .build(),
        )
        .invoke_handler(tauri::generate_handler![desktop, desktop_binary]);
    #[cfg(feature = "automation")]
    let builder = builder
        .plugin(tauri_plugin_wdio_webdriver::init())
        .manage(TestDialogs::default());
    #[cfg(target_os = "macos")]
    let builder =
        builder.on_web_content_process_terminate(|webview| failure_prompt(webview.app_handle()));
    let app = builder
        .setup(|app| {
            let instance = Uuid::new_v4().to_string();
            #[cfg(not(feature = "automation"))]
            let root = app
                .path()
                .app_config_dir()?
                .parent()
                .ok_or("Missing application data directory")?
                .join(if cfg!(debug_assertions) {
                    "DepthPlan Development/recovery"
                } else {
                    "DepthPlan/recovery"
                });
            #[cfg(feature = "automation")]
            let root = std::env::var_os("DEPTHPLAN_TEST_PROFILE")
                .map(|p| PathBuf::from(p).join("recovery"))
                .unwrap_or_else(|| {
                    std::env::temp_dir()
                        .join(format!("depthplan-automation-{instance}"))
                        .join("recovery")
                });
            app.manage(Host {
                dialogs: AtomicUsize::new(0),
                storage: Mutex::new(Storage {
                    files: FileStore::default(),
                    recovery: Recovery::new(root, instance.clone()),
                }),
                service: Mutex::new(Service::new(instance)?),
                folders: Folders::default(),
                closing: Mutex::new(Closing::default()),
                png: Mutex::new(None),
            });
            create_window(app.handle())?;
            menu(app.handle())?;
            let cwd = std::env::current_dir()?;
            open_paths(
                app.handle(),
                std::env::args_os()
                    .skip(1)
                    .filter_map(|arg| files::open_path(&arg, &cwd)),
            );
            Ok(())
        })
        .on_menu_event(|app, event| match event.id().as_ref() {
            "app:quit" => request_close(app, true),
            "app:close" => request_close(app, false),
            "app:devtools" =>
            {
                #[cfg(debug_assertions)]
                if let Some(window) = app.get_webview_window("main") {
                    #[cfg(debug_assertions)]
                    window.open_devtools();
                }
            }
            "help:docs" => {
                let _ = app.opener().open_url(
                    "https://github.com/TwistedPears/depthplan-diagram#readme",
                    None::<&str>,
                );
            }
            "help:issues" => {
                let _ = app.opener().open_url(
                    "https://github.com/TwistedPears/depthplan-diagram/issues/new/choose",
                    None::<&str>,
                );
            }
            id => {
                let _ = app.emit_to("main", id, ());
            }
        })
        .on_window_event(|window, event| {
            let app = window.app_handle();
            match event {
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    if !app.state::<Host>().closing.lock().unwrap().allowed {
                        api.prevent_close();
                        request_close(app, false);
                    }
                }
                tauri::WindowEvent::Destroyed => {
                    let host = app.state::<Host>();
                    *host.png.lock().unwrap() = None;
                    host.storage.lock().unwrap().files.clear();
                    let _ = host.service.lock().unwrap().disable();
                }
                _ => {}
            }
        })
        .build(tauri::generate_context!())
        .expect("Could not start DepthPlan");
    app.run(|app, event| match event {
        #[cfg(target_os = "macos")]
        tauri::RunEvent::Opened { urls } => {
            open_paths(
                app,
                urls.into_iter().filter_map(|url| url.to_file_path().ok()),
            );
        }
        tauri::RunEvent::ExitRequested { api, code, .. } => {
            if app.get_webview_window("main").is_some()
                && !app.state::<Host>().closing.lock().unwrap().allowed
            {
                api.prevent_exit();
                request_close(app, true);
            } else if cfg!(target_os = "macos") && code.is_none() {
                api.prevent_exit();
            }
        }
        #[cfg(target_os = "macos")]
        tauri::RunEvent::Reopen {
            has_visible_windows: false,
            ..
        } => {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            } else if let Err(error) = create_window(app) {
                log::error!("Could not reopen editor: {error}");
            }
        }
        tauri::RunEvent::Exit => {
            if app
                .state::<Host>()
                .service
                .lock()
                .unwrap()
                .shutdown()
                .is_err()
            {
                log::warn!("Could not clean up the local automation endpoint.");
            }
        }
        _ => {}
    });
}
