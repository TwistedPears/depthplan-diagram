import useConnectionEditing from '../hooks/useConnectionEditing';
import type { CanvasState } from '../../shared/editorApiContract';
import Icon from './Icon';
import ChildStackToggle from './ChildStackToggle';
import useDocumentDraft from '../hooks/useDocumentDraft';
import useCanvasPan from '../hooks/useCanvasPan';
import useExpansionAnimation from '../hooks/useExpansionAnimation';
import { flushSync } from 'react-dom';
import {
  memo,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useImperativeHandle,
  useMemo,
  useState,
  useRef,
  useCallback,
  type Ref,
  type Dispatch,
  type SetStateAction,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import {
  Stage,
  Layer,
  Group,
  Rect,
  Circle,
  Ellipse,
  Line,
  Arrow,
} from 'react-konva';
import Konva from 'konva';
import ShapeToolbar from './ShapeToolbar';
import ObjectSearchResults from './ObjectSearchResults';
import ConnectionRepairs from './ConnectionRepairs';
import RecursiveDelete from './RecursiveDelete';
import RecursiveExport, { type RecursiveExportHandle } from './RecursiveExport';
import { cullViewport } from '../utils/recursivePaintBounds';
import RecursiveProperties from './RecursiveProperties';
import SelectionProperties from './SelectionProperties';
import SelectionLink from './SelectionLink';
import { duplicateSelection } from '../../shared/recursiveDuplication';
import InlineObjectText from './InlineObjectText';
import RecursiveScene from './RecursiveScene';
import ObjectOutline from './ObjectOutline';
import {
  revealObject,
  setChildrenExpanded,
} from '../../shared/recursiveLayouts';
import RootDepthControls from './RootDepthControls';
import { boundaryPosition } from '../../shared/recursiveBoundary';
import { ToolMode } from '../types/CanvasTools';
import {
  createShape,
  drawnGeometry,
  type Point,
  type ConnectionTarget,
} from '../../shared/recursiveCreation';
import {
  topmostObjects,
  moveSelection,
  previewGeometry,
  resizeGeometry,
} from '../../shared/recursiveMovement';
import {
  alignObjects,
  stackSelection,
} from '../../shared/recursiveArrangement';
import { eligibleParent, containsShape } from '../../shared/recursiveOwnership';
import { isEditingText } from '../hooks/useDocumentHistoryActions';
import {
  toggleSelection,
  marqueeSelection,
} from '../../shared/recursiveSelection';
import Minimap from './Minimap';
import useCanvasKeyboardShortcuts from '../hooks/useCanvasKeyboardShortcuts';
import useCanvasClipboard from '../hooks/useCanvasClipboard';
import {
  type Bounds,
  type Camera,
  geometryBounds,
  sceneBounds,
  fitCamera,
  zoomCamera,
} from '../../shared/recursiveCamera';
import type {
  Geometry,
  RecursiveDocument,
} from '../../shared/recursiveDocument';
import {
  type DocumentEdit,
  type TransactionResult,
  transactDocument,
} from '../../shared/documentTransactions';
import { toWorldGeometry } from '../../shared/recursiveHierarchy';
import { localPoint, worldPoint } from '../../shared/connectionGeometry';
import {
  createInwardBridge,
  reattachInwardBridge,
  inwardEndpoint,
  type BoundaryReference,
} from '../../shared/recursiveBridges';
import { recursiveScene, objectLabel } from '../../shared/recursiveScene';

export default memo(function RecursiveCanvas({
  document,
  camera,
  setCamera,
  onEdit,
  onSelectDepth,
  onBusyChange,
  exportRef,
  isBusy,
  onStatus,
  canvas,
  setCanvas,
  fitRef,
  stamp,
}: {
  fitRef: Ref<() => void>;
  canvas: CanvasState;
  setCanvas: Dispatch<SetStateAction<CanvasState>>;
  exportRef: Ref<RecursiveExportHandle>;
  stamp: string;
  isBusy: () => boolean;
  onStatus: (message: string) => void;
  document: RecursiveDocument;
  camera: Camera;
  setCamera: Dispatch<SetStateAction<Camera>>;
  onEdit: (edit: DocumentEdit) => TransactionResult | null;
  onSelectDepth: (rootId: string, depth: number | 'all') => void;
  onBusyChange: (source: string, busy: boolean) => void;
}) {
  const stageRef = useRef<Konva.Stage>(null);
  const {
    setTool,
    setSelected,
    setSelectedPoint,
    setMinimap,
    setSelectionCollapsed,
  } = useMemo(() => {
    const field =
      <K extends keyof CanvasState>(key: K) =>
      (update: SetStateAction<CanvasState[K]>) =>
        setCanvas((current) => ({
          ...current,
          [key]:
            typeof update === 'function'
              ? (update as (value: CanvasState[K]) => CanvasState[K])(
                  current[key],
                )
              : update,
        }));
    return {
      setTool: field('tool'),
      setSelected: field('selected'),
      setSelectedPoint: field('selectedPoint'),
      setMinimap: field('minimap'),
      setSelectionCollapsed: field('selectionCollapsed'),
    };
  }, [setCanvas]);
  const tool = canvas.tool as ToolMode;
  useCanvasPan(stageRef, tool);
  const { selected, selectedPoint, minimap, selectionCollapsed } = canvas;
  const [properties, setProperties] = useState<string | null>(null);
  const [textEditing, setTextEditing] = useState<string | null>(null);
  const [linkEditing, setLinkEditing] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string | null>(null);
  const [searchFocus, setSearchFocus] = useState<string | null>(null);
  const [textToolbar, setTextToolbar] = useState<HTMLDivElement | null>(null);
  const [draw, setDraw] = useState<{
    start: Point;
    end: Point;
    alt: boolean;
    square: boolean;
    document: RecursiveDocument;
    bridge?: { source: BoundaryReference; connectionId?: string };
  } | null>(null);
  const bridge = draw?.bridge;
  const suppressClick = useRef(false);
  const drawing = tool !== ToolMode.POINTER && tool !== ToolMode.HAND;
  const [size, setSize] = useState({
    width: window.innerWidth,
    height: window.innerHeight,
  });
  const previousSize = useRef(size);
  useLayoutEffect(() => {
    setCanvas((current) => ({ ...current, viewport: size }));
  }, [size, setCanvas]);
  useEffect(() => {
    const resize = () => {
      const next = { width: window.innerWidth, height: window.innerHeight };
      const previous = previousSize.current;
      previousSize.current = next;
      setSize(next);
      setCamera((c) => ({
        ...c,
        x: c.x + (next.width - previous.width) / 2,
        y: c.y + (next.height - previous.height) / 2,
      }));
    };
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [setCamera]);
  const [preview, setPreview] = useState<{
    base: RecursiveDocument;
    value: RecursiveDocument;
  } | null>(null);
  const { document: animated, finish: finishAnimation } = useExpansionAnimation(
    document,
    preview?.base === document,
  );
  const animating = animated !== document;
  const displayed = preview?.base === document ? preview.value : animated;
  const scene = useMemo(() => recursiveScene(displayed), [displayed]);
  const bounds = useMemo(() => sceneBounds(document, scene), [document, scene]);
  const toggleChildren = (
    id: string,
    event: ReactMouseEvent<HTMLButtonElement> | MouseEvent,
  ) => {
    // macOS dispatches Ctrl-click as a context menu instead of a normal click.
    if (event.type === 'contextmenu' && !event.ctrlKey) return;
    if (event.ctrlKey) event.preventDefault();
    if (!isBusy())
      onEdit(
        setChildrenExpanded(
          id,
          !event.ctrlKey && !scene.expanded.has(id),
          event.ctrlKey,
        ),
      );
  };
  const boxes = useMemo(
    () =>
      new Map<string, Bounds>([
        ...[...bounds.objects].map(([id, b]) => [`object-${id}`, b] as const),
        ...[...bounds.connections].map(
          ([id, b]) => [`connection-${id}`, b] as const,
        ),
      ]),
    [bounds],
  );
  const selectionControlsRef = useRef<HTMLDivElement>(null);
  const [marquee, setMarquee] = useState<{
    start: { x: number; y: number };
    end: { x: number; y: number };
    additive: boolean;
  } | null>(null);
  const selection = selected.filter((id) => boxes.has(id));
  useCanvasClipboard({
    document,
    selection,
    isBusy,
    onEdit,
    onSelect: (ids) => {
      setSelected(ids);
      setSelectedPoint(null);
    },
    onStatus,
  });
  const connector = useConnectionEditing({
    document,
    scene,
    camera,
    tool,
    selected: selection,
    stageRef,
    disabled: !!(properties || textEditing || bridge),
    onEdit,
    onBusyChange,
    onStatus,
    setPreview,
    onSelect: (id) => {
      setSelected([`connection-${id}`]);
      setSelectedPoint(null);
    },
    onFinish: () => setTool(ToolMode.POINTER),
  });
  const shapesOnly = selection.every((id) => id.startsWith('object-'));
  const arrangementIds = shapesOnly ? selection.map((id) => id.slice(7)) : [];
  const effectiveIds = topmostObjects(document, arrangementIds);
  useEffect(() => {
    setSelected((current) =>
      current.every((id) => boxes.has(id))
        ? current
        : current.filter((id) => boxes.has(id)),
    );
  }, [boxes, setSelected]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (
        event.key === 'Escape' &&
        !textEditing &&
        !isEditingText(event.target)
      ) {
        setSelected([]);
        setSelectedPoint(null);
        setMarquee(null);
        setDraw(null);
        setTool(ToolMode.POINTER);
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [textEditing, setSelected, setSelectedPoint, setTool]);
  useLayoutEffect(() => {
    onBusyChange(
      'canvas-draft',
      !!(properties || textEditing || linkEditing || draw || marquee),
    );
  }, [properties, textEditing, linkEditing, draw, marquee, onBusyChange]);
  useLayoutEffect(
    () => () => {
      onBusyChange('canvas-draft', false);
      onBusyChange('canvas-gesture', false);
    },
    [onBusyChange],
  );
  const pointer = () => stageRef.current!.getRelativePointerPosition()!;
  const targetKey = (target: Konva.Node) => {
    const node = target.findAncestor(
      '.recursive-object, .recursive-connection',
      true,
    );
    return node && boxes.has(node.id()) ? node.id() : null;
  };
  const connectionTarget = (target: Konva.Node): ConnectionTarget => {
    const point = target.findAncestor('.boundary-point', true);
    if (point)
      return {
        objectId: point.getAttr('boundaryObjectId'),
        pointId: point.getAttr('boundaryPointId'),
      };
    const key = targetKey(target);
    return key?.startsWith('object-') ? key.slice(7) : null;
  };
  useEffect(() => {
    if (
      selectedPoint &&
      (!scene.world.has(selectedPoint.objectId) ||
        !document.objects[selectedPoint.objectId]?.boundaryPoints?.[
          selectedPoint.pointId
        ])
    ) {
      setSelectedPoint(null);
    }
  }, [document, scene.world, selectedPoint, setSelectedPoint]);
  const gesture = useRef<{
    ids: string[];
    start: Point;
    document: RecursiveDocument;
    world: Map<string, Geometry>;
    resize?: { x: number; y: number };
    delta: Point;
    patches: Map<string, Partial<Geometry>>;
    moved: boolean;
    clickTarget?: string;
    additiveClick?: boolean;
    parentChanges: Map<
      string,
      {
        parent: string | null;
        ready: boolean;
        timer?: ReturnType<typeof setTimeout>;
      }
    >;
  } | null>(null);
  const [dropTargets, setDropTargets] = useState<
    Array<{ id: string; parent: string | null }>
  >([]);
  useEffect(
    () => () => {
      for (const change of gesture.current?.parentChanges.values() ?? [])
        clearTimeout(change.timer);
      gesture.current = null;
    },
    [],
  );
  const [moveError, setMoveError] = useState('');
  const cancelConnector = connector.cancel;
  const cancelDrag = useCallback(() => {
    cancelConnector();
    stageRef.current?.stopDrag();
    onBusyChange('canvas-gesture', false);
    for (const change of gesture.current?.parentChanges.values() ?? [])
      clearTimeout(change.timer);
    gesture.current = null;
    setPreview(null);
    setDropTargets([]);
    setDraw(null);
    setMarquee(null);
  }, [onBusyChange, cancelConnector]);
  useDocumentDraft({
    label: 'canvas gesture or connector',
    active: () => !!(gesture.current || draw || marquee || bridge),
    discard: () => {
      cancelDrag();
      setTool(ToolMode.POINTER);
    },
  });

  useEffect(() => {
    if (gesture.current && gesture.current.document !== document) cancelDrag();
  }, [document, cancelDrag]);
  const cancelOutside = useEffectEvent((event: MouseEvent) => {
    if (
      !(event.target instanceof HTMLCanvasElement) &&
      (gesture.current || draw || marquee)
    )
      cancelDrag();
  });
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isEditingText(event.target)) cancelDrag();
      updateDragModifier(event);
    };
    window.addEventListener('keydown', handleKey);
    window.addEventListener('keyup', updateDragModifier);
    window.addEventListener('blur', cancelDrag);
    window.addEventListener('mouseup', cancelOutside);
    return () => {
      window.removeEventListener('keydown', handleKey);
      window.removeEventListener('keyup', updateDragModifier);
      window.removeEventListener('blur', cancelDrag);
      window.removeEventListener('mouseup', cancelOutside);
    };
  }, [cancelDrag]);
  const beginGeometry = (ids: string[], resize?: { x: number; y: number }) => {
    const movers = topmostObjects(
      document,
      ids.filter((id) => id.startsWith('object-')).map((id) => id.slice(7)),
    );
    onBusyChange('canvas-gesture', true);
    gesture.current = {
      ids: movers,
      start: pointer(),
      document,
      world: scene.world,
      resize,
      delta: { x: 0, y: 0 },
      patches: new Map(),
      moved: false,
      parentChanges: new Map(),
    };
    setMoveError('');
    setPreview({ base: document, value: document });
  };
  const updateGeometry = (preserveParent: boolean) => {
    const active = gesture.current;
    if (!active || !active.ids.length) return;
    const point = pointer();
    const delta = { x: point.x - active.start.x, y: point.y - active.start.y };
    if (!active.moved && Math.hypot(delta.x, delta.y) * camera.scale < 3)
      return;
    if (!active.moved && active.additiveClick && active.clickTarget) {
      const id = active.clickTarget;
      setSelected((current) => (current.includes(id) ? current : [id]));
    }
    active.moved = true;
    active.delta = delta;
    active.patches = new Map<string, Partial<Geometry>>(
      active.ids.map((id) => {
        const g = active.world.get(id)!;
        if (active.resize) {
          return [id, resizeGeometry(g, active.resize, delta)];
        }
        return [id, { x: g.x + delta.x, y: g.y + delta.y }];
      }),
    );
    if (active.resize) {
      // The frame's center moves during resize; its contents stay in place.
      for (const [id, geometry] of active.world)
        if (document.objects[id].parentId === active.ids[0])
          active.patches.set(id, geometry);
    }
    setPreview({
      base: document,
      value: previewGeometry(document, active.patches),
    });
    if (preserveParent) {
      for (const change of active.parentChanges.values())
        clearTimeout(change.timer);
      active.parentChanges.clear();
      setDropTargets([]);
    } else if (!active.resize) {
      const publish = () =>
        setDropTargets(
          [...active.parentChanges]
            .filter(([, change]) => change.ready)
            .map(([id, { parent }]) => ({ id, parent })),
        );
      for (const id of active.ids) {
        const center = { ...active.world.get(id)!, ...active.patches.get(id) };
        const current = document.objects[id].parentId;
        let candidate = eligibleParent(document, center, new Set(active.ids));
        // Small edge movements stay within the current parent without flicker.
        if (
          candidate === null &&
          current !== null &&
          containsShape(
            document.objects[current],
            active.world.get(current)!,
            center,
            8 / camera.scale,
          )
        )
          candidate = current;
        const previous = active.parentChanges.get(id);
        if (candidate === current) {
          clearTimeout(previous?.timer);
          active.parentChanges.delete(id);
        } else if (!previous || previous.parent !== candidate) {
          clearTimeout(previous?.timer);
          const change: {
            parent: string | null;
            ready: boolean;
            timer?: ReturnType<typeof setTimeout>;
          } = { parent: candidate, ready: candidate === null };
          active.parentChanges.set(id, change);
          if (candidate !== null)
            change.timer = setTimeout(() => {
              if (gesture.current !== active) return;
              change.ready = true;
              publish();
            }, 400);
        }
      }
      publish();
    }
  };
  const updateDragModifier = useEffectEvent((event: KeyboardEvent) => {
    if (
      event.key === 'Control' &&
      gesture.current?.moved &&
      !gesture.current.resize
    )
      updateGeometry(event.ctrlKey);
  });
  const finishGeometry = (preserveParent: boolean) => {
    const active = gesture.current;
    if (!active) return;
    updateGeometry(preserveParent);
    cancelDrag();
    if (!active.moved) {
      if (active.clickTarget) {
        const id = active.clickTarget;
        setSelected((current) =>
          toggleSelection(current, id, !!active.additiveClick),
        );
        suppressClick.current = true;
      }
      return;
    }
    suppressClick.current = true;
    const edit: DocumentEdit = active.resize
      ? (draft) => {
          draft.layouts = previewGeometry(draft, active.patches).layouts;
        }
      : moveSelection(
          active.ids,
          active.delta,
          new Map(
            active.ids.map((id) => {
              const change = active.parentChanges.get(id);
              return [
                id,
                change?.ready ? change.parent : document.objects[id].parentId,
              ];
            }),
          ),
        );
    const result = transactDocument(document, edit);
    if (result.status === 'rejected') setMoveError(result.error);
    else {
      onEdit(edit);
      const after = recursiveScene(result.document);
      const hidden = active.ids.filter((id) => !after.world.has(id));
      if (hidden.length)
        setSelected([
          ...new Set(
            active.ids.map(
              (id) =>
                `object-${after.world.has(id) ? id : result.document.objects[id].parentId}`,
            ),
          ),
        ]);
      if (hidden.length)
        onStatus(
          `Moved ${hidden.length === 1 ? objectLabel(document.objects[hidden[0]]) : `${hidden.length} objects`} inside. Reveal children to see them.`,
        );
    }
  };
  useEffect(() => {
    if (draw && draw.document !== document) cancelDrag();
  }, [draw, document, cancelDrag]);
  const startInside = (source: BoundaryReference, connectionId?: string) => {
    setMoveError('');
    if (!scene.expanded.has(source.objectId)) {
      setMoveError(
        'Reveal children with the root depth control before connecting inside.',
      );
      return;
    }
    const g = scene.world.get(source.objectId)!;
    const at = boundaryPosition(
      document.objects[source.objectId].boundaryPoints![source.pointId],
      g,
      document.objects[source.objectId],
    );
    const start = toWorldGeometry({ ...g, ...at }, g);
    const kind = connectionId
      ? document.connections[connectionId].kind
      : 'arrow';
    onBusyChange('canvas-draft', true);
    setDraw({
      start,
      end: start,
      bridge: { source, connectionId },
      alt: false,
      square: false,
      document,
    });
    setTool(kind === 'line' ? ToolMode.LINE : ToolMode.ARROW);
  };
  const freeWorkspace = useCallback(() => {
    const top = size.width <= 1100 ? 150 : 84;
    const bottom = size.width <= 760 ? 146 : 90;
    let workspaceBottom = size.height - bottom;
    const area = {
      x: 18,
      y: top,
      width: size.width - 36,
      height: size.height - top - bottom,
    };
    const panel = window.document.getElementById('selection-controls');
    if (panel && !panel.hidden) {
      const box = panel.getBoundingClientRect();
      if (size.width <= 600) workspaceBottom = box.top - 16;
      else {
        area.x = box.right + 16;
        area.width = size.width - 18 - area.x;
      }
    }
    const input = window.document.getElementById('object-search-form');
    if (input && !input.hidden)
      area.y = Math.max(area.y, input.getBoundingClientRect().bottom + 16);
    const results = window.document.querySelector('.object-search-results');
    if (results) {
      const box = results.getBoundingClientRect();
      if (size.width <= 760) area.y = Math.max(area.y, box.bottom + 16);
      else area.width = box.left - 16 - area.x;
    }
    area.height = workspaceBottom - area.y;
    return area;
  }, [size]);
  useLayoutEffect(() => {
    if (!searchFocus) return;
    const geometry = scene.world.get(searchFocus);
    if (geometry) {
      const area = freeWorkspace();
      const fitted = fitCamera(geometryBounds(geometry), area, 32);
      setCamera({ ...fitted, x: fitted.x + area.x, y: fitted.y + area.y });
    }
    setSearchFocus(null);
  }, [searchFocus, scene.world, freeWorkspace, setCamera]);
  const fit = useCallback(() => {
    // Fit within the free workspace; this changes only the camera command,
    // never the canvas extent or where objects can be created.
    const area = freeWorkspace();
    const fitted = fitCamera(
      sceneBounds(document, recursiveScene(document)).bounds,
      area,
      size.width <= 600 ? 24 : 80,
    );
    setCamera({ ...fitted, x: fitted.x + area.x, y: fitted.y + area.y });
  }, [document, freeWorkspace, size.width, setCamera]);
  useImperativeHandle(fitRef, () => fit, [fit]);
  useLayoutEffect(() => {
    if (!textEditing) return;
    const geometry = scene.world.get(textEditing);
    if (!geometry) return;
    const box = geometryBounds(geometry);
    const area = freeWorkspace();
    setCamera((current) => {
      const left = current.x + box.x * current.scale;
      const top = current.y + box.y * current.scale;
      if (
        left >= area.x &&
        top >= area.y &&
        left + box.width * current.scale <= area.x + area.width &&
        top + box.height * current.scale <= area.y + area.height
      )
        return current;
      const fitted = fitCamera(box, area, 24);
      const scale = Math.min(current.scale, fitted.scale);
      return {
        x: area.x + area.width / 2 - (box.x + box.width / 2) * scale,
        y: area.y + area.height / 2 - (box.y + box.height / 2) * scale,
        scale,
      };
    });
  }, [textEditing, scene.world, freeWorkspace, selectionCollapsed, setCamera]);
  const zoom = (
    factor: number,
    point = { x: size.width / 2, y: size.height / 2 },
  ) => {
    const minimum = Math.min(0.25, fitCamera(bounds.bounds, size).scale);
    setCamera((c) =>
      zoomCamera(c, point, Math.max(minimum, Math.min(2, c.scale * factor))),
    );
  };
  useCanvasKeyboardShortcuts({ zoomToFit: fit, setViewBox: setCamera });
  const renderBoundaryPoints = useCallback(
    (id: string) => {
      const object = displayed.objects[id],
        geometry = scene.local.get(id)!;
      return Object.entries(object.boundaryPoints ?? {}).map(
        ([pointId, point]) => {
          const at = boundaryPosition(point, geometry, object);
          return (
            <Circle
              key={pointId}
              name="boundary-point"
              boundaryObjectId={id}
              boundaryPointId={pointId}
              x={at.x}
              y={at.y}
              radius={6 / camera.scale}
              stroke="#92400e"
              strokeWidth={1.5 / camera.scale}
              fill={
                selectedPoint?.objectId === id &&
                selectedPoint.pointId === pointId
                  ? '#f97316'
                  : '#fef3c7'
              }
              onMouseDown={(event) => {
                if (tool !== ToolMode.POINTER || event.evt.button !== 0) return;
                event.cancelBubble = true;
                setSelected([`object-${id}`]);
                setSelectedPoint({ objectId: id, pointId });
              }}
              onClick={(event) => {
                if (tool === ToolMode.POINTER) event.cancelBubble = true;
              }}
            />
          );
        },
      );
    },
    [
      displayed,
      scene.local,
      camera.scale,
      selectedPoint,
      tool,
      setSelected,
      setSelectedPoint,
    ],
  );
  const lifted =
    gesture.current?.moved && !gesture.current.resize
      ? gesture.current.ids
      : undefined;
  const liftedIds = useMemo(() => lifted && new Set(lifted), [lifted]);
  const [focusedToggle, setFocusedToggle] = useState<string | null>(null);
  const toggleScale = Math.min(1, camera.scale);
  const toggleSize = 32 * toggleScale;
  const toggleInset = 4 * toggleScale;
  const togglesDisabled =
    !!preview ||
    !!textEditing ||
    !!properties ||
    !!draw ||
    !!linkEditing ||
    drawing;
  const childToggles = new Map<
    string,
    {
      x: number;
      y: number;
      icon: string;
      expanded: boolean;
      label: string;
      title: string;
    }
  >();
  for (const [id, geometry] of scene.world) {
    const children = scene.hierarchy.children.get(id) ?? [];
    const box = bounds.objects.get(id);
    if (!children.length || !box) continue;
    const left = camera.x + box.x * camera.scale;
    const top = camera.y + box.y * camera.scale;
    const right = left + box.width * camera.scale;
    if (
      right < 0 ||
      left > size.width ||
      top > size.height ||
      top + box.height * camera.scale < 0
    )
      continue;
    let x = Math.max(
      toggleInset,
      Math.min(size.width, right) - toggleSize - toggleInset,
    );
    let y = Math.max(
      toggleInset,
      Math.min(size.height - toggleSize - toggleInset, top + toggleInset),
    );
    const object = document.objects[id];
    if (object.type === 'diamond' || object.type === 'ellipse') {
      const anchor = worldPoint(
        boundaryPosition({ side: 'top', offset: 1 }, geometry, object),
        geometry,
      );
      x = camera.x + anchor.x * camera.scale - toggleSize / 2;
      y = camera.y + anchor.y * camera.scale - toggleSize / 2;
    }
    const expanded = scene.expanded.has(id);
    const icon =
      children.length > 1 || scene.hierarchy.children.has(children[0])
        ? 'square-stack-3'
        : 'square-stack-2';
    const label = `${expanded ? 'Hide' : 'Reveal'} children of ${objectLabel(object)}`;
    childToggles.set(id, {
      x,
      y,
      icon,
      expanded,
      label,
      title: `${label} (${children.length} direct ${children.length === 1 ? 'child' : 'children'}). Ctrl-click to collapse all descendants.`,
    });
  }
  // Recheck native paint bounds after scene or viewport changes. UI-only renders
  // leave both the geometry and the previous culling result intact.
  useLayoutEffect(() => {
    if (stageRef.current) cullViewport(stageRef.current);
  }, [
    displayed,
    scene,
    camera.x,
    camera.y,
    camera.scale,
    size,
    textEditing,
    connector.labelId,
    renderBoundaryPoints,
    liftedIds,
  ]);
  return (
    <div
      className="canvas-container"
      onDoubleClick={(event) => {
        if (
          animating ||
          !(event.target instanceof HTMLCanvasElement) ||
          properties ||
          tool !== ToolMode.POINTER
        )
          return;
        // Custom geometry gestures suppress Konva's click detection; use the native double-click.
        const stage = stageRef.current!;
        stage.setPointersPositions(event.nativeEvent);
        const hit = stage.getIntersection(stage.getPointerPosition()!);
        const key = hit && targetKey(hit);
        if (connector.doubleClick(hit, event)) return;
        if (!key?.startsWith('object-')) return;
        cancelDrag();
        setSelected([key]);
        setSelectedPoint(null);
        setSelectionCollapsed(false);
        setTextEditing(key.slice(7));
      }}
      style={{
        backgroundPosition: `${camera.x}px ${camera.y}px`,
        backgroundSize: `${24 * camera.scale * 2 ** Math.ceil(Math.log2(1 / camera.scale))}px ${24 * camera.scale * 2 ** Math.ceil(Math.log2(1 / camera.scale))}px`,
      }}
      role="region"
      aria-label={`${document.metadata.title}, recursive diagram`}
    >
      <Stage
        ref={stageRef}
        listening={!animating}
        width={size.width}
        height={size.height}
        x={camera.x}
        y={camera.y}
        scaleX={camera.scale}
        scaleY={camera.scale}
        draggable={tool === ToolMode.HAND}
        onMouseDown={(event) => {
          if (animating || properties || textEditing || event.evt.button !== 0)
            return;
          if (connector.mouseDown(event)) return;
          onBusyChange('canvas-gesture', true);
          suppressClick.current = false;
          if (bridge) return;
          if (drawing) {
            const start = pointer();
            setDraw({
              start,
              end: start,
              alt: event.evt.altKey,
              square: event.evt.shiftKey,
              document,
            });
            return;
          }
          if (tool !== ToolMode.POINTER) return;
          setSelectedPoint(null);
          const key = targetKey(event.target);
          if (
            key?.startsWith('object-') &&
            !event.evt.shiftKey &&
            !event.evt.metaKey
          ) {
            const ids = selection.includes(key) ? selection : [key];
            if (!event.evt.ctrlKey) setSelected(ids);
            beginGeometry(ids);
            gesture.current!.clickTarget = key;
            gesture.current!.additiveClick = event.evt.ctrlKey;
            return;
          }
          if (!key) {
            const start = pointer();
            setMarquee({
              start,
              end: start,
              additive:
                event.evt.shiftKey || event.evt.ctrlKey || event.evt.metaKey,
            });
          }
        }}
        onMouseMove={(event) => {
          if (connector.mouseMove(event)) return;
          if (gesture.current) {
            updateGeometry(event.evt.ctrlKey);
            return;
          }
          if (draw) {
            setDraw({ ...draw, end: pointer(), square: event.evt.shiftKey });
            return;
          }
          if (marquee) setMarquee({ ...marquee, end: pointer() });
        }}
        onMouseUp={(event) => {
          if (connector.mouseUp(event)) return;
          if (event.evt.button !== 0) return;
          onBusyChange('canvas-gesture', false);
          if (gesture.current) {
            finishGeometry(event.evt.ctrlKey);
            return;
          }
          if (draw) {
            const end = pointer();
            const id = bridge?.connectionId ?? crypto.randomUUID();
            if (bridge) {
              const target = connectionTarget(event.target);
              try {
                inwardEndpoint(document, bridge.source, target, end);
                onEdit(
                  bridge.connectionId
                    ? reattachInwardBridge(id, target, end)
                    : createInwardBridge(
                        id,
                        tool === ToolMode.LINE ? 'line' : 'arrow',
                        bridge.source,
                        target,
                        end,
                      ),
                );
                setSelected([`connection-${id}`]);
                setSelectedPoint(null);
              } catch (error) {
                setMoveError(
                  error instanceof Error
                    ? error.message
                    : 'Cannot connect to that target.',
                );
              }
              cancelDrag();
              setTool(ToolMode.POINTER);
              suppressClick.current = true;
              return;
            }
            const click =
              Math.hypot(end.x - draw.start.x, end.y - draw.start.y) *
                camera.scale <
              4;
            const geometry = drawnGeometry(
              draw.start,
              end,
              event.evt.shiftKey || (click && tool === ToolMode.CIRCLE),
              click,
            );
            const kind =
              tool === ToolMode.CIRCLE
                ? 'ellipse'
                : tool === ToolMode.DIAMOND
                  ? 'diamond'
                  : tool === ToolMode.FRAME
                    ? 'frame'
                    : 'rectangle';
            const parent = draw.alt ? null : eligibleParent(document, geometry);
            onEdit(createShape(id, kind, geometry, parent));
            setSelected([`object-${id}`]);
            setDraw(null);
            setSelectedPoint(null);
            setTool(ToolMode.POINTER);
            suppressClick.current = true;
            return;
          }
          if (!marquee) return;
          const end = pointer();
          if (
            Math.hypot(end.x - marquee.start.x, end.y - marquee.start.y) *
              camera.scale >=
            3
          ) {
            const hits = marqueeSelection(boxes, marquee.start, end);
            setSelected((current) =>
              marquee.additive ? [...new Set([...current, ...hits])] : hits,
            );
            suppressClick.current = true;
          }
          setMarquee(null);
        }}
        onClick={(event) => {
          if (connector.consumeClick()) return;
          if (
            animating ||
            properties ||
            textEditing ||
            event.evt.button !== 0 ||
            suppressClick.current ||
            tool !== ToolMode.POINTER
          )
            return;
          const id = targetKey(event.target);
          const additive =
            event.evt.shiftKey || event.evt.ctrlKey || event.evt.metaKey;
          if (id)
            setSelected((current) => toggleSelection(current, id, additive));
          else if (!additive) setSelected([]);
        }}
        onDragStart={(event) => {
          if (event.target === stageRef.current)
            onBusyChange('canvas-gesture', true);
        }}
        onDragEnd={(event) => {
          if (event.target === stageRef.current)
            onBusyChange('canvas-gesture', false);
        }}
        onDragMove={(event) => {
          if (event.target === stageRef.current)
            setCamera((c) => ({ ...c, ...event.target.position() }));
        }}
        onWheel={(event) => {
          event.evt.preventDefault();
          zoom(
            Math.exp(-event.evt.deltaY * 0.002),
            event.target.getStage()!.getPointerPosition()!,
          );
        }}
      >
        <Layer>
          <RecursiveScene
            liftedIds={liftedIds}
            document={displayed}
            editingTextId={textEditing}
            editingConnectionLabel={connector.labelId}
            scene={scene}
            scale={camera.scale}
            onError={setMoveError}
            renderBoundaryPoints={renderBoundaryPoints}
            renderChildrenToggle={(id) => {
              const toggle = childToggles.get(id);
              if (!toggle) return null;
              const geometry = scene.world.get(id)!;
              const position = localPoint(
                {
                  x: (toggle.x - camera.x) / camera.scale,
                  y: (toggle.y - camera.y) / camera.scale,
                },
                geometry,
              );
              return (
                <ChildStackToggle
                  {...toggle}
                  {...position}
                  id={`child-toggle-${id}`}
                  rotation={-geometry.rotation}
                  displayScale={toggleScale}
                  scaleX={toggleScale / camera.scale}
                  scaleY={toggleScale / camera.scale}
                  disabled={togglesDisabled}
                  focused={focusedToggle === id}
                  onToggle={(event) => toggleChildren(id, event)}
                />
              );
            }}
          />
        </Layer>
        <Layer listening={false}>
          {draw &&
            (tool === ToolMode.LINE || tool === ToolMode.ARROW ? (
              <Arrow
                name="creation-preview"
                points={[draw.start.x, draw.start.y, draw.end.x, draw.end.y]}
                pointerAtEnding={tool === ToolMode.ARROW}
                stroke="#2563eb"
                fill="#2563eb"
                dash={[6 / camera.scale, 4 / camera.scale]}
              />
            ) : (
              (() => {
                const { x, y, width, height } = drawnGeometry(
                  draw.start,
                  draw.end,
                  draw.square,
                );
                const paint = {
                  name: 'creation-preview',
                  x,
                  y,
                  stroke: '#2563eb',
                  strokeWidth: 1 / camera.scale,
                  fill: 'rgba(37,99,235,0.08)',
                };
                if (tool === ToolMode.CIRCLE)
                  return (
                    <Ellipse
                      {...paint}
                      radiusX={width / 2}
                      radiusY={height / 2}
                    />
                  );
                if (tool === ToolMode.DIAMOND)
                  return (
                    <Line
                      {...paint}
                      points={[
                        0,
                        -height / 2,
                        width / 2,
                        0,
                        0,
                        height / 2,
                        -width / 2,
                        0,
                      ]}
                      closed
                    />
                  );
                return (
                  <Rect
                    {...paint}
                    x={x - width / 2}
                    y={y - height / 2}
                    width={width}
                    height={height}
                  />
                );
              })()
            ))}
          {[
            ...new Set(
              dropTargets.map(
                ({ id, parent }) => parent ?? document.objects[id].parentId,
              ),
            ),
          ].map((id) => {
            if (!id || !scene.world.has(id)) return null;
            const geometry = scene.world.get(id)!;
            return (
              <Group
                key={id}
                x={geometry.x}
                y={geometry.y}
                rotation={geometry.rotation}
              >
                <ObjectOutline
                  name="parent-change-preview"
                  object={document.objects[id]}
                  geometry={geometry}
                  fillEnabled={false}
                  stroke="#2563eb"
                  strokeWidth={2 / camera.scale}
                  dash={[5 / camera.scale, 4 / camera.scale]}
                />
              </Group>
            );
          })}
          {selection
            .filter(
              (id) =>
                id.startsWith('object-') &&
                !gesture.current?.ids.includes(id.slice(7)),
            )
            .map((id) => (
              <Rect
                key={id}
                {...boxes.get(id)!}
                fillEnabled={false}
                stroke="#2563eb"
                strokeWidth={1.5 / camera.scale}
                dash={[5 / camera.scale, 3 / camera.scale]}
              />
            ))}
          {marquee && (
            <Rect
              name="selection-marquee"
              x={Math.min(marquee.start.x, marquee.end.x)}
              y={Math.min(marquee.start.y, marquee.end.y)}
              width={Math.abs(marquee.end.x - marquee.start.x)}
              height={Math.abs(marquee.end.y - marquee.start.y)}
              fill="rgba(37,99,235,0.08)"
              stroke="#2563eb"
              strokeWidth={1 / camera.scale}
            />
          )}
        </Layer>
        <Layer>
          {connector.overlay}
          {tool === ToolMode.POINTER &&
            selection.length === 1 &&
            selection[0].startsWith('object-') &&
            !draw &&
            !selectedPoint &&
            !textEditing &&
            (() => {
              const id = selection[0].slice(7),
                g = scene.world.get(id)!;
              return (
                <Group x={g.x} y={g.y} rotation={g.rotation}>
                  {[-1, 0, 1].flatMap((x) =>
                    [-1, 0, 1]
                      .filter((y) => x || y)
                      .map((y) => (
                        <Rect
                          key={`${x}:${y}`}
                          name="resize-handle"
                          x={(x * g.width) / 2 - 4 / camera.scale}
                          y={(y * g.height) / 2 - 4 / camera.scale}
                          width={8 / camera.scale}
                          height={8 / camera.scale}
                          fill="white"
                          stroke="#2563eb"
                          strokeWidth={1 / camera.scale}
                          onMouseDown={(event) => {
                            event.cancelBubble = true;
                            beginGeometry(selection, { x, y });
                          }}
                          onClick={(event) => {
                            event.cancelBubble = true;
                          }}
                        />
                      )),
                  )}
                </Group>
              );
            })()}
        </Layer>
      </Stage>
      {connector.labelEditor}
      {connector.hint && (
        <div className="connection-editing-hint" role="status">
          {connector.hint}
        </div>
      )}
      {dropTargets.length > 0 && (
        <div className="parent-drop-hint" role="status">
          {[
            ...new Set(
              dropTargets.map(({ parent }) =>
                parent === null
                  ? 'Move to top level'
                  : `Move into ${objectLabel(document.objects[parent])}`,
              ),
            ),
          ].join(' · ')}
        </div>
      )}
      {/* Keyboard and screen-reader controls; the visible buttons paint in the scene. */}
      {[...childToggles].map(([id, toggle]) => (
        <button
          key={id}
          type="button"
          className="child-stack-toggle"
          style={{
            left: toggle.x,
            top: toggle.y,
            transform: `scale(${toggleScale})`,
            transformOrigin: 'top left',
          }}
          aria-expanded={toggle.expanded}
          aria-label={toggle.label}
          title={toggle.title}
          disabled={togglesDisabled}
          onFocus={() => setFocusedToggle(id)}
          onBlur={() => setFocusedToggle(null)}
          onClick={(event) => toggleChildren(id, event)}
          onContextMenu={(event) => toggleChildren(id, event)}
        />
      ))}
      {linkEditing && (
        <SelectionLink
          key={linkEditing}
          target={linkEditing}
          value={String(
            (linkEditing.startsWith('object-')
              ? document.objects[linkEditing.slice(7)]
              : document.connections[linkEditing.slice(11)]
            )?.style?.link ?? '',
          )}
          onEdit={onEdit}
          onClose={() => setLinkEditing(null)}
        />
      )}
      <ShapeToolbar
        activeTool={tool}
        onSearch={setSearchQuery}
        selectedCount={selection.length}
        canAlign={effectiveIds.length >= 2}
        canDistribute={effectiveIds.length >= 3}
        canLayer={selection.length > 0}
        arrangementReason={
          !shapesOnly
            ? 'Select shapes only to align, distribute, or match size.'
            : effectiveIds.length < 2
              ? 'Select at least two independent shapes to align or match size; three to distribute.'
              : undefined
        }
        onAlignmentOperation={(action) =>
          onEdit(alignObjects(arrangementIds, action))
        }
        onLayeringOperation={(action) =>
          onEdit(stackSelection(selection, action))
        }
        onChangeTool={(next) => {
          cancelDrag();
          setTool(next);
        }}
      />
      {searchQuery !== null && (
        <ObjectSearchResults
          document={document}
          query={searchQuery}
          onClose={() => setSearchQuery(null)}
          onFocus={(id) => {
            if (isBusy()) {
              onStatus(
                'Finish the current edit or gesture before opening a search result.',
              );
              return;
            }
            if (!scene.world.has(id)) onEdit(revealObject(id));
            setCanvas((current) => ({
              ...current,
              tool: ToolMode.POINTER,
              selected: [`object-${id}`],
              selectedPoint: null,
              selectionCollapsed: size.width <= 760,
            }));
            setSearchFocus(id);
          }}
        />
      )}
      {textEditing && scene.world.has(textEditing) && (
        <InlineObjectText
          key={textEditing}
          document={document}
          objectId={textEditing}
          geometry={scene.world.get(textEditing)!}
          camera={camera}
          toolbarTarget={textToolbar}
          onEdit={onEdit}
          onClose={() => setTextEditing(null)}
        />
      )}
      {moveError && (
        <div
          role="alert"
          style={{
            position: 'absolute',
            top: 130,
            left: 16,
            background: 'white',
            padding: 8,
          }}
        >
          {moveError}
        </div>
      )}
      <div
        id="selection-controls"
        ref={selectionControlsRef}
        role="toolbar"
        aria-label="Selection"
        className="recursive-selection-toolbar"
        style={{ pointerEvents: preview ? 'none' : undefined }}
        hidden={
          !bridge &&
          (!selection.length ||
            selectionCollapsed ||
            (tool !== ToolMode.POINTER && !properties))
        }
      >
        {(textEditing || properties) && (
          <div className="selection-heading">
            <h2>{textEditing ? 'Text' : 'Properties'}</h2>
          </div>
        )}
        {selection.length === 1 &&
          selection[0].startsWith('object-') &&
          !textEditing &&
          (() => {
            const id = selection[0].slice(7);
            const ancestors: string[] = [];
            for (
              let parent = document.objects[id].parentId;
              parent !== null;
              parent = document.objects[parent].parentId
            )
              ancestors.unshift(parent);
            const count = scene.hierarchy.children.get(id)?.length ?? 0;
            return (
              <div className="selection-hierarchy">
                {ancestors.length > 0 && (
                  <nav aria-label="Parent path">
                    {ancestors.map((parent) => (
                      <button
                        key={parent}
                        type="button"
                        onClick={() => setSelected([`object-${parent}`])}
                      >
                        {objectLabel(document.objects[parent])}
                        <Icon name="chevron-right" />
                      </button>
                    ))}
                    <span aria-current="location">
                      {objectLabel(document.objects[id])}
                    </span>
                  </nav>
                )}
                {count > 0 && (
                  <button
                    type="button"
                    aria-label={`${scene.expanded.has(id) ? 'Hide' : 'Reveal'} ${count} ${count === 1 ? 'child' : 'children'}`}
                    title={`${scene.expanded.has(id) ? 'Hide' : 'Reveal'} ${count} ${count === 1 ? 'child' : 'children'}. Ctrl-click to collapse all descendants.`}
                    aria-expanded={scene.expanded.has(id)}
                    disabled={!!properties || !!draw}
                    onClick={(event) => toggleChildren(id, event)}
                    onContextMenu={(event) => toggleChildren(id, event)}
                  >
                    <Icon
                      name="chevron-right"
                      rotation={scene.expanded.has(id) ? 90 : undefined}
                    />
                  </button>
                )}
              </div>
            );
          })()}

        <div
          ref={setTextToolbar}
          hidden={!textEditing}
          className="text-toolbar-host"
        />
        {!properties && (
          <SelectionProperties
            document={document}
            selection={selection}
            textMode={!!textEditing}
            onEdit={onEdit}
          />
        )}
        {textEditing && (
          <p className="text-editing-hint">Esc or ⌘/Ctrl + Enter to finish</p>
        )}
        {properties && boxes.has(properties) && (
          <RecursiveProperties
            document={document}
            target={properties}
            onEdit={onEdit}
            onClose={() => {
              onBusyChange('canvas-draft', false);
              setProperties(null);
            }}
          />
        )}
        <div
          className="selection-actions"
          hidden={!!textEditing || !!properties}
        >
          <button
            type="button"
            aria-label="Edit text"
            title="Edit text"
            disabled={selection.length !== 1}
            onClick={() => {
              setSelectedPoint(null);
              if (selection[0].startsWith('connection-'))
                connector.editLabel(selection[0].slice(11));
              else setTextEditing(selection[0].slice(7));
            }}
          >
            <Icon name="edit-text" />
          </button>
          <button
            type="button"
            aria-label="Properties"
            title="Properties"
            disabled={selection.length !== 1}
            onClick={() => {
              onBusyChange('canvas-draft', true);
              setProperties(selection[0]);
            }}
          >
            <Icon name="sliders" />
          </button>
          {selection.length === 1 &&
            selection[0].startsWith('object-') &&
            (() => {
              const objectId = selection[0].slice(7),
                points = document.objects[objectId].boundaryPoints ?? {},
                pointIds = Object.keys(points);
              return (
                pointIds.length > 0 && (
                  <label>
                    Boundary point
                    <select
                      aria-label="Boundary point"
                      style={{ maxWidth: 160 }}
                      value={
                        selectedPoint?.objectId === objectId
                          ? selectedPoint.pointId
                          : ''
                      }
                      onChange={(event) =>
                        setSelectedPoint(
                          event.target.value
                            ? { objectId, pointId: event.target.value }
                            : null,
                        )
                      }
                    >
                      <option value="">Select a point</option>
                      {pointIds.map((pointId, index) => (
                        <option key={pointId} value={pointId}>
                          {index + 1}: {pointId}
                        </option>
                      ))}
                    </select>
                  </label>
                )
              );
            })()}
          {selectedPoint && (
            <button
              type="button"
              aria-label="Connect inside"
              title="Connect inside"
              onClick={() => startInside(selectedPoint)}
            >
              <Icon name="connect-inside" />
            </button>
          )}
          {selection.length === 1 &&
            selection[0].startsWith('connection-') &&
            (() => {
              const c = document.connections[selection[0].slice(11)];
              return c?.start.kind === 'boundary' &&
                c.start.objectId === c.ownerId ? (
                <button
                  type="button"
                  aria-label="Reattach child endpoint"
                  title="Reattach child endpoint"
                  onClick={() => {
                    if (c.start.kind === 'boundary') startInside(c.start, c.id);
                  }}
                >
                  <Icon name="reattach-child-endpoint" />
                </button>
              ) : null;
            })()}
          {bridge && (
            <span role="status">
              Click a revealed immediate child or its orange boundary point.
              Escape cancels.
            </span>
          )}
          <RecursiveDelete
            document={document}
            selection={selection}
            point={selectedPoint}
            blocked={() =>
              !!(
                gesture.current ||
                draw ||
                marquee ||
                properties ||
                textEditing
              )
            }
            onEdit={onEdit}
            onBusyChange={onBusyChange}
          />
          <button
            type="button"
            aria-label="Duplicate"
            title="Duplicate"
            disabled={!selection.length}
            onClick={() => {
              if (isBusy()) return;
              const copy = duplicateSelection(document, selection);
              onEdit(copy.edit);
              setSelected(copy.selection);
              setSelectedPoint(null);
            }}
          >
            <Icon name="duplicate" />
          </button>
          <button
            type="button"
            aria-label="Link"
            title="Add or edit link"
            hidden
            disabled={selection.length !== 1}
            onClick={() => {
              if (!isBusy()) setLinkEditing(selection[0]);
            }}
          >
            <Icon name="link" />
          </button>
        </div>
      </div>
      {selection.length > 0 &&
        tool === ToolMode.POINTER &&
        selectionCollapsed &&
        !bridge && (
          <button
            className="selection-reopen"
            type="button"
            aria-label="Show selection controls"
            aria-expanded="false"
            aria-controls="selection-controls"
            onClick={() => {
              setSelectionCollapsed(false);
              requestAnimationFrame(() =>
                selectionControlsRef.current
                  ?.querySelector<HTMLButtonElement>('button:not([hidden])')
                  ?.focus(),
              );
            }}
          >
            <Icon name="sliders" /> {selection.length} selected
          </button>
        )}
      <div
        role="toolbar"
        aria-label="Canvas navigation"
        className="canvas-navigation"
      >
        <button
          type="button"
          onClick={fit}
          title="Fit diagram"
          aria-label="Fit"
        >
          <Icon name="expand" />
        </button>
        <button
          type="button"
          aria-label="Zoom out"
          onClick={() => zoom(1 / 1.2)}
        >
          <Icon name="minus" />
        </button>
        <output aria-label="Canvas zoom">
          {(camera.scale * 100).toLocaleString(undefined, {
            maximumFractionDigits: 2,
          })}
          %
        </output>
        <button type="button" aria-label="Zoom in" onClick={() => zoom(1.2)}>
          <Icon name="plus" />
        </button>
        <button
          type="button"
          aria-label="Reset view"
          title="Reset view"
          onClick={() => setCamera({ x: 0, y: 0, scale: 1 })}
        >
          <Icon name="arrow-rotate-left" />
        </button>
        <button
          type="button"
          aria-label="Minimap"
          title="Minimap"
          aria-pressed={minimap}
          onClick={() => setMinimap(!minimap)}
        >
          <Icon name="map" />
        </button>
      </div>
      {minimap && (
        <div className="canvas-minimap">
          <Minimap
            blocks={bounds.objects}
            containerSize={size}
            viewBox={camera}
            onViewBoxChange={(p) => setCamera((c) => ({ ...c, ...p }))}
          />
        </div>
      )}
      <RecursiveExport
        stamp={stamp}
        ref={exportRef}
        stage={() => {
          flushSync(finishAnimation);
          return stageRef.current;
        }}
        document={document}
        selection={selection}
        isBusy={isBusy}
        onStatus={onStatus}
      />
      <ConnectionRepairs
        document={document}
        selected={
          selection.length === 1 && selection[0].startsWith('connection-')
            ? selection[0].slice(11)
            : null
        }
        onEdit={onEdit}
      />
      <RootDepthControls
        document={document}
        onSelect={onSelectDepth}
        onBusyChange={onBusyChange}
      />
      {!selection.length && boxes.size > 0 && (
        <button
          className="select-visible-control"
          type="button"
          onClick={() => {
            setSelected([...boxes.keys()]);
            setSelectedPoint(null);
          }}
        >
          Select visible
        </button>
      )}
      {Object.keys(document.objects).length === 0 &&
        Object.keys(document.connections).length === 0 &&
        !drawing && (
          <div className="canvas-welcome">
            <Icon name="square" className="welcome-shape" />
            <h1>Start with the big picture.</h1>
            <p>Draw your first shape. Add detail as your ideas take shape.</p>
            <button
              type="button"
              className="primary-button"
              onClick={() => setTool(ToolMode.SQUARE)}
            >
              <Icon name="plus" /> Draw a shape
            </button>
            <span className="welcome-hint">
              An infinite canvas, at every level of detail.
            </span>
          </div>
        )}
      {drawing && (
        <p className="drawing-hint">
          Click and drag to draw. <kbd>Esc</kbd> to cancel.
        </p>
      )}
      <span className="canvas-gesture-hint">
        {tool === ToolMode.HAND
          ? 'Drag with either mouse button to pan'
          : tool === ToolMode.POINTER
            ? 'Left-drag to select · Right-drag to pan'
            : 'Drag to draw'}
        {' · Scroll to zoom'}
      </span>
    </div>
  );
});
