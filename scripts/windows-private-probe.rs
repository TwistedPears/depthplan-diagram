// Exercise the production Windows helper before compiling the desktop app.
mod files {
    pub type Result<T> = std::result::Result<T, String>;
}
#[path = "../src-tauri/src/private.rs"]
mod private;

fn main() {
    let args: Vec<_> = std::env::args_os().skip(1).collect();
    let [mode, target] = args.as_slice() else {
        panic!("Usage: windows-private-probe <secure|verify|serve> <path-or-pipe>");
    };
    if mode == "serve" {
        use std::io::{BufRead, BufReader};
        use std::process::Stdio;
        let mut child = private::powershell("serve", target)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("Start pipe helper");
        let stdout = child.stdout.take().unwrap();
        let (send, receive) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let mut line = String::new();
            let result = BufReader::new(stdout).read_line(&mut line);
            let _ = send.send((result, line));
        });
        let ready = receive.recv_timeout(std::time::Duration::from_secs(5));
        let _ = child.kill();
        let output = child
            .wait_with_output()
            .expect("Collect pipe helper output");
        assert!(
            matches!(ready, Ok((Ok(_), ref line)) if line.trim() == "READY"),
            "Pipe startup failed: {ready:?}\n{}",
            String::from_utf8_lossy(&output.stderr)
        );
        return;
    }
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
