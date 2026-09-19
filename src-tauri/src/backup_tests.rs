//! Temp-directory-only tests for manual backups. No real user data is touched.
use super::*;
use std::{fs, path::PathBuf};

struct Fixture(PathBuf);
impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!("kv-backup-test-{}", vault::unique_id()));
        fs::create_dir_all(&root).unwrap();
        Self(root)
    }
    fn dir(&self, name: &str) -> PathBuf { self.0.join(name) }
    fn write(&self, rel: &str, bytes: &[u8]) {
        let path = self.0.join(rel);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, bytes).unwrap();
    }
}
impl Drop for Fixture {
    fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); }
}

fn source_with_git() -> (Fixture, PathBuf) {
    let f = Fixture::new();
    let source = f.dir("source");
    f.write("source/a/n.md", b"# v1\n");
    f.write("source/a/asset.bin", &[0u8, 159, 146, 150, 255]);
    f.write("source/.kv/history/1.kv", b"{}");
    f.write("source/.kv/trash/2.kv", b"{}");
    f.write("source/.git/HEAD", b"ref: refs/heads/main\n");
    (f, source)
}

fn learning() -> Value {
    serde_json::json!({
        "articles": { "a/n.md": { "favorite": true, "status": "learning" } },
        "cards": [ { "id": "c1", "question": "q", "answer": "a" } ],
        "activity": { "2026-04-01": { "read": ["a/n.md"] } }
    })
}

fn create_ok(f: &Fixture, source: &Path) -> (PathBuf, String) {
    let backups = f.dir("backups");
    let info = create_inner(&backups, source, source.to_str().unwrap(), &learning()).unwrap();
    assert!(backups.join(&info.id).join("knowledge").is_dir());
    (backups, info.id)
}

#[test]
fn create_list_restore_roundtrip_independent_copy_never_overwrites() {
    let (f, source) = source_with_git();
    let (backups, id) = create_ok(&f, &source);
    // .git excluded, .kv history/trash and assets kept.
    assert!(!backups.join(&id).join("knowledge/.git").exists());
    assert!(backups.join(&id).join("knowledge/.kv/history/1.kv").is_file());
    assert!(backups.join(&id).join("knowledge/a/asset.bin").is_file());
    assert!(backups.join(&id).join("learning.json").is_file());

    let listed = list_inner(&backups).unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].id, id);
    assert_eq!(listed[0].source_root, source.to_str().unwrap());
    assert_eq!(listed[0].files, 4); // n.md, asset.bin, 2 .kv records

    let restored = f.dir("restored");
    let first = restore_inner(&backups, &restored, &id).unwrap();
    assert_eq!(fs::read_to_string(Path::new(&first.path).join("a/n.md")).unwrap(), "# v1\n");
    assert_eq!(first.learning["articles"]["a/n.md"]["favorite"], true);
    // A second restore creates an independent folder; nothing is overwritten.
    let second = restore_inner(&backups, &restored, &id).unwrap();
    assert_ne!(first.path, second.path);
    assert!(Path::new(&first.path).join("a/n.md").is_file());
}

#[test]
fn create_rejects_wrong_root_nested_target_learning_and_limits() {
    let (f, source) = source_with_git();
    let backups = f.dir("backups");
    // Wrong expected_root.
    assert!(create_inner(&backups, &source, "Q:\\nope", &learning()).is_err());
    // Target nested inside the source (app data can be an ancestor of the root).
    assert!(create_inner(&source.join("backups"), &source, source.to_str().unwrap(), &learning()).is_err());
    // Missing articles/cards; activity must be an object when present.
    for bad in [
        serde_json::json!({ "cards": [] }),
        serde_json::json!({ "articles": {}, "cards": 0 }),
        serde_json::json!({ "articles": {}, "cards": [], "activity": [] }),
    ] {
        assert!(create_inner(&backups, &source, source.to_str().unwrap(), &bad).is_err());
    }
    // Oversized learning is refused before any staging.
    let huge = serde_json::json!({ "articles": {}, "cards": [{ "pad": "x".repeat(MAX_LEARNING as usize) }] });
    assert!(create_inner(&backups, &source, source.to_str().unwrap(), &huge).is_err());

    // Per-file limit on a sparse 100 MiB+1 file.
    let big = source.join("a/big.bin");
    File::create(&big).unwrap().set_len(MAX_FILE + 1).unwrap();
    assert!(create_inner(&backups, &source, source.to_str().unwrap(), &learning()).is_err());
    fs::remove_file(&big).unwrap();
    // A normal create still works after the failures.
    create_inner(&backups, &source, source.to_str().unwrap(), &learning()).unwrap();
}

