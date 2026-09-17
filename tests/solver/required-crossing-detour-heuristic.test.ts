import { expect, test } from "bun:test"
import { DistanceAwareTinyHyperGraphSolver } from "lib/distance-aware-tiny-hypergraph-solver"

test("remaining costs include the detour around a committed single-layer crossing", () => {
  const solver = new DistanceAwareTinyHyperGraphSolver(
    {
      portCount: 8,
      regionCount: 8,
      regionIncidentPorts: [
        [0, 1, 6],
        [1, 2, 4, 5],
        [6, 7],
        [2, 3, 7],
        [0],
        [3],
        [4],
        [5],
      ],
      incidentPortRegion: [
        [0, 4],
        [0, 1],
        [1, 3],
        [3, 5],
        [1, 6],
        [1, 7],
        [0, 2],
        [2, 3],
      ],
      regionWidth: new Float64Array(8).fill(2),
      regionHeight: new Float64Array(8).fill(2),
      regionCenterX: new Float64Array([-2, 0, 0, 2, -3, 3, 0, 0]),
      regionCenterY: new Float64Array([0, 0, -2, 0, 0, 0, 2, -2]),
      regionAvailableZMask: new Int32Array([0, 1, 0, 0, 0, 0, 0, 0]),
      portAngleForRegion1: new Int32Array([
        18000, 0, 0, 0, 9000, 27000, 27000, 0,
      ]),
      portAngleForRegion2: new Int32Array([
        0, 18000, 18000, 18000, 27000, 9000, 18000, 27000,
      ]),
      portX: new Float64Array([-2, -1, 1, 2, 0, 0, -1, 1]),
      portY: new Float64Array([0, 0, 0, 0, 1, -1, -2, -2]),
      portZ: new Int32Array(8),
    },
    {
      routeCount: 2,
      portSectionMask: new Int8Array(8).fill(1),
      routeStartPort: new Int32Array([0, 4]),
      routeEndPort: new Int32Array([3, 5]),
      routeNet: new Int32Array([0, 1]),
      regionNetId: new Int32Array(8).fill(-1),
      portPenalty: new Float64Array([0, 0, 0, 0, 0, 0, 10, 0]),
    },
  )
  solver.state.currentRouteNetId = 1
  solver.state.regionSegments[1] = [[1, 4, 5]]
  solver.state.portAssignment[4] = 1
  solver.state.portAssignment[5] = 1
  solver.appendSegmentToRegionCache(1, 4, 5)
  solver.state.currentRouteNetId = undefined
  solver.state.unroutedRoutes = [0]
  solver.step()

  expect(solver.computeH(1, 1)).toBeGreaterThanOrEqual(10)
  expect(solver.computeH(2, 3)).toBeLessThan(10)
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.state.regionSegments[1]).toEqual([[1, 4, 5]])
  expect(solver.state.regionSegments[2]).toEqual([[0, 6, 7]])
})
