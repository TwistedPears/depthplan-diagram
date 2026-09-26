//! User-local navigation only. Project and document files remain authoritative.
use crate::files::{self, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashSet,
    fs,
    io::Read,
    path::{Path, PathBuf},
};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct View {
    pub tabs: Vec<Tab>,
    pub active: Option<String>,
    pub drawer: bool,
    pub window: Option<[f64; 2]>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Tab {
    pub board_id: String,
    pub camera: Camera,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Camera {
    pub x: f64,
    pub y: f64,
    pub scale: f64,
}
impl View {
    pub fn parse(value: Value) -> Result<Self> {
        let view: Self = serde_json::from_value(value).map_err(|e| e.to_string())?;
        let mut ids = HashSet::new();
        if view.tabs.len() > 1000
            || view.tabs.iter().any(|tab| {
                tab.board_id.is_empty()
                    || tab.board_id.len() > 128
                    || !ids.insert(&tab.board_id)
                    || !tab.camera.x.is_finite()
                    || !tab.camera.y.is_finite()
                    || !tab.camera.scale.is_finite()
                    || tab.camera.scale <= 0.0
                    || tab.camera.scale > 100.0
            })
            || view.active.as_ref().is_some_and(|id| !ids.contains(id))
            || view.window.is_some_and(|[w, h]| {
                !w.is_finite()
                    || !h.is_finite()
                    || !(900.0..=10000.0).contains(&w)
                    || !(640.0..=10000.0).contains(&h)
            })
        {
            return Err("Invalid local workspace state".into());
        }
        Ok(view)
    }
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Recent {
    pub key: String,
    pub id: String,
    pub name: String,
    pub location: PathBuf,
    pub view: Option<View>,
}
pub struct Workspaces {
    path: PathBuf,
    entries: Vec<Recent>,
}
impl Workspaces {
    pub fn new(path: PathBuf) -> Self {
        let entries = (|| -> Option<Vec<Recent>> {
            let mut bytes = Vec::new();
            fs::File::open(&path)
                .ok()?
                .take(4 * 1024 * 1024 + 1)
                .read_to_end(&mut bytes)
                .ok()?;
            if bytes.len() > 4 * 1024 * 1024 {
                return None;
            }
            let entries: Vec<Recent> = serde_json::from_slice(&bytes).ok()?;
            if entries.len() > 20
                || entries.iter().any(|entry| {
                    !entry.location.is_absolute()
                        || entry.key.len() != 64
                        || entry.id.len() > 128
                        || entry.name.len() > 480
                        || entry
                            .view
                            .as_ref()
                            .is_some_and(|v| View::parse(json!(v)).is_err())
                })
            {
                return None;
            }
            Some(entries)
        })()
        .unwrap_or_default();
        Self { path, entries }
    }
    fn save(&self) -> Result<()> {
        fs::create_dir_all(self.path.parent().ok_or("Missing workspace directory")?)
            .map_err(|e| e.to_string())?;
        files::write_atomic(
            &self.path,
            &serde_json::to_vec(&self.entries).map_err(|e| e.to_string())?,
            None,
            &|| Ok(()),
        )
    }
    pub fn list(&self) -> Value {
        json!(self.entries.iter().map(|entry| json!({"key":entry.key,"id":entry.id,"name":entry.name,"location":entry.location,"available":entry.location.is_file()})).collect::<Vec<_>>())
    }
    pub fn get(&self, key: &str) -> Result<Recent> {
        self.entries
            .iter()
            .find(|e| e.key == key)
            .cloned()
            .ok_or("Recent project is no longer available".into())
    }
    pub fn view(&self, key: &str) -> Option<View> {
        self.get(key).ok().and_then(|e| e.view)
    }
    pub fn forget(&mut self, key: &str) -> Result<()> {
        self.entries.retain(|e| e.key != key);
        self.save()
    }
    pub fn remember(&mut self, project: &Value, view: Option<View>) -> Result<()> {
        let key = project["workspaceKey"]
            .as_str()
            .ok_or("Missing workspace key")?;
        let entry = Recent {
            key: key.into(),
            id: project["manifest"]["id"]
                .as_str()
                .ok_or("Missing project identity")?
                .into(),
            name: project["manifest"]["name"]
                .as_str()
                .ok_or("Missing name")?
                .into(),
            location: Path::new(project["location"].as_str().ok_or("Missing location")?).into(),
            view: view.or_else(|| self.view(key)),
        };
        self.entries.retain(|e| e.key != key);
        self.entries.insert(0, entry);
        self.entries.truncate(20);
        self.save()
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn local_state_roundtrip_corruption_and_location_isolation() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("workspace.json");
        let mut store = Workspaces::new(path.clone());
        let project = json!({"workspaceKey":"a".repeat(64),"manifest":{"id":"same-id","name":"Project"},"location":root.path().join("project.depthproject")});
        let view = View::parse(json!({"tabs":[{"boardId":"a","camera":{"x":13,"y":-21,"scale":2}}],"active":"a","drawer":false,"window":[1024,728]})).unwrap();
        store.remember(&project, Some(view)).unwrap();
        let mut copy = project.clone();
        copy["workspaceKey"] = json!("b".repeat(64));
        copy["location"] = json!(root.path().join("copy.depthproject"));
        store.remember(&copy, None).unwrap();
        let reopened = Workspaces::new(path.clone());
        assert!(reopened.view(&"b".repeat(64)).is_none());
        assert_eq!(
            reopened.view(&"a".repeat(64)).unwrap().tabs[0].camera.x,
            13.0
        );
        assert!(
            View::parse(json!({"tabs":[],"active":"unknown","drawer":true,"window":null})).is_err()
        );
        assert!(View::parse(json!({"tabs":[],"active":null,"drawer":true,"window":null})).is_ok());
        fs::write(&path, b"corrupt local preferences").unwrap();
        assert!(Workspaces::new(path).entries.is_empty());
    }
}
