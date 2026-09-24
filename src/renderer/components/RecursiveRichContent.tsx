import { memo, useMemo } from 'react';
import { Group, Text, Line } from 'react-konva';
import { type RichBlock, validLink } from '../../shared/recursiveDocument';
import { layoutRichContent, textFont } from '../../shared/richContentLayout';
let context: CanvasRenderingContext2D | null = null;
export default memo(function RecursiveRichContent({
  content,
  x,
  y,
  width,
  height,
  onError,
}: {
  content: RichBlock[];
  x: number;
  y: number;
  width: number;
  height: number;
  onError: (message: string) => void;
}) {
  const layout = useMemo(() => {
    context ??= document.createElement('canvas').getContext('2d')!;
    return layoutRichContent(
      content,
      width,
      (text, style) => {
        context!.font = textFont(style);
        return context!.measureText(text).width;
      },
      height,
    );
  }, [content, width, height]);
  return (
    <Group
      name="object-content"
      x={x}
      y={y}
      clipX={0}
      clipY={0}
      clipWidth={width}
      clipHeight={height}
    >
      {layout.rules.map((rule, at) => (
        <Line
          key={`rule-${at}`}
          points={[rule.x, rule.y, rule.x, rule.y + rule.height]}
          stroke="#94a3b8"
          strokeWidth={2}
          listening={false}
        />
      ))}
      {layout.pieces.map((piece, at) => (
        <Text
          key={at}
          name="rich-text-run"
          x={piece.x}
          y={piece.y}
          text={piece.text}
          fontFamily={piece.style.font}
          fontSize={piece.style.size}
          fontStyle={`${piece.style.italic ? 'italic ' : ''}${piece.style.bold ? 'bold' : 'normal'}`}
          textDecoration={[
            piece.style.underline || piece.style.link ? 'underline' : '',
            piece.style.strike ? 'line-through' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          fill={piece.style.color}
          listening={!!piece.style.link}
          onMouseDown={(event) => {
            if (event.evt.metaKey || event.evt.ctrlKey)
              event.cancelBubble = true;
          }}
          onClick={(event) => {
            if (!(event.evt.metaKey || event.evt.ctrlKey)) return;
            event.cancelBubble = true;
            const link = piece.style.link;
            if (validLink(link))
              void window.desktop
                .openLink(link)
                .catch(() => onError('Could not open this link.'));
          }}
        />
      ))}
    </Group>
  );
});
