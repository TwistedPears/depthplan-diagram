import { indexHierarchy } from './recursiveHierarchy';
import type { Camera } from './recursiveCamera';

/** The current document format uses a flat forest of shared objects. */
export interface Geometry {
  x: number;
  y: number;
  z: number;
  width: number;
  height: number;
  rotation: number;
}
export const codeLanguages = [
  'javascript',
  'typescript',
  'json',
  'yaml',
  'python',
  'sql',
  'bash',
  'csharp',
  'java',
  'html',
  'css',
  'plaintext',
] as const;
export interface TextRun {
  text: string;
  marks?: {
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
    strike?: boolean;
    font?: string;
    size?: number;
    color?: string;
    link?: string;
  };
}
export type RichBlock =
  | {
      type: 'paragraph';
      runs: TextRun[];
      align?: 'left' | 'center' | 'right' | 'justify';
    }
  | {
      type: 'heading';
      level: number;
      runs: TextRun[];
      align?: 'left' | 'center' | 'right' | 'justify';
    }
  | { type: 'list'; ordered: boolean; start?: number; items: RichBlock[][] }
  | { type: 'quote'; blocks: RichBlock[] }
  | {
      type: 'code';
      text: string;
      language: (typeof codeLanguages)[number];
      wrap?: boolean;
    };
export type Side = 'top' | 'right' | 'bottom' | 'left';
export interface BoundaryPoint {
  side: Side;
  offset: number;
}
export type Json =
  null | boolean | number | string | Json[] | { [key: string]: Json };
export interface DiagramObject {
  id: string;
  parentId: string | null;
  type: 'rectangle' | 'ellipse' | 'diamond' | 'frame';
  name: string;
  content: RichBlock[];
  geometry: Geometry;
  style?: Record<string, Json>;
  boundaryPoints?: Record<string, BoundaryPoint>;
}
export type Endpoint =
  | { kind: 'free'; x: number; y: number }
  | {
      kind: 'object';
      objectId: string;
      side: Side;
      offset: number;
      binding?: 'auto' | 'fixed';
    }
  | { kind: 'boundary'; objectId: string; pointId: string };
export interface DiagramConnection {
  id: string;
  ownerId: string | null;
  kind: 'line' | 'arrow';
  z: number;
  start: Endpoint;
  end: Endpoint;
  /** Interior vertices in owner-local coordinates; omit for a two-point path. */
  points?: { x: number; y: number }[];
  label?: string;
  style?: Record<string, Json>;
}
export interface ConnectionRepair {
  connection: DiagramConnection;
  ownerGeometry: Geometry | null;
  start: { x: number; y: number };
  end: { x: number; y: number };
  reason: string;
}
export type BookmarkGeometry = Pick<
  Geometry,
  'x' | 'y' | 'width' | 'height'
> & {
  parentId: string | null;
};
export interface NamedView {
  id: string;
  name: string;
  rootDepths: Record<string, number>;
  camera?: Camera;
  /** World point at the viewport center when the camera was captured. */
  cameraFocus?: { x: number; y: number };
  layouts?: Record<string, Record<string, BookmarkGeometry>>;
  metadata?: Record<string, Json>;
}
export interface RecursiveDocument {
  formatVersion: 2;
  id: string;
  metadata: {
    title: string;
    created: string;
    modified: string;
    [key: string]: Json;
  };
  objects: Record<string, DiagramObject>;
  rootDepths: Record<string, number>;
  layouts: Record<string, Record<string, Record<string, Geometry>>>;
  connections: Record<string, DiagramConnection>;
  connectionRepairs?: Record<string, ConnectionRepair>;
  namedViews?: Record<string, NamedView>;
  extensions?: Record<string, Json>;
}
export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function requireValue(value: unknown, path: string): asserts value {
  if (!value) throw new Error(`Invalid recursive document: ${path}`);
}
const finite = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v);
export const validId = (v: unknown): v is string =>
  typeof v === 'string' &&
  v.length > 0 &&
  !['__proto__', 'constructor', 'prototype'].includes(v);
