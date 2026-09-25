import ConnectionPaint from './ConnectionPaint';
import { memo, type ReactNode } from 'react';
import { Group, Text } from 'react-konva';
import type {
  DiagramObject,
  RecursiveDocument,
} from '../../shared/recursiveDocument';
import type { recursiveScene } from '../../shared/recursiveScene';
import {
  visibleEndpoint,
  type ConnectionRoute,
} from '../../shared/connectionGeometry';
import RecursiveRichContent from './RecursiveRichContent';
import ObjectOutline from './ObjectOutline';

// Position and child layout changes do not rebuild unchanged shape contents.
const ObjectContent = memo(function ObjectContent({
  object,
  width,
  height,
  expanded,
  editingText,
  onError,
}: {
  object: DiagramObject;
  width: number;
  height: number;
  expanded: boolean;
  editingText: boolean;
  onError: (message: string) => void;
}) {
  const style = object.style;
  const geometry = { width, height };
  const paint = {
    fill: typeof style?.fill === 'string' ? style.fill : '#ffffff',
    stroke: typeof style?.stroke === 'string' ? style.stroke : '#64748b',
    strokeWidth:
      typeof style?.strokeWidth === 'number'
        ? Math.max(0, style.strokeWidth)
        : 1.5,
  };
  const shapeProps = {
    ...paint,
    name: 'object-hit-area',
    dash:
      style?.strokeStyle === 'dashed'
        ? [8, 6]
        : style?.strokeStyle === 'dotted'
          ? [2, 4]
          : [],
  };
  const inset =
    object.type === 'ellipse' ? 0.15 : object.type === 'diamond' ? 0.25 : 0;
  const textX = Math.max(6, width * inset),
    textY = Math.max(4, height * inset);
  const textWidth = Math.max(1, width - textX * 2),
    textHeight = Math.max(1, height - textY * 2);
  const titleHeight = object.name ? 24 : 0;
  return (
    <>
      <ObjectOutline object={object} geometry={geometry} {...shapeProps} />
      {object.name && (
        <Text
          name="object-label"
          x={-width / 2 + textX}
          y={-height / 2 + textY}
          width={textWidth}
          height={Math.min(20, textHeight)}
          text={object.name}
          fontSize={13}
          fill="#0f172a"
          wrap="none"
          ellipsis
          listening={false}
        />
      )}
      {!expanded &&
        object.content.length > 0 &&
        textHeight > titleHeight + 10 &&
        !editingText && (
          <RecursiveRichContent
            x={-width / 2 + textX}
            y={-height / 2 + textY + titleHeight}
            width={textWidth}
            height={textHeight - titleHeight}
            content={object.content}
            onError={onError}
          />
        )}
    </>
  );
});

/** Shared diagram paint; editing gestures and overlays stay with the caller. */
export default memo(function RecursiveScene({
  document,
  scene,
  scale = 1,
  onError,
  renderBoundaryPoints,
  editingTextId,
  liftedIds,
  editingConnectionLabel,
}: {
  document: RecursiveDocument;
  scene: ReturnType<typeof recursiveScene>;
  scale?: number;
  onError: (message: string) => void;
  renderBoundaryPoints?: (id: string) => ReactNode;
  editingTextId?: string | null;
  liftedIds?: ReadonlySet<string>;
  editingConnectionLabel?: string | null;
}) {
  const liftedConnections = new Map<string, ConnectionRoute>();
  if (liftedIds?.size)
    for (const [ownerId, routes] of scene.connections)
      for (const route of routes) {
        const connection = document.connections[route.id];
        if (
          [connection.start, connection.end].some((endpoint) => {
            const target = visibleEndpoint(document, endpoint, scene.world);
            let id = target.kind === 'free' ? null : target.objectId;
            // Routes owned inside a lifted subtree already travel with its group.
            while (id !== null && id !== ownerId) {
              if (liftedIds.has(id)) return true;
              id = document.objects[id].parentId;
            }
            return false;
          })
        )
          liftedConnections.set(route.id, route);
      }
  const inheritedOpacity = (id: string | null) => {
    let opacity = 1;
    while (id !== null) {
      const object = document.objects[id];
      if (typeof object.style?.opacity === 'number')
        opacity *= object.style.opacity;
      id = object.parentId;
    }
    return opacity;
  };
  const renderConnection = (id: string, route: ConnectionRoute) => (
    <ConnectionPaint
      key={`connection-${id}`}
      connection={document.connections[id]}
      route={route}
      scale={scale}
      editingLabel={editingConnectionLabel === id}
    />
  );
  const renderScope = (ownerId: string | null): ReactNode =>
    (scene.paintOrder.get(ownerId) ?? []).map((item) =>
      item.kind === 'object'
        ? renderObject(item.id)
        : liftedConnections.has(item.id)
          ? null
          : renderConnection(item.id, item.route),
    );
  const renderObject = (id: string, lifted = false): ReactNode => {
    if (liftedIds?.has(id) && !lifted) return null;
    const object = document.objects[id],
      geometry = (lifted ? scene.world : scene.local).get(id)!;
    const { x, y, width, height, rotation } = geometry;
    const expanded = scene.expanded.has(id),
      style = object.style;
    const opacity = lifted
      ? inheritedOpacity(id)
      : typeof style?.opacity === 'number'
        ? style.opacity
        : 1;
    const clip = style?.clipToFrame === true;
    return (
      <Group
        key={`object-${id}`}
        id={`object-${id}`}
        name="recursive-object"
        x={x}
        y={y}
        rotation={rotation}
        width={width}
        height={height}
        opacity={opacity}
      >
        <ObjectContent
          object={object}
          width={width}
          height={height}
          expanded={expanded}
          editingText={editingTextId === id}
          onError={onError}
        />
        <Group
          {...(clip
            ? {
                clipX: -width / 2,
                clipY: -height / 2,
                clipWidth: width,
                clipHeight: height,
              }
            : {})}
        >
          {renderScope(id)}
        </Group>
        {renderBoundaryPoints?.(id)}
      </Group>
    );
  };
  return (
    <>
      {renderScope(null)}
      {[...(liftedIds ?? [])].map((id) => renderObject(id, true))}
      {[...liftedConnections].map(([id, route]) => {
        const ownerId = document.connections[id].ownerId;
        const owner = ownerId === null ? undefined : scene.world.get(ownerId);
        return (
          <Group
            key={`lifted-${id}`}
            x={owner?.x}
            y={owner?.y}
            rotation={owner?.rotation}
            opacity={inheritedOpacity(ownerId)}
          >
            {renderConnection(id, route)}
          </Group>
        );
      })}
    </>
  );
});
