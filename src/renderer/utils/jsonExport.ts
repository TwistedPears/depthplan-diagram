import type { RecursiveDocument } from '../../shared/recursiveDocument';

export default function exportAsJSON(
  document: RecursiveDocument,
): Promise<string | null> {
  const title = document.metadata.title.replace(/[^a-zA-Z0-9_-]/g, '_');
  const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
  return window.desktop.export.exportJSON(
    document,
    `${title}_${timestamp}.depthplan.json`,
  );
}
