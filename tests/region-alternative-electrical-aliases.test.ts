import { expect, test } from "bun:test"
import {
  createCapacityProbe,
  ownerCapacityHook,
} from "./fixtures/alternative-region-capacity.fixture"

test("alternative electrical owners expand every committed alias while minimizing distinct route removals", () => {
  const { solver, candidate } = createCapacityProbe([0, 0, 1, 2])
  solver.topology.regionSegmentFeasibility = ownerCapacityHook(2)
  const cheapest = solver.plan(candidate)
  expect(cheapest.found).toBe(true)
  if (!cheapest.found) throw new Error("Expected the two single-route owners")
  expect([...cheapest.owners].sort()).toEqual([2, 3])
  const aliases = solver.plan(candidate, new Set([2]))
  expect(aliases.found).toBe(true)
  if (!aliases.found) throw new Error("Expected the two-alias electrical owner")
  expect([...aliases.owners].sort()).toEqual([0, 1, 3])
  expect(solver.plan(candidate, new Set([0, 2])).found).toBe(false)
})
