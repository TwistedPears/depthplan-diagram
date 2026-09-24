use rmcp::{
    model::*, service::RequestContext, transport::stdio, ErrorData, RoleServer, ServerHandler,
    ServiceExt,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::Mutex,
    time::Duration,
};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Descriptor {
    version: u8,
    app_instance_id: uuid::Uuid,
    enabled: bool,
    endpoint: String,
    token: Option<String>,
}
struct Adapter {
    descriptor: PathBuf,
    pinned: Mutex<Option<uuid::Uuid>>,
    tools: Vec<Tool>,
    schemas: HashMap<String, (jsonschema::Validator, jsonschema::Validator)>,
}
fn failure(code: &str, message: &str) -> Value {
    json!({"ok":false,"state":null,"error":{"code":code,"message":message,"retryable":matches!(code,"APP_UNAVAILABLE"|"BUSY")}})
}
fn unavailable() -> Value {
    failure("APP_UNAVAILABLE", "The app is unavailable. Query current state before retrying an interrupted command with the same request ID.")
}
impl Adapter {
    async fn execute(&self, name: &str, input: Value) -> Result<Value, ()> {
        let Some((input_schema, output_schema)) = self.schemas.get(name) else {
            return Ok(failure("INVALID_REQUEST", "Unknown tool."));
        };
        if !input_schema.is_valid(&input) {
            return Ok(failure("INVALID_REQUEST", "Invalid tool input."));
        }
        let parent = self.descriptor.parent().ok_or(())?;
        crate::private::path(parent, false, true).map_err(|_| ())?;
        crate::private::path(&self.descriptor, false, false).map_err(|_| ())?;
        let file = tokio::fs::File::open(&self.descriptor)
            .await
            .map_err(|_| ())?;
        let mut bytes = Vec::new();
        file.take(8193)
            .read_to_end(&mut bytes)
            .await
            .map_err(|_| ())?;
        if bytes.len() > 8192 {
            return Err(());
        }
        let d: Descriptor = serde_json::from_slice(&bytes).map_err(|_| ())?;
        if d.version != 1 {
            return Err(());
        }
        {
            let mut pinned = self.pinned.lock().map_err(|_| ())?;
            if pinned.is_some_and(|id| id != d.app_instance_id) {
                return Ok(failure(
                    "STALE_APP",
                    "The selected app instance has changed. Reconnect explicitly.",
                ));
            }
            *pinned = Some(d.app_instance_id);
        }
        if !d.enabled || d.token.is_none() {
            return Ok(failure("DISABLED", "Automation is disabled."));
        }
        let token = d.token.ok_or(())?;
        if token.len() != 64
            || !token
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
            || Path::new(&d.endpoint) != expected_endpoint(parent, &d.app_instance_id)
        {
            return Err(());
        }
        #[cfg(unix)]
        crate::private::path(Path::new(&d.endpoint), false, false).map_err(|_| ())?;
        let mut wire = serde_json::to_vec(
            &json!({"tool":name,"input":input,"token":token,"appInstanceId":d.app_instance_id}),
        )
        .map_err(|_| ())?;
        wire.push(b'\n');
        if wire.len() > 64 * 1024 {
            return Ok(failure(
                "INVALID_REQUEST",
                "Request exceeds the size limit.",
            ));
        }
        #[cfg(unix)]
        let mut socket = tokio::net::UnixStream::connect(&d.endpoint)
            .await
            .map_err(|_| ())?;
        #[cfg(windows)]
        let mut socket = tokio::net::windows::named_pipe::ClientOptions::new()
            .open(&d.endpoint)
            .map_err(|_| ())?;
        socket.write_all(&wire).await.map_err(|_| ())?;
        #[cfg(unix)]
        socket.shutdown().await.map_err(|_| ())?;
        let mut response = Vec::new();
        socket
            .take(1024 * 1024 + 1)
            .read_to_end(&mut response)
            .await
            .map_err(|_| ())?;
        if response.len() > 1024 * 1024 {
            return Ok(failure(
                "RESPONSE_TOO_LARGE",
                "Response exceeds the size limit.",
            ));
        }
        let result: Value = serde_json::from_slice(&response).map_err(|_| ())?;
        if !output_schema.is_valid(&result) {
            return Ok(failure("INTERNAL_ERROR", "Invalid application response."));
        }
        Ok(result)
    }
}
impl ServerHandler for Adapter {
    fn get_info(&self) -> ServerConfig {
        ServerConfig::new(ServerCapabilities::builder().enable_tools().build())
            .with_server_info(Implementation::new("depthplan", "0.1.0"))
    }
    async fn list_tools(
        &self,
        _: Option<PaginatedRequestParams>,
        _: RequestContext<RoleServer>,
    ) -> Result<ListToolsResult, ErrorData> {
        Ok(ListToolsResult::with_all_items(self.tools.clone()))
    }
    async fn call_tool(
        &self,
        request: CallToolRequestParams,
        _: RequestContext<RoleServer>,
    ) -> Result<CallToolResponse, ErrorData> {
        let result = match tokio::time::timeout(
            Duration::from_secs(5),
            self.execute(
                &request.name,
                Value::Object(request.arguments.unwrap_or_default()),
            ),
        )
        .await
        {
            Ok(Ok(value)) => value,
            _ => unavailable(),
        };
        Ok(if result["ok"] == true {
            CallToolResult::structured(result)
        } else {
            CallToolResult::structured_error(result)
        }
        .into())
    }
}
pub async fn serve() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = std::env::args_os().skip(1).collect();
    if args.len() != 2 || args[0] != "--descriptor" {
        return Err("Usage: depthplan-mcp --descriptor PATH".into());
    }
    let tools: Vec<Tool> = serde_json::from_str(include_str!("../generated/mcp-tools.json"))?;
    let mut schemas = HashMap::new();
    for tool in &tools {
        schemas.insert(
            tool.name.to_string(),
            (
                jsonschema::validator_for(&Value::Object((*tool.input_schema).clone()))?,
                jsonschema::validator_for(&Value::Object(
                    (**tool.output_schema.as_ref().ok_or("Missing output schema")?).clone(),
                ))?,
            ),
        );
    }
    let adapter = Adapter {
        descriptor: args[1].clone().into(),
        pinned: Mutex::new(None),
        tools,
        schemas,
    };
    adapter.serve(stdio()).await?.waiting().await?;
    Ok(())
}

fn expected_endpoint(parent: &Path, instance: &uuid::Uuid) -> PathBuf {
    #[cfg(unix)]
    {
        let _ = instance;
        parent.join("ipc")
    }
    #[cfg(windows)]
    {
        let _ = parent;
        PathBuf::from(format!("\\\\.\\pipe\\depthplan-{instance}"))
    }
}
