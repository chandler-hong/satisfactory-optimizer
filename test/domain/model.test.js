import test from 'node:test';
import assert from 'node:assert/strict';
import { netPerMin } from '../../js/domain/model.js';

test('netPerMin: positive for outputs, negative for inputs, 0 for absent', () => {
  const recipe = {
    id: 'r', name: 'r', buildingId: 'b', alternate: false,
    inputs: [{ itemId: 'ore', perMin: 30 }],
    outputs: [{ itemId: 'ingot', perMin: 30 }],
  };
  assert.equal(netPerMin(recipe, 'ingot'), 30);
  assert.equal(netPerMin(recipe, 'ore'), -30);
  assert.equal(netPerMin(recipe, 'other'), 0);
});

test('netPerMin: nets an item that is both input and output', () => {
  const recipe = {
    id: 'r', name: 'r', buildingId: 'b', alternate: false,
    inputs: [{ itemId: 'water', perMin: 20 }],
    outputs: [{ itemId: 'water', perMin: 50 }],
  };
  assert.equal(netPerMin(recipe, 'water'), 30);
});
