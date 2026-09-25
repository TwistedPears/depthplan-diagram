import { arrowheads, markerLabel } from '../../shared/connectionGeometry';
import { patchSelectionStyle } from '../../shared/editorProperties';
import { useEffect, useState, type KeyboardEvent } from 'react';
import Icon from './Icon';
import type { DocumentEdit } from '../../shared/documentTransactions';
import type { RecursiveDocument } from '../../shared/recursiveDocument';
import { stackSelection } from '../../shared/recursiveArrangement';
import PropertyColorPalette from './PropertyColorPalette';
import './SelectionProperties.css';

const markerIcons: Record<(typeof arrowheads)[number], string> = {
  none: 'minus',
  arrow: 'arrow-right',
  bar: 'marker-bar',
  circle: 'marker-circle-filled',
  circle_outline: 'marker-circle-outline',
  triangle: 'marker-triangle-filled',
  triangle_outline: 'marker-triangle-outline',
  diamond: 'marker-diamond-filled',
  diamond_outline: 'marker-diamond-outline',
  crowfoot_many: 'marker-many',
  crowfoot_one: 'marker-bar',
  crowfoot_one_or_many: 'marker-one-or-many',
  cardinality_one: 'marker-bar',
  cardinality_many: 'marker-many',
  cardinality_one_or_many: 'marker-one-or-many',
  cardinality_exactly_one: 'marker-exactly-one',
  cardinality_zero_or_one: 'marker-zero-or-one',
  cardinality_zero_or_many: 'marker-zero-or-many',
};

type Choice = readonly [string | number, string, string];
function IconChoices({
  label,
  value,
  options,
  onChange,
  menu = false,
  mirror = false,
}: {
  label: string;
  value: string | number;
  options: readonly Choice[];
  onChange: (value: string | number) => void;
  menu?: boolean;
  mirror?: boolean;
}) {
  const closePicker = (target: HTMLElement) => {
    const picker = target.closest('details');
    if (picker) {
      picker.open = false;
      picker.querySelector('summary')?.focus();
    }
  };
  const dismiss = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      closePicker(event.currentTarget);
      event.stopPropagation();
    }
  };
  const buttons = (
    <div className="property-choices">
      {options.map(([option, title, icon]) => (
        <button
          key={option}
          type="button"
          aria-label={title}
          title={title}
          aria-pressed={value === option}
          onKeyDown={menu ? dismiss : undefined}
          onClick={(event) => {
            onChange(option);
            closePicker(event.currentTarget);
          }}
        >
          <Icon name={icon} mirror={mirror} className="property-icon" />
        </button>
      ))}
    </div>
  );
  return (
    <fieldset className="property-group">
      <legend>{label}</legend>
      {menu ? (
        <details className="marker-picker" name="connection-markers">
          <summary
            aria-label={label}
            title={`${label}: ${markerLabel(String(value))}`}
            onKeyDown={dismiss}
          >
            <Icon
              name={
                options.find(([option]) => option === value)?.[2] ?? 'minus'
              }
              mirror={mirror}
              className="property-icon"
            />
            <Icon name="chevron-right" rotation={90} />
          </summary>
          {buttons}
        </details>
      ) : (
        buttons
      )}
    </fieldset>
  );
}

