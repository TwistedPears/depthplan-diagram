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
args = ${JSON.stringify([...(status.launcherArgs ?? []), '--descriptor', status.descriptor])}
enabled = true`;
}
/** A `.mcp.json` document; the same `mcpServers` entry merges into an existing one. */
export function claudeCodeConfiguration(status: AutomationStatus) {
  return JSON.stringify(
    {
      mcpServers: {
        depthplan: {
          type: 'stdio',
          command: status.executable,
          args: [
            ...(status.launcherArgs ?? []),
            '--descriptor',
            status.descriptor,
          ],
        },
      },
    },
    null,
    2,
  );
}
const clients = [
  {
    name: 'Codex',
    configuration: codexConfiguration,
    rows: 7,
    help: 'Add this entry to Codex config.toml, then restart its MCP server.',
  },
  {
    name: 'Claude Code',
    configuration: claudeCodeConfiguration,
    rows: 12,
    help: 'Save this as .mcp.json in the folder where you run Claude Code, or merge the depthplan entry into an existing mcpServers block, then restart Claude Code.',
  },
];
export default function AutomationControl({
  automation: { status, changing, error, refresh, toggle, folder },
  operation,
  onShowDetails,
}: Props) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [copyNotice, setCopyNotice] = useState({ client: '', text: '' });
  useEffect(() => {
    if (!status?.enabled) setDetailsOpen(false);
  }, [status?.enabled]);
  const copy = async (client: (typeof clients)[number]) => {
    let text = 'Configuration copied.';
    try {
      await window.desktop.clipboard.writeText(client.configuration(status!));
    } catch {
      text = 'Select the configuration and copy it manually.';
    }
    setCopyNotice({ client: client.name, text });
  };
  return (
    <>
      <div className="dropdown-separator" />
      <button
        type="button"
        role="menuitemcheckbox"
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
          role="menuitem"
          aria-haspopup="dialog"
          onClick={() => {
            setCopyNotice({ client: '', text: '' });
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
        <button
          role="menuitem"
          disabled={changing}
          onClick={() => void refresh()}
        >
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
                  Add the entry for your client. Replace an existing depthplan
                  entry instead of adding a duplicate.
                </p>
                {clients.map((client) => (
                  <div key={client.name} className="automation-client">
                    <label className="form-dialog-field">
                      <span>{client.name} configuration</span>
                      <textarea
                        readOnly
                        rows={client.rows}
                        value={client.configuration(status)}
                        onFocus={(event) => event.target.select()}
                      />
                    </label>
                    <p className="form-dialog-hint">{client.help}</p>
                    <button type="button" onClick={() => void copy(client)}>
                      Copy {client.name} configuration
                    </button>
                    {copyNotice.client === client.name && (
                      <p role="status">{copyNotice.text}</p>
                    )}
                  </div>
                ))}
                <p>
                  Keep this app running. After restarting DepthPlan, enable
                  access and copy its new configuration. Disabling revokes
                  access immediately; re-enabling lets the same configuration
                  reconnect during this run.
                </p>
                <p>
                  Ask the client to build a diagram, arrange its objects and
                  save an Overview bookmark. Diagram edits are undoable. After
                  the first save, Autosave writes accepted changes when enabled;
                  otherwise save manually. Finish active edits before retrying a
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
