import { boundaryPosition } from '../../shared/recursiveBoundary';
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react';
import { Circle, Group, Line } from 'react-konva';
import type Konva from 'konva';
import type {
  DiagramConnection,
  RecursiveDocument,
} from '../../shared/recursiveDocument';
import type { DocumentEdit } from '../../shared/documentTransactions';
import {
  createConnector,
  type Point,
  type ConnectionTarget,
} from '../../shared/recursiveCreation';
import {
  boundEndpoint,
  bindingTarget,
  connectionAnchors,
  replaceEndpoint,
  type BindingModifiers,
} from '../../shared/connectionEditing';
import {
  connectionRoute,
  constrainPoint,
  distance,
  distanceToSegment,
  localPoint,
  midpoint,
  worldPoint,
} from '../../shared/connectionGeometry';
import { patchConnection } from '../../shared/editorProperties';
import type { Camera } from '../../shared/recursiveCamera';
import type { recursiveScene } from '../../shared/recursiveScene';
import { ToolMode } from '../types/CanvasTools';
import { isEditingText } from './useDocumentHistoryActions';
import useDocumentDraft from './useDocumentDraft';
import ConnectionPaint from '../components/ConnectionPaint';
import ObjectOutline from '../components/ObjectOutline';

type PointerEvent = Konva.KonvaEventObject<MouseEvent>;
type Handle = {
  type: 'point' | 'midpoint' | 'segment' | 'body';
  index: number;
};
type Drawing = {
  base: RecursiveDocument;
  id: string;
  kind: 'line' | 'arrow';
  pins: Point[];
  cursor: Point;
  multi: boolean;
  startTarget: ConnectionTarget;
  modifiers: BindingModifiers;
};
type Gesture = {
  base: RecursiveDocument;
  original: DiagramConnection;
  value: DiagramConnection;
  start: Point;
  handle: Handle;
  moved: boolean;
  error?: string;
};
const copyModifiers = (event: BindingModifiers): BindingModifiers => ({
  ctrlKey: event.ctrlKey,
  metaKey: event.metaKey,
  altKey: event.altKey,
  shiftKey: event.shiftKey,
});

