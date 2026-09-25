use crate::files::Result;
use std::{fs, path::Path};
#[cfg(unix)]
pub fn path(path: &Path, secure: bool, directory: bool) -> Result<()> {
    use std::os::unix::fs::{FileTypeExt, MetadataExt, PermissionsExt};
    let info = fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    if info.file_type().is_symlink()
        || info.uid() != unsafe { libc::geteuid() }
        || if directory {
            !info.is_dir()
        } else {
            !info.is_file() && !info.file_type().is_socket()
        }
    {
        return Err("Unsafe local endpoint".into());
    }
    let mode = if directory { 0o700 } else { 0o600 };
    if secure {
        fs::set_permissions(path, fs::Permissions::from_mode(mode)).map_err(|e| e.to_string())?;
    } else if info.mode() & 0o777 != mode {
        return Err("Unsafe local endpoint permissions".into());
    }
    Ok(())
}
#[cfg(windows)]
pub fn powershell(mode: &str, path: &std::ffi::OsStr) -> std::process::Command {
    let root = std::env::var_os("SystemRoot").unwrap_or_else(|| "C:\\Windows".into());
    let mut command = std::process::Command::new(
        Path::new(&root).join("System32/WindowsPowerShell/v1.0/powershell.exe"),
    );
    command
        .args([
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            include_str!("windows.ps1"),
        ])
        .env("DEPTHPLAN_ACL_MODE", mode)
        .env("DEPTHPLAN_ACL_PATH", path);
    command
}
#[cfg(windows)]
pub fn path(path: &Path, secure: bool, directory: bool) -> Result<()> {
    use std::os::windows::fs::MetadataExt;
    let info = fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    if info.file_attributes() & 0x400 != 0
        || if directory {
            !info.is_dir()
        } else {
            !info.is_file()
        }
    {
        return Err("Unsafe local endpoint".into());
    }
    let output = powershell(if secure { "secure" } else { "verify" }, path.as_os_str())
        .output()
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(format!(
            "Unsafe local endpoint ACL: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    Ok(())
}