function map(
  value: unknown,
  path: string,
): asserts value is Record<string, unknown> {
  requireValue(isRecord(value), path);
  requireValue(Object.keys(value).every(validId), `${path} keys`);
}
export function validateJson(value: unknown) {
  // JSON.stringify rejects cycles and permits harmless shared references.
  JSON.stringify(value, (_key, v: unknown) => {
    requireValue(
      v === null ||
        typeof v === 'string' ||
        typeof v === 'boolean' ||
        finite(v) ||
        Array.isArray(v) ||
        isRecord(v),
      'JSON-only values',
    );
    return v;
  });
}

export function validLink(value: unknown): value is string {
  if (typeof value !== 'string' || /[\s\p{Cc}]/u.test(value)) return false;
  try {
    const url = new URL(value);
    return (
      ['https:', 'http:', 'mailto:'].includes(url.protocol) &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}
export function validateGeometry(
  value: unknown,
  path = 'geometry',
): asserts value is Geometry {
  requireValue(isRecord(value), path);
  requireValue(
    ['x', 'y', 'z', 'width', 'height', 'rotation'].every((k) =>
      finite(value[k]),
    ),
    path,
  );
  requireValue(
    Number.isInteger(value.z) &&
      Number(value.width) > 0 &&
      Number(value.height) > 0,
    `${path} dimensions/z`,
  );
  requireValue(
    Number(value.rotation) >= 0 && Number(value.rotation) < 360,
    `${path} rotation`,
  );
}
export function validateContent(value: unknown): asserts value is RichBlock[] {
  requireValue(Array.isArray(value), 'content');
  const todo: unknown[] = [...value];
  while (todo.length) {
    const block = todo.pop();
    requireValue(isRecord(block), 'content block');
    if (block.type === 'paragraph' || block.type === 'heading') {
      requireValue(Array.isArray(block.runs), 'content runs');
      if (block.type === 'heading')
        requireValue(
          Number.isInteger(block.level) &&
            Number(block.level) >= 1 &&
            Number(block.level) <= 6,
          'heading level',
        );
      requireValue(
        block.align === undefined ||
          ['left', 'center', 'right', 'justify'].includes(String(block.align)),
        'alignment',
      );
      for (const run of block.runs) {
        requireValue(isRecord(run) && typeof run.text === 'string', 'text run');
        if (run.marks === undefined) continue;
        requireValue(isRecord(run.marks), 'text marks');
        for (const [key, v] of Object.entries(run.marks)) {
          if (['bold', 'italic', 'underline', 'strike'].includes(key))
            requireValue(typeof v === 'boolean', key);
          else if (['font', 'color'].includes(key))
            requireValue(typeof v === 'string', key);
          else if (key === 'size')
            requireValue(finite(v) && v > 0, 'font size');
          else if (key === 'link') requireValue(validLink(v), 'link');
          else requireValue(false, `unknown mark ${key}`);
        }
      }
    } else if (block.type === 'list') {
      requireValue(
        typeof block.ordered === 'boolean' && Array.isArray(block.items),
        'list',
      );
      requireValue(
        block.start === undefined ||
          (Number.isInteger(block.start) && Number(block.start) > 0),
        'list start',
      );
      for (const item of block.items) {
        requireValue(Array.isArray(item) && item.length, 'list item');
        todo.push(...item);
      }
    } else if (block.type === 'quote') {
      requireValue(Array.isArray(block.blocks) && block.blocks.length, 'quote');
      todo.push(...block.blocks);
    } else if (block.type === 'code') {
      requireValue(
        typeof block.text === 'string' &&
          codeLanguages.includes(
            block.language as (typeof codeLanguages)[number],
          ),
        'code',
      );
      requireValue(
        block.wrap === undefined || typeof block.wrap === 'boolean',
        'code wrap',
      );
    } else requireValue(false, `content type ${String(block.type)}`);
  }
}
function boundary(
  value: unknown,
  path: string,
): asserts value is BoundaryPoint {
  requireValue(
    isRecord(value) &&
      ['top', 'right', 'bottom', 'left'].includes(String(value.side)) &&
      finite(value.offset) &&
      value.offset >= 0 &&
      value.offset <= 1,
    path,
  );
}
function validateConnection(
  connection: unknown,
  id: string,
): asserts connection is DiagramConnection {
  requireValue(
    isRecord(connection) &&
      connection.id === id &&
      ['line', 'arrow'].includes(String(connection.kind)) &&
      Number.isInteger(connection.z),
    `connection ${id}`,
  );
  requireValue(
    connection.ownerId === null || validId(connection.ownerId),
    `connection owner ${id}`,
  );
  if (connection.points !== undefined)
    requireValue(
      Array.isArray(connection.points) &&
        connection.points.every(
          (point: unknown) =>
            isRecord(point) && finite(point.x) && finite(point.y),
        ),
      `connection points ${id}`,
    );
  if (connection.label !== undefined)
    requireValue(
      typeof connection.label === 'string',
      `connection label ${id}`,
    );
  if (connection.style !== undefined)
    map(connection.style, `connection style ${id}`);
  for (const end of [connection.start, connection.end]) {
    requireValue(isRecord(end), `endpoint ${id}`);
    if (end.kind === 'free')
      requireValue(finite(end.x) && finite(end.y), `free endpoint ${id}`);
    else {
      requireValue(validId(end.objectId), `endpoint target ${id}`);
      if (end.kind === 'object') {
        boundary(end, `attachment ${id}`);
        requireValue(
          end.binding === undefined ||
            end.binding === 'auto' ||
            end.binding === 'fixed',
          `binding ${id}`,
        );
      } else
        requireValue(
          end.kind === 'boundary' && validId(end.pointId),
          `boundary endpoint ${id}`,
        );
    }
  }
}
/** Validate a flat forest iteratively, including hidden and inactive data. */
export function validateRecursiveDocument(
  value: unknown,
): asserts value is RecursiveDocument {
  requireValue(
    isRecord(value) && value.formatVersion === 2,
    'unsupported document format; expected formatVersion 2',
  );
  validateJson(value);
  requireValue(validId(value.id), 'document id');
  requireValue(
    isRecord(value.metadata) &&
      ['title', 'created', 'modified'].every(
        (k) =>
          typeof (value.metadata as Record<string, unknown>)[k] === 'string',
      ),
    'metadata',
  );
  map(value.objects, 'objects');
  map(value.rootDepths, 'rootDepths');
  map(value.layouts, 'layouts');
  map(value.connections, 'connections');
  if (value.extensions !== undefined) map(value.extensions, 'extensions');
  if (value.namedViews !== undefined) {
    map(value.namedViews, 'named views');
    for (const [id, view] of Object.entries(value.namedViews)) {
      requireValue(
        isRecord(view) &&
          view.id === id &&
          typeof view.name === 'string' &&
          view.name.trim().length > 0,
        `named view ${id}`,
      );
      map(view.rootDepths, `named view depths ${id}`);
      for (const depth of Object.values(view.rootDepths))
        requireValue(
          Number.isSafeInteger(depth) && Number(depth) >= 0,
          `named view depth ${id}`,
        );
      if (view.camera !== undefined) {
        const camera = view.camera;
        requireValue(
          isRecord(camera) &&
            finite(camera.x) &&
            finite(camera.y) &&
            finite(camera.scale) &&
            camera.scale > 0,
          `named view camera ${id}`,
        );
      }
      if (view.cameraFocus !== undefined)
        requireValue(
          view.camera !== undefined &&
            isRecord(view.cameraFocus) &&
            finite(view.cameraFocus.x) &&
            finite(view.cameraFocus.y),
          `named view camera focus ${id}`,
        );
      if (view.layouts !== undefined) {
        map(view.layouts, `named view layouts ${id}`);
        for (const [root, layout] of Object.entries(view.layouts)) {
          requireValue(
            Object.hasOwn(view.rootDepths, root),
            `named view layout root ${id}/${root}`,
          );
          map(layout, `named view layout ${id}/${root}`);
          for (const [objectId, geometry] of Object.entries(layout)) {
            requireValue(
              isRecord(geometry) &&
                ['x', 'y', 'width', 'height'].every((key) =>
                  finite(geometry[key]),
                ) &&
                Number(geometry.width) > 0 &&
                Number(geometry.height) > 0 &&
                (geometry.parentId === null || validId(geometry.parentId)),
              `named view geometry ${id}/${objectId}`,
            );
          }
        }
      }
      if (view.metadata !== undefined)
        map(view.metadata, `named view metadata ${id}`);
    }
  }
  const objects = value.objects;
  for (const [id, object] of Object.entries(objects)) {
    requireValue(isRecord(object) && object.id === id, `object ${id}`);
    requireValue(
      object.parentId === null ||
        (validId(object.parentId) && Object.hasOwn(objects, object.parentId)),
      `parent ${id}`,
    );
    requireValue(
      ['rectangle', 'ellipse', 'diamond', 'frame'].includes(
        String(object.type),
      ) && typeof object.name === 'string',
      `object kind/name ${id}`,
    );
    validateGeometry(object.geometry, `geometry ${id}`);
    validateContent(object.content);
    if (object.style !== undefined) map(object.style, `style ${id}`);
    if (object.boundaryPoints !== undefined) {
      map(object.boundaryPoints, `boundary points ${id}`);
      for (const point of Object.values(object.boundaryPoints))
        boundary(point, `boundary point ${id}`);
    }
  }
  const hierarchy = indexHierarchy(
    objects as unknown as Record<string, DiagramObject>,
  );
  const forest = hierarchy.entries;
  const roots = hierarchy.roots;
  requireValue(
    Object.keys(value.rootDepths).length === roots.length &&
      Object.keys(value.layouts).length === roots.length,
    'root maps',
  );
  for (const root of roots) {
    const members = hierarchy.byRoot.get(root)!;
    const maximum = hierarchy.maximum.get(root)!;
    const depth = value.rootDepths[root];
    requireValue(
      Number.isInteger(depth) && Number(depth) >= 0 && Number(depth) <= maximum,
      `selected depth ${root}`,
    );
    const layouts = value.layouts[root];
    map(layouts, `layouts ${root}`);
    requireValue(
      Object.hasOwn(layouts, '0') && Object.hasOwn(layouts, String(depth)),
      `selected/zero layout ${root}`,
    );
    for (const [key, layout] of Object.entries(layouts)) {
      requireValue(
        /^(0|[1-9]\d*)$/.test(key) && Number.isSafeInteger(Number(key)),
        `layout depth ${root}`,
      );
      map(layout, `layout ${root}/${key}`);
      for (const [id, geometry] of Object.entries(layout)) {
        requireValue(
          forest.get(id)?.root === root,
          `layout object ${root}/${key}/${id}`,
        );
        validateGeometry(geometry, `layout geometry ${id}`);
      }
      for (const id of members)
        if (forest.get(id)!.generation <= Number(key))
          requireValue(
            Object.hasOwn(layout, id),
            `missing layout geometry ${root}/${key}/${id}`,
          );
    }
  }
  if (value.connectionRepairs !== undefined) {
    map(value.connectionRepairs, 'connection repairs');
    for (const [id, repair] of Object.entries(value.connectionRepairs)) {
      requireValue(
        isRecord(repair) &&
          typeof repair.reason === 'string' &&
          repair.reason.length > 0 &&
          !Object.hasOwn(value.connections, id),
        `connection repair ${id}`,
      );
      validateConnection(repair.connection, id);
      if (repair.ownerGeometry !== null) validateGeometry(repair.ownerGeometry);
      for (const point of [repair.start, repair.end])
        requireValue(
          isRecord(point) && finite(point.x) && finite(point.y),
          `repair position ${id}`,
        );
    }
  }
  for (const [id, connection] of Object.entries(value.connections)) {
    validateConnection(connection, id);
    requireValue(
      connection.ownerId === null || Object.hasOwn(objects, connection.ownerId),
      `connection owner ${id}`,
    );
    for (const end of [connection.start, connection.end]) {
      if (end.kind === 'free') continue;
      requireValue(
        Object.hasOwn(objects, end.objectId),
        `endpoint target ${id}`,
      );
      if (end.kind === 'boundary') {
        const points = (objects[end.objectId] as unknown as DiagramObject)
          .boundaryPoints;
        requireValue(
          points && Object.hasOwn(points, end.pointId),
          `endpoint boundary ${id}`,
        );
      }
      if (connection.ownerId !== null) {
        let cursor: string | null = end.objectId;
        while (cursor !== null && cursor !== connection.ownerId)
          cursor = (objects[cursor] as unknown as DiagramObject).parentId;
        requireValue(
          cursor === connection.ownerId,
          `endpoint outside owner ${id}`,
        );
      }
    }
  }
}
export function createRecursiveDocument(
  id: string,
  title: string,
  now = new Date().toISOString(),
): RecursiveDocument {
  return {
    formatVersion: 2,
    id,
    metadata: { title, created: now, modified: now },
    objects: {},
    rootDepths: {},
    layouts: {},
    connections: {},
  };
}
