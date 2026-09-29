use std::process::Command;

/// Query the OS font registry, without scanning or parsing font files ourselves.
pub fn families() -> Result<Vec<String>, String> {
    #[cfg(target_os = "macos")]
    let mut command = {
        let mut command = Command::new("/usr/bin/osascript");
        command.args([
            "-l", "JavaScript", "-e",
            r#"ObjC.import("AppKit"); ObjC.deepUnwrap($.NSFontManager.sharedFontManager.availableFontFamilies).join("\n")"#,
        ]);
        command
    };
    #[cfg(target_os = "windows")]
    let mut command = {
        use std::os::windows::process::CommandExt;
        let mut command = Command::new("powershell.exe");
        command.creation_flags(0x08000000); // CREATE_NO_WINDOW
        command.args([
            "-NoLogo", "-NoProfile", "-NonInteractive", "-Command",
            "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new(); Add-Type -AssemblyName System.Drawing; [System.Drawing.FontFamily]::Families.Name",
        ]);
        command
    };
    #[cfg(target_os = "linux")]
    let mut command = {
        let mut command = Command::new("fc-list");
        command.args(["--format", "%{family[0]}\n"]);
        command
    };
    let output = command.output().map_err(|error| error.to_string())?;
    if !output.status.success() {
        return Err("Could not list installed fonts".into());
    }
    let mut fonts: Vec<String> = String::from_utf8(output.stdout)
        .map_err(|error| error.to_string())?
        .lines()
        .map(str::trim)
        .filter(|name| !name.is_empty() && !name.starts_with('.'))
        .map(str::to_owned)
        .collect();
    fonts.sort();
    fonts.dedup();
    Ok(fonts)
}
