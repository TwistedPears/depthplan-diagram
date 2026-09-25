// Exercise the production Windows helper before compiling the desktop app.
mod files {
    pub type Result<T> = std::result::Result<T, String>;
}
#[path = "../src-tauri/src/private.rs"]
mod private;

fn main() {
    let args: Vec<_> = std::env::args_os().skip(1).collect();
    let [mode, target] = args.as_slice() else {
        panic!("Usage: windows-private-probe <secure|verify> <path>");
    };
    let secure = match mode.to_str() {
        Some("secure") => true,
        Some("verify") => false,
        _ => panic!("Use secure or verify"),
    };
    let path = std::path::Path::new(target);
    if let Err(error) = private::path(path, secure, path.is_dir()) {
        eprintln!("{error}");
        std::process::exit(1);
    }
}
