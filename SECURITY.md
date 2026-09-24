# Security status

DepthPlan is unreleased. **A private reporting route and supported-version policy
have not been activated.** No response-time or security-update commitment is in
force. The owner must approve and verify the [security/support proposal](docs/release.md#security-and-support-proposal)
before this document becomes an active reporting policy. Do not publish sensitive
reports, user documents, recovery checkpoints or MCP credentials in public issues.

The [release requirements](docs/release.md#open-dependency-findings) list seven
unresolved Rust dependency warnings and the evidence needed to fix or explicitly
disposition them. Audit exit zero is not risk acceptance or production approval.

Documents and recovery checkpoints are local. Recovery is best effort and does
not replace document backups. MCP starts disabled and requires explicit enabling;
its file operations need locally approved folders. Approve only necessary folders,
revoke access when finished, and treat descriptor contents as credentials. The
local transport is not a security boundary against a compromised OS user account.
See [MCP access](docs/mcp.md#files-drafts-and-decisions) for its scope.

Ordinary distributed builds must exclude test automation. Updates currently
require manual installation; an approved release channel, publisher/signing
identity and tested installer-verification instructions remain release decisions.
