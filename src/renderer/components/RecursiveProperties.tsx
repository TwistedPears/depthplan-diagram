import { arrowheads, markerLabel } from '../../shared/connectionGeometry';
import { patchObject, patchConnection } from '../../shared/editorProperties';
import useDocumentDraft from '../hooks/useDocumentDraft';
import { useEffect, useRef, useState } from 'react';
import type {
  RecursiveDocument,
  RichBlock,
} from '../../shared/recursiveDocument';
import {
  type DocumentEdit,
  editActiveGeometry,
} from '../../shared/documentTransactions';
import { activeGeometry } from '../../shared/recursiveLayouts';
import RichTextEditor from './RichTextEditor';
import { indexHierarchy } from '../../shared/recursiveHierarchy';

const geometryKeys = ['x', 'y', 'z', 'width', 'height', 'rotation'] as const;

export default function RecursiveProperties({
  document,
  target,
  onEdit,
  onClose,
}: {
  document: RecursiveDocument;
  target: string;
  onEdit: (edit: DocumentEdit) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLElement>(null);
  useDocumentDraft({
    label: 'primitive properties',
    active: () => true,
    apply: () => dialog.current!.querySelector('form')!.requestSubmit(),
    discard: onClose,
  });
  const initialValues = useRef<FormData | null>(null);
  useEffect(() => {
    const node = dialog.current!;
    initialValues.current ??= new FormData(node.querySelector('form')!);
  }, []);
  const object = target.startsWith('object-')
    ? document.objects[target.slice(7)]
    : undefined;
  const connection = target.startsWith('connection-')
    ? document.connections[target.slice(11)]
    : undefined;
  const style = object?.style ?? connection?.style ?? {};
  const [content, setContent] = useState<RichBlock[] | null>(null);
  const contentChanged =
    object &&
    content !== null &&
    JSON.stringify(content) !== JSON.stringify(object.content);
  const geometry = object && activeGeometry(document, object.id);
  const root =
    object && indexHierarchy(document.objects).entries.get(object.id)!.root;
  const color = (key: string, fallback: string) =>
    typeof style[key] === 'string' ? (style[key] as string) : fallback;
  return (
    <section
      ref={dialog}
      data-document-editor
      aria-label="Primitive properties"
      onKeyDownCapture={(event) => {
        if (event.key === 'Escape' && !event.nativeEvent.isComposing) {
          event.preventDefault();
          onClose();
        }
      }}
      className="properties-panel"
    >
      <form
        onInput={(event) => {
          if (event.target instanceof HTMLInputElement)
            event.target.setCustomValidity('');
        }}
        onSubmit={(event) => {
          event.preventDefault();
          const values = new FormData(event.currentTarget);
          const changed = (name: string) =>
            values.get(name) !== initialValues.current?.get(name);
          const text = (name: string) => String(values.get(name) ?? '');
          const number = (name: string) => Number(values.get(name));
          if (object || connection) {
            for (const key of object ? geometryKeys : (['z'] as const)) {
              const value = number(key);
              if (
                !text(key).trim() ||
                !Number.isFinite(value) ||
                (key === 'z' && !Number.isInteger(value)) ||
                ((key === 'width' || key === 'height') && value <= 0)
              ) {
                const input = event.currentTarget.elements.namedItem(
                  key,
                ) as HTMLInputElement;
                input.setCustomValidity(
                  key === 'z'
                    ? 'Enter an integer.'
                    : key === 'width' || key === 'height'
                      ? 'Enter a positive finite size.'
                      : 'Enter a finite number.',
                );
                input.reportValidity();
                return;
              }
            }
          }
          for (const key of ['fill', 'stroke']) {
            if (changed(key) && !CSS.supports('color', text(key))) {
              const input = event.currentTarget.elements.namedItem(
                key,
              ) as HTMLInputElement;
              input.setCustomValidity('Enter a valid CSS color.');
              input.reportValidity();
              return;
            }
          }
          if (
            ![...values.keys()].some(changed) &&
            !changed('clipToFrame') &&
            !contentChanged
          ) {
            onClose();
            return;
          }
          onEdit((draft) => {
            const nextStyle = { ...style };
            const stringKeys = [
              'fill',
              'stroke',
              'strokeStyle',
              'lineType',
              'arrowheadStart',
              'arrowheadEnd',
            ];
            const numberKeys = ['strokeWidth', 'opacity', 'cornerRadius'];
            for (const key of stringKeys)
              if (changed(key)) nextStyle[key] = text(key);
            for (const key of numberKeys)
              if (changed(key)) nextStyle[key] = number(key);
            if (changed('clipToFrame'))
              nextStyle.clipToFrame = values.has('clipToFrame');
            const styleChanged = [
              ...stringKeys,
              ...numberKeys,
              'clipToFrame',
            ].some(changed);
            if (object) {
              const patch: Parameters<typeof patchObject>[1] = {};
              if (changed('name')) patch.name = text('name');
              if (styleChanged) patch.style = nextStyle;
              if (contentChanged) patch.content = content!;
              patchObject(object.id, patch)(draft);
              const geometryPatch = Object.fromEntries(
                geometryKeys
                  .filter(changed)
                  .map((key) => [
                    key,
                    key === 'rotation'
                      ? ((number(key) % 360) + 360) % 360
                      : number(key),
                  ]),
              );
              editActiveGeometry(object.id, geometryPatch)(draft);
            } else if (connection) {
              patchConnection(connection.id, {
                ...(styleChanged ? { style: nextStyle } : {}),
                ...(changed('label') ? { label: text('label') } : {}),
                ...(changed('z') ? { z: number('z') } : {}),
              })(draft);
            }
          });
          onClose();
        }}
        style={{ display: 'grid', gap: 12 }}
      >
        {object && (
          <>
            <label>
              Name <input name="name" defaultValue={object.name} />
            </label>
            <fieldset className="geometry-fields">
              <legend>Geometry · D{document.rootDepths[root!]}</legend>
              <p>
                {object.parentId === null
                  ? 'World coordinates'
                  : `Coordinates relative to parent: ${document.objects[object.parentId].name}`}{' '}
                · X/Y locate the center
              </p>
              {(['x', 'y', 'z', 'width', 'height'] as const).map((key) => (
                <label key={key}>
                  {key.length === 1
                    ? key.toUpperCase()
                    : key === 'width'
                      ? 'Width'
                      : 'Height'}{' '}
                  <input
                    name={key}
                    type="number"
                    step={key === 'z' ? 1 : 'any'}
                    required
                    defaultValue={geometry![key]}
                  />
                </label>
              ))}
            </fieldset>
            {Object.values(document.extensions ?? {}).some(
              (value) =>
                value &&
                typeof value === 'object' &&
                !Array.isArray(value) &&
                value.kind === 'code-language-fallback',
            ) && (
              <p role="status">
                Unsupported imported code languages display as plaintext.
                Original language metadata is retained in the document's
                compatibility record.
              </p>
            )}
            <RichTextEditor content={object.content} onChange={setContent} />
            <label>
              Fill{' '}
              <input
                name="fill"
                type="text"
                defaultValue={color('fill', '#ffffff')}
              />
            </label>
            <label>
              Opacity{' '}
              <input
                name="opacity"
                type="number"
                min={0}
                max={1}
                step={0.01}
                required
                defaultValue={
                  typeof style.opacity === 'number' ? style.opacity : 1
                }
              />
            </label>
            <label>
              Corner radius{' '}
              <input
                name="cornerRadius"
                type="number"
                min={0}
                required
                defaultValue={
                  typeof style.cornerRadius === 'number'
                    ? style.cornerRadius
                    : 0
                }
              />
            </label>
            <label>
              Rotation{' '}
              <input
                name="rotation"
                type="number"
                step="any"
                required
                defaultValue={geometry!.rotation}
              />
            </label>
            <label>
              <input
                name="clipToFrame"
                type="checkbox"
                defaultChecked={style.clipToFrame === true}
              />{' '}
              Clip children to parent
            </label>
          </>
        )}
        <label>
          Stroke{' '}
          <input
            name="stroke"
            type="text"
            defaultValue={color('stroke', '#64748b')}
          />
        </label>
        <label>
          Stroke width{' '}
          <input
            name="strokeWidth"
            type="number"
            min={0}
            step={0.5}
            required
            defaultValue={
              typeof style.strokeWidth === 'number' ? style.strokeWidth : 2
            }
          />
        </label>
        <label>
          Stroke style{' '}
          <select
            name="strokeStyle"
            aria-label="Stroke style"
            defaultValue={
              typeof style.strokeStyle === 'string'
                ? style.strokeStyle
                : 'solid'
            }
          >
            <option>solid</option>
            <option>dashed</option>
            <option>dotted</option>
          </select>
        </label>
        {connection && (
          <>
            <label>
              Z{' '}
              <input
                name="z"
                type="number"
                step={1}
                required
                defaultValue={connection.z}
              />
            </label>
            <label>
              Label <input name="label" defaultValue={connection.label ?? ''} />
            </label>
            <label>
              Line type{' '}
              <select
                name="lineType"
                aria-label="Line type"
                defaultValue={
                  typeof style.lineType === 'string' ? style.lineType : 'sharp'
                }
              >
                <option>sharp</option>
                <option>curved</option>
                <option>elbow</option>
              </select>
            </label>
            {(['Start', 'End'] as const).map((end) => (
              <label key={end}>
                {end} marker{' '}
                <select
                  name={`arrowhead${end}`}
                  aria-label={`${end} marker`}
                  defaultValue={
                    typeof style[`arrowhead${end}`] === 'string'
                      ? (style[`arrowhead${end}`] as string)
                      : end === 'End' && connection.kind === 'arrow'
                        ? 'arrow'
                        : 'none'
                  }
                >
                  {arrowheads.map((value) => (
                    <option key={value} value={value}>
                      {markerLabel(value)}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </>
        )}
        <div className="properties-actions">
          <button type="submit">Apply</button>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </section>
  );
}
