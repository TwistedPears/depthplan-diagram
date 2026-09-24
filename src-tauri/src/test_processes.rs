//! Test-only WebKit process attribution. These private inspection selectors
//! must never be compiled into a distribution build. RSS is sampled externally.
use objc2::{msg_send, runtime::AnyObject, sel};
use serde_json::{json, Value};

pub async fn identifiers(window: &tauri::WebviewWindow) -> Result<Value, String> {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    window
        .with_webview(move |webview| {
            // SAFETY: Tauri runs this closure on the main thread and keeps the
            // WKWebView alive. Check private selectors before messaging them.
            let result = unsafe {
                let view = &*webview.inner().cast::<AnyObject>();
                let configuration: &AnyObject = msg_send![view, configuration];
                let store: &AnyObject = msg_send![configuration, websiteDataStore];
                let supported: bool = msg_send![view, respondsToSelector: sel!(_webProcessIdentifier)];
                let gpu: bool = msg_send![view, respondsToSelector: sel!(_gpuProcessIdentifier)];
                let network: bool = msg_send![store, respondsToSelector: sel!(_networkProcessIdentifier)];
                if supported && gpu && network {
                    let renderer: i32 = msg_send![view, _webProcessIdentifier];
                    let gpu: i32 = msg_send![view, _gpuProcessIdentifier];
                    let network: i32 = msg_send![store, _networkProcessIdentifier];
                    Ok(json!({"host":std::process::id(),"renderer":renderer,"gpu":gpu,"network":network}))
                } else {
                    Err("WebKit process attribution is unavailable on this OS".to_owned())
                }
            };
            let _ = sender.send(result);
        })
        .map_err(|e| e.to_string())?;
    receiver.await.map_err(|e| e.to_string())?
}
