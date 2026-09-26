// Reproduces tauri-apps/tauri#15408 without a WebView or IPC traffic.
#[cfg(windows)]
fn main() {
    let app = tauri::Builder::default()
        .build(tauri::generate_context!())
        .unwrap();
    let barrier = std::sync::Barrier::new(8);
    std::thread::scope(|scope| {
        for _ in 0..8 {
            let handle = app.handle().clone();
            let barrier = &barrier;
            scope.spawn(move || {
                barrier.wait();
                for _ in 0..100_000 {
                    drop(std::hint::black_box(handle.clone()));
                }
            });
        }
    });
    let surviving_handle = app.handle().clone();
    let monitor = surviving_handle.primary_monitor().unwrap().unwrap();
    assert!(!surviving_handle.available_monitors().unwrap().is_empty());
    let position = monitor.position();
    assert!(surviving_handle
        .monitor_from_point(position.x as f64, position.y as f64)
        .unwrap()
        .is_some());
    drop(app);
    assert!(surviving_handle.run_on_main_thread(|| {}).is_err());
    assert!(surviving_handle.primary_monitor().unwrap().is_none());
    assert!(surviving_handle.available_monitors().unwrap().is_empty());
    std::thread::spawn(move || drop(surviving_handle))
        .join()
        .unwrap();
    println!("PASS Windows runtime: concurrent handle clone/drop and late handle cleanup");
}

#[cfg(not(windows))]
fn main() {}
