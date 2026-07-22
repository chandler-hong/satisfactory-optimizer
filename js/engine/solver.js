import solver from '../vendor/solver.mjs';

const META = new Set(['feasible', 'result', 'bounded', 'isIntegral']);

/**
 * Solve a jsLPSolver model and normalize the result.
 * @param {object} model
 * @returns {{feasible: boolean, bounded: boolean, objective: number, values: Record<string, number>}}
 */
export function solveModel(model) {
  const raw = solver.Solve(model);
  const values = {};
  for (const k of Object.keys(raw)) if (!META.has(k)) values[k] = raw[k];
  return {
    feasible: !!raw.feasible,
    bounded: raw.bounded !== false,
    objective: typeof raw.result === 'number' ? raw.result : 0,
    values,
  };
}
