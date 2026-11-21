import type { DocumentEdit } from './documentTransactions';
import type {
  DiagramConnection,
  DiagramObject,
  RecursiveDocument,
  RichBlock,
  TagDefinition,
  TextRun,
} from './recursiveDocument';

type Tagged = Pick<DiagramObject | DiagramConnection, 'tags'>;
type Definitions = RecursiveDocument['tagDefinitions'];

/** Known definitions in the entity's order; unknown and repeated IDs are ignored. */
export function entityTags(definitions: Definitions, entity: Tagged) {
  return [...new Set(entity.tags ?? [])].flatMap((id) =>
    definitions && Object.hasOwn(definitions, id) ? [definitions[id]] : [],
  );
}

/** Match a tag by exact ID first, then by case-insensitive name. */
export function resolveTag(document: RecursiveDocument, idOrName: string) {
  const definitions = document.tagDefinitions ?? {};
  if (Object.hasOwn(definitions, idOrName)) return definitions[idOrName];
  const name = idOrName.trim().toLowerCase();
  return Object.values(definitions).find(
    (tag) => tag.name.trim().toLowerCase() === name,
  );
}

export const hasTag = (entity: Tagged, id: string | undefined) =>
  id !== undefined && !!entity.tags?.includes(id);

export function editTagDefinition(
  action: 'create' | 'update' | 'delete',
  id: string,
  patch: {
    name?: string;
    color?: string;
    strokeStyle?: TagDefinition['strokeStyle'] | null;
  } = {},
): DocumentEdit {
  return (draft) => {
    const definitions = (draft.tagDefinitions ??= {});
    const exists = Object.hasOwn(definitions, id);
    if (action === 'create' ? exists : !exists)
      throw new Error(
        action === 'create'
          ? `Tag ${id} already exists`
          : `Tag ${id} does not exist`,
      );
    if (action === 'delete') {
      delete definitions[id];
      if (!Object.keys(definitions).length) delete draft.tagDefinitions;
      const strip = (entity: Tagged) => {
        if (!entity.tags?.includes(id)) return;
        entity.tags = entity.tags.filter((tag) => tag !== id);
        if (!entity.tags.length) delete entity.tags;
      };
      Object.values(draft.objects).forEach(strip);
      Object.values(draft.connections).forEach(strip);
      Object.values(draft.connectionRepairs ?? {}).forEach((repair) =>
        strip(repair.connection),
      );
      return;
    }
    const name = (patch.name ?? definitions[id]?.name)?.trim();
    const color = patch.color ?? definitions[id]?.color;
    if (!name || !color) throw new Error('A tag needs a name and a color');
    if (
      Object.values(definitions).some(
        (tag) =>
          tag.id !== id && tag.name.trim().toLowerCase() === name.toLowerCase(),
      )
    )
      throw new Error(`A tag named ${name} already exists`);
    const strokeStyle =
      patch.strokeStyle === undefined
        ? definitions[id]?.strokeStyle
        : (patch.strokeStyle ?? undefined);
    definitions[id] = { id, name, color, ...(strokeStyle && { strokeStyle }) };
  };
}

/** Add, remove or replace tags on objects and connections in one edit. */
export function setEntityTags(
  mode: 'add' | 'remove' | 'set',
  tagIds: string[],
  objects: string[],
  connections: string[],
): DocumentEdit {
  return (draft) => {
    for (const id of tagIds)
      if (!Object.hasOwn(draft.tagDefinitions ?? {}, id))
        throw new Error(`Tag ${id} does not exist`);
    const entities = [
      ...objects.map((id) => draft.objects[id]),
      ...connections.map((id) => draft.connections[id]),
    ];
    if (entities.some((entity) => !entity))
      throw new Error('Tag target does not exist');
    for (const entity of entities) {
      const current = entity.tags ?? [];
      const next =
        mode === 'set'
          ? [...new Set(tagIds)]
          : mode === 'add'
            ? [...new Set([...current, ...tagIds])]
            : current.filter((id) => !tagIds.includes(id));
      if (next.length) entity.tags = next;
      else delete entity.tags;
    }
  };
}

