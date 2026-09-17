use std::path::Path;
use std::process::Command;

pub(crate) fn image_upload_command(command: &str, image: &Path) -> Command {
    let mut process = Command::new("cmd.exe");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;

        // cmd 不使用 CRT 的反斜杠转义；/S 去掉整条命令的外层引号。
        // 文件路径通过环境变量展开，避免路径中的 % 被当成变量再次解析。
        process
            .args(["/D", "/V:OFF", "/S", "/C"])
            .raw_arg(format!("\"{command} \"%KV_UPLOAD_IMAGE_PATH%\"\""))
            .env("KV_UPLOAD_IMAGE_PATH", image);
    }
    #[cfg(not(windows))]
    process.args(["/C", &format!("{command} \"{}\"", image.display())]);
    process
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn uploader_receives_readable_path_without_literal_quotes() {
        let stamp = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let root = std::env::temp_dir().join(format!("kv upload test {} {stamp}", std::process::id()));
        fs::create_dir_all(&root).unwrap();
        let source = root.join("mock.rs");
        let executable = root.join("mock-upgit.exe");
        fs::write(&source, r#"
fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    assert_eq!(args.len(), 3, "unexpected arguments: {args:?}");
    assert_eq!(&args[..2], &["--size-limit", "0"]);
    let bytes = std::fs::read(&args[2]).expect("image path must open");
    assert_eq!(bytes, b"local test image");
    println!("https://example.invalid/mock.png");
}
"#).unwrap();
        let compiled = Command::new("rustc").arg(&source).arg("-o").arg(&executable).output().unwrap();
        assert!(compiled.status.success(), "{}", String::from_utf8_lossy(&compiled.stderr));
        let quoted = format!("\"{}\" --size-limit 0", executable.display());
        for name in ["plain.png", "截图 with spaces.png", "image & (test) ! %TEMP%.png"] {
            let image = root.join(name);
            fs::write(&image, b"local test image").unwrap();
            for command in [quoted.as_str(), "mock-upgit --size-limit 0"] {
                let path = format!("{};{}", root.display(), std::env::var("PATH").unwrap());
                let output = image_upload_command(command, &image).env("PATH", &path).output().unwrap();
                assert!(output.status.success(), "{name}: {}", String::from_utf8_lossy(&output.stderr));
                assert_eq!(String::from_utf8_lossy(&output.stdout).trim(), "https://example.invalid/mock.png");
            }
        }
        let image = root.join("plain.png");
        let old = Command::new("cmd.exe")
            .args(["/C", &format!("{quoted} \"{}\"", image.display())])
            .output().unwrap();
        assert!(!old.status.success(), "old quoting unexpectedly succeeded");
        fs::remove_dir_all(root).unwrap();
    }
}
