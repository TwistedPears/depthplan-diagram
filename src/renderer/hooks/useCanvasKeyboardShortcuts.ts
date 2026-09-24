import React, { useEffect } from 'react';
import { isEditingText } from './useDocumentHistoryActions';

interface UseCanvasKeyboardShortcutsArgs {
  zoomToFit: () => void;
  setViewBox: React.Dispatch<
    React.SetStateAction<{ x: number; y: number; scale: number }>
  >;
  // Optional: if provided, arrow keys will nudge selected blocks instead of panning when selection exists
  selectedIds?: string[];
  onNudgeSelected?: (dx: number, dy: number) => void;
}

export default function useCanvasKeyboardShortcuts({
  zoomToFit,
  setViewBox,
  selectedIds = [],
  onNudgeSelected,
}: UseCanvasKeyboardShortcutsArgs) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isEditingText(e.target)) {
        return;
      }

      const PAN_STEP = 50;
      const PAN_STEP_LARGE = 200;
      const MICRO_STEP = 5;
      const isMac =
        typeof navigator !== 'undefined' &&
        /Mac|iPhone|iPad|iPod/i.test(navigator.platform || '');
      const isCtrlLike = e.ctrlKey || e.metaKey; // Ctrl on Win/Linux, Cmd on macOS
      const isShift = e.shiftKey;
      const isAlt = e.altKey;

      // 1) Micro‑nudge first: macOS uses Option(Alt)+Arrow to avoid OS-level Ctrl+Arrow space switch
      const wantsMicro = (isMac ? isAlt : isCtrlLike) && !isShift;
      if (wantsMicro && selectedIds.length > 0 && onNudgeSelected) {
        switch (e.key) {
          case 'ArrowLeft':
            e.preventDefault();
            onNudgeSelected(-MICRO_STEP, 0);
            return;
          case 'ArrowRight':
            e.preventDefault();
            onNudgeSelected(MICRO_STEP, 0);
            return;
          case 'ArrowUp':
            e.preventDefault();
            onNudgeSelected(0, -MICRO_STEP);
            return;
          case 'ArrowDown':
            e.preventDefault();
            onNudgeSelected(0, MICRO_STEP);
            return;
          default:
            break;
        }
      }

      if (isCtrlLike && !isShift && !isAlt) {
        switch (e.key.toLowerCase()) {
          case 'f':
            e.preventDefault();
            zoomToFit();
            break;
          case 'h':
            e.preventDefault();
            setViewBox((prev) => ({ ...prev, x: 0, y: 0 }));
            break;
          default:
            break;
        }
      } else if (!isCtrlLike && !isShift && !isAlt) {
        switch (e.key) {
          case 'ArrowLeft':
            e.preventDefault();
            if (selectedIds.length > 0 && onNudgeSelected) {
              onNudgeSelected(-PAN_STEP, 0);
            } else {
              setViewBox((prev) => ({ ...prev, x: prev.x + PAN_STEP }));
            }
            break;
          case 'ArrowRight':
            e.preventDefault();
            if (selectedIds.length > 0 && onNudgeSelected) {
              onNudgeSelected(PAN_STEP, 0);
            } else {
              setViewBox((prev) => ({ ...prev, x: prev.x - PAN_STEP }));
            }
            break;
          case 'ArrowUp':
            e.preventDefault();
            if (selectedIds.length > 0 && onNudgeSelected) {
              onNudgeSelected(0, -PAN_STEP);
            } else {
              setViewBox((prev) => ({ ...prev, y: prev.y + PAN_STEP }));
            }
            break;
          case 'ArrowDown':
            e.preventDefault();
            if (selectedIds.length > 0 && onNudgeSelected) {
              onNudgeSelected(0, PAN_STEP);
            } else {
              setViewBox((prev) => ({ ...prev, y: prev.y - PAN_STEP }));
            }
            break;
          default:
            break;
        }
      } else if (!isCtrlLike && isShift && !isAlt) {
        switch (e.key) {
          case 'ArrowLeft':
            e.preventDefault();
            if (selectedIds.length > 0 && onNudgeSelected) {
              onNudgeSelected(-PAN_STEP_LARGE, 0);
            } else {
              setViewBox((prev) => ({ ...prev, x: prev.x + PAN_STEP_LARGE }));
            }
            break;
          case 'ArrowRight':
            e.preventDefault();
            if (selectedIds.length > 0 && onNudgeSelected) {
              onNudgeSelected(PAN_STEP_LARGE, 0);
            } else {
              setViewBox((prev) => ({ ...prev, x: prev.x - PAN_STEP_LARGE }));
            }
            break;
          case 'ArrowUp':
            e.preventDefault();
            if (selectedIds.length > 0 && onNudgeSelected) {
              onNudgeSelected(0, -PAN_STEP_LARGE);
            } else {
              setViewBox((prev) => ({ ...prev, y: prev.y + PAN_STEP_LARGE }));
            }
            break;
          case 'ArrowDown':
            e.preventDefault();
            if (selectedIds.length > 0 && onNudgeSelected) {
              onNudgeSelected(0, PAN_STEP_LARGE);
            } else {
              setViewBox((prev) => ({ ...prev, y: prev.y - PAN_STEP_LARGE }));
            }
            break;
          default:
            break;
        }
      }
    };

    window.document.addEventListener('keydown', handleKeyDown);
    return () => window.document.removeEventListener('keydown', handleKeyDown);
  }, [zoomToFit, setViewBox, selectedIds, onNudgeSelected]);
}
