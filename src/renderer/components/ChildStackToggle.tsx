import { useEffect, useRef, useState } from 'react';
import { Group, Path, Rect } from 'react-konva';
import type { Group as KonvaGroup, GroupConfig } from 'konva/lib/Group';
import stack2 from '../assets/icons/square-stack-2.svg?raw';
import stack3 from '../assets/icons/square-stack-3.svg?raw';

// Reuse the same SVG paths and transforms as the toolbar symbols.
const icons = Object.fromEntries(
  [stack2, stack3].map((svg, i) => {
    const root = new DOMParser().parseFromString(svg, 'image/svg+xml');
    const matrix = new DOMMatrix(
      root.querySelector('g')!.getAttribute('transform')!,
    );
    return [
      `square-stack-${i + 2}`,
      {
        paths: [...root.querySelectorAll('path')].map((path) =>
          path.getAttribute('d')!,
        ),
        transform: {
          x: 4 + matrix.e,
          y: 4 + matrix.f,
          scaleX: matrix.a,
          scaleY: matrix.d,
        },
      },
    ];
  }),
);

export default function ChildStackToggle({
  icon,
  expanded,
  disabled,
  focused,
  title,
  onToggle,
  ...placement
}: GroupConfig & {
  icon: string;
  expanded: boolean;
  disabled: boolean;
  focused: boolean;
  title: string;
  onToggle: (event: MouseEvent) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const ref = useRef<KonvaGroup>(null);
  useEffect(() => {
    if (!hovered || disabled) return;
    const container = ref.current!.getStage()!.container();
    container.title = title;
    container.style.cursor = 'pointer';
    return () => {
      container.title = '';
      container.style.cursor = '';
    };
  }, [hovered, disabled, title]);
  return (
    <Group
      ref={ref}
      {...placement}
      name="child-stack-toggle"
      listening={!disabled}
      onMouseDown={(event) => {
        event.cancelBubble = true;
      }}
      onClick={(event) => {
        event.cancelBubble = true;
        if (event.evt.button === 0) onToggle(event.evt);
      }}
      onContextMenu={(event) => {
        event.cancelBubble = true;
        onToggle(event.evt);
      }}
      onDblClick={(event) => event.evt.stopPropagation()}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <Rect
        width={32}
        height={32}
        cornerRadius={6}
        fill={expanded ? '#eaf0ff' : '#ffffff'}
        stroke={
          focused || hovered ? '#2d62d5' : expanded ? 'transparent' : '#dbe2ec'
        }
        strokeWidth={focused ? 2 : 1}
      />
      <Group {...icons[icon].transform} listening={false}>
        {icons[icon].paths.map((data) => (
          <Path
            key={data}
            data={data}
            fill={expanded ? '#2d62d5' : '#5d6b7e'}
          />
        ))}
      </Group>
    </Group>
  );
}
