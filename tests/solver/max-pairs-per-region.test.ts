import { expect, test } from "bun:test"
import {
  type TinyHyperGraphProblem,
  TinyHyperGraphSolver,
  type TinyHyperGraphTopology,
} from "lib/index"

const createSingleRegionSolver = (regionPairCapacityGrowthSteps: number[]) => {
  const topology: TinyHyperGraphTopology = {
    portCount: 2,
    regionCount: 1,
    regionIncidentPorts: [[0, 1]],
    incidentPortRegion: [[0], [0]],
    regionWidth: new Float64Array([1]),
    regionHeight: new Float64Array([1]),
    regionCenterX: new Float64Array([0]),
    regionCenterY: new Float64Array([0]),
    portAngleForRegion1: Int32Array.from([0, 1000]),
    portX: new Float64Array([0, 1]),
    portY: new Float64Array([0, 0]),
    portZ: new Int32Array([0, 0]),
  }

  const problem: TinyHyperGraphProblem = {
    routeCount: 1,
    portSectionMask: new Int8Array(2).fill(1),
    routeStartPort: Int32Array.from([0]),
    routeEndPort: Int32Array.from([1]),
    routeNet: Int32Array.from([0]),
    regionNetId: new Int32Array([-1]),
  }

  return new TinyHyperGraphSolver(topology, problem, {
    REGION_PAIR_CAPACITY_GROWTH_STEPS: regionPairCapacityGrowthSteps,
  })
}

test("region caches preallocate the first configured tier", () => {
  const solver = createSingleRegionSolver([4, 16, 64])

  expect(solver.state.regionIntersectionCaches[0]?.netIds.length).toBe(4)
  expect(solver.state.regionIntersectionCaches[0]?.pairCount).toBe(0)
})

test("appendSegmentToRegionCache grows pair storage using configured tiers", () => {
  const solver = createSingleRegionSolver([4, 16, 64])

  for (let pairIndex = 0; pairIndex < 17; pairIndex++) {
    solver.state.currentRouteNetId = pairIndex
    solver.appendSegmentToRegionCache(0, 0, 1)
  }
  solver.state.currentRouteNetId = undefined

  const finalRegionCache = solver.state.regionIntersectionCaches[0]

  expect(finalRegionCache.pairCount).toBe(17)
  expect(finalRegionCache.existingSegmentCount).toBe(17)
  expect(finalRegionCache.netIds.length).toBe(64)
  expect(Array.from(finalRegionCache.netIds.slice(0, 5))).toEqual([0, 1, 2, 3, 4])
})

test("pair storage falls back to exact growth beyond the last tier", () => {
  const solver = createSingleRegionSolver([4, 16, 64])

  for (let pairIndex = 0; pairIndex < 65; pairIndex++) {
    solver.state.currentRouteNetId = pairIndex
    solver.appendSegmentToRegionCache(0, 0, 1)
  }
  solver.state.currentRouteNetId = undefined

  const finalRegionCache = solver.state.regionIntersectionCaches[0]

  expect(finalRegionCache.pairCount).toBe(65)
  expect(finalRegionCache.netIds.length).toBe(65)
})
