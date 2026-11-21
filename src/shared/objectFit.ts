import type {
  DiagramObject,
  RecursiveDocument,
  RichBlock,
} from './recursiveDocument';
import { objectContentBounds } from './objectContentBounds';
import { layoutRichContent, type TextStyle } from './richContentLayout';
import { measureText } from './textMeasure';
import { indexHierarchy } from './recursiveHierarchy';
import { recursiveVisibility } from './recursiveVisibility';
import { arrangeExpansion } from './expansionArrangement';
import { isLegend, legendContent } from './tags';

type Measure = (text: string, style: TextStyle) => number;
export const fitModes = ['clip', 'grow-height', 'shrink-text'] as const;
export type FitMode = (typeof fitModes)[number];
export const objectFit = (object: DiagramObject): FitMode =>
  fitModes.includes(object.style?.fit as FitMode)
    ? (object.style!.fit as FitMode)
    : 'clip';
/** Smallest uniform text scale before shrink-text clips and reports overflow. */
export const SHRINK_FLOOR = 0.6;
// The canvas skips a body this short or shorter.
const MIN_BODY = 10;
const SLACK = 0.5;

export function contentHeight(
  content: RichBlock[],
  width: number,
  measure: Measure = measureText,
) {
  return Math.max(0, layoutRichContent(content, width, measure).height - 6);
}

/** Largest scale in [SHRINK_FLOOR, 1] at which the body text fits, laid out at width / scale. */
export function shrinkScale(
  content: RichBlock[],
  width: number,
  height: number,
  measure: Measure = measureText,
) {
  const fits = (scale: number) =>
    contentHeight(content, width / scale, measure) * scale <= height + SLACK;
  if (fits(1)) return { scale: 1, overflow: false };
  if (!fits(SHRINK_FLOOR)) return { scale: SHRINK_FLOOR, overflow: true };
  let low = SHRINK_FLOOR,
    high = 1;
  for (let pass = 0; pass < 8; pass++) {
    const mid = (low + high) / 2;
    if (fits(mid)) low = mid;
    else high = mid;
  }
  return { scale: low, overflow: false };
}

/** Body text scale and vertical overflow, using the bounds and metric the canvas paints with. */
export function bodyFit(
  object: DiagramObject,
  content: RichBlock[],
  width: number,
  height: number,
  hasChildren: boolean,
  expanded: boolean,
  measure: Measure = measureText,
) {
  if (expanded || !content.length) return { scale: 1, overflow: false };
  const { body } = objectContentBounds(object, width, height, hasChildren);
  if (body.width <= 0 || body.height <= MIN_BODY)
    return { scale: 1, overflow: true };
  if (objectFit(object) === 'shrink-text')
    return shrinkScale(content, body.width, body.height, measure);
  return {
    scale: 1,
    overflow: contentHeight(content, body.width, measure) > body.height + SLACK,
  };
}

/** Active-layout overflow for each visible object whose body is painted. */
export function overflowingObjects(
  document: RecursiveDocument,
  measure: Measure = measureText,
) {
  const hierarchy = indexHierarchy(document.objects);
  const { visible, expanded } = recursiveVisibility(document, hierarchy);
  const legend = Object.values(document.objects).some(isLegend)
    ? legendContent(document)
    : undefined;
  const result = new Set<string>();
  for (const id of visible) {
    const object = document.objects[id];
    const { root } = hierarchy.entries.get(id)!;
    const geometry = document.layouts[root][document.rootDepths[root]][id];
    if (
      bodyFit(
        object,
        isLegend(object) ? legend! : object.content,
        geometry.width,
        geometry.height,
        hierarchy.children.has(id),
        expanded.has(id),
        measure,
      ).overflow
    )
      result.add(id);
  }
  return result;
}

/** grow-height: in the same transaction, grow (never shrink) an object's active-layout height
 * when its text, name, tags, shape, width or fit changed and the body no longer fits. The top
 * edge stays fixed; parents and neighbors make room through the auto-arrange rules. */
export function growFitHeights(
  before: RecursiveDocument,
  draft: RecursiveDocument,
  measure: Measure = measureText,
) {
  const candidates = Object.keys(draft.objects).filter(
    (id) => objectFit(draft.objects[id]) === 'grow-height',
  );
  if (!candidates.length) return;
  const hierarchy = indexHierarchy(draft.objects);
  const { visible, expanded } = recursiveVisibility(draft, hierarchy);
  let legend: RichBlock[] | undefined, previousLegend: RichBlock[] | undefined;
  const contentOf = (document: RecursiveDocument, object: DiagramObject) =>
    !isLegend(object)
      ? object.content
      : document === draft
        ? (legend ??= legendContent(draft))
        : (previousLegend ??= legendContent(before));
  const grown = new Set<string>();
  for (const id of candidates) {
    if (!visible.has(id) || expanded.has(id)) continue;
    const object = draft.objects[id];
    const { root } = hierarchy.entries.get(id)!;
    const depth = draft.rootDepths[root];
    const geometry = draft.layouts[root][depth][id];
    const content = contentOf(draft, object);
    const old = before.objects[id];
    const oldGeometry = old && before.layouts[root]?.[depth]?.[id];
    if (
      oldGeometry &&
      objectFit(old) === 'grow-height' &&
      old.type === object.type &&
      old.name === object.name &&
      !!old.tags?.length === !!object.tags?.length &&
      oldGeometry.width === geometry.width &&
      JSON.stringify(contentOf(before, old)) === JSON.stringify(content)
    )
      continue;
    if (!content.length) continue;
    const body = (height: number) =>
      objectContentBounds(object, geometry.width, height, false).body;
    if (body(geometry.height).width <= 0) continue;
    const need = Math.max(
      contentHeight(content, body(geometry.height).width, measure),
      MIN_BODY + 1,
    );
    let height = geometry.height;
    // Body height is piecewise linear in object height; two steps settle it.
    for (let pass = 0; pass < 4 && body(height).height < need; pass++)
      height +=
        (need - body(height).height) /
        Math.max(0.1, body(height + 1).height - body(height).height);
    height = Math.ceil(height);
    if (height <= geometry.height) continue;
    const grow = height - geometry.height,
      angle = (geometry.rotation * Math.PI) / 180;
    geometry.x -= (Math.sin(angle) * grow) / 2;
    geometry.y += (Math.cos(angle) * grow) / 2;
    geometry.height = height;
    grown.add(id);
  }
  if (grown.size) arrangeExpansion(draft, grown);
}
