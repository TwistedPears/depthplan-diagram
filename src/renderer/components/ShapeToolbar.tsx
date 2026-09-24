import Icon from './Icon';
import { useEffect, useRef, useState } from 'react';
import {
  AlignmentOperation,
  LayeringOperation,
  ToolMode,
} from '../types/CanvasTools';
import './ShapeToolbar.css';

interface ShapeToolbarProps {
  activeTool: ToolMode;
  onChangeTool: (tool: ToolMode) => void;
  // Alignment props
  selectedCount?: number;
  canAlign?: boolean;
  canLayer?: boolean;
  canDistribute?: boolean;
  arrangementReason?: string;
  onAlignmentOperation?: (operation: AlignmentOperation) => void;
  onLayeringOperation?: (operation: LayeringOperation) => void;
  onSearch?: (query: string) => void;
}

function ShapeToolbar({
  activeTool,
  onChangeTool,
  selectedCount = 0,
  canAlign = false,
  canLayer = false,
  canDistribute = selectedCount >= 3 && canAlign,
  arrangementReason,
  onAlignmentOperation,
  onLayeringOperation,
  onSearch,
}: ShapeToolbarProps) {
  const [openAlign, setOpenAlign] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const searchInput = useRef<HTMLInputElement>(null);
  const searchButton = useRef<HTMLButtonElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (searchOpen) searchInput.current?.focus();
  }, [searchOpen]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        toolbarRef.current &&
        !toolbarRef.current.contains(e.target as Node)
      ) {
        setOpenAlign(false);
      }
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenAlign(false);
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', escape);
    };
  }, []);
  const makeButton = (id: ToolMode, icon: string, title: string) => (
    <button
      key={id}
      type="button"
      className={`tool-button ${activeTool === id ? 'active' : ''}`}
      onClick={() => onChangeTool(id)}
      title={title}
      aria-label={title}
      aria-pressed={activeTool === id}
    >
      <Icon name={icon} />
    </button>
  );

  return (
    <div
      ref={toolbarRef}
      className="shape-toolbar"
      role="toolbar"
      aria-label="Drawing tools"
    >
      {makeButton(ToolMode.HAND, 'hand', 'Hand (Pan)')}
      {makeButton(ToolMode.POINTER, 'arrow-pointer', 'Pointer (Select/Edit)')}
      <div className="divider" />
      {makeButton(ToolMode.SQUARE, 'square', 'Square')}
      {makeButton(ToolMode.DIAMOND, 'diamond', 'Diamond')}
      {makeButton(ToolMode.CIRCLE, 'circle', 'Circle')}
      {makeButton(ToolMode.FRAME, 'frame', 'Frame')}
      <div className="divider" />
      {makeButton(ToolMode.LINE, 'minus', 'Line')}
      {makeButton(ToolMode.ARROW, 'arrow-right', 'Arrow')}
      <div className="divider" />
      <button
        type="button"
        className={`tool-button ${openAlign ? 'active' : ''}`}
        onClick={() => setOpenAlign(!openAlign)}
        title={selectedCount > 0 ? `Align (${selectedCount})` : 'Align'}
        aria-label="Arrange selection"
        aria-expanded={openAlign && selectedCount > 0}
        disabled={selectedCount === 0}
      >
        <Icon name="objects-align-left" />
      </button>

      {onSearch && (
        <>
          <button
            ref={searchButton}
            id="object-search-toggle"
            type="button"
            className={`tool-button ${searchOpen ? 'active' : ''}`}
            title="Search objects"
            aria-label="Search objects"
            aria-expanded={searchOpen}
            aria-controls="object-search-form"
            onClick={() => {
              setOpenAlign(false);
              setSearchOpen(!searchOpen);
            }}
          >
            <Icon name="magnifying-glass" />
          </button>
          <form
            id="object-search-form"
            className="object-search-form"
            role="search"
            hidden={!searchOpen}
            onSubmit={(event) => {
              event.preventDefault();
              onSearch(searchInput.current?.value.trim() ?? '');
            }}
          >
            <input
              ref={searchInput}
              id="object-search-input"
              type="search"
              aria-label="Search object text"
              placeholder="Search object text… Press Enter"
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.stopPropagation();
                  setSearchOpen(false);
                  searchButton.current?.focus();
                }
              }}
            />
          </form>
        </>
      )}

      {openAlign && selectedCount > 0 && (
        <div className="alignment-dropdown">
          {arrangementReason && <p role="status">{arrangementReason}</p>}
          <div className="dropdown-label">Layers</div>
          <div className="row">
            <button
              type="button"
              onClick={() => {
                onLayeringOperation?.(LayeringOperation.SEND_BACKWARD);
                setOpenAlign(false);
              }}
              disabled={!canLayer}
              title="Move Backward"
            >
              <Icon name="arrow-down" />
            </button>
            <button
              type="button"
              onClick={() => {
                onLayeringOperation?.(LayeringOperation.SEND_TO_BACK);
                setOpenAlign(false);
              }}
              disabled={!canLayer}
              title="Send to Back"
            >
              <Icon name="arrow-down-to-line" />
            </button>
            <button
              type="button"
              onClick={() => {
                onLayeringOperation?.(LayeringOperation.BRING_FORWARD);
                setOpenAlign(false);
              }}
              disabled={!canLayer}
              title="Move Forward"
            >
              <Icon name="arrow-up" />
            </button>
            <button
              type="button"
              onClick={() => {
                onLayeringOperation?.(LayeringOperation.BRING_TO_FRONT);
                setOpenAlign(false);
              }}
              disabled={!canLayer}
              title="Bring to Front"
            >
              <Icon name="arrow-up-to-line" />
            </button>
          </div>
          <div className="dropdown-label">Align</div>
          <div className="grid">
            <button
              type="button"
              onClick={() => {
                onAlignmentOperation?.(AlignmentOperation.ALIGN_LEFT);
                setOpenAlign(false);
              }}
              aria-label="Align left"
              title="Align left"
              disabled={!canAlign}
            >
              <Icon name="objects-align-left" />
            </button>
            <button
              type="button"
              onClick={() => {
                onAlignmentOperation?.(AlignmentOperation.ALIGN_CENTER);
                setOpenAlign(false);
              }}
              aria-label="Align center"
              title="Align center"
              disabled={!canAlign}
            >
              <Icon name="objects-align-center-horizontal" />
            </button>
            <button
              type="button"
              onClick={() => {
                onAlignmentOperation?.(AlignmentOperation.ALIGN_RIGHT);
                setOpenAlign(false);
              }}
              aria-label="Align right"
              title="Align right"
              disabled={!canAlign}
            >
              <Icon name="objects-align-right" />
            </button>
            <button
              type="button"
              onClick={() => {
                onAlignmentOperation?.(AlignmentOperation.ALIGN_TOP);
                setOpenAlign(false);
              }}
              aria-label="Align top"
              title="Align top"
              disabled={!canAlign}
            >
              <Icon name="objects-align-top" />
            </button>
            <button
              type="button"
              onClick={() => {
                onAlignmentOperation?.(AlignmentOperation.ALIGN_MIDDLE);
                setOpenAlign(false);
              }}
              aria-label="Align middle"
              title="Align middle"
              disabled={!canAlign}
            >
              <Icon name="objects-align-center-vertical" />
            </button>
            <button
              type="button"
              onClick={() => {
                onAlignmentOperation?.(AlignmentOperation.ALIGN_BOTTOM);
                setOpenAlign(false);
              }}
              aria-label="Align bottom"
              title="Align bottom"
              disabled={!canAlign}
            >
              <Icon name="objects-align-bottom" />
            </button>
          </div>
          <div className="dropdown-label">Distribute / size</div>
          <div className="grid distribute-size-grid">
            {(
              [
                [
                  AlignmentOperation.DISTRIBUTE_HORIZONTAL,
                  'Distribute horizontally',
                  'distribute-spacing-horizontal',
                ],
                [
                  AlignmentOperation.DISTRIBUTE_VERTICAL,
                  'Distribute vertically',
                  'distribute-spacing-vertical',
                ],
                [
                  AlignmentOperation.MAKE_SAME_WIDTH,
                  'Match width',
                  'arrow-up-right-and-arrow-down-left-from-center',
                  45,
                ],
                [
                  AlignmentOperation.MAKE_SAME_HEIGHT,
                  'Match height',
                  'arrow-up-right-and-arrow-down-left-from-center',
                  -45,
                ],
              ] as const
            ).map(([operation, label, icon, rotation = 0]) => (
              <button
                key={operation}
                type="button"
                aria-label={label}
                title={label}
                disabled={
                  operation.startsWith('distribute')
                    ? !canDistribute
                    : !canAlign
                }
                onClick={() => {
                  onAlignmentOperation?.(operation);
                  setOpenAlign(false);
                }}
              >
                <Icon name={icon} rotation={rotation} />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default ShapeToolbar;
