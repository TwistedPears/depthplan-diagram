use super::*;
fn create(dir: &Path) -> Project {
    Project::create(dir, "project", "Project", None, &|_| Ok(())).unwrap()
}
fn apply(project: &mut Project, action: Value) {
    project
        .apply(
            &project.fingerprint.clone(),
            serde_json::from_value(action).unwrap(),
            None,
            &|_| Ok(()),
        )
        .unwrap();
}
#[test]
fn lifecycle_keeps_independent_content_identity_home_and_extensions() {
    let dir = tempfile::tempdir().unwrap();
    let mut project = create(dir.path());
    let original = project.manifest.boards[0].clone();
    let source = files::fixture();
    project
        .apply(
            &project.fingerprint.clone(),
            Action::ImportBoard {
                name: "Imported".into(),
                path: "Imported.depthplan".into(),
            },
            Some(source.clone()),
            &|_| Ok(()),
        )
        .unwrap();
    let imported = project.manifest.boards[1].clone();
    let mut copy = project.read_board(&imported.id).unwrap()["document"].clone();
    assert_ne!(copy["id"], source["id"]);
    copy["id"] = source["id"].clone();
    copy["metadata"]["title"] = source["metadata"]["title"].clone();
    assert_eq!(copy, source);
    let mut edited = project.read_board(&imported.id).unwrap()["document"].clone();
    edited["metadata"]["extension"] = json!({"keep":true});
    apply(
        &mut project,
        json!({"kind":"duplicateBoard","boardId":imported.id,"name":"Copy","path":"Copy.depthplan","document":edited}),
    );
    let duplicate = project.manifest.boards[2].clone();
    assert_ne!(duplicate.id, imported.id);
    assert_eq!(
        project.read_board(&duplicate.id).unwrap()["document"]["metadata"]["extension"],
        json!({"keep":true})
    );
    let fingerprint = project.read_board(&imported.id).unwrap()["fingerprint"].clone();
    apply(
        &mut project,
        json!({"kind":"renameBoard","boardId":imported.id,"name":"Renamed","path":"Renamed.depthplan","expected":fingerprint}),
    );
    assert_eq!(project.manifest.boards[1].id, imported.id);
    assert!(!project.root.join(&imported.path).exists());
    apply(
        &mut project,
        json!({"kind":"reorderBoards","ids":[duplicate.id,imported.id,original.id]}),
    );
    apply(
        &mut project,
        json!({"kind":"settings","name":"Updated","description":"Portable","homeBoardId":imported.id,"autosave":false}),
    );
    project.manifest.extensions = Some(json!({"vendor":{"keep":[1,2]}}));
    apply(
        &mut project,
        json!({"kind":"removeBoard","boardId":imported.id}),
    );
    assert!(project.manifest.home_board_id.is_none());
    assert!(project.root.join("Renamed.depthplan").exists());
    let expected = project.manifest.clone();
    let path = project.path.clone();
    drop(project);
    let project = Project::open(&path).unwrap();
    assert_eq!(project.manifest, expected);
    assert_eq!(project.manifest.boards[0].id, duplicate.id);
    let mut files = files::FileStore::default();
    assert!(files.read(&project.root.join("Copy.depthplan")).is_ok());
}
#[test]
fn malformed_manifests_paths_versions_bounds_and_identities() {
    let dir = tempfile::tempdir().unwrap();
    let project = create(dir.path());
    let base = json!(project.manifest);
    assert!(manifest(&base).is_ok());
    for version in [json!(0), json!(2), json!("1"), Value::Null] {
        let mut value = base.clone();
        value["projectVersion"] = version;
        assert!(manifest(&value).is_err());
    }
    for path in [
        "/absolute.depthplan",
        "../outside.depthplan",
        "a/../x.depthplan",
        "a//x.depthplan",
        "C:\\x.depthplan",
        "a\\x.depthplan",
        "file.json",
        "CON.depthplan",
        "aux/x.depthplan",
        "nul.extra.depthplan",
    ] {
        let mut value = base.clone();
        value["boards"][0]["path"] = path.into();
        assert!(manifest(&value).is_err(), "{path}");
    }
    for (key, value) in [
        ("name", json!(" ")),
        ("name", json!("Bad/Name")),
        ("name", json!("a".repeat(121))),
        ("description", json!("a".repeat(4001))),
        ("homeBoardId", json!("missing")),
        ("extensions", json!([])),
        ("extra", json!(1)),
        ("id", json!("a".repeat(129))),
    ] {
        let mut candidate = base.clone();
        candidate[key] = value;
        assert!(manifest(&candidate).is_err(), "{key}");
    }
    let mut value = base.clone();
    value["boards"]
        .as_array_mut()
        .unwrap()
        .push(base["boards"][0].clone());
    assert!(manifest(&value).is_err());
    value["boards"][1]["id"] = "other".into();
    value["boards"][1]["path"] = "overview.depthplan".into();
    assert!(manifest(&value).is_err());
    let mut value = base;
    value["extensions"] = json!({"large":"x".repeat(MAX_BYTES as usize)});
    assert!(manifest(&value).is_err());
}
#[test]
fn invalid_open_missing_corrupt_and_identity_mismatch_preserve_healthy_boards() {
    let dir = tempfile::tempdir().unwrap();
    let mut project = create(dir.path());
    apply(
        &mut project,
        json!({"kind":"createBoard","name":"Missing","path":"Missing.depthplan"}),
    );
    apply(
        &mut project,
        json!({"kind":"createBoard","name":"Broken","path":"Broken.depthplan"}),
    );
    apply(
        &mut project,
        json!({"kind":"createBoard","name":"Replaced","path":"Replaced.depthplan"}),
    );
    fs::remove_file(project.root.join("Missing.depthplan")).unwrap();
    fs::write(project.root.join("Broken.depthplan"), "bad").unwrap();
    fs::write(
        project.root.join("Replaced.depthplan"),
        serde_json::to_vec(&blank("Replacement")).unwrap(),
    )
    .unwrap();
    let path = project.path.clone();
    drop(project);
    let project = Project::open(&path).unwrap();
    assert_eq!(
        project.snapshot("session")["diagnostics"]
            .as_array()
            .unwrap()
            .len(),
        3
    );
    assert!(project.read_board(&project.manifest.boards[0].id).is_ok());
    let invalid = dir.path().join("invalid.depthproject");
    fs::write(&invalid, "{}").unwrap();
    assert!(Project::open(&invalid).is_err());
    assert!(project.read_board(&project.manifest.boards[0].id).is_ok());
}
#[test]
fn collisions_conflicts_and_unavailable_destinations_preserve_prior_files() {
    let dir = tempfile::tempdir().unwrap();
    let mut project = create(dir.path());
    let original = fs::read(&project.path).unwrap();
    fs::write(project.root.join("OTHER.depthplan"), "unrelated").unwrap();
    for path in [
        "other.depthplan",
        "Overview.depthplan",
        "missing/board.depthplan",
    ] {
        assert!(project
            .apply(
                &project.fingerprint.clone(),
                Action::CreateBoard {
                    name: "Board".into(),
                    path: path.into()
                },
                None,
                &|_| Ok(())
            )
            .is_err());
    }
    assert_eq!(fs::read(&project.path).unwrap(), original);
    assert_eq!(
        fs::read_to_string(project.root.join("OTHER.depthplan")).unwrap(),
        "unrelated"
    );
    let stale = project.fingerprint.clone();
    apply(
        &mut project,
        json!({"kind":"createBoard","name":"Second","path":"Second.depthplan"}),
    );
    assert!(project
        .apply(
            &stale,
            Action::RemoveBoard {
                board_id: project.manifest.boards[0].id.clone()
            },
            None,
            &|_| Ok(())
        )
        .is_err());
    let external = json!({"external":"preserve"}).to_string();
    let path = project.path.clone();
    assert!(project
        .apply(
            &project.fingerprint.clone(),
            Action::CreateBoard {
                name: "Interrupted".into(),
                path: "Interrupted.depthplan".into()
            },
            None,
            &|phase| {
                if phase == "manifest-publish" {
                    fs::write(&path, &external).unwrap();
                }
                Ok(())
            }
        )
        .is_err());
    assert_eq!(fs::read_to_string(path).unwrap(), external);
    assert!(project.root.join("Interrupted.depthplan").exists());
}
#[test]
fn every_create_import_and_rename_boundary_is_recoverable() {
    for phase in [
        "create-folder",
        "board-publish",
        "board-published",
        "manifest-publish",
        "manifest-published",
    ] {
        let dir = tempfile::tempdir().unwrap();
        let result = Project::create(dir.path(), "project", "Project", None, &|p| {
            if p == phase {
                Err("injected".into())
            } else {
                Ok(())
            }
        });
        assert!(result.is_err());
        let root = dir.path().join("project");
        if root.join("project.depthproject").exists() {
            let reopened = Project::open(&root.join("project.depthproject")).unwrap();
            assert!(reopened.read_board(&reopened.manifest.boards[0].id).is_ok());
        }
    }
    for operation in ["import", "rename"] {
        let phases = if operation == "rename" {
            vec![
                "board-publish",
                "board-published",
                "manifest-publish",
                "manifest-published",
                "rename-cleanup",
                "rename-cleaned",
            ]
        } else {
            vec![
                "board-publish",
                "board-published",
                "manifest-publish",
                "manifest-published",
            ]
        };
        for phase in phases {
            let dir = tempfile::tempdir().unwrap();
            let mut project = create(dir.path());
            let original = project.manifest.boards[0].clone();
            let source = project.read_board(&original.id).unwrap();
            let action = if operation == "rename" {
                Action::RenameBoard {
                    board_id: original.id.clone(),
                    name: "New".into(),
                    path: "New.depthplan".into(),
                    expected: source["fingerprint"].as_str().unwrap().into(),
                }
            } else {
                Action::ImportBoard {
                    name: "New".into(),
                    path: "New.depthplan".into(),
                }
            };
            assert!(project
                .apply(
                    &project.fingerprint.clone(),
                    action,
                    Some(files::fixture()),
                    &|p| if p == phase {
                        Err("injected".into())
                    } else {
                        Ok(())
                    }
                )
                .is_err());
            let path = project.path.clone();
            drop(project);
            let project = Project::open(&path).unwrap();
            for board in &project.manifest.boards {
                assert!(project.read_board(&board.id).is_ok());
            }
            assert_eq!(
                project.root.join(&original.path).exists(),
                phase != "rename-cleaned"
            );
            if phase == "board-published" || phase == "manifest-publish" {
                assert!(!project.snapshot("s")["diagnostics"]
                    .as_array()
                    .unwrap()
                    .is_empty());
            }
        }
    }
}
#[test]
fn locks_block_second_writers_and_release_without_stale_pid_recovery() {
    let dir = tempfile::tempdir().unwrap();
    let project = create(dir.path());
    assert!(Project::open(&project.path).is_err());
    assert!(files::write_atomic(
        &project.root.join("Overview.depthplan"),
        b"overwrite",
        None,
        &|| Ok(())
    )
    .is_err());
    let path = project.path.clone();
    drop(project);
    assert!(path.parent().unwrap().join(LOCK).exists());
    assert!(Project::open(&path).is_ok());
}
#[test]
fn relocation_and_copy_keep_members_but_separate_local_workspace_keys() {
    let dir = tempfile::tempdir().unwrap();
    let project = create(dir.path());
    let key = project.snapshot("s")["workspaceKey"].clone();
    let copy = dir.path().join("copy");
    fs::create_dir(&copy).unwrap();
    for name in ["project.depthproject", "Overview.depthplan", LOCK] {
        fs::copy(project.root.join(name), copy.join(name)).unwrap();
    }
    let copied = Project::open(&copy.join("project.depthproject")).unwrap();
    assert_eq!(copied.manifest, project.manifest);
    assert_ne!(copied.snapshot("s")["workspaceKey"], key);
    drop(project);
    fs::rename(dir.path().join("project"), dir.path().join("moved")).unwrap();
    let moved = Project::open(&dir.path().join("moved/project.depthproject")).unwrap();
    assert!(moved.read_board(&moved.manifest.boards[0].id).is_ok());
}
#[cfg(unix)]
#[test]
fn symlinks_root_replacement_readonly_and_case_only_rename_are_safe() {
    use std::os::unix::fs::{symlink, PermissionsExt};
    let dir = tempfile::tempdir().unwrap();
    let mut project = create(dir.path());
    let alias = dir.path().join("alias");
    symlink(&project.root, &alias).unwrap();
    assert!(Project::open(&alias.join("project.depthproject")).is_err());
    let outside = dir.path().join("outside");
    fs::create_dir(&outside).unwrap();
    symlink(&outside, project.root.join("linked")).unwrap();
    symlink(
        outside.join("absent"),
        project.root.join("linked.depthplan"),
    )
    .unwrap();
    for path in ["linked/out.depthplan", "linked.depthplan"] {
        assert!(project
            .apply(
                &project.fingerprint.clone(),
                Action::CreateBoard {
                    name: "Board".into(),
                    path: path.into()
                },
                None,
                &|_| Ok(())
            )
            .is_err());
    }
    assert!(fs::read_dir(&outside).unwrap().next().is_none());
    let board = project.manifest.boards[0].clone();
    let fingerprint = project.read_board(&board.id).unwrap()["fingerprint"].clone();
    assert!(project.apply(&project.fingerprint.clone(),serde_json::from_value(json!({"kind":"renameBoard","boardId":board.id,"name":"Overview","path":"overview.depthplan","expected":fingerprint})).unwrap(),None,&|_|Ok(())).is_err());
    fs::set_permissions(&project.root, fs::Permissions::from_mode(0o500)).unwrap();
    let result = project.apply(
        &project.fingerprint.clone(),
        Action::CreateBoard {
            name: "Denied".into(),
            path: "Denied.depthplan".into(),
        },
        None,
        &|_| Ok(()),
    );
    fs::set_permissions(&project.root, fs::Permissions::from_mode(0o700)).unwrap();
    assert!(result.is_err());
    let root = project.root.clone();
    fs::rename(&root, dir.path().join("moved")).unwrap();
    symlink(&outside, &root).unwrap();
    assert!(project
        .apply(
            &project.fingerprint.clone(),
            Action::CreateBoard {
                name: "Escape".into(),
                path: "Escape.depthplan".into()
            },
            None,
            &|_| Ok(())
        )
        .is_err());
    assert!(fs::read_dir(outside).unwrap().next().is_none());
}

