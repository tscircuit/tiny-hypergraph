import { expect, test } from "bun:test"
import { TinyHyperGraphSolver, type TinyHyperGraphProblem } from "lib/core"
import {
  AlternativeCapacityProbe,
  createCapacityProbe,
  ownerCapacityHook,
} from "./fixtures/alternative-region-capacity.fixture"

test("alternative owners use current child and reset problem IDs instead of captured parent IDs", () => {
  const { solver: parent, candidate } = createCapacityProbe([0, 0, 1, 2])
  const hook = ownerCapacityHook(2)
  const seenProblems: TinyHyperGraphProblem[] = []
  parent.topology.regionSegmentFeasibility = (context) => {
    seenProblems.push(context.problem)
    return hook(context)
  }
  const childProblem: TinyHyperGraphProblem = {
    ...parent.problem,
    // Local IDs 0 and 1 are now the inexpensive owners; 2 and 3 share a net.
    routeNet: new Int32Array([1, 2, 0, 0, 99]),
  }
  const child = new AlternativeCapacityProbe(parent.topology, childProblem)
  const childResult = child.plan(candidate)
  expect(childResult.found).toBe(true)
  if (!childResult.found) throw new Error("Expected child-local owner IDs")
  expect([...childResult.owners].sort()).toEqual([0, 1])
  expect(seenProblems.every((problem) => problem === childProblem)).toBe(true)
  seenProblems.length = 0
  const reset = new TinyHyperGraphSolver(parent.topology, parent.problem)
  reset.resetForProblem(childProblem)
  reset.state.currentRouteId = candidate
  reset.state.currentRouteNetId = childProblem.routeNet[candidate]!
  expect(
    reset.computeG(
      { portId: candidate * 2, nextRegionId: 0, f: 0, g: 0, h: 0 },
      candidate * 2 + 1,
    ),
  ).toBe(Infinity)
  expect(seenProblems.length).toBeGreaterThan(0)
  expect(seenProblems.every((problem) => problem === childProblem)).toBe(true)
})
