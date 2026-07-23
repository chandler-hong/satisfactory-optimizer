import test from 'node:test';
import assert from 'node:assert/strict';
import { iconUrl } from '../../js/ui/icons.js';

test('iconUrl builds the satisfactorytools slug path', () => {
  assert.equal(iconUrl('iron-ore'), 'https://www.satisfactorytools.com/assets/images/items/iron-ore_64.png');
  assert.equal(iconUrl('modular-frame'), 'https://www.satisfactorytools.com/assets/images/items/modular-frame_64.png');
});

test('iconUrl returns null for a missing slug', () => {
  assert.equal(iconUrl(undefined), null);
  assert.equal(iconUrl(''), null);
});