#[test]
fn killed_owner_releases_the_os_lock() {
    const CHILD_ROOT: &str = "DEPTHPLAN_PROJECT_LOCK_TEST";
    if let Some(root) = std::env::var_os(CHILD_ROOT) {
        let _project = Project::open(&PathBuf::from(root).join("project.depthproject")).unwrap();
        println!("PROJECT_LOCK_READY");
        loop {
            std::thread::park();
        }
    }
    use std::io::BufRead;
    let dir = tempfile::tempdir().unwrap();
    let project = create(dir.path());
    let root = project.root.clone();
    drop(project);
    let mut child = std::process::Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            "projects::tests::killed_owner_releases_the_os_lock",
            "--nocapture",
        ])
        .env(CHILD_ROOT, &root)
        .stdout(std::process::Stdio::piped())
        .spawn()
        .unwrap();
    let mut ready = false;
    for line in std::io::BufReader::new(child.stdout.take().unwrap()).lines() {
        if line.unwrap().contains("PROJECT_LOCK_READY") {
            ready = true;
            break;
        }
    }
    assert!(ready);
    assert!(Project::open(&root.join("project.depthproject")).is_err());
    child.kill().unwrap();
    child.wait().unwrap();
    assert!(Project::open(&root.join("project.depthproject")).is_ok());
}