export default function useConnectionEditing({
  document,
  scene,
  camera,
  tool,
  selected,
  stageRef,
  disabled,
  onEdit,
  onBusyChange,
  onStatus,
  onSelect,
  onFinish,
  setPreview,
}: {
  document: RecursiveDocument;
  scene: ReturnType<typeof recursiveScene>;
  camera: Camera;
  tool: ToolMode;
  selected: string[];
  stageRef: RefObject<Konva.Stage | null>;
  disabled: boolean;
  onEdit: (edit: DocumentEdit) => void;
  onBusyChange: (source: string, busy: boolean) => void;
  onStatus: (message: string) => void;
  onSelect: (id: string) => void;
  onFinish: () => void;
  setPreview: (
    preview: { base: RecursiveDocument; value: RecursiveDocument } | null,
  ) => void;
}) {
  const drawing = useRef<Drawing | null>(null),
    gesture = useRef<Gesture | null>(null);
  const [paint, setPaint] = useState<DiagramConnection | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  const [pointMode, setPointMode] = useState<string | null>(null);
  const [pointsSelected, setPointsSelected] = useState<number[]>([]);
  const [label, setLabel] = useState<{
    id: string;
    value: string;
    base: RecursiveDocument;
  } | null>(null);
  const labelRef = useRef<HTMLTextAreaElement>(null);
  const consumed = useRef(false);
  const pointer = () => stageRef.current!.getRelativePointerPosition()!;
  const selectedId =
    selected.length === 1 && selected[0].startsWith('connection-')
      ? selected[0].slice(11)
      : null;
  const connection = selectedId
    ? paint?.id === selectedId
      ? paint
      : document.connections[selectedId]
    : undefined;
  const route = useMemo(
    () => connection && connectionRoute(document, connection, scene.world),
    [connection, document, scene.world],
  );
  const owner = connection?.ownerId
    ? scene.world.get(connection.ownerId)
    : undefined;
  const drawingTool = tool === ToolMode.LINE || tool === ToolMode.ARROW;
  const cancel = useCallback(() => {
    drawing.current = null;
    gesture.current = null;
    setPaint(null);
    setTarget(null);
    setPreview(null);
    onBusyChange('connection-gesture', false);
  }, [onBusyChange, setPreview]);
  const finishLabel = (apply: boolean) => {
    if (apply && label?.base === document)
      onEdit(patchConnection(label.id, { label: label.value }));
    setLabel(null);
  };
  useDocumentDraft({
    label: 'line or arrow edit',
    active: () => !!(drawing.current || gesture.current || label),
    apply: label ? () => finishLabel(true) : undefined,
    discard: () => {
      cancel();
      setLabel(null);
      onFinish();
    },
  });
  const labelId = label?.id;
  useLayoutEffect(() => {
    onBusyChange('connection-label', !!labelId);
    if (labelId) labelRef.current?.focus();
  }, [labelId, onBusyChange]);
  useLayoutEffect(
    () => () => {
      onBusyChange('connection-gesture', false);
      onBusyChange('connection-label', false);
    },
    [onBusyChange],
  );
  const cancelStale = useEffectEvent(() => {
    if (
      (gesture.current && gesture.current.base !== document) ||
      (drawing.current && drawing.current.base !== document)
    )
      cancel();
    if (label && label.base !== document) setLabel(null);
    if (pointMode && pointMode !== selectedId) {
      setPointMode(null);
      setPointsSelected([]);
    }
  });
  useEffect(() => {
    cancelStale();
  }, [document, selectedId]);
  const targetAt = (
    point: Point,
    modifiers: BindingModifiers,
    ownerId?: string | null,
  ): ConnectionTarget =>
    bindingTarget(
      document,
      scene.world,
      point,
      camera.scale,
      modifiers,
      ownerId,
    );
  const highlight = (value: ConnectionTarget) =>
    setTarget(typeof value === 'string' ? value : (value?.objectId ?? null));
  const buildDrawing = (active: Drawing, finish = false) => {
    const pins = finish ? active.pins : [...active.pins, active.cursor];
    if (pins.length < 2) return null;
    const startTarget =
      active.modifiers.ctrlKey || active.modifiers.metaKey
        ? null
        : active.startTarget;
    const endTarget =
      active.kind === 'arrow' ? targetAt(pins.at(-1)!, active.modifiers) : null;
    highlight(endTarget);
    const draft = {
      ...active.base,
      connections: { ...active.base.connections },
    };
    createConnector(
      active.id,
      active.kind,
      pins[0],
      pins.at(-1)!,
      startTarget,
      endTarget,
      pins.slice(1, -1),
    )(draft);
    const c = draft.connections[active.id];
    c.start = boundEndpoint(
      active.base,
      scene.world,
      c.ownerId,
      startTarget,
      pins[0],
      camera.scale,
    );
    c.end = boundEndpoint(
      active.base,
      scene.world,
      c.ownerId,
      endTarget,
      pins.at(-1)!,
      camera.scale,
    );
    return c;
  };
  const previewDrawing = () => {
    if (!drawing.current) return;
    try {
      setPaint(buildDrawing(drawing.current));
    } catch {
      const active = drawing.current;
      setPaint({
        id: active.id,
        ownerId: null,
        kind: active.kind,
        z: 0,
        start: { kind: 'free', ...active.pins[0] },
        end: { kind: 'free', ...active.cursor },
        points: active.pins.slice(1),
        style: { stroke: '#dc2626' },
      });
    }
  };
  const commitDrawing = (useCursor: boolean) => {
    const active = drawing.current;
    if (!active) return;
    if (
      useCursor &&
      distance(active.pins.at(-1)!, active.cursor) * camera.scale >= 3
    )
      active.pins.push(active.cursor);
    try {
      const value = buildDrawing(active, true);
      if (value) {
        onEdit((draft) => {
          draft.connections[value.id] = value;
        });
        onSelect(value.id);
      }
    } catch (error) {
      onStatus(
        error instanceof Error
          ? error.message
          : 'Cannot create this connector.',
      );
    }
    cancel();
    onFinish();
    consumed.current = true;
  };
  const updateGesture = (point: Point, modifiers: BindingModifiers) => {
    const active = gesture.current;
    if (!active) return;
    if (!active.moved && distance(active.start, point) * camera.scale < 3)
      return;
    active.moved = true;
    const original = active.original;
    const originalRoute = connectionRoute(active.base, original, scene.world)!;
    const originalOwner = original.ownerId
      ? scene.world.get(original.ownerId)
      : undefined;
    const { type, index } = active.handle;
    let at = localPoint(point, originalOwner);
    const vertices = originalRoute.vertices.map((p) => ({ ...p }));
    let value = { ...original };
    try {
      if (type === 'point' && (index === 0 || index === vertices.length - 1)) {
        const adjacent = vertices[index === 0 ? 1 : vertices.length - 2];
        at = constrainPoint(adjacent, at, modifiers.shiftKey);
        const worldAt = worldPoint(at, originalOwner);
        const nextTarget =
          original.kind === 'arrow'
            ? targetAt(worldAt, modifiers, original.ownerId)
            : null;
        highlight(nextTarget);
        value = replaceEndpoint(
          active.base,
          scene.world,
          original,
          index === 0 ? 'start' : 'end',
          worldAt,
          nextTarget,
          camera.scale,
        );
      } else if (type === 'point' || type === 'midpoint') {
        at = constrainPoint(
          vertices[Math.max(0, index - (type === 'point' ? 1 : 0))],
          at,
          modifiers.shiftKey,
        );
        if (type === 'midpoint') vertices.splice(index + 1, 0, at);
        else vertices[index] = at;
        value.points = vertices.slice(1, -1);
      } else if (type === 'segment') {
        const path = originalRoute.route.map((p) => ({ ...p }));
        const a = path[index],
          b = path[index + 1];
        const horizontal = Math.abs(a.y - b.y) < 0.001;
        const first = { ...a, ...(horizontal ? { y: at.y } : { x: at.x }) };
        const second = { ...b, ...(horizontal ? { y: at.y } : { x: at.x }) };
        // Endpoint segments acquire a new dogleg; interior segments retain both adjacent bends.
        value.points = [
          ...path.slice(1, index),
          first,
          second,
          ...path.slice(index + 2, -1),
        ];
      } else {
        const from = localPoint(active.start, originalOwner);
        const delta = { x: at.x - from.x, y: at.y - from.y };
        const shifted = vertices.map((p) => ({
          x: p.x + delta.x,
          y: p.y + delta.y,
        }));
        value = {
          ...original,
          start: { kind: 'free', ...shifted[0] },
          end: { kind: 'free', ...shifted.at(-1)! },
          points: shifted.slice(1, -1),
        };
      }
      active.error = undefined;
      active.value = value;
      setPaint(value);
      setPreview({
        base: active.base,
        value: {
          ...active.base,
          connections: { ...active.base.connections, [value.id]: value },
        },
      });
    } catch (error) {
      active.error =
        error instanceof Error
          ? error.message
          : 'Cannot connect to this target.';
    }
  };
  const startGesture = (
    c: DiagramConnection,
    handle: Handle,
    event: PointerEvent,
  ) => {
    consumed.current = true;
    onBusyChange('connection-gesture', true);
    gesture.current = {
      base: document,
      original: c,
      value: c,
      start: pointer(),
      handle,
      moved: false,
    };
    if (handle.type === 'point') {
      setPointMode(c.id);
      setPointsSelected((current) =>
        event.evt.shiftKey
          ? current.includes(handle.index)
            ? current.filter((i) => i !== handle.index)
            : [...current, handle.index]
          : [handle.index],
      );
    } else setPointsSelected([]);
  };
  const mouseDown = (event: PointerEvent): boolean => {
    if (event.evt.button !== 0) return false;
    if (label) return true;
    if (window.document.querySelector('dialog[open]')) return true;
    if (disabled) return false;
    consumed.current = false;
    if (drawingTool) {
      const point = pointer();
      if (drawing.current) return true;
      drawing.current = {
        base: document,
        id: crypto.randomUUID(),
        kind: tool === ToolMode.LINE ? 'line' : 'arrow',
        pins: [point],
        cursor: point,
        multi: false,
        startTarget:
          tool === ToolMode.ARROW ? targetAt(point, event.evt) : null,
        modifiers: copyModifiers(event.evt),
      };
      onBusyChange('connection-gesture', true);
      previewDrawing();
      return true;
    }
    if (tool !== ToolMode.POINTER) return false;
    const handle = (event.target as Konva.Node).getAttr('connectorHandle') as
      Handle | undefined;
    if (handle && connection) {
      startGesture(connection, handle, event);
      return true;
    }
    const group = event.target.findAncestor('.recursive-connection', true);
    if (group) {
      const id = group.id().slice(11),
        c = document.connections[id];
      if (!c) return false;
      if (event.evt.shiftKey || event.evt.metaKey || event.evt.ctrlKey)
        return false;
      onSelect(id);
      if (pointMode === id && event.evt.altKey) {
        const r = connectionRoute(document, c, scene.world)!;
        const own = c.ownerId ? scene.world.get(c.ownerId) : undefined;
        const p = localPoint(pointer(), own);
        const samples = r.bezier ? r.samples : r.vertices;
        let nearest = 0;
        for (let i = 1; i < samples.length - 1; i++)
          if (
            distanceToSegment(p, samples[i], samples[i + 1]) <
            distanceToSegment(p, samples[nearest], samples[nearest + 1])
          )
            nearest = i;
        if (r.bezier) nearest = Math.floor(nearest / 20);
        startGesture(c, { type: 'midpoint', index: nearest }, event);
        gesture.current!.moved = true;
        updateGesture(pointer(), event.evt);
      } else startGesture(c, { type: 'body', index: 0 }, event);
      return true;
    }
    return false;
  };
  const mouseMove = (event: PointerEvent): boolean => {
    if (gesture.current) {
      updateGesture(pointer(), event.evt);
      return true;
    }
    const active = drawing.current;
    if (!active) {
      if (!disabled && tool === ToolMode.ARROW)
        highlight(targetAt(pointer(), event.evt));
      return false;
    }
    active.cursor = constrainPoint(
      active.pins.at(-1)!,
      pointer(),
      event.evt.shiftKey,
    );
    active.modifiers = copyModifiers(event.evt);
    previewDrawing();
    return true;
  };
  const mouseUp = (event: PointerEvent): boolean => {
    if (event.evt.button !== 0) return false;
    if (gesture.current) {
      updateGesture(pointer(), event.evt);
      const active = gesture.current;
      if (active.error) onStatus(active.error);
      else if (active.moved)
        onEdit((draft) => {
          draft.connections[active.value.id] = active.value;
        });
      cancel();
      consumed.current = true;
      return true;
    }
    const active = drawing.current;
    if (!active) return false;
    active.cursor = constrainPoint(
      active.pins.at(-1)!,
      pointer(),
      event.evt.shiftKey,
    );
    active.modifiers = copyModifiers(event.evt);
    if (
      !active.multi &&
      distance(active.pins[0], pointer()) * camera.scale >= 4
    ) {
      commitDrawing(true);
      return true;
    }
    if (!active.multi) active.multi = true;
    else if (distance(active.pins.at(-1)!, active.cursor) * camera.scale < 6)
      commitDrawing(false);
    else active.pins.push(active.cursor);
    previewDrawing();
    consumed.current = true;
    return true;
  };
  const editLabel = (id: string) => {
    cancel();
    setLabel({
      id,
      value: document.connections[id].label ?? '',
      base: document,
    });
    setPointMode(null);
  };
  const doubleClick = (
    hit: Konva.Node | null,
    event: { metaKey: boolean; ctrlKey: boolean },
  ): boolean => {
    if (drawing.current) {
      commitDrawing(false);
      return true;
    }
    const handle = hit?.getAttr('connectorHandle') as Handle | undefined;
    if (handle && connection && route) {
      if (
        handle.type === 'point' &&
        (handle.index === 0 || handle.index === route.vertices.length - 1)
      ) {
        const key = handle.index === 0 ? 'arrowheadStart' : 'arrowheadEnd';
        const current =
          connection.style?.[key] ??
          (key === 'arrowheadEnd' && connection.kind === 'arrow'
            ? 'arrow'
            : 'none');
        onEdit(
          patchConnection(connection.id, {
            style: { [key]: current === 'none' ? 'arrow' : 'none' },
          }),
        );
      } else setPointMode(connection.id);
      return true;
    }
    const group = hit?.findAncestor('.recursive-connection', true);
    if (!group) return false;
    const id = group.id().slice(11);
    onSelect(id);
    if (
      document.connections[id].kind === 'line' ||
      event.metaKey ||
      event.ctrlKey
    ) {
      setPointMode(id);
      setPointsSelected([]);
    } else editLabel(id);
    return true;
  };
  const keyboard = useEffectEvent((event: KeyboardEvent) => {
    if (
      isEditingText(event.target) ||
      disabled ||
      label ||
      window.document.querySelector('dialog[open]')
    )
      return;
    if (
      event.type === 'keyup' ||
      ['Shift', 'Meta', 'Control', 'Alt'].includes(event.key)
    ) {
      if (gesture.current) updateGesture(pointer(), event);
      if (drawing.current) {
        drawing.current.modifiers = copyModifiers(event);
        drawing.current.cursor = constrainPoint(
          drawing.current.pins.at(-1)!,
          pointer(),
          event.shiftKey,
        );
        previewDrawing();
      }
      return;
    }
    if (
      event.key === 'Escape' &&
      (drawing.current || gesture.current || pointMode)
    ) {
      event.preventDefault();
      event.stopImmediatePropagation();
      cancel();
      setPointMode(null);
      setPointsSelected([]);
      onFinish();
      return;
    }
    if (event.key === 'Enter') {
      if (drawing.current) commitDrawing(false);
      else if (connection) {
        if (connection.kind === 'line' || event.metaKey || event.ctrlKey)
          setPointMode(pointMode ? null : connection.id);
        else editLabel(connection.id);
      } else return;
      event.preventDefault();
      event.stopImmediatePropagation();
    }
    if (
      (event.key === 'Delete' || event.key === 'Backspace') &&
      pointMode &&
      connection &&
      route
    ) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const kept = route.vertices.filter((_, i) => !pointsSelected.includes(i));
      if (kept.length >= 2 && kept.length < route.vertices.length)
        onEdit(
          patchConnection(connection.id, {
            points: kept.slice(1, -1),
            start: pointsSelected.includes(0)
              ? { kind: 'free', ...kept[0] }
              : connection.start,
            end: pointsSelected.includes(route.vertices.length - 1)
              ? { kind: 'free', ...kept.at(-1)! }
              : connection.end,
          }),
        );
      setPointsSelected([]);
    }
  });
  const cancelOutside = useEffectEvent((event: MouseEvent | FocusEvent) => {
    if (gesture.current && !(event.target instanceof HTMLCanvasElement))
      cancel();
  });
  useEffect(() => {
    window.addEventListener('keydown', keyboard, true);
    window.addEventListener('keyup', keyboard, true);
    window.addEventListener('mouseup', cancelOutside);
    window.addEventListener('blur', cancelOutside);
    return () => {
      window.removeEventListener('keydown', keyboard, true);
      window.removeEventListener('keyup', keyboard, true);
      window.removeEventListener('mouseup', cancelOutside);
      window.removeEventListener('blur', cancelOutside);
    };
  }, []);
  const handle = (point: Point, type: Handle['type'], index: number) => (
    <Circle
      key={`${type}-${index}`}
      name={`connector-${type}-handle`}
      connectorHandle={{ type, index }}
      x={point.x}
      y={point.y}
      radius={(type === 'point' ? 5 : 3.5) / camera.scale}
      hitStrokeWidth={12 / camera.scale}
      stroke="#6366f1"
      strokeWidth={1.5 / camera.scale}
      fill={
        type === 'point'
          ? pointsSelected.includes(index)
            ? '#a5b4fc'
            : '#fff'
          : '#6366f1'
      }
    />
  );
  const paintedRoute = paint && connectionRoute(document, paint, scene.world);
  const paintOwner = paint?.ownerId
    ? scene.world.get(paint.ownerId)
    : undefined;
  const labelConnection = label && document.connections[label.id];
  const labelRoute =
    labelConnection && connectionRoute(document, labelConnection, scene.world);
  const labelPosition =
    labelRoute &&
    worldPoint(
      labelRoute.label,
      labelConnection.ownerId
        ? scene.world.get(labelConnection.ownerId)
        : undefined,
    );
  const guideKey =
    gesture.current?.handle.type === 'point' &&
    gesture.current.handle.index === 0
      ? 'start'
      : 'end';
  const guideEndpoint = paint?.[guideKey];
  const guideTarget =
    guideEndpoint?.kind === 'object'
      ? scene.world.get(guideEndpoint.objectId)
      : undefined;
  const guideAnchor =
    guideTarget && guideEndpoint?.kind === 'object'
      ? guideEndpoint.binding === 'auto'
        ? guideTarget
        : worldPoint(
            boundaryPosition(
              guideEndpoint,
              guideTarget,
              document.objects[guideEndpoint.objectId],
            ),
            guideTarget,
          )
      : null;
  const guideTip =
    paintedRoute &&
    worldPoint(
      guideKey === 'start'
        ? paintedRoute.vertices[0]
        : paintedRoute.vertices.at(-1)!,
      paintOwner,
    );
  return {
    mouseDown,
    mouseMove,
    mouseUp,
    doubleClick,
    cancel,
    editLabel,
    consumeClick: () => {
      const value = consumed.current;
      consumed.current = false;
      return value;
    },
    labelId: label?.id ?? null,
    overlay: (
      <>
        {target && guideAnchor && guideTip && (
          <Group listening={false}>
            <Line
              points={[guideTip.x, guideTip.y, guideAnchor.x, guideAnchor.y]}
              stroke="#06b6d4"
              strokeWidth={1 / camera.scale}
              dash={[4 / camera.scale, 4 / camera.scale]}
            />
            <Circle
              x={guideAnchor.x}
              y={guideAnchor.y}
              radius={3 / camera.scale}
              stroke="#06b6d4"
              strokeWidth={1 / camera.scale}
            />
          </Group>
        )}
        {!disabled &&
          (tool === ToolMode.ARROW ||
            gesture.current?.handle.type === 'point') &&
          target &&
          scene.world.has(target) && (
            <Group listening={false}>
              <Group
                x={scene.world.get(target)!.x}
                y={scene.world.get(target)!.y}
                rotation={scene.world.get(target)!.rotation}
              >
                <ObjectOutline
                  object={document.objects[target]}
                  geometry={scene.world.get(target)!}
                  stroke="#06b6d4"
                  strokeWidth={3 / camera.scale}
                  fill="rgba(6,182,212,0.08)"
                />
              </Group>
              {connectionAnchors(scene.world.get(target)!).map((anchor) => (
                <Circle
                  key={anchor.side}
                  name="connection-anchor"
                  x={anchor.x}
                  y={anchor.y}
                  radius={4 / camera.scale}
                  stroke="#06b6d4"
                  strokeWidth={1.5 / camera.scale}
                  fill="white"
                />
              ))}
            </Group>
          )}
        {drawing.current && paint && paintedRoute && (
          <Group
            name="creation-preview"
            listening={false}
            x={paintOwner?.x ?? 0}
            y={paintOwner?.y ?? 0}
            rotation={paintOwner?.rotation ?? 0}
          >
            <ConnectionPaint
              connection={paint}
              route={paintedRoute}
              scale={camera.scale}
            />
          </Group>
        )}
        {!disabled &&
          !label &&
          tool === ToolMode.POINTER &&
          connection &&
          route && (
            <Group
              x={owner?.x ?? 0}
              y={owner?.y ?? 0}
              rotation={owner?.rotation ?? 0}
            >
              <Line
                listening={false}
                points={route.points}
                bezier={route.bezier}
                stroke="#818cf8"
                strokeWidth={1 / camera.scale}
                dash={[4 / camera.scale, 4 / camera.scale]}
              />
              {route.vertices.map((point, index) =>
                handle(point, 'point', index),
              )}
              {connection.style?.lineType === 'elbow'
                ? route.route
                    .slice(1)
                    .map(
                      (p, i) =>
                        distance(p, route.route[i]) * camera.scale > 16 &&
                        handle(midpoint(route.route[i], p), 'segment', i),
                    )
                : route.vertices
                    .slice(1)
                    .map((p, i) =>
                      handle(
                        route.bezier
                          ? route.samples[i * 20 + 10]
                          : midpoint(route.vertices[i], p),
                        'midpoint',
                        i,
                      ),
                    )}
            </Group>
          )}
      </>
    ),
    labelEditor: label && labelPosition && (
      <textarea
        ref={labelRef}
        aria-label="Arrow label"
        className="connection-label-editor"
        value={label.value}
        style={{
          left: camera.x + labelPosition.x * camera.scale,
          top: camera.y + labelPosition.y * camera.scale,
          transform: 'translate(-50%, -50%)',
        }}
        rows={Math.max(1, label.value.split('\n').length)}
        onChange={(event) => setLabel({ ...label, value: event.target.value })}
        onBlur={() => finishLabel(true)}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Escape') {
            event.preventDefault();
            finishLabel(false);
          } else if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            finishLabel(true);
          }
        }}
      />
    ),
    hint: drawing.current
      ? 'Click to add points · Enter or click the last point to finish · Escape to cancel'
      : pointMode
        ? 'Drag points or midpoints · Alt-click a segment to add a point · Delete selected points · Escape to finish'
        : connection
          ? 'Drag endpoints to snap to side points or slide along the outline · Shift locks angles · Ctrl/⌘ disables binding'
          : null,
  };
}
