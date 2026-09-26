import { useEffect, useRef, type CSSProperties } from 'react';
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
import {
  objectContentBounds,
  type TextExclusion,
} from '../../shared/objectContentBounds';

export default function InlineObjectText({
  document,
  objectId,
  hasChildren,
  exclusion,
  geometry,
  camera,
  toolbarTarget,
  onEdit,
  onClose,
}: {
  document: RecursiveDocument;
  objectId: string;
  hasChildren: boolean;
  exclusion?: TextExclusion;
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
  const { body } = objectContentBounds(
    object,
    geometry.width,
    geometry.height,
    hasChildren,
  );
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
        data-wrap={exclusion ? '' : undefined}
        style={
          {
            left: body.x + geometry.width / 2,
            top: body.y + geometry.height / 2,
            width: Math.max(40, body.width),
            height: Math.max(24, body.height),
            '--text-wrap-side': exclusion?.side,
            '--text-wrap-width': `${exclusion?.width ?? 0}px`,
            '--text-wrap-top': `${exclusion?.top ?? 0}px`,
            '--text-wrap-bottom': `${exclusion?.bottom ?? 0}px`,
          } as CSSProperties
        }
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