export default function SelectionProperties({
  document,
  selection,
  textMode,
  onEdit,
}: {
  document: RecursiveDocument;
  selection: string[];
  textMode: boolean;
  onEdit: (edit: DocumentEdit) => void;
}) {
  const items = selection
    .map((key) =>
      key.startsWith('object-')
        ? document.objects[key.slice(7)]
        : document.connections[key.slice(11)],
    )
    .filter(Boolean);
  const shapesOnly = selection.every((key) => key.startsWith('object-'));
  const style = items[0]?.style ?? {};
  const strokeWidth = Number(style.strokeWidth ?? 2);
  const opacity = typeof style.opacity === 'number' ? style.opacity : 1;
  const [opacityDraft, setOpacityDraft] = useState(opacity);
  const selectionKey = selection.join(',');
  useEffect(() => setOpacityDraft(opacity), [opacity, selectionKey]);
  if (!items.length) return null;
  const color = (key: string, fallback: string) =>
    typeof style[key] === 'string' ? (style[key] as string) : fallback;
  const setStyle = (key: string, value: string | number) =>
    onEdit(patchSelectionStyle(selection, { [key]: value }));
  const commitOpacity = () => {
    if (opacityDraft !== opacity) setStyle('opacity', opacityDraft);
  };
  return (
    <div className="selection-properties">
      {!textMode && (
        <>
          {selection.every((key) => key.startsWith('connection-')) && (
            <>
              <IconChoices
                label="Path"
                value={String(style.lineType ?? 'sharp')}
                options={[
                  ['sharp', 'Straight path', 'path-straight'],
                  ['curved', 'Curved path', 'path-curved'],
                  ['elbow', 'Elbow path', 'path-elbow'],
                ]}
                onChange={(value) => setStyle('lineType', value)}
              />
              <div className="marker-controls">
                {(['Start', 'End'] as const).map((end) => (
                  <IconChoices
                    key={end}
                    label={`${end} marker`}
                    menu
                    mirror={end === 'Start'}
                    value={String(
                      style[`arrowhead${end}`] ??
                        (end === 'End' &&
                        document.connections[selection[0].slice(11)]?.kind ===
                          'arrow'
                          ? 'arrow'
                          : 'none'),
                    )}
                    options={arrowheads.map((value) => [
                      value,
                      `${end} marker: ${markerLabel(value)}`,
                      markerIcons[value],
                    ])}
                    onChange={(value) => setStyle(`arrowhead${end}`, value)}
                  />
                ))}
              </div>
            </>
          )}
          <PropertyColorPalette
            label="Stroke"
            value={color('stroke', shapesOnly ? '#64748b' : '#475569')}
            onChange={(value) => setStyle('stroke', value)}
          />
          {shapesOnly && (
            <>
              <PropertyColorPalette
                label="Background"
                background
                value={color('fill', '#ffffff')}
                onChange={(value) => {
                  onEdit(
                    patchSelectionStyle(selection, {
                      fill: value,
                      ...(style.fillType === 'none' && value !== 'transparent'
                        ? { fillType: 'solid' }
                        : {}),
                    }),
                  );
                }}
              />
              <IconChoices
                label="Fill type"
                value={String(style.fillType ?? 'solid')}
                options={[
                  ['none', 'No fill', 'fill-none'],
                  ['hachure', 'Hachure fill', 'fill-hachure'],
                  ['cross-hatch', 'Cross hatch fill', 'fill-cross-hatch'],
                  ['solid', 'Solid fill', 'fill-solid'],
                ]}
                onChange={(value) => setStyle('fillType', value)}
              />
            </>
          )}
          <IconChoices
            label="Stroke width"
            // Recognize the previous Thin preset without changing saved widths.
            value={strokeWidth === 1.5 ? 2 : strokeWidth}
            options={[
              [0, 'No stroke', 'stroke-width-none'],
              [2, 'Thin stroke', 'stroke-width-thin'],
              [3, 'Medium stroke', 'stroke-width-medium'],
              [5, 'Thick stroke', 'stroke-width-thick'],
            ]}
            onChange={(value) => setStyle('strokeWidth', value)}
          />
          {items.every(
            (item) =>
              'type' in item && ['rectangle', 'frame'].includes(item.type),
          ) && (
            <IconChoices
              label="Corners"
              value={Number(style.cornerRadius ?? 0) > 0 ? 'rounded' : 'sharp'}
              options={[
                ['sharp', 'Sharp corners', 'corner-sharp'],
                ['rounded', 'Rounded corners', 'corner-rounded'],
              ]}
              onChange={(value) =>
                setStyle('cornerRadius', value === 'rounded' ? 12 : 0)
              }
            />
          )}
          <IconChoices
            label="Stroke style"
            value={String(style.strokeStyle ?? 'solid')}
            options={[
              ['solid', 'Solid stroke', 'minus'],
              ['dashed', 'Dashed stroke', 'stroke-dashed'],
              ['dotted', 'Dotted stroke', 'stroke-dotted'],
            ]}
            onChange={(value) => setStyle('strokeStyle', value)}
          />
        </>
      )}
      <fieldset className="property-group">
        <legend>Opacity</legend>
        <input
          type="range"
          aria-label="Opacity"
          min="0"
          max="1"
          step="0.01"
          value={opacityDraft}
          onChange={(event) => setOpacityDraft(Number(event.target.value))}
          onPointerUp={commitOpacity}
          onKeyUp={commitOpacity}
          onBlur={commitOpacity}
        />
        <div className="property-range-labels">
          <span>0</span>
          <output>{Math.round(opacityDraft * 100)}%</output>
        </div>
      </fieldset>
      <fieldset className="property-group">
        <legend>Layers</legend>
        <div className="property-choices">
          {(
            [
              ['send-to-back', 'Send to back', 'arrow-down-to-line'],
              ['send-backward', 'Send backward', 'arrow-down'],
              ['bring-forward', 'Bring forward', 'arrow-up'],
              ['bring-to-front', 'Bring to front', 'arrow-up-to-line'],
            ] as const
          ).map(([action, label, icon]) => (
            <button
              key={action}
              type="button"
              aria-label={label}
              title={label}
              onClick={() => onEdit(stackSelection(selection, action))}
            >
              <Icon name={icon} className="property-icon" />
            </button>
          ))}
        </div>
      </fieldset>
    </div>
  );
}
