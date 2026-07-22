import test from 'node:test';
import assert from 'node:assert/strict';
import solver from '../../js/vendor/solver.mjs';

test('vendored solver solves the Berlin Airlift LP', () => {
  const model = {
    optimize: 'capacity', opType: 'max',
    constraints: { plane: { max: 44 }, person: { max: 512 }, cost: { max: 300000 } },
    variables: {
      brit: { capacity: 20000, plane: 1, person: 8, cost: 5000 },
      yank: { capacity: 30000, plane: 1, person: 16, cost: 9000 },
    },
  };
  const r = solver.Solve(model);
  assert.equal(r.feasible, true);
  assert.equal(r.result, 1080000);
  assert.equal(r.brit, 24);
  assert.equal(r.yank, 20);
});
