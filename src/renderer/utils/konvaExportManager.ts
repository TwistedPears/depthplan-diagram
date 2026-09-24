import type Konva from 'konva';
import { hatchPath } from './shapeFill';

const SVG_NS = 'http://www.w3.org/2000/svg';
function element(
  tag: string,
  attributes: Record<string, string | number | undefined> = {},
) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (value !== undefined) node.setAttribute(key, String(value));
  }
  return node;
}

function textElement(text: Konva.Text) {
  const font = text.fontStyle();
  const node = element('text', {
    'font-family': text.fontFamily(),
    'font-size': text.fontSize(),
    'font-weight': font.match(/bold|[1-9]00/)?.[0] ?? 'normal',
    'font-style': font.includes('italic') ? 'italic' : 'normal',
    'font-variant': text.fontVariant(),
    'text-decoration': text.textDecoration(),
    'letter-spacing': text.letterSpacing(),
  });
  node.setAttributeNS(
    'http://www.w3.org/XML/1998/namespace',
    'xml:space',
    'preserve',
  );
  const padding = text.padding();
  const lineHeight = text.lineHeight() * text.fontSize();
  const metrics = text.measureSize('M');
  // Match Konva 10's alphabetic baseline and already-wrapped visible lines.
  const baseline =
    ((metrics.fontBoundingBoxAscent ?? metrics.actualBoundingBoxAscent) -
      (metrics.fontBoundingBoxDescent ?? metrics.actualBoundingBoxDescent)) /
      2 +
    lineHeight / 2;
  const freeHeight =
    text.height() - text.textArr.length * lineHeight - padding * 2;
  const yOffset =
    text.verticalAlign() === 'middle'
      ? freeHeight / 2
      : text.verticalAlign() === 'bottom'
        ? freeHeight
        : 0;
  text.textArr.forEach((line, index) => {
    const freeWidth = text.width() - padding * 2 - line.width;
    const xOffset =
      text.align() === 'center'
        ? freeWidth / 2
        : text.align() === 'right'
          ? freeWidth
          : 0;
    const spaces = line.text.split(' ').length - 1;
    const span = element('tspan', {
      x: padding + xOffset,
      y: padding + yOffset + baseline + index * lineHeight,
      'word-spacing':
        text.align() === 'justify' && !line.lastInParagraph && spaces
          ? freeWidth / spaces
          : undefined,
    });
    // DOM serialization escapes imported text rather than interpreting markup.
    span.textContent = line.text;
    node.append(span);
  });
  return node;
}

