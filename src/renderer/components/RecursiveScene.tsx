import ConnectionPaint from './ConnectionPaint';
import { memo, useMemo, type ReactNode } from 'react';
import { Group, Rect, Text } from 'react-konva';
import type {
  DiagramObject,
  RecursiveDocument,
  RichBlock,
} from '../../shared/recursiveDocument';
import {
  entityTags,
  isLegend,
  legendContent,
  tagStyledConnection,
} from '../../shared/tags';
import { TagDefinitionsContext, TagPills } from './TagPills';
import { bodyFit } from '../../shared/objectFit';
import type { recursiveScene } from '../../shared/recursiveScene';
import {
  visibleEndpoint,
  type ConnectionRoute,
} from '../../shared/connectionGeometry';
import RecursiveRichContent from './RecursiveRichContent';
import ObjectOutline from './ObjectOutline';
import {
  objectContentBounds,
  textVerticalAlignment,
  type TextExclusion,
} from '../../shared/objectContentBounds';

// Position and child layout changes do not rebuild unchanged shape contents.
const ObjectContent = memo(function ObjectContent({
  object,
  width,
  height,
  expanded,
  hasChildren,
  exclusion,
  editingText,
  tagDefinitions,
  legend,
  onError,
}: {
  object: DiagramObject;
  width: number;
  height: number;
  expanded: boolean;
  hasChildren: boolean;
  exclusion?: TextExclusion;
  editingText: boolean;
  tagDefinitions: RecursiveDocument['tagDefinitions'];
  /** Generated legend body that replaces the object's own content. */
  legend?: RichBlock[];
  onError: (message: string) => void;
}) {
  const style = object.style;
  const content = legend ?? object.content;
  const tags = entityTags(tagDefinitions, object);
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
  const {
    title,
    body,
    tags: tagBox,
  } = objectContentBounds(object, width, height, hasChildren);
  const { scale, overflow } = useMemo(
    () => bodyFit(object, content, width, height, hasChildren, expanded),
    [object, content, width, height, hasChildren, expanded],
  );
  return (
    <>
      <ObjectOutline object={object} geometry={geometry} {...shapeProps} />
      {object.name && title.width > 0 && title.height > 0 && (
        <Text
          name="object-label"
          {...title}
          text={object.name}
          fontSize={13}
          fill="#0f172a"
          wrap="none"
          ellipsis
          listening={false}
        />
      )}
      {!expanded &&
        content.length > 0 &&
        body.width > 0 &&
        body.height > 10 &&
        !editingText &&
        (scale === 1 ? (
          <RecursiveRichContent
            {...body}
            exclusion={exclusion}
            content={content}
            verticalAlign={textVerticalAlignment(object)}
            onError={onError}
          />
        ) : (
          // shrink-text lays out at the unscaled size, then scales the body uniformly.
          <Group
            name="object-content"
            x={body.x}
            y={body.y}
            scaleX={scale}
            scaleY={scale}
          >
            <RecursiveRichContent
              x={0}
              y={0}
              width={body.width / scale}
              height={body.height / scale}
              exclusion={
                exclusion && {
                  ...exclusion,
                  width: exclusion.width / scale,
                  top: exclusion.top / scale,
                  bottom: exclusion.bottom / scale,
                }
              }
              content={content}
              verticalAlign={textVerticalAlignment(object)}
              onError={onError}
            />
          </Group>
        ))}
      {tags.length > 0 && tagBox.height > 0 && (
        <TagPills
          tags={tags}
          {...tagBox}
          width={tagBox.width - (overflow ? 20 : 0)}
        />
      )}
      {overflow && !editingText && (
        <Group
          name="object-content object-overflow"
          x={width / 2 - 18}
          y={height / 2 - 14}
          listening={false}
        >
          <Rect width={14} height={10} cornerRadius={3} fill="#ac323b" />
          <Text
            width={14}
            height={10}
            text="…"
            fontSize={10}
            align="center"
            verticalAlign="middle"
            fill="#ffffff"
          />
        </Group>
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
  renderChildrenToggle,
  textExclusions,
  editingTextId,
  liftedIds,
  editingConnectionLabel,
}: {
  document: RecursiveDocument;
  scene: ReturnType<typeof recursiveScene>;
  scale?: number;
  onError: (message: string) => void;
  renderBoundaryPoints?: (id: string) => ReactNode;
  renderChildrenToggle?: (id: string) => ReactNode;
  textExclusions?: ReadonlyMap<string, TextExclusion>;
  editingTextId?: string | null;
  liftedIds?: ReadonlySet<string>;
  editingConnectionLabel?: string | null;
}) {
  const definitions = document.tagDefinitions;
  const legend = useMemo(
    () =>
      Object.values(document.objects).some(isLegend)
        ? legendContent(document)
        : undefined,
    [document],
  );
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
      connection={tagStyledConnection(document.connections[id], definitions)}
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
          hasChildren={scene.hierarchy.children.has(id)}
          exclusion={textExclusions?.get(id)}
          editingText={editingTextId === id}
          tagDefinitions={definitions}
          legend={isLegend(object) ? legend : undefined}
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
        {renderChildrenToggle?.(id)}
      </Group>
    );
  };
  return (
    <TagDefinitionsContext.Provider value={definitions}>
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
    </TagDefinitionsContext.Provider>
  );
});
