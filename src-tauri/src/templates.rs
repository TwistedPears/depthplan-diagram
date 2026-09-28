use crate::{
    files::{self, Result},
    validation,
};
use serde_json::{json, Value};
use std::{
    collections::HashSet,
    fs,
    io::Read,
    path::{Path, PathBuf},
    sync::LazyLock,
};

pub const MAX_BYTES: usize = 8 * 1024 * 1024;
static SCHEMA: LazyLock<jsonschema::Validator> = LazyLock::new(|| {
    jsonschema::validator_for(
        &serde_json::from_str(include_str!("../generated/template-schema.json")).unwrap(),
    )
    .unwrap()
});
fn text(value: &Value, max: usize) -> bool {
    value
        .as_str()
        .is_some_and(|s| s.encode_utf16().count() <= max)
}
fn id(value: &Value) -> Result<&str> {
    value
        .as_str()
        .filter(|s| {
            !s.is_empty()
                && s.len() <= 128
                && s.bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
        })
        .ok_or("Invalid template ID".into())
}
pub fn validate(value: &Value) -> Result<()> {
    if serde_json::to_vec(value).map_err(|e| e.to_string())?.len() > MAX_BYTES {
        return Err("Template exceeds 8 MiB".into());
    }
    let mut pending = vec![(value, 0)];
    while let Some((item, depth)) = pending.pop() {
        if depth > 64 {
            return Err("Template JSON exceeds 64 levels".into());
        }
        match item {
            Value::Object(map) => pending.extend(map.values().map(|v| (v, depth + 1))),
            Value::Array(array) => pending.extend(array.iter().map(|v| (v, depth + 1))),
            _ => (),
        }
    }
    validation::document(value)?;
    let m = &value["extensions"]["template"];
    if !SCHEMA.is_valid(m) {
        return Err("Invalid or unsupported template manifest (expected version 1)".into());
    }
    // JSON Schema counts Unicode scalars; renderer text limits count UTF-16 units.
    if !text(&m["name"], 120)
        || !text(&m["description"], 4000)
        || !text(&m["guidance"], 4000)
        || m["tags"].as_array().unwrap().iter().any(|v| !text(v, 80))
        || m["excludedConnections"]
            .as_array()
            .unwrap()
            .iter()
            .any(|v| !text(v, 256))
        || ["author", "license"]
            .iter()
            .any(|k| m.get(k).is_some_and(|v| !text(v, 200)))
    {
        return Err("Template text exceeds supported bounds".into());
    }
    let objects = value["objects"].as_object().unwrap();
    let mut ids = HashSet::new();
    for c in m["components"].as_array().unwrap() {
        if !ids.insert(c["id"].as_str().unwrap())
            || !objects.contains_key(c["rootId"].as_str().unwrap())
            || !text(&c["name"], 120)
            || !text(&c["parentRole"], 200)
            || !text(&c["guidance"], 4000)
        {
            return Err("Invalid reusable component".into());
        }
    }
    let mut folds: Vec<_> = value["extensions"]
        .get("collapsedObjects")
        .into_iter()
        .collect();
    if let Some(views) = value["namedViews"].as_object() {
        folds.extend(
            views
                .values()
                .filter_map(|view| view["metadata"].get("collapsedObjects")),
        );
    }
    for fold in folds {
        if !fold.as_array().is_some_and(|ids| {
            ids.iter()
                .all(|id| id.as_str().is_some_and(|s| objects.contains_key(s)))
        }) {
            return Err("Invalid template fold references".into());
        }
    }
    if objects.len() > 5000
        || value["connections"].as_object().unwrap().len() > 10000
        || value["layouts"]
            .as_object()
            .unwrap()
            .values()
            .any(|v| v.as_object().unwrap().len() > 128)
    {
        return Err("Template exceeds object, connection or layout limits".into());
    }
    for object in objects.values() {
        let mut parent = &object["parentId"];
        let mut depth = 0;
        while let Some(p) = parent.as_str() {
            depth += 1;
            if depth > 64 {
                return Err("Template hierarchy exceeds 64 levels".into());
            }
            parent = &objects[p]["parentId"];
        }
    }
    if value.as_object().unwrap().keys().any(|key| {
        ![
            "formatVersion",
            "id",
            "metadata",
            "objects",
            "rootDepths",
            "layouts",
            "connections",
            "namedViews",
            "extensions",
        ]
        .contains(&key.as_str())
    }) || value.get("connectionRepairs").is_some()
        || value["extensions"]
            .as_object()
            .unwrap()
            .keys()
            .any(|k| !["template", "collapsedObjects"].contains(&k.as_str()))
        || value["namedViews"].as_object().is_some_and(|views| {
            views.values().any(|view| {
                view["metadata"]
                    .as_object()
                    .is_some_and(|metadata| metadata.keys().any(|key| key != "collapsedObjects"))
            })
        })
        || value["metadata"]
            .as_object()
            .unwrap()
            .keys()
            .any(|k| !["title", "created", "modified"].contains(&k.as_str()))
    {
        return Err("Template contains source/session metadata".into());
    }
    Ok(())
}
pub fn read(path: &Path) -> Result<Value> {
    crate::projects::regular(path)?;
    let mut bytes = Vec::new();
    fs::File::open(path)
        .map_err(|e| e.to_string())?
        .take((MAX_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() > MAX_BYTES {
        return Err("Template exceeds 8 MiB".into());
    }
    let document: Value =
        serde_json::from_slice(&bytes).map_err(|e| format!("Invalid template JSON: {e}"))?;
    validate(&document)?;
    Ok(json!({"document": document, "fingerprint": files::fingerprint(&bytes)}))
}
fn path(root: &Path, identity: &Value) -> Result<PathBuf> {
    Ok(root.join(format!("{}.depthtemplate", id(identity)?)))
}
pub fn list(root: &Path) -> Result<Value> {
    let mut entries = vec![];
    let mut warnings = vec![];
    if root.exists() {
        for entry in fs::read_dir(root).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            if entry
                .path()
                .extension()
                .is_none_or(|s| s != "depthtemplate")
            {
                continue;
            }
            match read(&entry.path()) {
                Ok(value)
                    if path(root, &value["document"]["extensions"]["template"]["id"])?
                        == entry.path() =>
                {
                    entries.push(value)
                }
                Ok(_) => warnings.push(format!(
                    "{}: identity does not match filename",
                    entry.file_name().to_string_lossy()
                )),
                Err(error) => {
                    warnings.push(format!("{}: {error}", entry.file_name().to_string_lossy()))
                }
            }
        }
    }
    Ok(json!({"entries": entries, "warnings": warnings}))
}
pub fn save(root: &Path, document: &Value, expected: Option<&str>) -> Result<Value> {
    validate(document)?;
    fs::create_dir_all(root).map_err(|e| e.to_string())?;
    let target = path(root, &document["extensions"]["template"]["id"])?;
    if target.symlink_metadata().is_ok() {
        crate::projects::regular(&target)?;
        if expected.is_none() {
            return Err(
                "Template already exists. Keep a separate copy or explicitly update the entry."
                    .into(),
            );
        }
        let old = read(&target)?;
        if old["fingerprint"].as_str() != expected {
            return Err(files::SOURCE_CHANGED.into());
        }
        if document["extensions"]["template"]["version"].as_u64()
            != old["document"]["extensions"]["template"]["version"]
                .as_u64()
                .and_then(|v| v.checked_add(1))
        {
            return Err("An update must increment the template version".into());
        }
    }
    let bytes = serde_json::to_vec(document).map_err(|e| e.to_string())?;
    files::write_atomic(&target, &bytes, Some(expected), &|| Ok(()))?;
    Ok(json!({"document":document,"fingerprint":files::fingerprint(&bytes)}))
}
pub fn remove(root: &Path, identity: &Value, expected: &str) -> Result<()> {
    let target = path(root, identity)?;
    crate::projects::regular(&target)?;
    if files::hash(&target)?.as_deref() != Some(expected) {
        return Err(files::SOURCE_CHANGED.into());
    }
    fs::remove_file(target).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn portable_library_roundtrip_conflicts_and_validation() {
        let templates: Vec<Value> =
            serde_json::from_str(include_str!("../generated/templates.json")).unwrap();
        let first = tempfile::tempdir().unwrap();
        let second = tempfile::tempdir().unwrap();
        for mut document in templates {
            let saved = save(first.path(), &document, None).unwrap();
            assert!(save(first.path(), &document, None).is_err());
            let file = path(first.path(), &document["extensions"]["template"]["id"]).unwrap();
            let imported = read(&file).unwrap();
            assert_eq!(imported["document"], document);
            save(second.path(), &imported["document"], None).unwrap();
            document["extensions"]["template"]["version"] = 2.into();
            assert!(save(first.path(), &document, Some("stale")).is_err());
            let updated = save(first.path(), &document, saved["fingerprint"].as_str()).unwrap();
            assert!(remove(
                first.path(),
                &document["extensions"]["template"]["id"],
                "stale"
            )
            .is_err());
            remove(
                first.path(),
                &document["extensions"]["template"]["id"],
                updated["fingerprint"].as_str().unwrap(),
            )
            .unwrap();
            document["extensions"]["template"]["formatVersion"] = 99.into();
            assert!(validate(&document).is_err());
        }
        assert_eq!(
            list(second.path()).unwrap()["entries"]
                .as_array()
                .unwrap()
                .len(),
            3
        );
        assert!(path(first.path(), &json!("../escape")).is_err());
        let corrupt = first.path().join("corrupt.depthtemplate");
        fs::write(&corrupt, b"invalid").unwrap();
        assert!(read(&corrupt).is_err());
        assert_eq!(
            list(first.path()).unwrap()["warnings"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
        fs::write(&corrupt, vec![b' '; MAX_BYTES + 1]).unwrap();
        assert!(read(&corrupt).is_err());
    }
}
