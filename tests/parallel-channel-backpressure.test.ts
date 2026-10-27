import { expect, test } from "bun:test"
import { DistanceAwareTinyHyperGraphSolver } from "../lib/distance-aware-tiny-hypergraph-solver"
import {
  DistributedSearchPool,
  type ParallelSearchExecutor,
} from "../lib/parallel/DistributedSearchPool"
import { createDistributedSearchExecutor } from "./fixtures/createDistributedSearchExecutor"
import { createParallelGrid } from "./fixtures/createParallelGrid"

test("one-slot channels drain during expansion and during a budget pause", async () => {
  const { topology, problem } = createParallelGrid(3)
  const options = { STATIC_REACHABILITY_PRECHECK: false, VERBOSE: false }
  const reference = new DistanceAwareTinyHyperGraphSolver(
    topology,
    problem,
    options,
  )
  let expected = Infinity
  const onPathFound = reference.onPathFound.bind(reference)
  reference.onPathFound = (candidate) => {
    if (candidate.portId === reference.state.goalPortId) expected = candidate.g
    onPathFound(candidate)
  }
  do {
    reference.step()
  } while (reference.state.currentRouteId !== undefined && !reference.failed)
  const executor = createDistributedSearchExecutor(4)
  const constrained: ParallelSearchExecutor = {
    persistentWorkerCount: 4,
    executeAsync: (Task, input) =>
      executor.executeAsync(Task, { ...input, capacity: 1 }),
  }
  const solver = new DistanceAwareTinyHyperGraphSolver(
    topology,
    problem,
    options,
  )
  solver.setup()
  const pool = new DistributedSearchPool(solver, constrained)
  try {
    await pool.start()
    const complete = await pool.search(0, 10000)
    expect(complete.status).toBe("found")
    expect(complete.candidate!.g).toBeCloseTo(expected, 10)
    expect(pool.totals.messages).toBeGreaterThan(0)
    const exhausted = await pool.search(0, 1)
    expect(exhausted.status).toBe("budget")
    expect(exhausted.iterations).toBe(1)
  } finally {
    await pool.dispose()
    executor.dispose()
  }
})
