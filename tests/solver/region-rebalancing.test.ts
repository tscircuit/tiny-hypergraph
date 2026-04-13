import { expect, test } from "bun:test"
import type { TinyHyperGraphProblem, TinyHyperGraphTopology } from "lib/index"
import { TinyHyperGraphSolver } from "lib/index"

const createTopology = (): TinyHyperGraphTopology => ({
  portCount: 4,
  regionCount: 4,
  regionIncidentPorts: [[0, 1], [0, 1, 2, 3], [2], [3]],
  incidentPortRegion: [
    [0, 1],
    [0, 1],
    [1, 2],
    [1, 3],
  ],
  regionWidth: new Float64Array([4, 4, 1, 1]),
  regionHeight: new Float64Array([4, 4, 1, 1]),
  regionCenterX: new Float64Array(4).fill(0),
  regionCenterY: new Float64Array(4).fill(0),
  portAngleForRegion1: new Int32Array([0, 18000, 9000, 27000]),
  portAngleForRegion2: new Int32Array([0, 18000, 0, 0]),
  portX: new Float64Array([1, -1, 0, 0]),
  portY: new Float64Array([0, 0, 1, -1]),
  portZ: new Int32Array(4).fill(0),
})

const createProblem = (): TinyHyperGraphProblem => ({
  routeCount: 2,
  portSectionMask: new Int8Array(4).fill(1),
  routeStartPort: new Int32Array([0, 2]),
  routeEndPort: new Int32Array([1, 3]),
  routeNet: new Int32Array([0, 1]),
  regionNetId: new Int32Array(4).fill(-1),
})

test("rebalanceRegionAssignments moves ambiguous segments to the lower-cost neighboring region", () => {
  const solver = new TinyHyperGraphSolver(createTopology(), createProblem())

  solver.state.regionSegments[1]!.push([0, 0, 1], [1, 2, 3])

  solver.state.currentRouteNetId = 0
  solver.appendSegmentToRegionCache(1, 0, 1)
  solver.state.currentRouteNetId = 1
  solver.appendSegmentToRegionCache(1, 2, 3)
  solver.state.currentRouteNetId = undefined

  const lowerCostBefore =
    solver.state.regionIntersectionCaches[1]!.existingRegionCost

  expect(lowerCostBefore).toBeGreaterThan(0)
  expect(solver.state.regionSegments[0]).toEqual([])
  expect(solver.state.regionSegments[1]).toEqual([
    [0, 0, 1],
    [1, 2, 3],
  ])

  ;(solver as any).rebalanceRegionAssignments()

  expect(solver.state.regionSegments[0]).toEqual([[0, 0, 1]])
  expect(solver.state.regionSegments[1]).toEqual([[1, 2, 3]])
  expect(
    solver.state.regionIntersectionCaches[1]!.existingRegionCost,
  ).toBeLessThan(lowerCostBefore)
  expect(solver.state.regionIntersectionCaches[0]!.existingRegionCost).toBe(0)
  expect(solver.state.regionIntersectionCaches[1]!.existingRegionCost).toBe(0)
})
