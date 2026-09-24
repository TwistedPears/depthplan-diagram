import { useState } from 'react';
import type { RecursiveDocument } from '../../shared/recursiveDocument';
import type { DocumentEdit } from '../../shared/documentTransactions';
import { resolveConnectionRepair } from '../../shared/recursiveConnectionRepair';
export default function ConnectionRepairs({
  document,
  selected,
  onEdit,
}: {
  document: RecursiveDocument;
  selected: string | null;
  onEdit: (edit: DocumentEdit) => void;
}) {
  const [open, setOpen] = useState(false);
  const repairs = Object.entries(document.connectionRepairs ?? {});
  if (!repairs.length) return null;
  return (
    <aside
      aria-label="Pending connection repairs"
      className="connection-repairs"
    >
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}>
        {open
          ? 'Close repairs'
          : `Pending connection repairs (${repairs.length})`}
      </button>
      {open && (
        <>
          <p>
            Create the boundary points and bridge segments with the canvas
            tools. Select the replacement segment, then use it below to retain
            the original route’s ID, label and style. Closing this list keeps
            every pending route.
          </p>
          {repairs.map(([id, repair]) => (
            <section key={id} aria-label={`Repair ${id}`}>
              <strong>{repair.connection.label || id}</strong>
              <p>{repair.reason}</p>
              <details>
                <summary>Original route and positions</summary>
                <pre style={{ whiteSpace: 'pre-wrap' }}>
                  {JSON.stringify(repair, null, 2)}
                </pre>
              </details>
              <button
                type="button"
                disabled={!selected || !document.connections[selected]}
                onClick={() =>
                  selected && onEdit(resolveConnectionRepair(id, selected))
                }
              >
                Use selected segment for {repair.connection.label || id}
              </button>
            </section>
          ))}
        </>
      )}
    </aside>
  );
}
