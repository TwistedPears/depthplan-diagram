// Tool / Interaction modes for the canvas
export enum ToolMode {
  HAND = 'hand',
  POINTER = 'pointer',
  SQUARE = 'square',
  DIAMOND = 'diamond',
  CIRCLE = 'circle',
  FRAME = 'frame',
  LINE = 'line',
  ARROW = 'arrow',
}

/**
 * Alignment operations enum for alignment tools
 */
export enum AlignmentOperation {
  ALIGN_LEFT = 'align-left',
  ALIGN_CENTER = 'align-center',
  ALIGN_RIGHT = 'align-right',
  ALIGN_TOP = 'align-top',
  ALIGN_MIDDLE = 'align-middle',
  ALIGN_BOTTOM = 'align-bottom',
  DISTRIBUTE_HORIZONTAL = 'distribute-horizontal',
  DISTRIBUTE_VERTICAL = 'distribute-vertical',
  MAKE_SAME_WIDTH = 'make-same-width',
  MAKE_SAME_HEIGHT = 'make-same-height',
}

/**
 * Layering operations enum for z-index management
 */
export enum LayeringOperation {
  BRING_TO_FRONT = 'bring-to-front',
  BRING_FORWARD = 'bring-forward',
  SEND_BACKWARD = 'send-backward',
  SEND_TO_BACK = 'send-to-back',
}
