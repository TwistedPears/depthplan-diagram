import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import FormDialog from './FormDialog';
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
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [copyNotice, setCopyNotice] = useState('');
  useEffect(() => {
    if (!status?.enabled) setDetailsOpen(false);
  }, [status?.enabled]);
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
            setDetailsOpen(true);
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
        detailsOpen &&
        createPortal(
          <FormDialog
            title="MCP Details"
            description="Allow local MCP clients to edit diagrams, manage saved views and work with files in folders you approve."
            className="automation-dialog"
            onCancel={() => setDetailsOpen(false)}
          >
            {error && <p role="alert">{error}</p>}
            {operation && (
              <p role="status">
                MCP {operation.kind}: {operation.status}{' '}
                <button type="button" onClick={operation.cancel}>
                  Cancel MCP operation
                </button>
              </p>
            )}
            <section className="form-dialog-section">
              <h3>Approved folders</h3>
              <p>
                Approved folders allow MCP file reads and writes for this app
                run.
              </p>
              {(status.folders ?? []).map((grant) => (
                <div key={grant.id} className="automation-folder">
                  <code>{grant.path}</code>
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
            </section>
            <p>
              Ready for local requests. This does not mean a client is
              connected.
            </p>
            {status.descriptor && (
              <section className="form-dialog-section">
                <h3>Client setup</h3>
                <p>
                  Add this entry to Codex config.toml, then restart its MCP
                  server. Replace an existing depthplan entry instead of adding
                  a duplicate.
                </p>
                <label className="form-dialog-field">
                  <span>Codex configuration</span>
                  <textarea
                    readOnly
                    rows={7}
                    value={codexConfiguration(status)}
                    onFocus={(event) => event.target.select()}
                  />
                </label>
                <button type="button" onClick={() => void copy()}>
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
                <label className="form-dialog-field">
                  <span>MCP executable</span>
                  <input readOnly value={status.executable} />
                </label>
                <label className="form-dialog-field">
                  <span>Descriptor</span>
                  <input readOnly value={status.descriptor} />
                </label>
              </section>
            )}
          </FormDialog>,
          document.body,
        )}
    </>
  );
}
