import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from './Icon';
import type { AutomationStatus } from '../../shared/automationContract';
import type useAutomation from '../hooks/useAutomation';

type Props = {
  automation: ReturnType<typeof useAutomation>;
  operation?: { kind: string; status: string; cancel: () => void } | null;
  onShowDetails: () => void;
};
export function codexConfiguration(status: AutomationStatus) {
  return `[mcp_servers.depthplan]
command = ${JSON.stringify(status.executable)}
args = ${JSON.stringify(['--descriptor', status.descriptor])}
enabled = true`;
}
export default function AutomationControl({
  automation: { status, changing, error, refresh, toggle, folder },
  operation,
  onShowDetails,
}: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [copyNotice, setCopyNotice] = useState('');
  const copy = async () => {
    try {
      await window.desktop.clipboard.writeText(codexConfiguration(status!));
      setCopyNotice('Configuration copied.');
    } catch {
      setCopyNotice('Select the configuration and copy it manually.');
    }
  };
  return (
    <>
      <div className="dropdown-separator" />
      <button
        type="button"
        role="switch"
        aria-label="MCP Server"
        aria-checked={status?.enabled ?? false}
        disabled={changing || !status}
        onClick={() => void toggle()}
      >
        <span>MCP Server</span>
        <span className="automation-state">
          {changing
            ? 'Updating…'
            : status
              ? status.enabled
                ? 'On'
                : 'Off'
              : 'Unavailable'}
        </span>
      </button>
      {status?.enabled && (
        <button
          type="button"
          aria-haspopup="dialog"
          onClick={() => {
            setCopyNotice('');
            onShowDetails();
            dialog.current?.showModal();
          }}
        >
          MCP Details
        </button>
      )}
      {error && (
        <p className="automation-error" role="alert">
          {error}
        </p>
      )}
      {!status && (
        <button disabled={changing} onClick={() => void refresh()}>
          Retry MCP Server status
        </button>
      )}
      {status?.enabled &&
        createPortal(
          <dialog
            ref={dialog}
            className="automation-dialog"
            aria-labelledby="mcp-details-title"
            closedby="any"
          >
            <div className="automation-heading">
              <h2 id="mcp-details-title">MCP Details</h2>
              <button
                type="button"
                className="toolbar-button"
                aria-label="Close"
                title="Close MCP Details"
                onClick={() => dialog.current?.close()}
              >
                <Icon name="xmark" />
              </button>
            </div>
            <p>
              Allow local MCP clients to edit diagrams, manage saved views and
              work with files in folders you approve.
            </p>
            {error && <p role="alert">{error}</p>}
            {operation && (
              <p role="status">
                MCP {operation.kind}: {operation.status}{' '}
                <button type="button" onClick={operation.cancel}>
                  Cancel MCP operation
                </button>
              </p>
            )}
            <p>
              Approved folders allow MCP file reads and writes for this app run.
            </p>
            {(status.folders ?? []).map((grant) => (
              <div key={grant.id}>
                <code>{grant.path}</code>{' '}
                <button
                  type="button"
                  disabled={changing}
                  onClick={() => void folder(grant.id)}
                  aria-label={`Revoke access to ${grant.path}`}
                >
                  Revoke
                </button>
              </div>
            ))}
            <button
              type="button"
              disabled={changing}
              onClick={() => void folder()}
            >
              Approve folder…
            </button>
            <p>
              Ready for local requests. This does not mean a client is
              connected.
            </p>
            {status.descriptor && (
              <>
                <p>
                  Add this entry to Codex config.toml, then restart its MCP
                  server. Replace an existing depthplan entry instead of adding
                  a duplicate.
                </p>
                <label>
                  Codex configuration
                  <textarea
                    readOnly
                    rows={7}
                    value={codexConfiguration(status)}
                    onFocus={(event) => event.target.select()}
                  />
                </label>
                <button onClick={() => void copy()}>
                  Copy Codex configuration
                </button>
                {copyNotice && <p role="status">{copyNotice}</p>}
                <p>
                  Keep this app running. After restarting DepthPlan, enable
                  access and copy its new configuration. Disabling revokes
                  access immediately; re-enabling lets the same configuration
                  reconnect during this run.
                </p>
                <p>
                  Ask Codex to build a diagram, arrange its objects and save an
                  Overview bookmark. Diagram edits are undoable and remain
                  unsaved until you save. Finish active edits before retrying a
                  busy request.
                </p>
                <label>
                  MCP executable
                  <input readOnly value={status.executable} />
                </label>
                <label>
                  Descriptor
                  <input readOnly value={status.descriptor} />
                </label>
              </>
            )}
          </dialog>,
          document.body,
        )}
    </>
  );
}
