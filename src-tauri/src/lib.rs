mod files;
mod host;
pub mod mcp;
mod png_export;
mod recovery;
mod validation;
pub fn run() {
    host::run();
}

mod automation;
mod private;

#[cfg(all(feature = "automation", target_os = "macos"))]
mod test_processes;
