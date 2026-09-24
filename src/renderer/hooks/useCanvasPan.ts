import { useEffect, type RefObject } from 'react';
import type Konva from 'konva';
import { ToolMode } from '../types/CanvasTools';

export default function useCanvasPan(
  stageRef: RefObject<Konva.Stage | null>,
  tool: ToolMode,
) {
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const container = stage.container();
    const down = (event: MouseEvent) => {
      if (
        (tool !== ToolMode.POINTER && tool !== ToolMode.HAND) ||
        (event.button !== 2 && !(tool === ToolMode.HAND && event.button === 0))
      )
        return;
      // Capture before shapes and resize handles can claim the gesture.
      event.preventDefault();
      event.stopPropagation();
      if (event.buttons !== (event.button === 0 ? 1 : 2)) return;
      stage.setPointersPositions(event);
      stage.startDrag({ evt: event });
    };
    const contextMenu = (event: MouseEvent) => event.preventDefault();
    const stop = () => stage.stopDrag();
    container.addEventListener('mousedown', down, true);
    container.addEventListener('contextmenu', contextMenu);
    window.addEventListener('blur', stop);
    return () => {
      container.removeEventListener('mousedown', down, true);
      container.removeEventListener('contextmenu', contextMenu);
      window.removeEventListener('blur', stop);
      stop();
    };
  }, [stageRef, tool]);
}
