import type { DesktopApi } from './desktop';

declare global {
  interface Window {
    desktop: DesktopApi;
    depthplanCanvasState?: () => { busy: boolean; animating: boolean };
  }
}
export {};
