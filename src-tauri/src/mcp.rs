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
    async fn execute(
        &self,
        name: &str,
        input: Value,
    ) -> Result<Value, Box<dyn std::error::Error + Send + Sync>> {
        let Some((input_schema, output_schema)) = self.schemas.get(name) else {
            return Ok(failure("INVALID_REQUEST", "Unknown tool."));
        };
        if !input_schema.is_valid(&input) {
            return Ok(failure("INVALID_REQUEST", "Invalid tool input."));
        }
        let parent = self
            .descriptor
            .parent()
            .ok_or("Missing descriptor directory")?;
        crate::private::path(parent, false, true)?;
        crate::private::path(&self.descriptor, false, false)?;
        let file = tokio::fs::File::open(&self.descriptor).await?;
        let mut bytes = Vec::new();
        file.take(8193).read_to_end(&mut bytes).await?;
        if bytes.len() > 8192 {
            return Err("Invalid local descriptor".into());
        }
        let d: Descriptor = serde_json::from_slice(&bytes)?;
        if d.version != 1 {
            return Err("Invalid local descriptor".into());
        }
        {
            let mut pinned = self
                .pinned
                .lock()
                .map_err(|_| "App identity lock poisoned")?;
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
        let token = d.token.ok_or("Missing local authorization")?;
        if token.len() != 64
            || !token
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
            || Path::new(&d.endpoint) != expected_endpoint(parent, &d.app_instance_id)
        {
            return Err("Invalid local descriptor".into());
        }
        #[cfg(unix)]
        crate::private::path(Path::new(&d.endpoint), false, false)?;
        let mut wire = serde_json::to_vec(
            &json!({"tool":name,"input":input,"token":token,"appInstanceId":d.app_instance_id}),
        )?;
        wire.push(b'\n');
        if wire.len() > 64 * 1024 {
            return Ok(failure(
                "INVALID_REQUEST",
                "Request exceeds the size limit.",
            ));
        }
        #[cfg(unix)]
        let mut socket = tokio::net::UnixStream::connect(&d.endpoint).await?;
        #[cfg(windows)]
        let mut socket = tokio::net::windows::named_pipe::ClientOptions::new().open(&d.endpoint)?;
        socket.write_all(&wire).await?;
        #[cfg(unix)]
        socket.shutdown().await?;
        let limit = crate::automation::response_limit(name);
        let mut response = Vec::new();
        socket
            .take(limit as u64 + 1)
            .read_to_end(&mut response)
            .await?;
        if response.len() > limit {
            return Ok(failure(
                "RESPONSE_TOO_LARGE",
                "Response exceeds the size limit.",
            ));
        }
        let mut result: Value = serde_json::from_slice(&response)?;
        let Ok(image) = crate::automation::take_image(name, &mut result) else {
            return Ok(failure("INTERNAL_ERROR", "Invalid application response."));
        };
        if !output_schema.is_valid(&result) {
            return Ok(failure("INTERNAL_ERROR", "Invalid application response."));
        }
        if let Some(png) = image {
            result["data"]["png"] = png.into();
        }
        Ok(result)
    }
}
/// Map a validated reply to MCP content; a snapshot PNG becomes an image block
/// instead of megabytes of JSON text or structured content.
fn tool_result(name: &str, mut value: Value) -> CallToolResult {
    let image = crate::automation::take_image(name, &mut value)
        .ok()
        .flatten();
    let mut result = if value["ok"] == true {
        CallToolResult::structured(value)
    } else {
        CallToolResult::structured_error(value)
    };
    if let Some(png) = image {
        result.content.push(ContentBlock::image(png, "image/png"));
    }
    result
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
            // Windows verifies both descriptor ACLs in PowerShell before connecting.
            // Include that process startup cost, beyond the pipe's five-second limit.
            Duration::from_secs(if cfg!(windows) { 15 } else { 5 }),
            self.execute(
                &request.name,
                Value::Object(request.arguments.unwrap_or_default()),
            ),
        )
        .await
        .unwrap_or_else(|error| Err(error.into()))
        {
            Ok(value) => value,
            Err(error) => {
                eprintln!("MCP {} transport error: {error}", request.name);
                unavailable()
            }
        };
        Ok(tool_result(&request.name, result).into())
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

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn snapshot_png_becomes_image_content_outside_structured_metadata() {
        let tools: Vec<Value> =
            serde_json::from_str(include_str!("../generated/mcp-tools.json")).unwrap();
        let schema = &tools
            .iter()
            .find(|t| t["name"] == crate::automation::SNAPSHOT_TOOL)
            .unwrap()["outputSchema"];
        let output = jsonschema::validator_for(schema).unwrap();
        let reply = json!({"ok":true,"state":null,"data":{"scope":"whole","width":2,"height":1,"scale":0.5,"region":{"x":-16.0,"y":-16.0,"width":4.0,"height":2.0},"revision":3,"viewRevision":4,"bytes":3,"png":"iVBO"}});
        let mut carved = reply.clone();
        let png = crate::automation::take_image(crate::automation::SNAPSHOT_TOOL, &mut carved)
            .unwrap()
            .unwrap();
        assert_eq!(png, "iVBO");
        assert!(output.is_valid(&carved));
        assert!(
            !output.is_valid(&reply),
            "the advertised schema excludes png"
        );
        let result = tool_result(crate::automation::SNAPSHOT_TOOL, reply);
        assert_eq!(result.is_error, Some(false));
        assert_eq!(result.structured_content.as_ref(), Some(&carved));
        assert_eq!(result.content.len(), 2);
        let encoded = serde_json::to_value(&result.content).unwrap();
        assert!(!encoded[0]["text"].as_str().unwrap().contains("iVBO"));
        assert_eq!(
            encoded[1],
            json!({"type":"image","data":"iVBO","mimeType":"image/png"})
        );
        for bad in [json!(null), json!(""), json!("not base64!"), json!(5)] {
            let mut value = carved.clone();
            value["data"]["png"] = bad;
            assert!(
                crate::automation::take_image(crate::automation::SNAPSHOT_TOOL, &mut value)
                    .is_err()
            );
        }
        let mut missing = carved.clone();
        assert!(
            crate::automation::take_image(crate::automation::SNAPSHOT_TOOL, &mut missing).is_err()
        );
        let error = failure("RESPONSE_TOO_LARGE", "Request a smaller maxPixels.");
        let result = tool_result(crate::automation::SNAPSHOT_TOOL, error.clone());
        assert_eq!(result.is_error, Some(true));
        assert_eq!(result.content.len(), 1);
        assert!(output.is_valid(&error));
        let ordinary = tool_result(
            "depthplan_get_state",
            json!({"ok":true,"state":null,"data":{"png":"iVBO"}}),
        );
        assert_eq!(ordinary.content.len(), 1);
        assert_eq!(
            crate::automation::response_limit("depthplan_query"),
            1024 * 1024
        );
        assert_eq!(
            crate::automation::response_limit(crate::automation::SNAPSHOT_TOOL),
            8 * 1024 * 1024
        );
    }
}
