import { useEffect, useRef } from 'react';
import type {
  Geometry,
  RecursiveDocument,
} from '../../shared/recursiveDocument';
import {
  editObject,
  type DocumentEdit,
} from '../../shared/documentTransactions';
import useDocumentDraft from '../hooks/useDocumentDraft';
import RichTextEditor from './RichTextEditor';

export default function InlineObjectText({
  document,
  objectId,
  geometry,
  camera,
  toolbarTarget,
  onEdit,
  onClose,
}: {
  document: RecursiveDocument;
  objectId: string;
  geometry: Geometry;
  camera: { x: number; y: number; scale: number };
  toolbarTarget: HTMLElement | null;
  onEdit: (edit: DocumentEdit) => void;
  onClose: () => void;
}) {
  const object = document.objects[objectId];
  const initial = useRef(object.content);
  const content = useRef(object.content);
  const host = useRef<HTMLDivElement>(null);
  const finished = useRef(false);
  const finish = () => {
    if (finished.current) return;
    finished.current = true;
    if (JSON.stringify(content.current) !== JSON.stringify(initial.current))
      onEdit(editObject(objectId, { content: content.current }));
    onClose();
  };
  const finishRef = useRef(finish);
  finishRef.current = finish;
  useDocumentDraft({
    label: 'object text',
    active: () => true,
    apply: finish,
    discard: onClose,
  });
  useEffect(() => {
    const outside = (event: Event) => {
      const target = event.target as Element;
      if (
        !host.current?.contains(target) &&
        !target.closest(
          '#selection-controls, .selection-reopen, dialog, [role="dialog"]',
        )
      )
        finishRef.current();
    };
    const finishKey = (event: KeyboardEvent) => {
      if (
        !event.defaultPrevented &&
        !event.isComposing &&
        (event.key === 'Escape' ||
          (event.key === 'Enter' && (event.metaKey || event.ctrlKey)))
      ) {
        event.preventDefault();
        event.stopPropagation();
        finishRef.current();
      }
    };
    window.addEventListener('pointerdown', outside, true);
    window.addEventListener('focusin', outside);
    window.addEventListener('keydown', finishKey, true);
    return () => {
      window.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('focusin', outside);
      window.removeEventListener('keydown', finishKey, true);
    };
  }, []);
  const inset =
    object.type === 'ellipse' ? 0.15 : object.type === 'diamond' ? 0.25 : 0;
  const textX = Math.max(6, geometry.width * inset);
  const textY = Math.max(4, geometry.height * inset);
  const titleHeight = object.name ? 24 : 0;
  return (
    <div
      ref={host}
      className="inline-object-text"
      data-document-editor
      aria-label="Edit object text"
      style={{
        left: camera.x + geometry.x * camera.scale,
        top: camera.y + geometry.y * camera.scale,
        width: geometry.width,
        height: geometry.height,
        transform: `translate(-50%, -50%) rotate(${geometry.rotation}deg) scale(${camera.scale})`,
      }}
    >
      <div
        className="inline-object-text-body"
        style={{
          left: textX,
          top: textY + titleHeight,
          width: Math.max(40, geometry.width - 2 * textX),
          height: Math.max(24, geometry.height - 2 * textY - titleHeight),
        }}
      >
        <RichTextEditor
          content={initial.current}
          onChange={(value) => {
            content.current = value;
          }}
          compact
          focusOnMount
          toolbarTarget={toolbarTarget}
        />
      </div>
    </div>
  );
}