/** Serialize the rendered scene, preserving editable shapes, text and transforms. */
export function captureKonvaStage(stage: Konva.Stage | Konva.Group): string {
  const svg = element('svg', {
    width: stage.width(),
    height: stage.height(),
    viewBox: `0 0 ${stage.width()} ${stage.height()}`,
  });
  const definitions = element('defs');
  svg.append(definitions);
  let shadowIndex = 0;

  function serialize(node: Konva.Node): SVGElement | null {
    if (!node.visible() || node.opacity() === 0) return null;
    const type = node.getClassName();
    let output: SVGElement;
    switch (type) {
      case 'Stage':
      case 'Layer':
      case 'Group': {
        output = element('g');
        for (const child of (node as Konva.Container).getChildren()) {
          const serialized = serialize(child);
          if (serialized) output.append(serialized);
        }
        break;
      }
      case 'Rect': {
        const rect = node as Konva.Rect;
        const radius = rect.cornerRadius();
        // Every rectangle produced by DepthPlan uses one uniform corner radius.
        if (Array.isArray(radius))
          throw new Error('Unsupported rectangle corner radii');
        output = element('rect', {
          width: rect.width(),
          height: rect.height(),
          rx: Math.min(radius, rect.width() / 2, rect.height() / 2),
        });
        break;
      }
      case 'Ellipse': {
        const ellipse = node as Konva.Ellipse;
        output = element('ellipse', {
          rx: ellipse.radiusX(),
          ry: ellipse.radiusY(),
        });
        break;
      }
      case 'Circle':
        output = element('circle', { r: (node as Konva.Circle).radius() });
        break;
      case 'RegularPolygon': {
        const polygon = node as Konva.RegularPolygon;
        const points = Array.from({ length: polygon.sides() }, (_, index) => {
          const angle = (index * Math.PI * 2) / polygon.sides();
          return `${polygon.radius() * Math.sin(angle)},${-polygon.radius() * Math.cos(angle)}`;
        }).join(' ');
        output = element('polygon', { points });
        break;
      }
      case 'Line':
      case 'Arrow': {
        const line = node as Konva.Line;
        const points = line.points();
        if (line.tension()) throw new Error('Unsupported tension scene path');
        output = element('g');
        const commands = [];
        for (let index = 0; index < points.length; index += 2) {
          commands.push(
            `${index ? (line.bezier() ? ((index - 2) % 6 === 0 ? 'C' : '') : 'L') : 'M'}${points[index]} ${points[index + 1]}`,
          );
        }
        output.append(
          element('path', {
            d: commands.join(' ') + (line.closed() ? ' Z' : ''),
            fill: line.closed() ? undefined : 'none',
          }),
        );
        if (type === 'Arrow' && points.length >= 4) {
          const arrow = node as Konva.Arrow;
          const tip = (index: number, previous: number) => {
            const angle =
              (Math.atan2(
                index === 0
                  ? -(points[previous + 1] - points[index + 1])
                  : points[index + 1] - points[previous + 1],
                index === 0
                  ? -(points[previous] - points[index])
                  : points[index] - points[previous],
              ) *
                180) /
              Math.PI;
            return element('polygon', {
              points: `0,0 ${-arrow.pointerLength()},${arrow.pointerWidth() / 2} ${-arrow.pointerLength()},${-arrow.pointerWidth() / 2}`,
              transform: `translate(${points[index]} ${points[index + 1]}) rotate(${angle})`,
              'stroke-dasharray': 'none',
            });
          };
          if (arrow.pointerAtBeginning()) output.append(tip(0, 2));
          if (arrow.pointerAtEnding())
            output.append(tip(points.length - 2, points.length - 4));
        }
        break;
      }
      case 'Text':
        output = textElement(node as Konva.Text);
        break;
      default:
        throw new Error(`Unsupported SVG scene node: ${type}`);
    }
    output.setAttribute(
      'transform',
      `matrix(${node.getTransform().getMatrix().join(' ')})`,
    );
    if (['Group', 'Layer'].includes(type)) {
      const container = node as Konva.Container;
      if (
        container.clipWidth() !== undefined &&
        container.clipHeight() !== undefined
      ) {
        const id = `clip-${definitions.childElementCount}`;
        const clip = element('clipPath', {
          id,
          clipPathUnits: 'userSpaceOnUse',
        });
        clip.append(
          element('rect', {
            x: container.clipX() ?? 0,
            y: container.clipY() ?? 0,
            width: container.clipWidth(),
            height: container.clipHeight(),
          }),
        );
        definitions.append(clip);
        output.setAttribute('clip-path', `url(#${id})`);
      }
    }
    if (node.opacity() !== 1)
      output.setAttribute('opacity', String(node.opacity()));
    if (node.id()) output.setAttribute('id', node.id());
    if (!['Stage', 'Layer', 'Group'].includes(type)) {
      const shape = node as Konva.Shape;
      const fill = shape.fill();
      const stroke = shape.stroke();
      output.setAttribute(
        'fill',
        shape.fillEnabled() &&
          typeof fill === 'string' &&
          CSS.supports('color', fill)
          ? fill
          : 'none',
      );
      const fillType = shape.getAttr('fillType');
      if (
        shape.fillEnabled() &&
        typeof fill === 'string' &&
        CSS.supports('color', fill) &&
        (fillType === 'hachure' || fillType === 'cross-hatch')
      ) {
        const id = `hatch-${definitions.childElementCount}`;
        const pattern = element('pattern', {
          id,
          width: 12,
          height: 12,
          patternUnits: 'userSpaceOnUse',
        });
        pattern.append(
          element('path', {
            d: hatchPath(fillType === 'cross-hatch'),
            fill: 'none',
            stroke: String(fill),
            'stroke-width': 1.5,
          }),
        );
        definitions.append(pattern);
        output.setAttribute('fill', `url(#${id})`);
      }
      output.setAttribute(
        'stroke',
        shape.strokeEnabled() &&
          typeof stroke === 'string' &&
          CSS.supports('color', stroke)
          ? stroke
          : 'none',
      );
      output.setAttribute('stroke-width', String(shape.strokeWidth()));
      output.setAttribute('stroke-linecap', shape.lineCap());
      output.setAttribute('stroke-linejoin', shape.lineJoin());
      if (shape.dashEnabled() && shape.dash()?.length)
        output.setAttribute('stroke-dasharray', shape.dash().join(' '));
      if (!shape.strokeScaleEnabled())
        output.setAttribute('vector-effect', 'non-scaling-stroke');
      if (shape.hasShadow()) {
        const id = `shadow-${++shadowIndex}`;
        const filter = element('filter', {
          id,
          x: '-100%',
          y: '-100%',
          width: '300%',
          height: '300%',
        });
        filter.append(
          element('feDropShadow', {
            dx: shape.shadowOffsetX(),
            dy: shape.shadowOffsetY(),
            stdDeviation: shape.shadowBlur() / 2,
            'flood-color': shape.shadowColor(),
            'flood-opacity': shape.shadowOpacity(),
          }),
        );
        definitions.append(filter);
        output.setAttribute('filter', `url(#${id})`);
      }
    }
    return output;
  }
  const scene = serialize(stage);
  if (scene) svg.append(scene);
  if (!definitions.childElementCount) definitions.remove();
  return new XMLSerializer().serializeToString(svg);
}