/** Adopt pasted/inserted entities' tags into the destination: a matching ID keeps the
 * destination definition, a matching name reuses that tag, otherwise the definition is
 * copied. IDs the source does not define are dropped. */
export function adoptTagDefinitions(
  draft: RecursiveDocument,
  source: Definitions,
  entities: Iterable<Tagged>,
) {
  for (const entity of entities) {
    if (!entity.tags) continue;
    const tags = entityTags(source, entity).map((tag) => {
      const own = draft.tagDefinitions ?? {};
      if (Object.hasOwn(own, tag.id)) return tag.id;
      const named = resolveTag(draft, tag.name);
      if (named) return named.id;
      (draft.tagDefinitions ??= {})[tag.id] = { ...tag };
      return tag.id;
    });
    if (tags.length) entity.tags = [...new Set(tags)];
    else delete entity.tags;
  }
}

/** Drop definitions no copied entity uses. */
export function pruneTagDefinitions(draft: RecursiveDocument) {
  const used = new Set(
    [
      ...Object.values(draft.objects),
      ...Object.values(draft.connections),
    ].flatMap((entity) => entity.tags ?? []),
  );
  for (const id of Object.keys(draft.tagDefinitions ?? {}))
    if (!used.has(id)) delete draft.tagDefinitions![id];
  if (draft.tagDefinitions && !Object.keys(draft.tagDefinitions).length)
    delete draft.tagDefinitions;
}

const tagStyled = new WeakMap<
  DiagramConnection,
  { definitions: Definitions; value: DiagramConnection }
>();
/** A tag's line style applies unless the connection sets its own; cached to keep paint memoized. */
export function tagStyledConnection(
  connection: DiagramConnection,
  definitions: Definitions,
) {
  if (connection.style?.strokeStyle !== undefined || !connection.tags?.length)
    return connection;
  const cached = tagStyled.get(connection);
  if (cached && cached.definitions === definitions) return cached.value;
  const strokeStyle = entityTags(definitions, connection).find(
    (tag) => tag.strokeStyle,
  )?.strokeStyle;
  const value = strokeStyle
    ? { ...connection, style: { ...connection.style, strokeStyle } }
    : connection;
  tagStyled.set(connection, { definitions, value });
  return value;
}

export const isLegend = (object: DiagramObject) =>
  object.style?.legend === true;

const count = <T>(values: T[], key: (value: T) => string) => {
  const counts = new Map<string, { value: T; count: number }>();
  for (const value of values) {
    const entry = counts.get(key(value));
    if (entry) entry.count++;
    else counts.set(key(value), { value, count: 1 });
  }
  return [...counts.entries()]
    .sort(([a, x], [b, y]) => y.count - x.count || (a < b ? -1 : 1))
    .slice(0, 12)
    .map(([, entry]) => entry);
};
/** Tags in use, then explicit object fills and connection strokes, all derived at render time. */
export function legendEntries(document: RecursiveDocument) {
  const definitions = document.tagDefinitions;
  const objects = Object.values(document.objects).filter((o) => !isLegend(o));
  const connections = Object.values(document.connections);
  const used = new Map<string, number>();
  for (const entity of [...objects, ...connections])
    for (const tag of entityTags(definitions, entity))
      used.set(tag.id, (used.get(tag.id) ?? 0) + 1);
  return {
    tags: Object.values(definitions ?? {})
      .filter((tag) => used.has(tag.id))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
      .map((tag) => ({ ...tag, count: used.get(tag.id)! })),
    fills: count(
      objects.flatMap((o) =>
        typeof o.style?.fill === 'string' &&
        o.style.fill !== 'transparent' &&
        o.style.fillType !== 'none'
          ? [o.style.fill]
          : [],
      ),
      (fill) => fill,
    ).map(({ value, count }) => ({ color: value, count })),
    lines: count(
      connections.flatMap((c) =>
        typeof c.style?.stroke === 'string'
          ? [
              {
                color: c.style.stroke,
                strokeStyle: String(
                  tagStyledConnection(c, definitions).style?.strokeStyle ??
                    'solid',
                ),
              },
            ]
          : [],
      ),
      (line) => `${line.color} ${line.strokeStyle}`,
    ).map(({ value, count }) => ({ ...value, count })),
  };
}

