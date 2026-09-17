import { expect, test } from "bun:test"
import { SelectiveReripTinyHyperGraphSolver } from "lib/selective-rerip-tiny-hyper-graph-solver"

test("uses another blocking route instead of restarting when owners form a cycle", () => {
  const forbiddenOwners: number[][] = []
  class SolverWithAlternateCorridor extends SelectiveReripTinyHyperGraphSolver {
    protected override findRelaxedBlockerPath(
      forbidden: ReadonlySet<number> = new Set(),
    ) {
      forbiddenOwners.push([...forbidden])
      const owner =
        this.state.currentRouteId === 0
          ? 1
          : this.state.currentRouteId === 1
            ? 2
            : !forbidden.has(0)
              ? 0
              : !forbidden.has(1)
                ? 1
                : 3
      return {
        found: true as const,
        states: [],
        hops: [],
        owners: new Set([owner]),
        distance: 1,
        expandedLabelCount: 1,
      }
    }
  }
  const solver = new SolverWithAlternateCorridor(
    {
      portCount: 8,
      regionCount: 2,
      regionIncidentPorts: [[0, 1, 2, 3, 4, 5, 6, 7], []],
      incidentPortRegion: Array.from({ length: 8 }, () => [0, 1]),
      regionWidth: new Float64Array([10, 10]),
      regionHeight: new Float64Array([10, 10]),
      regionCenterX: new Float64Array(2),
      regionCenterY: new Float64Array(2),
      portAngleForRegion1: new Int32Array(8),
      portX: new Float64Array(8),
      portY: new Float64Array(8),
      portZ: new Int32Array(8),
    },
    {
      routeCount: 4,
      portSectionMask: new Int8Array(8).fill(1),
      routeStartPort: new Int32Array([0, 2, 4, 6]),
      routeEndPort: new Int32Array([1, 3, 5, 7]),
      routeNet: new Int32Array([0, 1, 2, 3]),
      regionNetId: new Int32Array(2).fill(-1),
    },
  )
  solver.state.regionSegments[0] = [
    [1, 2, 3],
    [2, 4, 5],
    [3, 6, 7],
  ]
  for (const failedRouteId of [0, 1, 2]) {
    if (failedRouteId > 0) {
      const routeId = failedRouteId - 1
      solver.state.regionSegments[0].push([
        routeId,
        routeId * 2,
        routeId * 2 + 1,
      ])
      solver.state.currentRouteNetId = routeId
      solver.appendSegmentToRegionCache(0, routeId * 2, routeId * 2 + 1)
    }
    solver.state.currentRouteId = failedRouteId
    solver.state.currentRouteNetId = failedRouteId
    solver.state.unroutedRoutes = []
    solver.onOutOfCandidates()
  }

  expect(forbiddenOwners).toEqual([[], [], [], [0, 1]])
  expect(solver.getSelectiveReripStats().globalReripCount).toBe(0)
  expect(solver.getSelectiveReripStats().failedOwnerPairs).toContainEqual({
    failedRouteId: 2,
    ownerRouteId: 3,
    count: 1,
  })
  expect(solver.getSelectiveReripStats().lastAlternateOwnerRouteIds).toEqual([
    3,
  ])
  expect(solver.state.regionSegments[0]).toEqual([
    [0, 0, 1],
    [1, 2, 3],
  ])
})
