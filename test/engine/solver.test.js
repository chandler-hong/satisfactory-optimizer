import test from 'node:test';
import assert from 'node:assert/strict';
import { solveModel } from '../../js/engine/solver.js';

const approx = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

test('solveModel returns normalized result with variable values only', () => {
  const model = {
    optimize: 'capacity', opType: 'max',
    constraints: { plane: { max: 44 }, person: { max: 512 }, cost: { max: 300000 } },
    variables: {
      brit: { capacity: 20000, plane: 1, person: 8, cost: 5000 },
      yank: { capacity: 30000, plane: 1, person: 16, cost: 9000 },
    },
  };
  const r = solveModel(model);
  assert.equal(r.feasible, true);
  assert.ok(approx(r.objective, 1080000));
  assert.ok(approx(r.values.brit, 24));
  assert.ok(approx(r.values.yank, 20));
  // meta keys must not leak into values
  assert.equal('feasible' in r.values, false);
  assert.equal('result' in r.values, false);
  assert.equal('bounded' in r.values, false);
});

test('solveModel reports infeasible models', () => {
  const model = {
    optimize: 'x', opType: 'max',
    constraints: { a: { min: 10, max: 5 } },  // impossible
    variables: { v: { a: 1, x: 1 } },
  };
  const r = solveModel(model);
  assert.equal(r.feasible, false);
});

test('reports bounded true for a feasible bounded model', () => {
  const model = {
    optimize: 'x', opType: 'max',
    constraints: { cap: { max: 10 } },
    variables: { a: { cap: 1, x: 1 } },
  };
  const r = solveModel(model);
  assert.equal(r.feasible, true);
  assert.equal(r.bounded, true);
});

test('excludes isIntegral from values on a MILP and keeps variable values', () => {
  const model = {
    optimize: 'profit', opType: 'max',
    constraints: { wood: { max: 300 }, labor: { max: 110 } },
    variables: {
      table: { wood: 30, labor: 5, profit: 1200 },
      dresser: { wood: 20, labor: 10, profit: 1600 },
    },
    ints: { table: 1, dresser: 1 },
  };
  const r = solveModel(model);
  assert.equal(r.feasible, true);
  assert.equal('isIntegral' in r.values, false);   // meta key filtered out of values
  assert.equal('feasible' in r.values, false);
  assert.ok((r.values.table ?? 0) >= 0);            // decision-variable values survive
  assert.ok((r.values.dresser ?? 0) >= 0);
});
