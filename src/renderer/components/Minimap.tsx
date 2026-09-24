import Konva from 'konva';
import { useCallback, useMemo, useRef } from 'react';
import { Layer, Rect, Stage } from 'react-konva';
import type { Bounds } from '../../shared/recursiveCamera';

interface MinimapProps {
  blocks: ReadonlyMap<string, Bounds>;
  containerSize: { width: number; height: number };
  viewBox: { x: number; y: number; scale: number };
  onViewBoxChange: (newViewBox: { x: number; y: number }) => void;
}

const MINIMAP_WIDTH = 200;
const MINIMAP_HEIGHT = 150;
const MINIMAP_SCALE_FACTOR = 4; // Show 4x the area of the current viewport

function Minimap({
  blocks,
  containerSize,
  viewBox,
  onViewBoxChange,
}: MinimapProps) {
  const stageRef = useRef<Konva.Stage>(null);

  // Calculate the world area that the minimap should show
  const minimapWorldArea = useMemo(() => {
    // Current viewport size in world coordinates
    const viewportWorldWidth = containerSize.width / viewBox.scale;
    const viewportWorldHeight = containerSize.height / viewBox.scale;

    // Minimap should show MINIMAP_SCALE_FACTOR times larger area
    const minimapWorldWidth = viewportWorldWidth * MINIMAP_SCALE_FACTOR;
    const minimapWorldHeight = viewportWorldHeight * MINIMAP_SCALE_FACTOR;

    // Center of current viewport in world coordinates
    const viewportCenterX = -viewBox.x / viewBox.scale + viewportWorldWidth / 2;
    const viewportCenterY =
      -viewBox.y / viewBox.scale + viewportWorldHeight / 2;

    // Minimap world bounds (centered on current viewport)
    const minimapWorldLeft = viewportCenterX - minimapWorldWidth / 2;
    const minimapWorldTop = viewportCenterY - minimapWorldHeight / 2;

    return {
      left: minimapWorldLeft,
      top: minimapWorldTop,
      width: minimapWorldWidth,
      height: minimapWorldHeight,
      centerX: viewportCenterX,
      centerY: viewportCenterY,
    };
  }, [containerSize, viewBox]);

  // Calculate scale to fit the minimap world area into the minimap display
  const minimapDisplayScale = useMemo(() => {
    const scaleX = MINIMAP_WIDTH / minimapWorldArea.width;
    const scaleY = MINIMAP_HEIGHT / minimapWorldArea.height;
    return Math.min(scaleX, scaleY);
  }, [minimapWorldArea]);

  // Transform blocks to minimap coordinates
  const minimapBlocks = useMemo(() => {
    return [...blocks]
      .filter(([, block]) => {
        // Only show blocks that are within or near the minimap area
        const blockRight = block.x + block.width;
        const blockBottom = block.y + block.height;
        const areaRight = minimapWorldArea.left + minimapWorldArea.width;
        const areaBottom = minimapWorldArea.top + minimapWorldArea.height;

        return (
          blockRight >= minimapWorldArea.left &&
          block.x <= areaRight &&
          blockBottom >= minimapWorldArea.top &&
          block.y <= areaBottom
        );
      })
      .map(([id, block]) => ({
        id,
        x: (block.x - minimapWorldArea.left) * minimapDisplayScale,
        y: (block.y - minimapWorldArea.top) * minimapDisplayScale,
        width: Math.max(2, block.width * minimapDisplayScale),
        height: Math.max(2, block.height * minimapDisplayScale),
      }));
  }, [blocks, minimapWorldArea, minimapDisplayScale]);

  // Handle minimap click to change viewport
  const handleMinimapClick = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;

    const pos = stage.getPointerPosition();
    if (!pos) return;

    // Convert minimap display coordinates to world coordinates
    const worldX = minimapWorldArea.left + pos.x / minimapDisplayScale;
    const worldY = minimapWorldArea.top + pos.y / minimapDisplayScale;

    // Calculate new pan to center the clicked point in the viewport
    const newPanX = containerSize.width / 2 - worldX * viewBox.scale;
    const newPanY = containerSize.height / 2 - worldY * viewBox.scale;

    onViewBoxChange({ x: newPanX, y: newPanY });
  }, [
    minimapWorldArea,
    minimapDisplayScale,
    containerSize,
    viewBox.scale,
    onViewBoxChange,
  ]);

  return (
    <div
      style={{
        position: 'absolute',
        top: '20px',
        right: '20px',
        width: MINIMAP_WIDTH,
        height: MINIMAP_HEIGHT,
        background: 'rgba(40, 44, 52, 0.95)',
        border: '1px solid #555',
        borderRadius: '8px',
        overflow: 'hidden',
        boxShadow: '0 2px 12px rgba(0,0,0,0.3)',
        zIndex: 1000,
      }}
    >
      <Stage
        ref={stageRef}
        width={MINIMAP_WIDTH}
        height={MINIMAP_HEIGHT}
        onClick={handleMinimapClick}
        onTap={handleMinimapClick}
      >
        {/* Background */}
        <Layer>
          <Rect
            x={0}
            y={0}
            width={MINIMAP_WIDTH}
            height={MINIMAP_HEIGHT}
            fill="#2c3e50"
            listening={false}
          />
        </Layer>

        {/* Blocks */}
        <Layer>
          {minimapBlocks.map((block) => (
            <Rect
              key={block.id}
              x={block.x}
              y={block.y}
              width={block.width}
              height={block.height}
              fill="#95a5a6"
              stroke="#7f8c8d"
              strokeWidth={0.5}
              listening={false}
            />
          ))}
        </Layer>

        {/* Center crosshair to show current viewport center */}
        <Layer>
          <Rect
            x={MINIMAP_WIDTH / 2 - 1}
            y={MINIMAP_HEIGHT / 2 - 6}
            width={2}
            height={12}
            fill="#e74c3c"
            listening={false}
          />
          <Rect
            x={MINIMAP_WIDTH / 2 - 6}
            y={MINIMAP_HEIGHT / 2 - 1}
            width={12}
            height={2}
            fill="#e74c3c"
            listening={false}
          />
        </Layer>
      </Stage>

      {/* Minimap label */}
      <div
        style={{
          position: 'absolute',
          bottom: '4px',
          left: '4px',
          fontSize: '10px',
          color: '#bdc3c7',
          background: 'rgba(0, 0, 0, 0.6)',
          padding: '2px 4px',
          borderRadius: '2px',
        }}
      >
        Minimap ({MINIMAP_SCALE_FACTOR}x)
      </div>

      {/* Center coordinates display */}
      <div
        style={{
          position: 'absolute',
          bottom: '4px',
          right: '4px',
          fontSize: '9px',
          color: '#95a5a6',
          background: 'rgba(0, 0, 0, 0.5)',
          padding: '2px 4px',
          borderRadius: '2px',
          fontFamily: 'monospace',
          opacity: 0.8,
        }}
      >
        {Math.round(minimapWorldArea.centerX)},{' '}
        {Math.round(minimapWorldArea.centerY)}
      </div>
    </div>
  );
}

export default Minimap;
