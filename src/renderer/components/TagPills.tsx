import { createContext, useContext } from 'react';
import { Group, Rect, Text } from 'react-konva';
import type {
  DiagramConnection,
  RecursiveDocument,
  TagDefinition,
} from '../../shared/recursiveDocument';
import {
  PILL_HEIGHT,
  entityTags,
  pillStyle,
  pillText,
  tagPillLayout,
} from '../../shared/tags';
import { fontFamily } from '../../shared/textFont';
import { measureText } from '../../shared/textMeasure';

/** Definitions reach memoized connection paint without changing its props. */
export const TagDefinitionsContext =
  createContext<RecursiveDocument['tagDefinitions']>(undefined);

const measure = (text: string) => measureText(text, pillStyle);

/** A row of tag pills; `x` is the left edge, or the center when `centered`. */
export function TagPills({
  tags,
  x,
  y,
  width,
  centered = false,
  name = 'object-content object-tags',
}: {
  tags: TagDefinition[];
  x: number;
  y: number;
  width: number;
  centered?: boolean;
  name?: string;
}) {
  const pills = tagPillLayout(tags, width, measure);
  if (!pills.length) return null;
  const used = pills.at(-1)!.x + pills.at(-1)!.width;
  return (
    <Group name={name} x={centered ? x - used / 2 : x} y={y} listening={false}>
      {pills.map((pill) => (
        <Group key={pill.x} x={pill.x}>
          <Rect
            width={pill.width}
            height={PILL_HEIGHT}
            cornerRadius={PILL_HEIGHT / 2}
            fill={pill.color}
          />
          <Text
            width={pill.width}
            height={PILL_HEIGHT}
            text={pill.text}
            align="center"
            verticalAlign="middle"
            wrap="none"
            fontSize={pillStyle.size}
            fontStyle="bold"
            fontFamily={fontFamily(pillStyle.font)}
            fill={pillText(pill.color)}
          />
        </Group>
      ))}
    </Group>
  );
}

/** Pills below a connection label, or centered on the path middle without one. */
export function ConnectionTagPills({
  connection,
  at,
  labelHeight,
}: {
  connection: DiagramConnection;
  at: { x: number; y: number };
  labelHeight: number;
}) {
  const tags = entityTags(useContext(TagDefinitionsContext), connection);
  if (!tags.length) return null;
  return (
    <TagPills
      tags={tags}
      x={at.x}
      y={labelHeight ? at.y + labelHeight / 2 + 3 : at.y - PILL_HEIGHT / 2}
      width={240}
      centered
      name="connection-tags"
    />
  );
}
