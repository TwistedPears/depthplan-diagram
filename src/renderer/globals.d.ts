import type { DesktopApi } from './desktop';

declare global {
  interface Window {
    desktop: DesktopApi;
  }
}
export {};
