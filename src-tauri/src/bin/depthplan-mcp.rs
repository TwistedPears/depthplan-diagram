#[tokio::main]
async fn main() {
    if let Err(error) = depthplan_native::mcp::serve().await {
        eprintln!("{error}");
        std::process::exit(1);
    }
}
