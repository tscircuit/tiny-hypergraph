import { expect, test } from "bun:test"
import { TinyHyperGraphSolver, type TinyHyperGraphTopology } from "lib/core"

function createCrossingDetourSolver(
  goalInside: boolean,
  z: number,
  ownedFrontier: boolean,
  centerLayerMask = 1 << z,
): TinyHyperGraphSolver {
  const centers = [
    [0, 0],
    [-2, 0],
    [2, 0],
    [0, 2],
  ]
  const points = [
    [0, 1],
    [0, -1],
    [-1, 0],
    [1, 0],
    [-1, 0.75],
    [1, 0.75],
    [-2, 1],
    [2, 1],
    [3, 0],
  ]
  const incidentPortRegion = [
    [0],
    [0],
    [0, 1],
    [0, 2],
    [0, 1],
    [0, 2],
    [1, 3],
    [3, 2],
    [2],
  ]
  const angles = points.map((point, portId) =>
    incidentPortRegion[portId].map((regionId) => {
      const center = centers[regionId]
      return (
        Math.round(
          (Math.atan2(point[1] - center[1], point[0] - center[0]) * 18000) /
            Math.PI +
            36000,
        ) % 36000
      )
    }),
  )
  const topology: TinyHyperGraphTopology = {
    portCount: points.length,
    regionCount: centers.length,
    regionIncidentPorts: [
      [0, 1, 2, 3, 4, 5],
      [2, 4, 6],
      [3, 5, 7, 8],
      [6, 7],
    ],
    incidentPortRegion,
    regionWidth: new Float64Array([2, 2, 2, 4]),
    regionHeight: new Float64Array(4).fill(2),
    regionCenterX: new Float64Array(centers.map(([x]) => x)),
    regionCenterY: new Float64Array(centers.map(([, y]) => y)),
    regionAvailableZMask: new Int32Array([centerLayerMask, 255, 255, 255]),
    portAngleForRegion1: new Int32Array(angles.map((entry) => entry[0])),
    portAngleForRegion2: new Int32Array(angles.map((entry) => entry[1] ?? 0)),
    portX: new Float64Array(points.map(([x]) => x)),
    portY: new Float64Array(points.map(([, y]) => y)),
    portZ: new Int32Array(points.length).fill(z),
  }
  return new TinyHyperGraphSolver(
    topology,
    {
      routeCount: 2,
      portSectionMask: new Int8Array(points.length).fill(1),
      routeStartPort: new Int32Array([0, 2]),
      routeEndPort: new Int32Array([1, goalInside ? 3 : 8]),
      routeNet: new Int32Array([0, 1]),
      regionNetId: new Int32Array(4).fill(-1),
      initialAssignments: [
        { routeId: 0, regionId: 0, fromPortId: 0, toPortId: 1 },
      ],
    },
    {
      ACCEPT_BEST_SOLUTION_ON_TIMEOUT: true,
      GREEDY_FINAL_ROUTE_ITERS: 1,
      OWNED_REGIONAL_HOP_FRONTIER: ownedFrontier,
    },
  )
}

test("greedy and goal completion retain single-layer feasibility and take a legal global detour", () => {
  for (const goalInside of [false, true]) {
    for (const z of [0, 7]) {
      for (const ownedFrontier of [false, true]) {
        for (const greedy of [false, true]) {
          const solver = createCrossingDetourSolver(
            goalInside,
            z,
            ownedFrontier,
          )
          if (greedy) solver.tryFinalAcceptance()
          else solver.solve()
          expect(solver.solved).toBe(true)
          expect(solver.failed).toBe(false)
          expect(solver.state.regionSegments[0]).toContainEqual([0, 0, 1])
          expect(solver.state.regionSegments[0]).not.toContainEqual([1, 2, 3])
          expect(solver.state.regionSegments[3]).toContainEqual([1, 6, 7])
          expect(solver.state.unroutedRoutes).toEqual([])
          if (greedy) expect(solver.stats.finalRoutingStrategy).toBe("greedy")
        }
      }
    }
  }
  // Unknown and full-stack regions retain the existing via-capable model.
  for (const mask of [0, 255]) {
    const multiLayer = createCrossingDetourSolver(true, 0, false, mask)
    multiLayer.tryFinalAcceptance()
    expect(multiLayer.solved).toBe(true)
    expect(multiLayer.state.regionSegments[0]).toContainEqual([1, 2, 3])
    expect(multiLayer.state.regionSegments[3]).toEqual([])
  }
  // Same-net overlap remains legal in both a single layer and an owned PTH.
  for (const mask of [1, 255]) {
    const sameNet = createCrossingDetourSolver(true, 0, false, mask)
    sameNet.problem.routeNet[1] = 0
    sameNet.problem.regionNetId[0] = 0
    sameNet.tryFinalAcceptance()
    expect(sameNet.solved).toBe(true)
    const crossing = sameNet.state.regionSegments[0].find(
      ([routeId]) => routeId === 1,
    )
    expect(crossing).toBeDefined()
    expect([2, 4]).toContain(crossing![1])
    expect(crossing![2]).toBe(3)
    expect(sameNet.state.regionSegments[3]).toEqual([])
  }
})
