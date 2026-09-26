// Development-only real-canvas fixture. See docs/github-issues/13/implementation.md.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import Konva from 'konva';
import { Workspace } from '../App';
import useDocumentSessions, {
  DocumentSessions,
} from '../hooks/useDocumentSessions';
import { generateStressDocument } from '../../shared/stressDocument';

const noop = () => () => {};
window.desktop = {
  getAppInstanceId: async () => 'fixture',
  events: { on: noop },
  transitions: { onRequest: noop, confirm: async () => 'discard' },
  fileSystem: { onOpenRequested: noop },
  recovery: {
    discover: async () => ({ entries: [], warnings: [] }),
    write: async () => {},
    remove: async () => {},
  },
  automation: { onRequest: noop, status: async () => ({ enabled: false }) },
} as unknown as typeof window.desktop;

const painted = () =>
  new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
function Fixture() {
  const registry = useDocumentSessions();
  const [report, setReport] = useState('Ready');
  const [running, setRunning] = useState(false);
  const run = async () => {
    setRunning(true);
    try {
      const times: number[] = [];
      const counts: number[] = [];
      const heap = () =>
        (performance as Performance & { memory?: { usedJSHeapSize: number } })
          .memory?.usedJSHeapSize;
      for (let i = 0; i < 3; i++) {
        const key = `fixture-${i}`;
        await registry.open(key, async () => ({
          status: 'success',
          document: generateStressDocument({
            seed: key,
            roots: 4,
            breadth: 4,
            depth: 3,
          }).document,
          source: { id: key, path: `/${key}.depthplan`, fingerprint: key },
        }));
        await painted();
      }
      const heapBefore = heap();
      const snapshots = [...registry.controllers].map(
        ([key, { owner }]) => [key, owner.snapshot()] as const,
      );
      for (let i = 0; i < 60; i++) {
        const start = performance.now();
        if (!registry.activate(`fixture-${i % 3}`))
          throw new Error('Switch rejected');
        await painted();
        times.push(performance.now() - start);
        counts.push(document.querySelectorAll('canvas').length);
        if (Konva.stages.length !== 1)
          throw new Error(`Retained ${Konva.stages.length} stages`);
      }
      for (const [key, before] of snapshots) {
        const after = registry.controllers.get(key)!.owner.snapshot();
        if (
          after.document !== before.document ||
          after.revision !== before.revision ||
          after.dirty !== before.dirty
        )
          throw new Error(`Switch modified ${key}`);
      }
      if (new Set(counts).size !== 1)
        throw new Error(`Canvas resources grew: ${counts.join(',')}`);
      const sorted = times.sort((a, b) => a - b);
      setReport(
        JSON.stringify(
          {
            switches: times.length,
            heapBefore,
            heapAfter: heap(),
            medianMs: sorted[30],
            p95Ms: sorted[56],
            maxMs: sorted.at(-1),
            stages: Konva.stages.length,
            canvases: counts[0],
            sessions: registry.controllers.size,
            objectsPerBoard: Object.keys(snapshots[1][1].document!.objects)
              .length,
            userAgent: navigator.userAgent,
          },
          null,
          2,
        ),
      );
    } catch (error) {
      setReport(`FAILED: ${String(error)}`);
    } finally {
      setRunning(false);
    }
  };
  return (
    <>
      <Workspace />
      <aside
        data-session-navigation
        style={{
          position: 'fixed',
          zIndex: 5000,
          right: 8,
          top: 8,
          background: 'white',
          padding: 12,
          maxWidth: 420,
        }}
      >
        <button disabled={running} onClick={() => void run()}>
          Run 60 switches
        </button>
        {[0, 1, 2].map((i) => (
          <button
            key={i}
            disabled={running}
            onClick={() => registry.activate(`fixture-${i}`)}
          >
            Board {i}
          </button>
        ))}
        <pre role="status" style={{ whiteSpace: 'pre-wrap' }}>
          {report}
        </pre>
      </aside>
    </>
  );
}
createRoot(document.getElementById('root')!).render(
  <DocumentSessions>
    <Fixture />
  </DocumentSessions>,
);
