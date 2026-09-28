use super::*;
fn create(dir: &Path) -> Project {
    Project::create(dir, "project", "Project", None, &|_| Ok(())).unwrap()
}
#[test]
fn definition_resolution_requires_the_observed_version_and_preserves_board_files() {
    let dir = tempfile::tempdir().unwrap();
    let mut project = create(dir.path());
    let id = project.manifest.boards[0].id.clone();
    let board = fs::read(project.board_path(&id).unwrap()).unwrap();
    let original = project.manifest.clone();
    let mut external = original.clone();
    external.name = "External name".into();
    fs::write(
        &project.disk().unwrap().path,
        serde_json::to_vec(&external).unwrap(),
    )
    .unwrap();
    let (_, observed) = project.read_definition().unwrap();
    assert!(project
        .write_board(&id, "stale", &files::fixture(), &|| Ok(()))
        .is_err());
    fs::write(
        &project.disk().unwrap().path,
        serde_json::to_vec_pretty(&external).unwrap(),
    )
    .unwrap();
    assert!(project.resolve_definition(&observed, true).is_err());
    assert_eq!(project.manifest, original);
    let (_, observed) = project.read_definition().unwrap();
    project.resolve_definition(&observed, false).unwrap();
    assert_eq!(project.manifest.name, "External name");
    external.name = "Another external name".into();
    fs::write(
        &project.disk().unwrap().path,
        serde_json::to_vec(&external).unwrap(),
    )
    .unwrap();
    let (_, observed) = project.read_definition().unwrap();
    project.resolve_definition(&observed, true).unwrap();
    assert_eq!(
        read_manifest(&project.disk().unwrap().path).unwrap().0.name,
        "External name"
    );
    assert_eq!(fs::read(project.board_path(&id).unwrap()).unwrap(), board);
    external.id = Uuid::new_v4().to_string();
    fs::write(
        &project.disk().unwrap().path,
        serde_json::to_vec(&external).unwrap(),
    )
    .unwrap();
    assert!(project.read_definition().is_err());
}
#[test]
fn settings_failures_preserve_policy_and_boards_and_move_with_the_folder() {
    let dir = tempfile::tempdir().unwrap();
    let mut project = create(dir.path());
    let board = project.manifest.boards[0].clone();
    let bytes = fs::read(project.board_path(&board.id).unwrap()).unwrap();
    let original = project.manifest.clone();
    let settings = |home: &str| {
        serde_json::from_value(json!({
        "kind":"settings", "name":"New display name", "description":"Portable", "homeBoardId":home, "autosave":false
    })).unwrap()
    };
    let expected = project.fingerprint.clone();
    assert!(project
        .apply(&expected, settings("missing"), None, &|_| Ok(()))
        .is_err());
    assert!(project
        .apply(&expected, settings(&board.id), None, &|phase| {
            if phase == "manifest-publish" {
                Err("Storage unavailable".into())
            } else {
                Ok(())
            }
        })
        .is_err());
    assert_eq!(project.manifest, original);
    let external = fs::read(&project.disk().unwrap().path).unwrap();
    fs::write(
        &project.disk().unwrap().path,
        [external.as_slice(), b"\n"].concat(),
    )
    .unwrap();
    assert!(project
        .apply(&expected, settings(&board.id), None, &|_| Ok(()))
        .is_err());
    assert_eq!(project.manifest, original);
    fs::write(&project.disk().unwrap().path, external).unwrap();
    project
        .apply(&expected, settings(&board.id), None, &|_| Ok(()))
        .unwrap();
    assert_eq!(
        fs::read(project.board_path(&board.id).unwrap()).unwrap(),
        bytes
    );
    assert_eq!(
        project.disk().unwrap().path,
        dir.path()
            .join("project/project.depthproject")
            .canonicalize()
            .unwrap()
    );
    let saved = project.manifest.clone();
    drop(project);
    fs::rename(dir.path().join("project"), dir.path().join("moved")).unwrap();
    let project = Project::open(&dir.path().join("moved/project.depthproject")).unwrap();
    assert_eq!(project.manifest, saved);
    assert!(!project.manifest.autosave);
}
#[test]
fn board_saves_use_owned_project_and_reject_stale_identity_or_manifest() {
    let dir = tempfile::tempdir().unwrap();
    let mut project = create(dir.path());
    let id = project.manifest.boards[0].id.clone();
    let read = project.read_board(&id).unwrap();
    let original = read["fingerprint"].as_str().unwrap();
    let mut edited = read["document"].clone();
    edited["metadata"]["title"] = "Accepted content".into();
    let before = fs::read(project.board_path(&id).unwrap()).unwrap();
    let calls = std::cell::Cell::new(0);
    assert!(project
        .write_board(&id, original, &edited, &|| {
            calls.set(calls.get() + 1);
            if calls.get() == 2 {
                Err("Access revoked".into())
            } else {
                Ok(())
            }
        })
        .is_err());
    assert_eq!(calls.get(), 2);
    assert_eq!(fs::read(project.board_path(&id).unwrap()).unwrap(), before);
    let saved = project
        .write_board(&id, original, &edited, &|| Ok(()))
        .unwrap();
    assert_eq!(
        project.read_board(&id).unwrap()["document"]["metadata"]["title"],
        "Accepted content"
    );
    assert!(project
        .write_board(&id, original, &edited, &|| Ok(()))
        .is_err());
    assert!(project
        .write_board("unknown", &saved, &edited, &|| Ok(()))
        .is_err());
    edited["id"] = "wrong".into();
    assert!(project
        .write_board(&id, &saved, &edited, &|| Ok(()))
        .is_err());
    edited["id"] = id.clone().into();
    let path = project.board_path(&id).unwrap();
    let bytes = fs::read(&path).unwrap();
    fs::write(&project.disk().unwrap().path, "{}").unwrap();
    assert!(project
        .write_board(&id, &saved, &edited, &|| Ok(()))
        .is_err());
    assert_eq!(fs::read(&path).unwrap(), bytes);
    fs::write(
        &project.disk().unwrap().path,
        serde_json::to_vec(&project.manifest).unwrap(),
    )
    .unwrap();
    let source = dir.path().join("legacy.depthplan.json");
    fs::write(&source, serde_json::to_vec(&edited).unwrap()).unwrap();
    let imported = project.import_path(&source).unwrap();
    assert_ne!(imported, id);
    assert!(source.exists());
    let count = project.manifest.boards.len();
    fs::write(&source, "{}").unwrap();
    assert!(project.import_path(&source).is_err());
    assert_eq!(project.manifest.boards.len(), count);
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
    assert!(!project.disk().unwrap().root.join(&imported.path).exists());
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
    assert!(project
        .disk()
        .unwrap()
        .root
        .join("Renamed.depthplan")
        .exists());
    let expected = project.manifest.clone();
    let path = project.disk().unwrap().path.clone();
    drop(project);
    let project = Project::open(&path).unwrap();
    assert_eq!(project.manifest, expected);
    assert_eq!(project.manifest.boards[0].id, duplicate.id);
    let mut files = files::FileStore::default();
    assert!(files
        .read(&project.disk().unwrap().root.join("Copy.depthplan"))
        .is_ok());
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
    fs::remove_file(project.disk().unwrap().root.join("Missing.depthplan")).unwrap();
    fs::write(project.disk().unwrap().root.join("Broken.depthplan"), "bad").unwrap();
    fs::write(
        project.disk().unwrap().root.join("Replaced.depthplan"),
        serde_json::to_vec(&blank("Replacement")).unwrap(),
    )
    .unwrap();
    let path = project.disk().unwrap().path.clone();
    drop(project);
    let project = Project::open(&path).unwrap();
    assert_eq!(
        project.snapshot("session")["diagnostics"]
            .as_array()
            .unwrap()
            .len(),
        1 // Missing path is reported immediately; content remains lazy.
    );
    for board in &project.manifest.boards[1..] {
        assert!(project.read_board(&board.id).is_err());
    }
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
    let original = fs::read(&project.disk().unwrap().path).unwrap();
    fs::write(
        project.disk().unwrap().root.join("OTHER.depthplan"),
        "unrelated",
    )
    .unwrap();
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
    assert_eq!(fs::read(&project.disk().unwrap().path).unwrap(), original);
    assert_eq!(
        fs::read_to_string(project.disk().unwrap().root.join("OTHER.depthplan")).unwrap(),
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
    let path = project.disk().unwrap().path.clone();
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
    assert!(project
        .disk()
        .unwrap()
        .root
        .join("Interrupted.depthplan")
        .exists());
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
    for operation in ["import", "rename", "retitle"] {
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
            let action = if operation != "import" {
                Action::RenameBoard {
                    board_id: original.id.clone(),
                    name: "New".into(),
                    path: if operation == "retitle" {
                        original.path.clone()
                    } else {
                        "New.depthplan".into()
                    },
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
            let path = project.disk().unwrap().path.clone();
            drop(project);
            let project = Project::open(&path).unwrap();
            for board in &project.manifest.boards {
                assert!(project.read_board(&board.id).is_ok());
            }
            assert_eq!(
                project.disk().unwrap().root.join(&original.path).exists(),
                phase != "rename-cleaned"
            );
            if operation != "retitle" && (phase == "board-published" || phase == "manifest-publish")
            {
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
    assert!(Project::open(&project.disk().unwrap().path).is_err());
    assert!(files::write_atomic(
        &project.disk().unwrap().root.join("Overview.depthplan"),
        b"overwrite",
        None,
        &|| Ok(())
    )
    .is_err());
    let path = project.disk().unwrap().path.clone();
    // A concurrently spawned child can briefly retain a duplicate descriptor.
    let inherited = project.disk().unwrap().owner.0.try_clone().unwrap();
    drop(project);
    assert!(path.parent().unwrap().join(LOCK).exists());
    assert!(Project::open(&path).is_ok());
    drop(inherited);
}
#[test]
fn relocation_and_copy_keep_members_but_separate_local_workspace_keys() {
    let dir = tempfile::tempdir().unwrap();
    let project = create(dir.path());
    let key = project.snapshot("s")["workspaceKey"].clone();
    let copy = dir.path().join("copy");
    fs::create_dir(&copy).unwrap();
    for name in ["project.depthproject", "Overview.depthplan", LOCK] {
        fs::copy(project.disk().unwrap().root.join(name), copy.join(name)).unwrap();
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
    symlink(&project.disk().unwrap().root, &alias).unwrap();
    assert!(Project::open(&alias.join("project.depthproject")).is_err());
    let outside = dir.path().join("outside");
    fs::create_dir(&outside).unwrap();
    symlink(&outside, project.disk().unwrap().root.join("linked")).unwrap();
    symlink(
        outside.join("absent"),
        project.disk().unwrap().root.join("linked.depthplan"),
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
    fs::set_permissions(
        &project.disk().unwrap().root,
        fs::Permissions::from_mode(0o500),
    )
    .unwrap();
    let result = project.apply(
        &project.fingerprint.clone(),
        Action::CreateBoard {
            name: "Denied".into(),
            path: "Denied.depthplan".into(),
        },
        None,
        &|_| Ok(()),
    );
    fs::set_permissions(
        &project.disk().unwrap().root,
        fs::Permissions::from_mode(0o700),
    )
    .unwrap();
    assert!(result.is_err());
    let root = project.disk().unwrap().root.clone();
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
    let root = project.disk().unwrap().root.clone();
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
    fs::create_dir(project.disk().unwrap().root.join("nested")).unwrap();
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
    let original_path = project.disk().unwrap().root.join(&board.path);
    let mut external = read["document"].clone();
    external["metadata"]["title"] = "External edit".into();
    let original_manifest = fs::read(&project.disk().unwrap().path).unwrap();
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
    assert_eq!(
        fs::read(&project.disk().unwrap().path).unwrap(),
        original_manifest
    );
    assert_eq!(
        serde_json::from_slice::<Value>(&fs::read(original_path).unwrap()).unwrap(),
        external
    );
    let mut value = json!(project.manifest);
    value["name"] = "😀".repeat(61).into();
    assert!(manifest(&value).is_err());
}

#[test]
fn read_only_boards_and_manifests_preserve_original_files() {
    let dir = tempfile::tempdir().unwrap();
    let mut project = create(dir.path());
    let board = project.manifest.boards[0].clone();
    let path = project.board_path(&board.id).unwrap();
    let before = fs::read(&path).unwrap();
    let read = project.read_board(&board.id).unwrap();
    let permissions = fs::metadata(&path).unwrap().permissions();
    let mut protected = permissions.clone();
    protected.set_readonly(true);
    fs::set_permissions(&path, protected).unwrap();
    assert!(project
        .write_board(
            &board.id,
            read["fingerprint"].as_str().unwrap(),
            &read["document"],
            &|| Ok(())
        )
        .unwrap_err()
        .contains("read-only"));
    assert_eq!(fs::read(&path).unwrap(), before);
    fs::set_permissions(&path, permissions).unwrap();
    let permissions = fs::metadata(&project.disk().unwrap().path)
        .unwrap()
        .permissions();
    let original = fs::read(&project.disk().unwrap().path).unwrap();
    let mut protected = permissions.clone();
    protected.set_readonly(true);
    fs::set_permissions(&project.disk().unwrap().path, protected).unwrap();
    assert!(project
        .apply(
            &project.fingerprint.clone(),
            Action::CreateBoard {
                name: "Blocked".into(),
                path: "Blocked.depthplan".into()
            },
            None,
            &|_| Ok(())
        )
        .unwrap_err()
        .contains("read-only"));
    assert!(!project
        .disk()
        .unwrap()
        .root
        .join("Blocked.depthplan")
        .exists());
    assert_eq!(fs::read(&project.disk().unwrap().path).unwrap(), original);
    fs::set_permissions(&project.disk().unwrap().path, permissions).unwrap();
    // The same guard protects standalone atomic writes, including a flag changed mid-write.
    let standalone = dir.path().join("standalone.depthplan");
    fs::write(&standalone, &before).unwrap();
    let permissions = fs::metadata(&standalone).unwrap().permissions();
    let mut protected = permissions.clone();
    protected.set_readonly(true);
    let calls = std::cell::Cell::new(0);
    assert!(files::write_atomic(&standalone, b"replacement", None, &|| {
        calls.set(calls.get() + 1);
        if calls.get() == 2 {
            fs::set_permissions(&standalone, protected.clone()).map_err(|e| e.to_string())?;
        }
        Ok(())
    })
    .unwrap_err()
    .contains("read-only"));
    assert_eq!(calls.get(), 2);
    assert_eq!(fs::read(&standalone).unwrap(), before);
    fs::set_permissions(&standalone, permissions).unwrap();
}

#[test]
fn internal_references_survive_duplicate_import_rename_and_relocation_without_retargeting() {
    let dir = tempfile::tempdir().unwrap();
    let mut project = Project::create(
        dir.path(),
        "linked",
        "Linked",
        Some(files::fixture()),
        &|_| Ok(()),
    )
    .unwrap();
    let board_id = project.manifest.boards[0].id.clone();
    let original = project.read_board(&board_id).unwrap();
    let mut document = original["document"].clone();
    let object_id = document["objects"]
        .as_object()
        .unwrap()
        .keys()
        .next()
        .unwrap()
        .clone();
    let link = json!({"projectId":project.manifest.id,"boardId":board_id,"bookmarkId":"view"});
    document["objects"][&object_id]["projectLink"] = link.clone();
    project
        .write_board(
            &board_id,
            original["fingerprint"].as_str().unwrap(),
            &document,
            &|| Ok(()),
        )
        .unwrap();
    apply(
        &mut project,
        json!({"kind":"duplicateBoard","boardId":board_id,"name":"Duplicate","path":"Duplicate.depthplan"}),
    );
    let copied_id = project.manifest.boards[1].id.clone();
    assert_ne!(copied_id, board_id);
    assert_eq!(
        project.read_board(&copied_id).unwrap()["document"]["objects"][&object_id]["projectLink"],
        link
    );
    let external = dir.path().join("import.depthplan");
    fs::write(&external, serde_json::to_vec(&document).unwrap()).unwrap();
    let imported_id = project.import_path(&external).unwrap();
    assert_ne!(imported_id, board_id);
    assert_eq!(
        project.read_board(&imported_id).unwrap()["document"]["objects"][&object_id]["projectLink"],
        link
    );
    let expected = project.read_board(&board_id).unwrap()["fingerprint"].clone();
    apply(
        &mut project,
        json!({"kind":"renameBoard","boardId":board_id,"name":"Renamed","path":"Renamed.depthplan","expected":expected}),
    );
    let manifest = project.manifest.clone();
    drop(project);
    fs::rename(dir.path().join("linked"), dir.path().join("moved")).unwrap();
    let project = Project::open(&dir.path().join("moved/project.depthproject")).unwrap();
    assert_eq!(project.manifest, manifest);
    assert_eq!(
        project.read_board(&board_id).unwrap()["document"]["objects"][&object_id]["projectLink"],
        link
    );
}

#[test]
fn same_path_rename_preserves_external_edits_before_board_and_manifest_publication() {
    for phase in ["board-publish", "manifest-publish"] {
        let dir = tempfile::tempdir().unwrap();
        let mut project = create(dir.path());
        let board = project.manifest.boards[0].clone();
        let current = project.read_board(&board.id).unwrap();
        let path = project.board_path(&board.id).unwrap();
        let original_manifest = fs::read(&project.disk().unwrap().path).unwrap();
        let mut external = current["document"].clone();
        external["metadata"]["title"] = "External edit".into();
        let external = serde_json::to_vec_pretty(&external).unwrap();
        assert!(project
            .apply(
                &project.fingerprint.clone(),
                Action::RenameBoard {
                    board_id: board.id,
                    name: "overview".into(),
                    path: board.path,
                    expected: current["fingerprint"].as_str().unwrap().into(),
                },
                None,
                &|p| {
                    if p == phase {
                        fs::write(&path, &external).unwrap();
                    }
                    Ok(())
                },
            )
            .is_err());
        assert_eq!(fs::read(&path).unwrap(), external);
        assert_eq!(
            fs::read(&project.disk().unwrap().path).unwrap(),
            original_manifest
        );
    }
}

#[test]
fn renaming_without_changing_the_path_updates_memory_and_saved_boards() {
    let dir = tempfile::tempdir().unwrap();
    let mut project = Project::new();
    let board = project.manifest.boards[0].clone();
    let path = dir.path().join("project.depthproject");
    for name in ["Untitled board", "UNTITLED BOARD"] {
        let current = project.read_board(&board.id).unwrap();
        apply(
            &mut project,
            json!({"kind":"renameBoard","boardId":board.id,"name":name,"path":board.path,"expected":current["fingerprint"]}),
        );
        assert_eq!(project.manifest.boards[0].path, board.path);
        assert_eq!(project.manifest.boards[0].name, name);
        let mut expected = current["document"].clone();
        expected["metadata"]["title"] = name.into();
        let actual = project.read_board(&board.id).unwrap()["document"].clone();
        expected["metadata"]["modified"] = actual["metadata"]["modified"].clone();
        assert_eq!(actual, expected);
        if project.is_draft() {
            assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 0);
            project
                .save(
                    &path,
                    &project.fingerprint.clone(),
                    project.manifest.clone(),
                    &[],
                    &|_| Ok(()),
                )
                .unwrap();
        }
    }
    assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 3);
    let expected = project.manifest.clone();
    drop(project);
    let reopened = Project::open(&path).unwrap();
    assert_eq!(reopened.manifest, expected);
    assert_eq!(
        reopened.read_board(&board.id).unwrap()["document"]["metadata"]["title"],
        "UNTITLED BOARD"
    );
}

#[test]
fn memory_project_retains_boards_until_first_save_and_then_reopens() {
    let dir = tempfile::tempdir().unwrap();
    let mut project = Project::new();
    let first = project.manifest.boards[0].id.clone();
    assert!(project.snapshot("session")["location"].is_null());
    assert!(project.board_path(&first).is_err());
    let mut document = project.read_board(&first).unwrap()["document"].clone();
    document["metadata"]["title"] = "Accepted edit".into();
    project
        .write_board(&first, "", &document, &|| Ok(()))
        .unwrap();
    project
        .apply(
            &project.fingerprint.clone(),
            Action::DuplicateBoard {
                board_id: first.clone(),
                name: "API Details".into(),
                path: "api_details.depthplan".into(),
                document: None,
            },
            None,
            &|_| Ok(()),
        )
        .unwrap();
    let second = project.manifest.boards[1].id.clone();
    assert_ne!(first, second);
    assert_eq!(project.read_board(&first).unwrap()["document"], document);
    assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 0);
    let mut candidate = project.manifest.clone();
    candidate.name = "My Project".into();
    candidate.boards[0].name = "API Details".into();
    candidate.boards[0].path = "api_details_2.depthplan".into();
    let path = dir.path().join("my_project.depthproject");
    let mut invalid = candidate.clone();
    invalid.boards.pop();
    assert!(project
        .save(&path, &project.fingerprint.clone(), invalid, &[], &|_| Ok(
            ()
        ))
        .is_err());
    project
        .save(
            &path,
            &project.fingerprint.clone(),
            candidate.clone(),
            &[],
            &|_| Ok(()),
        )
        .unwrap();
    assert!(!project.is_draft());
    assert!(project.documents.is_empty());
    assert_eq!(read_manifest(&path).unwrap().0, candidate);
    let board = project.read_board(&first).unwrap();
    assert_eq!(board["document"]["metadata"]["title"], "API Details");
    let mut edited = board["document"].clone();
    edited["metadata"]["title"] = "After first save".into();
    project
        .write_board(
            &first,
            board["fingerprint"].as_str().unwrap(),
            &edited,
            &|| Ok(()),
        )
        .unwrap();
    drop(project);
    let reopened = Project::open(&path).unwrap();
    assert_eq!(reopened.manifest, candidate);
    assert_eq!(
        reopened.read_board(&first).unwrap()["document"]["metadata"]["title"],
        "After first save"
    );
    assert_eq!(
        reopened.read_board(&second).unwrap()["document"]["id"],
        second
    );
}

#[test]
fn save_project_as_copies_nested_boards_and_accepted_edits_without_changing_the_original() {
    let dir = tempfile::tempdir().unwrap();
    let mut project = create(dir.path());
    let first = project.manifest.boards[0].id.clone();
    let original_path = project.disk().unwrap().path.clone();
    fs::create_dir(project.disk().unwrap().root.join("nested")).unwrap();
    apply(
        &mut project,
        json!({"kind":"duplicateBoard","boardId":first,"name":"Detail","path":"nested/detail.depthplan"}),
    );
    let original = project.snapshot("session");
    let original_files: Vec<_> = std::iter::once(original_path.clone())
        .chain(
            project
                .manifest
                .boards
                .iter()
                .map(|b| project.board_path(&b.id).unwrap()),
        )
        .map(|path| {
            let bytes = fs::read(&path).unwrap();
            (path, bytes)
        })
        .collect();
    let mut accepted = project.read_board(&first).unwrap()["document"].clone();
    accepted["extensions"] = json!({"accepted": true});
    for phase in ["board-publish", "manifest-publish", "manifest-published"] {
        let destination = tempfile::tempdir().unwrap();
        assert!(project
            .save(
                &destination.path().join("copy.depthproject"),
                &project.fingerprint.clone(),
                project.manifest.clone(),
                &[accepted.clone()],
                &|step| {
                    if step == phase {
                        Err("Injected copy failure".into())
                    } else {
                        Ok(())
                    }
                }
            )
            .is_err());
        assert_eq!(project.snapshot("session"), original);
        for (path, bytes) in &original_files {
            assert_eq!(fs::read(path).unwrap(), *bytes);
        }
    }
    let destination = tempfile::tempdir().unwrap();
    let path = destination.path().join("copy.depthproject");
    for documents in [
        vec![accepted.clone(), accepted.clone()],
        vec![json!({"id":"foreign"})],
    ] {
        assert!(project
            .save(
                &path,
                &project.fingerprint.clone(),
                project.manifest.clone(),
                &documents,
                &|_| Ok(())
            )
            .is_err());
        assert!(!path.exists());
    }
    project
        .save(
            &path,
            &project.fingerprint.clone(),
            project.manifest.clone(),
            &[accepted.clone()],
            &|_| Ok(()),
        )
        .unwrap();
    assert_eq!(project.disk().unwrap().path, path.canonicalize().unwrap());
    assert_eq!(project.read_board(&first).unwrap()["document"], accepted);
    assert!(destination.path().join("nested/detail.depthplan").is_file());
    let original = Project::open(&original_path).unwrap();
    assert_eq!(original.manifest, project.manifest);
    for board in &project.manifest.boards[1..] {
        assert_eq!(
            original.read_board(&board.id).unwrap()["document"],
            project.read_board(&board.id).unwrap()["document"]
        );
    }
    let read = project.read_board(&first).unwrap();
    accepted["extensions"] = json!({"afterCopy": true});
    project
        .write_board(
            &first,
            read["fingerprint"].as_str().unwrap(),
            &accepted,
            &|| Ok(()),
        )
        .unwrap();
    for (path, bytes) in &original_files {
        assert_eq!(fs::read(path).unwrap(), *bytes);
    }
    assert_eq!(
        project.read_board(&first).unwrap()["document"]["extensions"]["afterCopy"],
        true
    );
}

#[test]
fn first_save_errors_keep_memory_and_never_replace_existing_files() {
    for phase in [
        "board-publish",
        "board-published",
        "manifest-publish",
        "manifest-published",
    ] {
        let dir = tempfile::tempdir().unwrap();
        let mut project = Project::new();
        let before = project.snapshot("session");
        let document = project.read_board(&project.manifest.boards[0].id).unwrap();
        let path = dir.path().join("project.depthproject");
        assert!(project
            .save(
                &path,
                &project.fingerprint.clone(),
                project.manifest.clone(),
                &[],
                &|step| {
                    if step == phase {
                        Err("Injected storage failure".into())
                    } else {
                        Ok(())
                    }
                }
            )
            .is_err());
        assert_eq!(project.snapshot("session"), before);
        assert_eq!(
            project.read_board(&project.manifest.boards[0].id).unwrap(),
            document
        );
    }
    let dir = tempfile::tempdir().unwrap();
    let mut project = Project::new();
    let path = dir.path().join("project.depthproject");
    let occupied = dir.path().join("UNTITLED_BOARD.depthplan");
    fs::write(&occupied, b"unrelated content").unwrap();
    assert!(project
        .save(
            &path,
            &project.fingerprint.clone(),
            project.manifest.clone(),
            &[],
            &|_| Ok(())
        )
        .is_err());
    assert_eq!(fs::read(&occupied).unwrap(), b"unrelated content");
    assert!(!path.exists());
    assert!(project.is_draft());
    fs::write(&path, b"another project").unwrap();
    assert!(project
        .save(
            &path,
            &project.fingerprint.clone(),
            project.manifest.clone(),
            &[],
            &|_| Ok(())
        )
        .is_err());
    assert_eq!(fs::read(&path).unwrap(), b"another project");
}