const muted = '#64748b';
const plural = (count: number, noun: string) =>
  `${count} ${noun}${count === 1 ? '' : 's'}`;
/** Fill swatch; the outline is a derived-only mark that keeps white and pale fills visible. */
const swatch = (color: string): TextRun => ({
  text: '■',
  marks: { color, outline: muted } as TextRun['marks'],
});
const lineGlyph = (style?: string) =>
  style === 'dashed' ? ' ‒ ‒ ‒' : style === 'dotted' ? ' · · · ·' : ' ———';
/** Legend body as ordinary rich content, so layout, export and fit treat it like text. */
export function legendContent(document: RecursiveDocument): RichBlock[] {
  const { tags, fills, lines } = legendEntries(document);
  const section = (title: string): RichBlock => ({
    type: 'paragraph',
    align: 'left',
    runs: [{ text: title, marks: { bold: true } }],
  });
  const blocks: RichBlock[] = [];
  if (tags.length) blocks.push(section('Tags'));
  for (const tag of tags)
    blocks.push({
      type: 'paragraph',
      align: 'left',
      runs: [
        { text: '● ', marks: { color: tag.color } },
        { text: tag.name },
        ...(tag.strokeStyle
          ? [{ text: lineGlyph(tag.strokeStyle), marks: { color: tag.color } }]
          : []),
        { text: ` (${tag.count})`, marks: { color: muted } },
      ],
    });
  if (fills.length) blocks.push(section('Fills'));
  for (const fill of fills)
    blocks.push({
      type: 'paragraph',
      align: 'left',
      runs: [swatch(fill.color), { text: ` ${plural(fill.count, 'shape')}` }],
    });
  if (lines.length) blocks.push(section('Lines'));
  for (const line of lines)
    blocks.push({
      type: 'paragraph',
      align: 'left',
      runs: [
        {
          text: lineGlyph(line.strokeStyle).trim(),
          marks: { color: line.color },
        },
        { text: ` ${plural(line.count, 'connector')}` },
      ],
    });
  return blocks.length
    ? blocks
    : [{ type: 'paragraph', runs: [{ text: 'No tags in use' }] }];
}

export const PILL_HEIGHT = 14;
export const PILL_ROW = PILL_HEIGHT + 4;
export const pillStyle = {
  font: 'Arial',
  size: 9,
  color: '#ffffff',
  bold: true,
};
/** Readable pill text on light or dark tag colors (hex colors; others use white). */
export function pillText(color: string) {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color)?.[1];
  if (!hex) return '#ffffff';
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex;
  const [r, g, b] = [0, 2, 4].map((at) => parseInt(full.slice(at, at + 2), 16));
  return 0.299 * r + 0.587 * g + 0.114 * b > 160 ? '#0f172a' : '#ffffff';
}
/** One row of pills; tags that do not fit collapse into a trailing "+N" pill. */
export function tagPillLayout(
  tags: TagDefinition[],
  maxWidth: number,
  measure: (text: string) => number,
) {
  const width = (text: string) => Math.ceil(measure(text)) + 10;
  const pills: { x: number; width: number; text: string; color: string }[] = [];
  let x = 0;
  for (const [at, tag] of tags.entries()) {
    const rest = tags.length - at - 1;
    const own = width(tag.name);
    const more = rest ? width(`+${rest}`) + 4 : 0;
    if (x + own + more > maxWidth) {
      const text = `+${tags.length - at}`;
      if (x + width(text) <= maxWidth)
        pills.push({ x, width: width(text), text, color: muted });
      break;
    }
    pills.push({ x, width: own, text: tag.name, color: tag.color });
    x += own + 4;
  }
  return pills;
}
