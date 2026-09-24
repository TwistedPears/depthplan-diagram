import { memo, useMemo } from 'react';
import { Circle, Group, Line, Rect, Text } from 'react-konva';
import type { DiagramConnection } from '../../shared/recursiveDocument';
import {
  labelSize,
  type ConnectionRoute,
} from '../../shared/connectionGeometry';

let paintContext: CanvasRenderingContext2D | null = null;

function Marker({
  value,
  stroke,
  width,
  background,
}: {
  value: string;
  stroke: string;
  width: number;
  background: string;
}) {
  const paint = {
    stroke,
    strokeWidth: width,
    lineCap: 'round' as const,
    lineJoin: 'round' as const,
  };
  const bar = (x: number) => <Line {...paint} points={[x, -6, x, 6]} />;
  const circle = (x: number, filled = false) => (
    <Circle {...paint} x={x} radius={4} fill={filled ? stroke : background} />
  );
  if (value === 'none') return null;
  if (value === 'arrow')
    return <Line {...paint} points={[-12, -6, 0, 0, -12, 6]} />;
  if (value === 'bar') return bar(0);
  if (value.startsWith('circle')) return circle(0, value === 'circle');
  if (value.startsWith('triangle'))
    return (
      <Line
        {...paint}
        points={[0, 0, -12, -6, -12, 6]}
        closed
        fill={value === 'triangle' ? stroke : background}
      />
    );
  if (value.startsWith('diamond'))
    return (
      <Line
        {...paint}
        points={[0, 0, -8, -5, -16, 0, -8, 5]}
        closed
        fill={value === 'diamond' ? stroke : background}
      />
    );
  const many = value.includes('many');
  const zero = value.includes('zero');
  const double = value === 'cardinality_exactly_one';
  return (
    <Group>
      {many ? <Line {...paint} points={[0, -7, -12, 0, 0, 7]} /> : bar(0)}
      {many && <Line {...paint} points={[-12, 0, 0, 0]} />}
      {zero
        ? circle(-20)
        : value.includes('one_or_many') || double
          ? bar(-18)
          : null}
    </Group>
  );
}

function ConnectionPaint({
  connection: c,
  route,
  scale = 1,
  editingLabel = false,
}: {
  connection: DiagramConnection;
  route: ConnectionRoute;
  scale?: number;
  editingLabel?: boolean;
}) {
  const stroke =
    typeof c.style?.stroke === 'string' ? c.style.stroke : '#475569';
  const width =
    typeof c.style?.strokeWidth === 'number'
      ? Math.max(0, c.style.strokeWidth)
      : 2;
  const { points, bezier } = route;
  const background = useMemo(() => {
    paintContext ??= document
      .createElement('canvas')
      .getContext('2d', { willReadFrequently: true })!;
    paintContext.clearRect(0, 0, 1, 1);
    paintContext.fillStyle = stroke;
    paintContext.fillRect(0, 0, 1, 1);
    return `rgba(255,255,255,${paintContext.getImageData(0, 0, 1, 1).data[3] / 255})`;
  }, [stroke]);
  const size = useMemo(() => {
    const size = labelSize(c.label ?? '');
    if (!c.label) return size;
    paintContext!.font = '14px Arial';
    return {
      ...size,
      width:
        Math.max(
          40,
          ...c.label
            .split('\n')
            .map((line) => paintContext!.measureText(line).width),
        ) + 12,
    };
  }, [c.label]);
  return (
    <Group
      id={`connection-${c.id}`}
      name="recursive-connection"
      opacity={typeof c.style?.opacity === 'number' ? c.style.opacity : 1}
    >
      <Line
        name="connection-path"
        points={points}
        bezier={bezier}
        stroke={stroke}
        strokeWidth={width}
        lineCap="round"
        lineJoin="round"
        hitStrokeWidth={Math.max(10 / scale, width)}
        dash={
          c.style?.strokeStyle === 'dashed'
            ? [8, 6]
            : c.style?.strokeStyle === 'dotted'
              ? [2, 4]
              : []
        }
      />
      {c.label && !editingLabel && (
        <Group
          x={route.label.x - size.width / 2}
          y={route.label.y - size.height / 2}
          name="connection-label"
        >
          <Rect
            width={size.width}
            height={size.height}
            fill={background}
            cornerRadius={3}
          />
          <Text
            x={6}
            y={4}
            width={size.width - 12}
            height={size.height - 8}
            text={c.label}
            fontSize={14}
            lineHeight={18 / 14}
            align="center"
            fill={stroke}
          />
        </Group>
      )}
      {(['Start', 'End'] as const).map((end) => {
        const tip = end === 'Start' ? route.route[0] : route.route.at(-1)!;
        const previous =
          end === 'Start'
            ? route.route.find((p) => p.x !== tip.x || p.y !== tip.y)
            : [...route.route]
                .reverse()
                .find((p) => p.x !== tip.x || p.y !== tip.y);
        const value =
          c.style?.[`arrowhead${end}`] ??
          (end === 'End' && c.kind === 'arrow' ? 'arrow' : 'none');
        return (
          <Group
            key={end}
            name={`connection-marker-${end.toLowerCase()}`}
            markerType={value}
            x={tip.x}
            y={tip.y}
            rotation={
              previous
                ? (Math.atan2(tip.y - previous.y, tip.x - previous.x) * 180) /
                  Math.PI
                : 0
            }
            scaleX={Math.max(1, width / 2)}
            scaleY={Math.max(1, width / 2)}
          >
            <Marker
              background={background}
              value={String(value)}
              stroke={stroke}
              width={Math.min(2, width)}
            />
          </Group>
        );
      })}
    </Group>
  );
}

export default memo(
  ConnectionPaint,
  (before, after) =>
    before.connection === after.connection &&
    before.scale === after.scale &&
    before.editingLabel === after.editingLabel &&
    // Scene construction creates fresh, plain-data routes for stationary edges too.
    JSON.stringify(before.route) === JSON.stringify(after.route),
);
