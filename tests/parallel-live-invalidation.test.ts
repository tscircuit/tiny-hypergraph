import { expect, test } from "bun:test"
import { DistanceAwareTinyHyperGraphSolver } from "../lib/distance-aware-tiny-hypergraph-solver"
import { PackedRouteSearch } from "../lib/parallel/PackedRouteSearch"
import { createParallelGrid } from "./fixtures/createParallelGrid"

test("an obsolete live read aborts before scoring and the worker can run a fresh exact search", () => {
  const { topology, problem } = createParallelGrid(3)
  const solver = new DistanceAwareTinyHyperGraphSolver(topology, problem, {
    STATIC_REACHABILITY_PRECHECK: false,
    VERBOSE: false,
  })
  solver.setup()
  const search = new PackedRouteSearch(solver)
  const control = new Int32Array(new SharedArrayBuffer(10 * 4))
  const before = solver.state.portAssignment.slice()
  let reads = 0
  const aborted = search.search(0, 100000, control, new Set(), () => {
    reads++
    return false
  })
  expect(reads).toBe(1)
  expect(aborted.canceled).toBe(true)
  expect(aborted.iterations).toBe(1)
  expect(aborted.candidate).toBeUndefined()
  expect(solver.state.portAssignment).toEqual(before)
  const restarted = search.search(0, 100000, control, new Set(), () => true)
  const reference = new PackedRouteSearch(solver).search(
    0,
    100000,
    control,
    new Set(),
  )
  expect(restarted.canceled).toBe(false)
  expect(restarted.candidate).toEqual(reference.candidate)
  expect(restarted.iterations).toBe(reference.iterations)
})
