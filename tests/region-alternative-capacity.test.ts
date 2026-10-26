import { expect, test } from "bun:test"
import {
  createCapacityProbe,
  ownerCapacityHook,
} from "./fixtures/alternative-region-capacity.fixture"

test("C2 capacity keeps all removal alternatives and skips a forbidden first choice", () => {
  const { solver, candidate } = createCapacityProbe([0, 1, 2])
  solver.topology.regionSegmentFeasibility = ownerCapacityHook(2)
  const before = structuredClone(solver.state.regionSegments)
  const free = solver.plan(candidate)
  expect(free.found).toBe(true)
  if (!free.found) throw new Error("Expected a two-owner removal choice")
  expect(free.owners.size).toBe(2)
  const forbidden = solver.plan(candidate, new Set([0]))
  expect(forbidden.found).toBe(true)
  if (!forbidden.found)
    throw new Error("Expected the alternative excluding owner 0")
  expect([...forbidden.owners].sort()).toEqual([1, 2])
  expect(solver.plan(candidate, new Set([0, 1])).found).toBe(false)
  expect(solver.state.regionSegments).toEqual(before)

  const larger = createCapacityProbe([0, 1, 2, 3, 4])
  larger.solver.topology.regionSegmentFeasibility = ownerCapacityHook(3)
  const c3 = larger.solver.plan(larger.candidate)
  expect(c3.found).toBe(true)
  if (!c3.found) throw new Error("Expected a three-owner C3 removal choice")
  expect(c3.owners.size).toBe(3)
  const c3Forbidden = larger.solver.plan(larger.candidate, new Set([0, 1]))
  expect(c3Forbidden.found).toBe(true)
  if (!c3Forbidden.found)
    throw new Error("Expected the remaining C3 alternative")
  expect([...c3Forbidden.owners].sort()).toEqual([2, 3, 4])
})
