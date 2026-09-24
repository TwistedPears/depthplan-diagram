import { Ellipse, Line, Rect } from 'react-konva';
import { useMemo } from 'react';
import { hatchTile } from '../utils/shapeFill';
import type { ShapeConfig } from 'konva/lib/Shape';
import type { DiagramObject, Geometry } from '../../shared/recursiveDocument';

export default function ObjectOutline({
  object,
  geometry,
  ...paint
}: ShapeConfig & {
  object: DiagramObject;
  geometry: Pick<Geometry, 'width' | 'height'>;
}) {
  const { width, height } = geometry;
  const fillType = object.style?.fillType;
  const color = typeof paint.fill === 'string' ? paint.fill : '#ffffff';
  const pattern = useMemo(() => hatchTile(fillType, color), [fillType, color]);
  paint = {
    ...paint,
    fill: fillType === 'none' ? 'transparent' : paint.fill,
    fillPriority: pattern ? 'pattern' : 'color',
    // Konva's canvas pattern API accepts canvases; its public setter type is narrower.
    fillPatternImage: pattern as unknown as HTMLImageElement | undefined,
    fillType: pattern ? fillType : undefined,
  };
  if (object.type === 'ellipse')
    return <Ellipse {...paint} radiusX={width / 2} radiusY={height / 2} />;
  if (object.type === 'diamond')
    return (
      <Line
        {...paint}
        points={[0, -height / 2, width / 2, 0, 0, height / 2, -width / 2, 0]}
        closed
      />
    );
  return (
    <Rect
      {...paint}
      x={-width / 2}
      y={-height / 2}
      width={width}
      height={height}
      cornerRadius={
        typeof object.style?.cornerRadius === 'number'
          ? object.style.cornerRadius
          : 0
      }
    />
  );
}
