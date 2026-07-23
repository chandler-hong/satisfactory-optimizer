import test from 'node:test';
import assert from 'node:assert/strict';
import { iconUrl } from '../../js/ui/icons.js';

test('iconUrl builds the vendored local icon path', () => {
  assert.equal(iconUrl('desc-ironingot-c'), 'assets/icons/desc-ironingot-c_64.png');
  assert.equal(iconUrl('modular-frame'), 'assets/icons/modular-frame_64.png');
});

test('iconUrl returns null for a missing slug', () => {
  assert.equal(iconUrl(undefined), null);
  assert.equal(iconUrl(''), null);
});
