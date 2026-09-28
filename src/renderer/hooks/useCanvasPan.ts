import { useEffect, useEffectEvent, type RefObject } from 'react';
import type Konva from 'konva';
import { ToolMode } from '../types/CanvasTools';

export default function useCanvasPan(
  stageRef: RefObject<Konva.Stage | null>,
  tool: ToolMode,
  onContextMenu: (event: MouseEvent, target: Konva.Node | null) => void,
) {
  const openMenu = useEffectEvent(onContextMenu);
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const container = stage.container();
    let right: {
      event: MouseEvent;
      moved: boolean;
      released: boolean;
    } | null = null;
    const down = (event: MouseEvent) => {
      if (
        (tool !== ToolMode.POINTER && tool !== ToolMode.HAND) ||
        (event.button !== 2 && !(tool === ToolMode.HAND && event.button === 0))
      )
        return;
      stage.setPointersPositions(event);
      if (
        stage
          .getIntersection(stage.getPointerPosition()!)
          ?.findAncestor('.child-stack-toggle', true)
      )
        return;
      // Capture before shapes and resize handles can claim the gesture.
      event.preventDefault();
      event.stopPropagation();
      right =
        event.button === 2 ? { event, moved: false, released: false } : null;
      if (event.buttons !== (event.button === 0 ? 1 : 2)) return;
      if (!right) stage.startDrag({ evt: event });
    };
    const show = (event: MouseEvent) => {
      stage.setPointersPositions(event);
      openMenu(event, stage.getIntersection(stage.getPointerPosition()!));
    };
    const move = (event: MouseEvent) => {
      if (
        right &&
        !right.released &&
        !right.moved &&
        Math.hypot(
          event.clientX - right.event.clientX,
          event.clientY - right.event.clientY,
        ) >= 3
      ) {
        right.moved = true;
        stage.setPointersPositions(right.event);
        stage.startDrag({ evt: right.event });
      }
    };
    const up = (event: MouseEvent) => {
      if (event.button !== 2 || !right || right.released) return;
      right.released = true;
      stage.stopDrag();
      if (!right.moved && tool === ToolMode.POINTER) show(event);
    };
    const contextMenu = (event: MouseEvent) => {
      event.preventDefault();
      // macOS sends contextmenu before mouseup; Windows/Linux can send it after.
      if (!right && !event.buttons && tool === ToolMode.POINTER) show(event);
    };
    const stop = () => {
      right = null;
      stage.stopDrag();
    };
    container.addEventListener('mousedown', down, true);
    window.addEventListener('mousemove', move, true);
    window.addEventListener('mouseup', up);
    container.addEventListener('contextmenu', contextMenu);
    window.addEventListener('blur', stop);
    return () => {
      container.removeEventListener('mousedown', down, true);
      window.removeEventListener('mousemove', move, true);
      window.removeEventListener('mouseup', up);
      container.removeEventListener('contextmenu', contextMenu);
      window.removeEventListener('blur', stop);
      stop();
    };
  }, [stageRef, tool]);
}