#[test]
fn symlinked_file_directory_and_ancestor_are_refused() {
    let (f, source) = source_with_git();
    let backups = f.dir("backups");
    #[cfg(windows)]
    {
        use std::os::windows::fs::{symlink_dir, symlink_file};
        if symlink_dir(&source.join("a"), source.join("link-dir")).is_ok() {
            assert!(create_inner(&backups, &source, source.to_str().unwrap(), &learning()).is_err());
            fs::remove_dir(source.join("link-dir")).unwrap();
        }
        if symlink_file(&source.join("a/n.md"), source.join("a/link.md")).is_ok() {
            assert!(create_inner(&backups, &source, source.to_str().unwrap(), &learning()).is_err());
            fs::remove_file(source.join("a/link.md")).ok();
        }
    }
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(source.join("a"), source.join("link-dir")).unwrap();
        assert!(create_inner(&backups, &source, source.to_str().unwrap(), &learning()).is_err());
        fs::remove_file(source.join("link-dir")).unwrap();
        std::os::unix::fs::symlink(source.join("a/n.md"), source.join("a/link.md")).unwrap();
        assert!(create_inner(&backups, &source, source.to_str().unwrap(), &learning()).is_err());
        fs::remove_file(source.join("a/link.md")).unwrap();
    }
    // The whole source root being a symlink/junction is rejected.
    let link_root = f.dir("link-root");
    #[cfg(windows)]
    {
        use std::os::windows::fs::symlink_dir;
        if symlink_dir(&source, &link_root).is_ok() {
            assert!(create_inner(&backups, &link_root, link_root.to_str().unwrap(), &learning()).is_err());
        }
    }
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(&source, &link_root).unwrap();
        assert!(create_inner(&backups, &link_root, link_root.to_str().unwrap(), &learning()).is_err());
    }
}

#[test]
fn preflight_failure_and_external_edit_prevent_publication() {
    let (f, source) = source_with_git();
    let backups = f.dir("backups");
    // Internal writes are serialized by the io lock; simulate a concurrent internal
    // write arriving during the copy by rejecting from a preflight after copying.
    let before_count = scan(&source, true).unwrap().entries.len();
    assert!(create_with_preflight(&backups, &source, source.to_str().unwrap(), &learning(), || {
        f.write("source/a/new.md", b"arrived during backup");
        Err("模拟内部写入".into())
    })
    .is_err());
    // The live file arrived anyway (write path is independent), no backup published.
    assert!(source.join("a/new.md").is_file());
    assert_eq!(scan(&source, true).unwrap().entries.len(), before_count + 1);
    assert!(list_inner(&backups).unwrap().is_empty());
    // Deterministic mutation between scans must abort publication.
    let (_f2, source2) = source_with_git();
    assert!(create_with_preflight(&backups, &source2, source2.to_str().unwrap(), &learning(), || {
        fs::write(source2.join("a/n.md"), b"# v2 changed
").unwrap();
        Ok(())
    }).is_err());
    assert!(list_inner(&backups).unwrap().is_empty());
}

#[test]
fn restore_rejects_tampered_backup_and_never_copies() {
    let (f, source) = source_with_git();
    let (backups, id) = create_ok(&f, &source);
    let restored = f.dir("restored");
    // Vault file tampering is caught by full hashing.
    f.write(&format!("backups/{id}/knowledge/a/n.md"), b"# tampered\n");
    assert!(restore_inner(&backups, &restored, &id).is_err());
    assert!(!restored.exists());
    // Learning tampering fails before any copy.
    fs::write(backups.join(&id).join("learning.json"), b"{").unwrap();
    assert!(restore_inner(&backups, &restored, &id).is_err());
    f.write(&format!("backups/{id}/knowledge/a/n.md"), b"# v1
");
    let learning_bytes = serde_json::to_vec(&learning()).unwrap();
    fs::write(backups.join(&id).join("learning.json"), learning_bytes).unwrap();
    // Manifest path escape and parent-directory tricks are refused.
    for path in ["../x.md", "a/../../x.md", "a//x", "", "/a", "\\\\srv\\share\\x"] {
        let manifest_path = backups.join(&id).join("manifest.json");
        let bytes = fs::read(&manifest_path).unwrap();
        let mut manifest: Manifest = serde_json::from_slice(&bytes).unwrap();
        manifest.tree.entries[0].path = path.into();
        fs::write(&manifest_path, serde_json::to_vec(&manifest).unwrap()).unwrap();
        assert!(restore_inner(&backups, &restored, &id).is_err(), "{path}");
        fs::write(&manifest_path, bytes).unwrap();
    }
    // A valid restore succeeds again after failed attempts.
    restore_inner(&backups, &restored, &id).unwrap();
    assert_eq!(fs::read_dir(&restored).unwrap().count(), 1);
}

#[test]
fn restore_manifest_count_and_learning_mismatch_rejected() {
    let (f, source) = source_with_git();
    let (backups, id) = create_ok(&f, &source);
    let restored = f.dir("restored");
    let manifest_path = backups.join(&id).join("manifest.json");
    let mut manifest: Manifest = serde_json::from_slice(&fs::read(&manifest_path).unwrap()).unwrap();
    manifest.files += 1; // declared count != tree entries
    fs::write(&manifest_path, serde_json::to_vec(&manifest).unwrap()).unwrap();
    assert!(restore_inner(&backups, &restored, &id).is_err());
    assert!(!restored.exists());

    let (f2, source2) = source_with_git();
    let (backups2, id2) = create_ok(&f2, &source2);
    // learning.json removed after backup: envelope incomplete.
    fs::remove_file(backups2.join(&id2).join("learning.json")).unwrap();
    assert!(restore_inner(&backups2, &f2.dir("restored"), &id2).is_err());
    assert!(!f2.dir("restored").exists());
}

#[test]
fn list_ignores_staging_and_rejects_corrupt_published_folders() {
    let (f, source) = source_with_git();
    let (backups, id) = create_ok(&f, &source);
    fs::create_dir(backups.join(".staging-x")).unwrap();
    let listed = list_inner(&backups).unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].id, id);
    // A malformed published folder fails closed instead of being skipped.
    fs::remove_file(backups.join(&id).join("manifest.json")).unwrap();
    assert!(list_inner(&backups).is_err());
}

