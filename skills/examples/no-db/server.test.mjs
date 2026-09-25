import assert from 'node:assert/strict';
import test from 'node:test';
import { responseFor } from './server.mjs';
import { statusLabel } from './view.mjs';

test('health response and label', () => {
  assert.equal(responseFor('/health').status, 200);
  assert.equal(responseFor('/missing').status, 404);
  assert.equal(statusLabel(true), 'Available');
});
