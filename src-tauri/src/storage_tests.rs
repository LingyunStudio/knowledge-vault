//! Temp-directory-only tests for storage location changes. No real user data is touched.
use super::*;
use std::path::PathBuf;

struct Fixture(PathBuf);
impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!("kv-storage-test-{}", crate::vault::unique_id()));
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

#[test]
fn migrate_copies_and_verifies_every_file() {
    let f = Fixture::new();
    let source = f.dir("source");
    f.write("source/a/n.md", b"# v1\n");
    f.write("source/a/deep/asset.bin", &[0u8, 159, 146, 150, 255]);
    f.write("source/.kv/history/1.kv", b"{}");
    let target = f.dir("target");

    migrate(&source, &target).unwrap();

    let expected = scan_hash(&source).unwrap();
    assert_eq!(scan_hash(&target).unwrap(), expected);
    assert_eq!(expected.get("a/deep/asset.bin").unwrap().len(), 64);
    assert!(target.join(".kv/history/1.kv").is_file());
    // 原库保留不动
    assert!(source.join("a/n.md").is_file());
}

#[test]
fn migrate_refuses_non_empty_target() {
    let f = Fixture::new();
    let source = f.dir("source");
    f.write("source/a/n.md", b"# v1\n");
    let target = f.dir("target");
    f.write("target/existing.txt", b"keep me");

    // 目标非空 → 直接拒绝，绝不混入或覆盖现有内容
    let err = ensure_vacant(&target).unwrap_err();
    assert!(err.contains("非空"), "{err}");
    // 空目录或不存在 → 允许
    let empty = f.dir("empty");
    fs::create_dir_all(&empty).unwrap();
    ensure_vacant(&empty).unwrap();
    ensure_vacant(&f.dir("missing")).unwrap();
}

#[test]
fn conflict_detection_rejects_nesting_both_ways() {
    let f = Fixture::new();
    let root = f.dir("vault");
    let inside = f.dir("vault/sub/knowledge");
    let outside = f.dir("other");
    assert!(conflicts(&root, &root));
    assert!(conflicts(&root, &inside));
    assert!(conflicts(&inside, &root));
    assert!(!conflicts(&root, &outside));
    // Windows 下忽略大小写与分隔符差异
    #[cfg(windows)]
    {
        assert!(conflicts(Path::new("E:\\Vault"), Path::new("e:/vault/sub")));
        assert!(conflicts(Path::new("E:\\"), Path::new("e:/x")));
    }
}

#[test]
fn absolute_dir_cleans_user_input() {
    let base = std::env::temp_dir();
    let joined = absolute_dir(base.to_str().unwrap()).unwrap();
    assert_eq!(joined, safe_path::clean(&base));
    assert!(absolute_dir("relative/path").is_err());
    assert!(absolute_dir("   ").is_err());
}