#[test]
fn interrupted_nested_output_and_external_rename_edits_are_reported() {
    let dir = tempfile::tempdir().unwrap();
    let mut project = create(dir.path());
    fs::create_dir(project.root.join("nested")).unwrap();
    assert!(project
        .apply(
            &project.fingerprint.clone(),
            Action::CreateBoard {
                name: "Nested".into(),
                path: "nested/New.depthplan".into()
            },
            None,
            &|phase| if phase == "manifest-publish" {
                Err("injected".into())
            } else {
                Ok(())
            }
        )
        .is_err());
    assert!(project.snapshot("s")["diagnostics"]
        .as_array()
        .unwrap()
        .iter()
        .any(|d| d["path"] == "nested/New.depthplan"));
    let board = project.manifest.boards[0].clone();
    let read = project.read_board(&board.id).unwrap();
    let original_path = project.root.join(&board.path);
    let mut external = read["document"].clone();
    external["metadata"]["title"] = "External edit".into();
    let original_manifest = fs::read(&project.path).unwrap();
    assert!(project
        .apply(
            &project.fingerprint.clone(),
            Action::RenameBoard {
                board_id: board.id,
                name: "Renamed".into(),
                path: "Renamed.depthplan".into(),
                expected: read["fingerprint"].as_str().unwrap().into()
            },
            None,
            &|phase| {
                if phase == "manifest-publish" {
                    fs::write(&original_path, serde_json::to_vec(&external).unwrap()).unwrap();
                }
                Ok(())
            }
        )
        .is_err());
    assert_eq!(fs::read(&project.path).unwrap(), original_manifest);
    assert_eq!(
        serde_json::from_slice::<Value>(&fs::read(original_path).unwrap()).unwrap(),
        external
    );
    let mut value = json!(project.manifest);
    value["name"] = "😀".repeat(61).into();
    assert!(manifest(&value).is_err());
}