#[test]
fn restore_never_writes_into_source_and_ids_are_validated() {
    let (f, source) = source_with_git();
    let (backups, id) = create_ok(&f, &source);
    // Malformed ids fail before touching the disk.
    for bad in ["", "../x", "a/b", "a b", "a.b", &"x".repeat(129)] {
        assert!(restore_inner(&backups, &f.dir("restored"), bad).is_err(), "{bad}");
    }
    // Restoring with the restored folder configured inside the source is refused.
    assert!(disjoint_target(&source, &source.join("restored")).is_err());
    // Source stays intact.
    assert!(source.join("a/n.md").is_file());
    assert!(!source.join("knowledge").exists());
}

#[test]
fn learning_json_bounded_and_manifest_paths_portable() {
    let (f, source) = source_with_git();
    let (backups, id) = create_ok(&f, &source);
    let manifest_bytes = fs::read(backups.join(&id).join("manifest.json")).unwrap();
    let manifest: Manifest = serde_json::from_slice(&manifest_bytes).unwrap();
    assert_eq!(manifest.version, 1);
    assert_eq!(manifest.source_root, source.to_str().unwrap());
    assert!(manifest.tree.entries.iter().all(|e| !e.path.contains('\\')));
    assert!(manifest.tree.entries.iter().all(|e| e.bytes <= MAX_FILE));
    // Learning stays beside the knowledge copy for manual recovery.
    let restored = restore_inner(&backups, &f.dir("restored"), &id).unwrap();
    assert!(Path::new(&restored.path).parent().unwrap().join("learning.json").is_file());
    assert!(Path::new(&restored.path).parent().unwrap().join("manifest.json").is_file());
}

#[test]
fn empty_dirs_and_names_survive_roundtrip() {
    let f = Fixture::new();
    let source = f.dir("source");
    fs::create_dir_all(source.join("empty-sec")).unwrap();
    f.write("source/a/n.md", b"# v1\n");
    let (backups, id) = create_ok(&f, &source);
    let restored = f.dir("restored");
    let r = restore_inner(&backups, &restored, &id).unwrap();
    assert!(Path::new(&r.path).join("empty-sec").is_dir());
}

#[test]
fn long_names_and_arbitrary_binary_roundtrip() {
    let f = Fixture::new();
    let source = f.dir("source");
    let long = format!("{}.md", "x".repeat(100));
    f.write(&format!("source/{long}"), &[0xFF, 0x00, 0x41, 0x0A]);
    f.write("source/bin/data.bin", &(0u8..=255).cycle().take(64 * 1024 + 7).collect::<Vec<u8>>());
    let (backups, id) = create_ok(&f, &source);
    let restored = f.dir("restored");
    let r = restore_inner(&backups, &restored, &id).unwrap();
    assert_eq!(fs::read(Path::new(&r.path).join(&long)).unwrap(), vec![0xFF, 0x00, 0x41, 0x0A]);
    let bin = fs::read(Path::new(&r.path).join("bin/data.bin")).unwrap();
    assert_eq!(bin.len(), 64 * 1024 + 7);
    assert_eq!(bin, (0u8..=255).cycle().take(64 * 1024 + 7).collect::<Vec<_>>());
}
