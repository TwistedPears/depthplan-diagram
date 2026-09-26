use crate::{
    files::{self, Result},
    validation,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    fs::{self, File},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::LazyLock,
};
use uuid::Uuid;

const MAX_BYTES: u64 = 1024 * 1024;
const LOCK: &str = ".depthproject.lock";
const CONFLICT: &str = "Project manifest changed; reopen/reconcile before retrying.";
static SCHEMA: LazyLock<jsonschema::Validator> = LazyLock::new(|| {
    jsonschema::validator_for(
        &serde_json::from_str(include_str!("../generated/project-schema.json")).unwrap(),
    )
    .unwrap()
});

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Board {
    pub id: String,
    pub name: String,
    pub path: String,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Manifest {
    pub project_version: u32,
    pub id: String,
    pub name: String,
    pub description: String,
    pub boards: Vec<Board>,
    pub home_board_id: Option<String>,
    pub autosave: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub extensions: Option<Value>,
}
fn reserved(name: &str) -> bool {
    let stem = name.split('.').next().unwrap_or("").to_ascii_uppercase();
    ["CON", "PRN", "AUX", "NUL"].contains(&stem.as_str())
        || (stem.len() == 4
            && (stem.starts_with("COM") || stem.starts_with("LPT"))
            && matches!(stem.as_bytes()[3], b'1'..=b'9'))
}
pub fn manifest(value: &Value) -> Result<Manifest> {
    if !SCHEMA.is_valid(value)
        || serde_json::to_vec(value).map_err(|e| e.to_string())?.len() > MAX_BYTES as usize
    {
        return Err("Invalid/unsupported project manifest (v1, at most 1 MiB)".into());
    }
    let manifest: Manifest = serde_json::from_value(value.clone()).map_err(|e| e.to_string())?;
    // JSON Schema counts Unicode scalars; match Zod's UTF-16 string bounds too.
    if manifest.name.encode_utf16().count() > 120
        || manifest.description.encode_utf16().count() > 4000
        || manifest
            .boards
            .iter()
            .any(|b| b.name.encode_utf16().count() > 120)
    {
        return Err("Project text exceeds supported bounds".into());
    }
    let mut ids = HashSet::new();
    let mut paths = HashSet::new();
    for board in &manifest.boards {
        if !ids.insert(&board.id)
            || !paths.insert(board.path.to_lowercase())
            || board.path.split('/').any(reserved)
        {
            return Err("Duplicate board identity/path or reserved filename".into());
        }
    }
    if manifest
        .home_board_id
        .as_ref()
        .is_some_and(|id| !ids.contains(id))
    {
        return Err("Home board must be a project member".into());
    }
    Ok(manifest)
}
fn read_manifest(path: &Path) -> Result<(Manifest, String)> {
    let mut bytes = Vec::new();
    File::open(path)
        .map_err(|e| e.to_string())?
        .take(MAX_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() > MAX_BYTES as usize {
        return Err("Project manifest exceeds 1 MiB".into());
    }
    Ok((
        manifest(&serde_json::from_slice(&bytes).map_err(|e| e.to_string())?)?,
        files::fingerprint(&bytes),
    ))
}
fn regular(path: &Path) -> Result<()> {
    let metadata = fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    if !metadata.is_file() {
        return Err(format!(
            "Expected a regular file, without symlinks: {}",
            path.display()
        ));
    }
    Ok(())
}
fn lock(root: &Path) -> Result<File> {
    let path = root.join(LOCK);
    let file = match File::create_new(&path) {
        Ok(file) => file,
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
            regular(&path)?;
            File::options()
                .read(true)
                .write(true)
                .open(&path)
                .map_err(|e| e.to_string())?
        }
        Err(e) => return Err(e.to_string()),
    };
    file.try_lock()
        .map_err(|e| format!("Project is in use or cannot be locked: {e}"))?;
    regular(&path)?;
    if same_file::Handle::from_file(file.try_clone().map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?
        != same_file::Handle::from_path(&path).map_err(|e| e.to_string())?
    {
        return Err("Project lock was replaced; reopen the project".into());
    }
    // Never unlink the lock: OS ownership is released even when a process crashes.
    Ok(file)
}
/// Standalone/MCP writes must respect a project's live writer too.
pub fn lock_for_file(path: &Path) -> Result<Option<File>> {
    let parent = path
        .parent()
        .ok_or("Missing destination directory")?
        .canonicalize()
        .map_err(|e| e.to_string())?;
    for root in parent.ancestors() {
        if root.join(LOCK).try_exists().map_err(|e| e.to_string())? {
            return lock(root).map(Some);
        }
    }
    Ok(None)
}
fn vacant(path: &Path) -> Result<()> {
    let name = path
        .file_name()
        .ok_or("Missing filename")?
        .to_string_lossy()
        .to_lowercase();
    for entry in
        fs::read_dir(path.parent().ok_or("Missing directory")?).map_err(|e| e.to_string())?
    {
        if entry
            .map_err(|e| e.to_string())?
            .file_name()
            .to_string_lossy()
            .to_lowercase()
            == name
        {
            return Err(format!(
                "Destination already exists (including case variants): {}",
                path.display()
            ));
        }
    }
    Ok(())
}
fn durable_directory(path: &Path) -> Result<()> {
    #[cfg(unix)]
    File::open(path)
        .and_then(|f| f.sync_all())
        .map_err(|e| e.to_string())?;
    #[cfg(not(unix))]
    let _ = path;
    Ok(())
}

#[derive(Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum Action {
    CreateBoard {
        name: String,
        path: String,
    },
    ImportBoard {
        name: String,
        path: String,
    },
    DuplicateBoard {
        board_id: String,
        name: String,
        path: String,
        document: Option<Value>,
    },
    RenameBoard {
        board_id: String,
        name: String,
        path: String,
        expected: String,
    },
    RemoveBoard {
        board_id: String,
    },
    ReorderBoards {
        ids: Vec<String>,
    },
    Settings {
        name: String,
        description: String,
        home_board_id: Option<String>,
        autosave: bool,
    },
}
pub struct Project {
    root: PathBuf,
    root_handle: same_file::Handle,
    path: PathBuf,
    owner: File,
    pub manifest: Manifest,
    pub fingerprint: String,
}
impl Project {
    fn acquire(path: &Path, manifest: Manifest, fingerprint: String) -> Result<Self> {
        let root = path
            .parent()
            .ok_or("Missing project folder")?
            .canonicalize()
            .map_err(|e| e.to_string())?;
        let path = root.join(path.file_name().ok_or("Missing manifest filename")?);
        if !path
            .extension()
            .is_some_and(|ext| ext.eq_ignore_ascii_case("depthproject"))
        {
            return Err("Select a .depthproject manifest".into());
        }
        let root_handle = same_file::Handle::from_path(&root).map_err(|e| e.to_string())?;
        let owner = lock(&root)?;
        Ok(Self {
            root,
            root_handle,
            path,
            owner,
            manifest,
            fingerprint,
        })
    }
    fn check_location(&self) -> Result<()> {
        if self.root.canonicalize().map_err(|e| e.to_string())? != self.root
            || same_file::Handle::from_path(&self.root).map_err(|e| e.to_string())?
                != self.root_handle
            || same_file::Handle::from_path(self.root.join(LOCK)).map_err(|e| e.to_string())?
                != same_file::Handle::from_file(self.owner.try_clone().map_err(|e| e.to_string())?)
                    .map_err(|e| e.to_string())?
        {
            return Err("Project folder or ownership changed; reopen before writing".into());
        }
        regular(&self.root.join(LOCK))
    }
    fn resolve(&self, relative: &str) -> Result<PathBuf> {
        self.check_location()?;
        let mut path = self.root.clone();
        for part in relative.split('/') {
            if part.is_empty() || part == "." || part == ".." || part.contains(['\\', ':', '\0']) {
                return Err("Invalid project relative path".into());
            }
            path.push(part);
            match fs::symlink_metadata(&path) {
                Ok(m) if m.file_type().is_symlink() => {
                    return Err(format!(
                        "Project paths cannot traverse symlinks: {relative}"
                    ))
                }
                Ok(_) => {}
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(e) => return Err(e.to_string()),
            }
        }
        if !path
            .parent()
            .ok_or("Missing board directory")?
            .canonicalize()
            .map_err(|e| e.to_string())?
            .starts_with(&self.root)
        {
            return Err("Board path escapes project".into());
        }
        Ok(path)
    }
    fn check(&self, expected: &str) -> Result<()> {
        self.check_location()?;
        regular(&self.path)?;
        if expected != self.fingerprint || files::hash(&self.path)?.as_deref() != Some(expected) {
            return Err(CONFLICT.into());
        }
        Ok(())
    }
    pub fn open(path: &Path) -> Result<Self> {
        // Validate before taking ownership; failed opens never mutate current sessions.
        regular(path)?;
        let (manifest, fingerprint) = read_manifest(path)?;
        let project = Self::acquire(path, manifest, fingerprint)?;
        project.check(&project.fingerprint)?;
        Ok(project)
    }
    pub fn create(
        parent: &Path,
        folder: &str,
        name: &str,
        document: Option<Value>,
        before: &dyn Fn(&str) -> Result<()>,
    ) -> Result<Self> {
        if folder.is_empty()
            || folder.len() > 100
            || !folder
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'_' | b'-'))
            || reserved(folder)
        {
            return Err("Use a portable folder name (letters, numbers, - and _)".into());
        }
        let mut first = document.unwrap_or_else(|| blank("Overview"));
        validation::document(&first)?;
        first["id"] = Uuid::new_v4().to_string().into();
        let mut candidate = Manifest {
            project_version: 1,
            id: Uuid::new_v4().to_string(),
            name: name.into(),
            description: String::new(),
            boards: vec![Board {
                id: first["id"].as_str().unwrap().into(),
                name: "Overview".into(),
                path: "Overview.depthplan".into(),
            }],
            home_board_id: first["id"].as_str().map(str::to_string),
            autosave: true,
            extensions: None,
        };
        candidate = manifest(&json!(candidate))?;
        let root = parent
            .canonicalize()
            .map_err(|e| e.to_string())?
            .join(folder);
        vacant(&root)?;
        before("create-folder")?;
        fs::create_dir(&root).map_err(|e| e.to_string())?;
        let result: Result<Self> = (|| {
            durable_directory(root.parent().unwrap())?;
            let mut project = Self::acquire(
                &root.join("project.depthproject"),
                candidate.clone(),
                String::new(),
            )?;
            project.write_new("Overview.depthplan", &first, before)?;
            project.commit(candidate, before)?;
            Ok(project)
        })();
        result.map_err(|e| format!("{e}. Creation left recoverable output in {}; inspect it before retrying with a new folder.", root.display()))
    }
    fn write_new(
        &self,
        relative: &str,
        value: &Value,
        before: &dyn Fn(&str) -> Result<()>,
    ) -> Result<()> {
        let path = self.resolve(relative)?;
        vacant(&path)?;
        let mut temporary =
            tempfile::NamedTempFile::new_in(path.parent().unwrap()).map_err(|e| e.to_string())?;
        temporary
            .write_all(&serde_json::to_vec_pretty(value).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
        temporary.as_file().sync_all().map_err(|e| e.to_string())?;
        before("board-publish")?;
        self.resolve(relative)?;
        vacant(&path)?;
        temporary
            .persist_noclobber(&path)
            .map_err(|e| e.to_string())?;
        durable_directory(path.parent().unwrap())?;
        before("board-published")
    }
    fn commit(&mut self, candidate: Manifest, before: &dyn Fn(&str) -> Result<()>) -> Result<()> {
        manifest(&json!(candidate))?;
        let bytes = serde_json::to_vec(&candidate).map_err(|e| e.to_string())?;
        let mut temporary =
            tempfile::NamedTempFile::new_in(&self.root).map_err(|e| e.to_string())?;
        temporary.write_all(&bytes).map_err(|e| e.to_string())?;
        temporary.as_file().sync_all().map_err(|e| e.to_string())?;
        before("manifest-publish")?;
        self.check_location()?;
        if self.fingerprint.is_empty() {
            vacant(&self.path)?;
            temporary
                .persist_noclobber(&self.path)
                .map_err(|e| e.to_string())?;
        } else {
            self.check(&self.fingerprint)?;
            temporary.persist(&self.path).map_err(|e| e.to_string())?;
        }
        self.manifest = candidate;
        self.fingerprint = files::fingerprint(&bytes);
        durable_directory(&self.root).map_err(|e| {
            format!("Manifest committed but directory sync failed: {e}; reopen to reconcile")
        })?;
        before("manifest-published")
    }
    pub fn read_board(&self, id: &str) -> Result<Value> {
        let board = self
            .manifest
            .boards
            .iter()
            .find(|b| b.id == id)
            .ok_or("Unknown project board")?;
        let path = self.resolve(&board.path)?;
        regular(&path)?;
        let bytes = fs::read(&path).map_err(|e| e.to_string())?;
        let document: Value = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
        validation::document(&document)?;
        if document["id"] != board.id {
            return Err(
                "Board identity differs from manifest; explicitly import the replacement".into(),
            );
        }
        Ok(json!({"document": document, "fingerprint": files::fingerprint(&bytes)}))
    }
    pub fn apply(
        &mut self,
        expected: &str,
        action: Action,
        imported: Option<Value>,
        before: &dyn Fn(&str) -> Result<()>,
    ) -> Result<()> {
        self.check(expected)?;
        let mut next = self.manifest.clone();
        let mut output: Option<(String, Value)> = None;
        let mut renamed_source = None;
        match action {
            Action::Settings {
                name,
                description,
                home_board_id,
                autosave,
            } => {
                next.name = name;
                next.description = description;
                next.home_board_id = home_board_id;
                next.autosave = autosave;
            }
            Action::ReorderBoards { ids } => {
                if ids.len() != next.boards.len()
                    || ids.iter().collect::<HashSet<_>>().len() != ids.len()
                {
                    return Err("Order must contain every board exactly once".into());
                }
                next.boards = ids
                    .iter()
                    .map(|id| {
                        self.manifest
                            .boards
                            .iter()
                            .find(|b| &b.id == id)
                            .cloned()
                            .ok_or("Unknown board".to_string())
                    })
                    .collect::<Result<_>>()?;
            }
            Action::RemoveBoard { board_id } => {
                if !next.boards.iter().any(|b| b.id == board_id) {
                    return Err("Unknown board".into());
                }
                next.boards.retain(|b| b.id != board_id);
                if next.home_board_id.as_ref() == Some(&board_id) {
                    next.home_board_id = None;
                }
            }
            Action::RenameBoard {
                board_id,
                name,
                path,
                expected,
            } => {
                let current = self.read_board(&board_id)?;
                if current["fingerprint"] != expected {
                    return Err(files::SOURCE_CHANGED.into());
                }
                let board = next.boards.iter_mut().find(|b| b.id == board_id).unwrap();
                renamed_source = Some((board.path.clone(), expected));
                if board.path == path {
                    return Err(
                        "Rename requires a new filename; case-only renames are rejected safely"
                            .into(),
                    );
                }
                board.name = name.clone();
                board.path = path.clone();
                let mut document = current["document"].clone();
                document["metadata"]["title"] = name.into();
                output = Some((path, document));
            }
            action => {
                let (name, path, mut document) = match action {
                    Action::CreateBoard { name, path } => (name.clone(), path, blank(&name)),
                    Action::ImportBoard { name, path } => (
                        name,
                        path,
                        imported.ok_or("Import requires a native-selected source")?,
                    ),
                    Action::DuplicateBoard {
                        board_id,
                        name,
                        path,
                        document,
                    } => {
                        let current = self.read_board(&board_id)?;
                        let document = document.unwrap_or_else(|| current["document"].clone());
                        if document["id"] != board_id {
                            return Err("Duplicate snapshot has a different board identity".into());
                        }
                        (name, path, document)
                    }
                    _ => unreachable!(),
                };
                validation::document(&document)?;
                document["id"] = Uuid::new_v4().to_string().into();
                document["metadata"]["title"] = name.clone().into();
                next.boards.push(Board {
                    id: document["id"].as_str().unwrap().into(),
                    name,
                    path: path.clone(),
                });
                output = Some((path, document));
            }
        }
        manifest(&json!(next))?;
        if let Some((path, document)) = &output {
            self.write_new(path, document, before).map_err(|e| {
                format!("{e}. Inspect {path} for recoverable output; membership is unchanged.")
            })?;
        }
        let mut checked_files = Vec::new();
        if let Some((relative, hash)) = &renamed_source {
            checked_files.push((self.resolve(relative)?, hash.clone()));
        }
        if let Some((relative, document)) = &output {
            checked_files.push((
                self.resolve(relative)?,
                files::fingerprint(
                    &serde_json::to_vec_pretty(document).map_err(|e| e.to_string())?,
                ),
            ));
        }
        let check_files = || -> Result<()> {
            for (path, expected) in &checked_files {
                regular(path)?;
                if path.canonicalize().map_err(|e| e.to_string())? != *path
                    || files::hash(path)?.as_deref() != Some(expected.as_str())
                {
                    return Err(files::SOURCE_CHANGED.into());
                }
            }
            Ok(())
        };
        self.commit(next, &|phase| {
            before(phase)?;
            if phase == "manifest-publish" { check_files()?; }
            Ok(())
        }).map_err(|e| format!("{e}. Reopen to reconcile; any unlisted board files are retained for explicit recovery."))?;
        if let Some((relative, _)) = renamed_source {
            // The new mapping is durable before removing the unchanged old file.
            let cleanup: Result<()> = (|| {
                before("rename-cleanup")?;
                self.check(&self.fingerprint)?;
                let path = self.resolve(&relative)?;
                check_files()?;
                fs::remove_file(&path).map_err(|e| e.to_string())?;
                durable_directory(path.parent().unwrap())?;
                before("rename-cleaned")
            })();
            cleanup.map_err(|e| format!("Rename committed; cleanup incomplete: {e}. Reopen and inspect {relative}; do not automatically delete recovery files."))?;
        }
        Ok(())
    }

    pub fn snapshot(&self, session: &str) -> Value {
        let mut diagnostics = Vec::new();
        for board in &self.manifest.boards {
            if let Err(error) = self.read_board(&board.id) {
                diagnostics.push(json!({"boardId": board.id, "path": board.path, "error": format!("{error}. Restore the expected file, retry, or remove membership.")}));
            }
        }
        if let Err(error) = self.check(&self.fingerprint) {
            diagnostics.push(json!({"boardId":null,"path":self.path,"error":error}));
        }
        let mut folders = vec![self.root.clone()];
        while let Some(folder) = folders.pop() {
            // Recheck containment before scanning; never follow unlisted symlinks.
            if self.check_location().is_err()
                || folder.canonicalize().ok().as_ref() != Some(&folder)
            {
                continue;
            }
            match fs::read_dir(&folder) {
                Ok(entries) => {
                    for entry in entries {
                        let entry = match entry {
                            Ok(entry) => entry,
                            Err(error) => {
                                diagnostics.push(
                                    json!({"boardId":null,"path":folder,"error":error.to_string()}),
                                );
                                continue;
                            }
                        };
                        let path = entry.path();
                        let kind = entry.file_type();
                        if kind.as_ref().is_ok_and(|t| t.is_dir()) {
                            folders.push(path);
                            continue;
                        }
                        if path
                            .extension()
                            .is_some_and(|e| e.eq_ignore_ascii_case("depthplan"))
                        {
                            let relative = path
                                .strip_prefix(&self.root)
                                .unwrap()
                                .to_string_lossy()
                                .replace('\\', "/");
                            if !self.manifest.boards.iter().any(|b| b.path == relative) {
                                diagnostics.push(json!({"boardId":null,"path":relative,"error":"Unlisted board retained on disk. Import explicitly to recover it; it has not been adopted or deleted."}));
                            }
                        }
                    }
                }
                Err(error) => diagnostics
                    .push(json!({"boardId":null,"path":folder,"error":error.to_string()})),
            }
        }
        json!({"sessionId":session, "location":self.path, "workspaceKey":files::fingerprint(format!("{}\0{}", self.manifest.id, self.root.display()).as_bytes()), "manifest":self.manifest, "fingerprint":self.fingerprint, "diagnostics":diagnostics})
    }
}
fn blank(name: &str) -> Value {
    json!({"formatVersion":2,"id":Uuid::new_v4().to_string(),"metadata":{"title":name,"created":files::now(),"modified":files::now()},"objects":{},"connections":{},"layouts":{},"rootDepths":{}})
}
#[derive(Default)]
pub struct Projects(pub HashMap<String, Project>);
impl Projects {
    pub fn insert(&mut self, project: Project) -> Value {
        let id = Uuid::new_v4().to_string();
        let result = project.snapshot(&id);
        self.0.insert(id, project);
        result
    }
    pub fn get(&mut self, id: &str) -> Result<&mut Project> {
        self.0
            .get_mut(id)
            .ok_or("Project must be selected through a native dialog".into())
    }
}

#[cfg(test)]
mod tests;
