import '@testing-library/jest-dom';
import { TextDecoder, TextEncoder } from 'node:util';

Object.assign(global, { TextDecoder, TextEncoder });

if (typeof HTMLElement !== 'undefined') {
  // jsdom does not implement the native Popover API.
  HTMLElement.prototype.showPopover = function () {
    if (this.hasAttribute('data-test-popover-open')) return;
    document
      .querySelectorAll<HTMLElement>('[popover="auto"][data-test-popover-open]')
      .forEach((other) => other.hidePopover());
    this.setAttribute('data-test-popover-open', '');
    this.dispatchEvent(
      Object.assign(new Event('toggle'), { newState: 'open' }),
    );
  };
  HTMLElement.prototype.hidePopover = function () {
    if (!this.hasAttribute('data-test-popover-open')) return;
    this.removeAttribute('data-test-popover-open');
    this.dispatchEvent(
      Object.assign(new Event('toggle'), { newState: 'closed' }),
    );
  };
}

if (typeof HTMLDialogElement !== 'undefined') {
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
}
