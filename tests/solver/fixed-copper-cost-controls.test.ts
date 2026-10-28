import { expect, test } from "bun:test"
import { TinyHyperGraphSolver } from "lib/core"
import { createFixedCopperProblem, createFixedCopperSegment, createFixedCopperTopology } from "../fixtures/fixed-copper/synthetic"

test("fixed capsule costs preserve exact owner, finite endpoint, layer, width and reversal distinctions", () => {
  const base = createFixedCopperSegment()
  const solver = new TinyHyperGraphSolver(createFixedCopperTopology(), createFixedCopperProblem([base]))
  const cost = (): number => solver.computeFixedCopperTransitionCost(1, 0, 1, 0)
  const crossing = cost()
  expect(crossing).toBeGreaterThan(0)
  expect(Number.isFinite(crossing)).toBe(true)
  expect(solver.computeFixedCopperTransitionCost(1, 1, 0, 0)).toBe(crossing)
  expect(solver.computeFixedCopperTransitionCost(1, 0, 2, 0)).toBe(0)
  expect(solver.computeFixedCopperTransitionCost(1, 0, 1, 1)).toBe(0)
  base.netId = -1
  expect(cost()).toBe(crossing)
  base.z = 1
  expect(cost()).toBe(0)
  base.z = 0
  base.y1 = 0.21
  base.y2 = 1
  expect(cost()).toBe(0)
  base.width = 0.14
  expect(cost()).toBe(crossing)
  base.width = 0.1
  base.clearance = 0.12
  expect(cost()).toBe(crossing)
  base.x1 = base.x2 = 2
  expect(cost()).toBe(0)
  base.x1 = base.x2 = 0
  base.y1 = base.y2 = 0
  expect(cost()).toBe(crossing)
  const duplicate = new TinyHyperGraphSolver(createFixedCopperTopology(), createFixedCopperProblem([base, {...base}]))
  expect(duplicate.computeFixedCopperTransitionCost(1, 0, 1, 0)).toBe(crossing)
})
