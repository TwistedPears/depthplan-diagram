use serde_json::{Map, Value};
use std::collections::{HashMap, VecDeque};
type Result<T> = std::result::Result<T, String>;
fn require(ok: bool, field: &str) -> Result<()> {
    if ok {
        Ok(())
    } else {
        Err(format!("Invalid DepthPlan document: {field}"))
    }
}
fn id(v: &Value) -> bool {
    v.as_str().is_some_and(valid_id)
}
fn valid_id(s: &str) -> bool {
    !s.is_empty() && !["__proto__", "constructor", "prototype"].contains(&s)
}
fn map<'a>(v: &'a Value, field: &str) -> Result<&'a Map<String, Value>> {
    let m = v
        .as_object()
        .ok_or_else(|| format!("Invalid DepthPlan document: {field}"))?;
    require(m.keys().all(|key| valid_id(key)), field)?;
    Ok(m)
}
fn number(v: &Value) -> bool {
    v.as_f64().is_some_and(f64::is_finite)
}
fn integer(v: &Value) -> bool {
    v.as_f64()
        .is_some_and(|x| x.is_finite() && x.fract() == 0.0)
}
fn positive(v: &Value) -> bool {
    v.as_f64().is_some_and(|x| x > 0.0)
}
fn natural(v: &Value) -> bool {
    integer(v)
        && v.as_f64()
            .is_some_and(|x| (0.0..=9007199254740991.0).contains(&x))
}
fn point(v: &Value) -> bool {
    v.is_object() && number(&v["x"]) && number(&v["y"])
}
pub fn valid_link(value: &str) -> bool {
    if value.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return false;
    }
    tauri::Url::parse(value).is_ok_and(|url| {
        matches!(url.scheme(), "http" | "https" | "mailto")
            && url.username().is_empty()
            && url.password().is_none()
    })
}
pub fn geometry(v: &Value) -> Result<()> {
    require(
        v.is_object()
            && ["x", "y", "z", "width", "height", "rotation"]
                .iter()
                .all(|k| number(&v[k]))
            && integer(&v["z"])
            && positive(&v["width"])
            && positive(&v["height"])
            && v["rotation"]
                .as_f64()
                .is_some_and(|n| (0.0..360.0).contains(&n)),
        "geometry",
    )
}
fn boundary(v: &Value) -> Result<()> {
    require(
        v.is_object()
            && matches!(
                v["side"].as_str(),
                Some("top" | "right" | "bottom" | "left")
            )
            && v["offset"]
                .as_f64()
                .is_some_and(|n| (0.0..=1.0).contains(&n)),
        "boundary point",
    )
}
fn content(v: &Value) -> Result<()> {
    let mut todo: Vec<_> = v.as_array().ok_or("Invalid content")?.iter().collect();
    while let Some(b) = todo.pop() {
        require(b.is_object(), "content block")?;
        match b["type"].as_str() {
            Some("paragraph" | "heading") => {
                if b["type"] == "heading" {
                    require(
                        integer(&b["level"])
                            && b["level"]
                                .as_f64()
                                .is_some_and(|x| (1.0..=6.0).contains(&x)),
                        "heading level",
                    )?;
                }
                require(
                    b.get("align").is_none()
                        || matches!(
                            b["align"].as_str(),
                            Some("left" | "center" | "right" | "justify")
                        ),
                    "alignment",
                )?;
                for run in b["runs"].as_array().ok_or("Invalid content runs")? {
                    require(run.is_object() && run["text"].is_string(), "text run")?;
                    if let Some(marks) = run.get("marks") {
                        for (k, v) in map(marks, "text marks")? {
                            require(
                                match k.as_str() {
                                    "bold" | "italic" | "underline" | "strike" => v.is_boolean(),
                                    "font" | "color" => v.is_string(),
                                    "size" => positive(v),
                                    "link" => v.as_str().is_some_and(valid_link),
                                    _ => false,
                                },
                                "text mark",
                            )?;
                        }
                    }
                }
            }
            Some("list") => {
                require(
                    b["ordered"].is_boolean()
                        && (b.get("start").is_none()
                            || (integer(&b["start"]) && positive(&b["start"]))),
                    "list",
                )?;
                for item in b["items"].as_array().ok_or("Invalid list items")? {
                    let a = item.as_array().ok_or("Invalid list item")?;
                    require(!a.is_empty(), "list item")?;
                    todo.extend(a);
                }
            }
            Some("quote") => {
                let a = b["blocks"].as_array().ok_or("Invalid quote")?;
                require(!a.is_empty(), "quote")?;
                todo.extend(a);
            }
            Some("code") => {
                require(
                    b["text"].is_string()
                        && matches!(
                            b["language"].as_str(),
                            Some(
                                "plaintext"
                                    | "javascript"
                                    | "typescript"
                                    | "csharp"
                                    | "java"
                                    | "json"
                                    | "python"
                                    | "bash"
                                    | "sql"
                                    | "html"
                                    | "css"
                                    | "yaml"
                            )
                        )
                        && (b.get("wrap").is_none() || b["wrap"].is_boolean()),
                    "code",
                )?;
            }
            _ => return Err("Invalid content type".into()),
        }
    }
    Ok(())
}
fn connection(c: &Value, key: &str) -> Result<()> {
    require(
        c.is_object()
            && c["id"] == key
            && matches!(c["kind"].as_str(), Some("line" | "arrow"))
            && integer(&c["z"])
            && c.get("ownerId").is_some()
            && (c["ownerId"].is_null() || id(&c["ownerId"])),
        "connection",
    )?;
    if let Some(points) = c.get("points") {
        require(
            points.as_array().is_some_and(|a| a.iter().all(point)),
            "connection points",
        )?;
    }
    if let Some(label) = c.get("label") {
        require(label.is_string(), "connection label")?;
    }
    if let Some(style) = c.get("style") {
        map(style, "connection style")?;
    }
    for end in [&c["start"], &c["end"]] {
        require(end.is_object(), "endpoint")?;
        match end["kind"].as_str() {
            Some("free") => require(point(end), "free endpoint")?,
            Some("object") => {
                require(id(&end["objectId"]), "endpoint target")?;
                boundary(end)?;
                require(
                    end.get("binding").is_none()
                        || matches!(end["binding"].as_str(), Some("auto" | "fixed")),
                    "binding",
                )?;
            }
            Some("boundary") => require(
                id(&end["objectId"]) && id(&end["pointId"]),
                "boundary endpoint",
            )?,
            _ => return Err("Invalid endpoint kind".into()),
        }
    }
    Ok(())
}
pub fn document(v: &Value) -> Result<()> {
    require(
        v["formatVersion"] == 2,
        "unsupported document format; expected formatVersion 2",
    )?;
    require(id(&v["id"]), "id")?;
    require(
        v["metadata"].is_object()
            && ["title", "created", "modified"]
                .iter()
                .all(|k| v["metadata"][k].is_string()),
        "metadata",
    )?;
    let objects = map(&v["objects"], "objects")?;
    let depths = map(&v["rootDepths"], "rootDepths")?;
    let layouts = map(&v["layouts"], "layouts")?;
    let connections = map(&v["connections"], "connections")?;
    if let Some(e) = v.get("extensions") {
        map(e, "extensions")?;
    }
    if let Some(views) = v.get("namedViews") {
        for (key, view) in map(views, "named views")? {
            require(
                view.is_object()
                    && view["id"] == *key
                    && view["name"].as_str().is_some_and(|s| !s.trim().is_empty()),
                "named view",
            )?;
            let vd = map(&view["rootDepths"], "named view depths")?;
            require(vd.values().all(natural), "named view depth")?;
            if let Some(camera) = view.get("camera") {
                require(
                    point(camera) && positive(&camera["scale"]),
                    "named view camera",
                )?;
            }
            if let Some(focus) = view.get("cameraFocus") {
                require(
                    view.get("camera").is_some() && point(focus),
                    "named view camera focus",
                )?;
            }
            if let Some(ls) = view.get("layouts") {
                for (root, layout) in map(ls, "named view layouts")? {
                    require(vd.contains_key(root), "named view layout root")?;
                    for g in map(layout, "named view layout")?.values() {
                        require(
                            point(g)
                                && positive(&g["width"])
                                && positive(&g["height"])
                                && (g.get("parentId").is_some()
                                    && (g["parentId"].is_null() || id(&g["parentId"]))),
                            "named view geometry",
                        )?;
                    }
                }
            }
            if let Some(meta) = view.get("metadata") {
                map(meta, "named view metadata")?;
            }
        }
    }
    let mut children: HashMap<&str, Vec<&str>> = HashMap::new();
    let mut roots = Vec::new();
    for (key, o) in objects {
        require(o.is_object() && o["id"] == *key, "object id")?;
        require(
            matches!(
                o["type"].as_str(),
                Some("rectangle" | "ellipse" | "diamond" | "frame")
            ) && o["name"].is_string(),
            "object kind/name",
        )?;
        geometry(&o["geometry"])?;
        content(&o["content"])?;
        if let Some(s) = o.get("style") {
            map(s, "style")?;
        }
        if let Some(points) = o.get("boundaryPoints") {
            for p in map(points, "boundary points")?.values() {
                boundary(p)?;
            }
        }
        if o["parentId"].is_null() {
            require(o.get("parentId").is_some(), "parent")?;
            roots.push(key.as_str());
        } else {
            let parent = o["parentId"].as_str().ok_or("Invalid parent")?;
            require(objects.contains_key(parent), "missing parent")?;
            children.entry(parent).or_default().push(key);
        }
    }
    let mut forest: HashMap<&str, (&str, u64)> = HashMap::new();
    let mut members: HashMap<&str, Vec<&str>> = HashMap::new();
    let mut maximum: HashMap<&str, u64> = HashMap::new();
    let mut queue: VecDeque<_> = roots.iter().map(|r| (*r, *r, 0u64)).collect();
    while let Some((key, root, depth)) = queue.pop_front() {
        require(
            forest.insert(key, (root, depth)).is_none(),
            "ownership cycle",
        )?;
        members.entry(root).or_default().push(key);
        maximum
            .entry(root)
            .and_modify(|m| *m = (*m).max(depth))
            .or_insert(depth);
        if let Some(cs) = children.get(key) {
            for child in cs {
                queue.push_back((child, root, depth + 1));
            }
        }
    }
    require(forest.len() == objects.len(), "ownership cycle")?;
    require(
        depths.len() == roots.len() && layouts.len() == roots.len(),
        "root maps",
    )?;
    for root in roots {
        let depth = depths
            .get(root)
            .filter(|v| natural(v))
            .and_then(Value::as_f64)
            .map(|v| v as u64)
            .ok_or("Invalid selected depth")?;
        require(depth <= maximum[root], "selected depth")?;
        let ls = map(
            layouts.get(root).ok_or("Missing root layout")?,
            "root layouts",
        )?;
        require(
            ls.contains_key("0") && ls.contains_key(&depth.to_string()),
            "selected/zero layout",
        )?;
        for (key, layout) in ls {
            let d = key.parse::<u64>().map_err(|_| "Invalid layout depth")?;
            require(
                d <= 9007199254740991 && d.to_string() == *key,
                "layout depth",
            )?;
            let l = map(layout, "layout")?;
            for (key, g) in l {
                require(
                    forest.get(key.as_str()).is_some_and(|(r, _)| *r == root),
                    "layout object",
                )?;
                geometry(g)?;
            }
            for member in &members[root] {
                if forest[member].1 <= d {
                    require(l.contains_key(*member), "missing layout geometry")?;
                }
            }
        }
    }
    if let Some(repairs) = v.get("connectionRepairs") {
        for (key, r) in map(repairs, "connection repairs")? {
            require(
                r.is_object()
                    && r["reason"].as_str().is_some_and(|s| !s.is_empty())
                    && !connections.contains_key(key),
                "connection repair",
            )?;
            connection(&r["connection"], key)?;
            require(r.get("ownerGeometry").is_some(), "repair owner geometry")?;
            if !r["ownerGeometry"].is_null() {
                geometry(&r["ownerGeometry"])?;
            }
            require(point(&r["start"]) && point(&r["end"]), "repair position")?;
        }
    }
    for (key, c) in connections {
        connection(c, key)?;
        let owner = c["ownerId"].as_str();
        require(
            c.get("ownerId").is_some()
                && (c["ownerId"].is_null() || owner.is_some_and(|id| objects.contains_key(id))),
            "connection owner",
        )?;
        for end in [&c["start"], &c["end"]] {
            if end["kind"] == "free" {
                continue;
            }
            let target = end["objectId"].as_str().ok_or("Invalid endpoint target")?;
            let object = objects.get(target).ok_or("Missing endpoint target")?;
            if end["kind"] == "boundary" {
                require(
                    end["pointId"]
                        .as_str()
                        .is_some_and(|p| object["boundaryPoints"].get(p).is_some()),
                    "endpoint boundary",
                )?;
            }
            if let Some(owner) = owner {
                let mut cursor = Some(target);
                while let Some(key) = cursor {
                    if key == owner {
                        break;
                    }
                    cursor = objects[key]["parentId"].as_str();
                }
                require(cursor == Some(owner), "endpoint outside owner")?;
            }
        }
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn matches_editor_document_validation() {
        let cases: Vec<Value> =
            serde_json::from_str(include_str!("../generated/document-cases.json")).unwrap();
        let mismatches: Vec<_> = cases
            .iter()
            .filter_map(|c| {
                let result = document(&c["document"]);
                if result.is_ok() != c["valid"].as_bool().unwrap() {
                    Some(format!(
                        "{}: expected {}, got {:?}",
                        c["name"], c["valid"], result
                    ))
                } else {
                    None
                }
            })
            .collect();
        assert!(mismatches.is_empty(), "{}", mismatches.join("\n"));
    }
}
