import {
  useEffect,
  useLayoutEffect,
  useImperativeHandle,
  useRef,
  useState,
  type Ref,
} from 'react';
import type Konva from 'konva';
import type { RecursiveDocument } from '../../shared/recursiveDocument';
import {
  resolveExportSelection,
  type ExportSelection,
} from '../../shared/recursiveExportScope';
import {
  captureRecursiveScene,
  encodeRecursiveExport,
  restrictExportScene,
} from '../utils/recursiveExport';
import useDocumentDraft from '../hooks/useDocumentDraft';
export type RecursiveExportHandle = (() => void) & {
  capture: (request: {
    stamp: string;
    document: RecursiveDocument;
    selection: string[];
    scope: 'whole' | 'selection';
    format: 'svg' | 'png';
    permit: () => boolean;
  }) => Promise<string | Uint8Array>;
};
export default function RecursiveExport({
  ref,
  stage,
  document,
  selection,
  isBusy,
  onStatus,
  stamp,
}: {
  ref: Ref<RecursiveExportHandle>;
  stamp: string;
  stage: () => Konva.Stage | null;
  document: RecursiveDocument;
  selection: string[];
  isBusy: () => boolean;
  onStatus: (message: string) => void;
}) {
  const [snapshot, setSnapshot] = useState<{
    scene: Konva.Group;
    title: string;
    selection: ExportSelection;
  } | null>(null);
  const [scope, setScope] = useState<'selection' | 'whole'>('whole');
  const [format, setFormat] = useState<'svg' | 'png'>('svg');
  const dialog = useRef<HTMLDialogElement>(null);
  const rendered = useRef('');
  useLayoutEffect(() => {
    rendered.current = stamp;
  });
  useDocumentDraft({
    label: 'image export',
    active: () => !!snapshot,
    discard: () => setSnapshot(null),
  });
  const openDialog = () => {
    if (isBusy() || snapshot) {
      onStatus('Finish or cancel the current edit before exporting.');
      return;
    }
    const canvas = stage();
    if (canvas) {
      const included = resolveExportSelection(document, selection);
      setScope(
        included.objects.size || included.connections.size
          ? 'selection'
          : 'whole',
      );
      setSnapshot({
        scene: captureRecursiveScene(canvas),
        title: document.metadata.title,
        selection: included,
      });
    }
  };
  useImperativeHandle(ref, () =>
    Object.assign(openDialog, {
      capture: async (
        request: Parameters<RecursiveExportHandle['capture']>[0],
      ) => {
        const deadline = Date.now() + 5000;
        while (rendered.current !== request.stamp) {
          if (!request.permit())
            throw new Error('Export canceled or the requested view changed');
          if (Date.now() > deadline)
            throw new Error('Canvas has not rendered the requested revision');
          await new Promise((resolve) => setTimeout(resolve, 16));
        }
        if (!request.permit() || snapshot)
          throw new Error('Export canceled or an export dialog is active');
        const canvas = stage();
        if (!canvas) throw new Error('Canvas is unavailable');
        const scene = captureRecursiveScene(canvas);
        if (request.scope === 'selection')
          restrictExportScene(
            scene,
            resolveExportSelection(request.document, request.selection),
          );
        return encodeRecursiveExport(scene, request.format);
      },
    }),
  );
  useEffect(() => {
    if (snapshot) dialog.current!.showModal();
    return () => {
      snapshot?.scene.destroy();
    };
  }, [snapshot]);
  if (!snapshot) return null;
  const exportImage = async () => {
    // Transfer ownership out of dialog cleanup before encoding awaits the PNG blob.
    const scene = snapshot.scene.clone();
    if (scope === 'selection') restrictExportScene(scene, snapshot.selection);
    const name = snapshot.title.replace(/[^a-zA-Z0-9_-]/g, '_') || 'diagram';
    setSnapshot(null);
    try {
      const data = await encodeRecursiveExport(scene, format);
      const result = await window.desktop.export.exportImage(
        format,
        data,
        `${name}.${format}`,
      );
      onStatus(
        result
          ? `${format.toUpperCase()} exported successfully!`
          : 'Export canceled',
      );
    } catch (error) {
      onStatus(error instanceof Error ? error.message : 'Image export failed.');
    }
  };
  return (
    <dialog
      ref={dialog}
      data-document-editor
      aria-label="Export image"
      onCancel={(event) => {
        event.preventDefault();
        setSnapshot(null);
      }}
    >
      <h2>Export image</h2>
      <p>
        Export the current depths, including offscreen content in the chosen
        scope.
      </p>
      {!!(
        snapshot.selection.objects.size || snapshot.selection.connections.size
      ) && (
        <label>
          Scope
          <select
            aria-label="Scope"
            value={scope}
            onChange={(event) =>
              setScope(event.target.value as 'selection' | 'whole')
            }
          >
            <option value="selection">Selection</option>
            <option value="whole">Whole document</option>
          </select>
        </label>
      )}
      <label>
        Format
        <select
          aria-label="Format"
          value={format}
          onChange={(event) => setFormat(event.target.value as 'svg' | 'png')}
        >
          <option value="svg">SVG</option>
          <option value="png">PNG</option>
        </select>
      </label>
      <button type="button" onClick={() => setSnapshot(null)}>
        Cancel
      </button>
      <button type="button" onClick={() => void exportImage()}>
        Export
      </button>
    </dialog>
  );
}
