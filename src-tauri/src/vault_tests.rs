use crate::{library, vault};
use std::{fs, path::PathBuf};
struct Fixture(PathBuf);
impl Fixture {
    fn new() -> Self {
        let p = std::env::temp_dir().join(format!("kv-test-{}", vault::unique_id()));
        fs::create_dir_all(p.join("a")).unwrap(); fs::create_dir_all(p.join("b")).unwrap();
        Self(p)
    }
    fn write(&self, rel: &str, text: &str) { fs::write(self.0.join(rel), text).unwrap(); }
}
impl Drop for Fixture { fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); } }
#[test]
fn atomic_save_records_history_and_rejects_stale_or_deleted_revision() {
    let f = Fixture::new(); f.write("a/n.md", "old");
    let original = library::read_article(&f.0, "a/n.md").unwrap();
    let current = vault::save(&f.0, "a/n.md", "new", Some(&original.revision), None, "test").unwrap();
    assert_eq!(current.body, "new");
    assert!(vault::save(&f.0, "a/n.md", "stale", Some(&original.revision), None, "test").is_err());
    let history = vault::list_article_history(&f.0, "a/n.md").unwrap();
    assert_eq!(history.len(), 1);
    assert_eq!(vault::read_article_history(&f.0, &history[0].id).unwrap().content, "old");
    fs::remove_file(f.0.join("a/n.md")).unwrap();
    assert!(vault::save(&f.0, "a/n.md", "resurrect", Some(&current.revision), None, "test").is_err());
    assert!(!f.0.join("a/n.md").exists());
}
#[test]
fn trash_restore_never_overwrites_and_history_restore_keeps_current() {
    let f = Fixture::new(); f.write("a/n.md", "original");
    let original = library::read_article(&f.0, "a/n.md").unwrap();
    let entry = vault::delete_article(&f.0, "a/n.md", Some(&original.revision)).unwrap();
    assert!(!f.0.join("a/n.md").exists());
    f.write("a/n.md", "other");
    assert!(vault::restore_trash(&f.0, &entry.id, None).is_err());
    assert_eq!(fs::read_to_string(f.0.join("a/n.md")).unwrap(), "other");
    fs::remove_file(f.0.join("a/n.md")).unwrap();
    let restored = vault::restore_trash(&f.0, &entry.id, None).unwrap();
    assert_eq!(restored.body, "original"); assert!(vault::list_trash(&f.0).unwrap().is_empty());
    let changed = vault::save(&f.0, "a/n.md", "changed", Some(&restored.revision), None, "test").unwrap();
    let h = vault::list_article_history(&f.0, "a/n.md").unwrap();
    assert_eq!(vault::restore_article_history(&f.0, &h[0].id, &changed.revision).unwrap().body, "original");
    assert_eq!(vault::list_article_history(&f.0, "a/n.md").unwrap().len(), 2);
}
#[test]
fn backup_failure_and_preflight_failure_leave_live_bytes_intact() {
    let f = Fixture::new(); f.write("a/n.md", "old"); f.write(".kv", "blocks directory creation");
    let old = library::read_article(&f.0, "a/n.md").unwrap();
    assert!(vault::save(&f.0, "a/n.md", "new", Some(&old.revision), None, "test").is_err());
    assert_eq!(fs::read_to_string(f.0.join("a/n.md")).unwrap(), "old");
    assert!(vault::atomic_write(&f.0.join("a/n.md"), b"bad", true, || Err(library::WriteError::InvalidRel)).is_err());
    assert_eq!(fs::read_to_string(f.0.join("a/n.md")).unwrap(), "old");
}
#[test]
fn metadata_preserves_unknown_fields_and_move_rebases_images() {
    let f = Fixture::new(); f.write("a/n.md", "---\ntitle: Old\ncustom: retained\n---\n![picture](pic.png)\n"); f.write("a/pic.png", "image");
    let old = library::read_article(&f.0, "a/n.md").unwrap();
    let new = vault::update_article_metadata(&f.0, "a/n.md", &vault::MetadataUpdate { title: "New".into(), summary: "summary".into(), order: 2, tags: vec!["rust".into()] }, &old.revision).unwrap();
    assert_eq!(new.title, "New"); assert!(new.fm_raw.unwrap().contains("custom: retained"));
    let moved = vault::move_article(&f.0, "a/n.md", "b/n.md", &new.revision).unwrap();
    assert!(moved.article.body.contains("../a/pic.png")); assert!(!f.0.join("a/n.md").exists());
}
#[test]
fn incoming_links_block_move_and_link_index_reports_missing() {
    let f = Fixture::new(); f.write("a/n.md", "target"); f.write("a/ref.md", "[target](n.md) [missing](missing.md)\n`[not a link](code.md)`");
    let old = library::read_article(&f.0, "a/n.md").unwrap();
    assert!(vault::move_article(&f.0, "a/n.md", "b/n.md", &old.revision).is_err());
    assert!(f.0.join("a/n.md").exists()); assert!(!f.0.join("b/n.md").exists());
    let index = crate::links::list_article_links(&f.0).unwrap();
    assert_eq!(index.links.len(), 2); assert!(index.links.iter().any(|l| l.exists == Some(false)));
}
