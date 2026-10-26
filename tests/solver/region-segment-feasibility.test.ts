import { expect, test } from "bun:test"
import {
  TinyHyperGraphSolver,
  type TinyHyperGraphRegionSegmentFeasibilityContext,
  type TinyHyperGraphTopology,
} from "lib/core"

function createCapacityDetourSolver(
  goalInside: boolean,
  ownedFrontier: boolean,
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
      const center = centers[regionId]!
      return (
        Math.round(
          (Math.atan2(point[1]! - center[1]!, point[0]! - center[0]!) * 18000) /
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
    regionCenterX: new Float64Array(centers.map(([x]) => x!)),
    regionCenterY: new Float64Array(centers.map(([, y]) => y!)),
    regionAvailableZMask: new Int32Array(4).fill(255),
    portAngleForRegion1: new Int32Array(angles.map((entry) => entry[0]!)),
    portAngleForRegion2: new Int32Array(angles.map((entry) => entry[1] ?? 0)),
    portX: new Float64Array(points.map(([x]) => x!)),
    portY: new Float64Array(points.map(([, y]) => y!)),
    portZ: new Int32Array([0, 7, 0, 7, 0, 7, 0, 7, 7]),
  }
  const solver = new TinyHyperGraphSolver(
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
  topology.regionSegmentFeasibility = ({
    regionId,
    fromPortId,
    toPortId,
    netId,
    regionSegments,
  }) => {
    if (
      regionId !== 0 ||
      topology.portZ[fromPortId] === topology.portZ[toPortId]
    )
      return { feasible: true }
    const blockers = regionSegments
      .filter(
        ([routeId, from, to]) =>
          topology.portZ[from] !== topology.portZ[to] &&
          solver.problem.routeNet[routeId] !== netId,
      )
      .map(([routeId]) => routeId)
    return blockers.length
      ? { feasible: false, blockerRouteIds: blockers }
      : { feasible: true }
  }
  return solver
}

test("runtime region constraints survive normal, greedy, and goal searches without changing defaults", () => {
  for (const goalInside of [false, true]) {
    for (const ownedFrontier of [false, true]) {
      for (const greedy of [false, true]) {
        const solver = createCapacityDetourSolver(goalInside, ownedFrontier)
        if (greedy) solver.tryFinalAcceptance()
        else solver.solve()
        expect(solver.solved).toBe(true)
        expect(solver.failed).toBe(false)
        expect(solver.state.regionSegments[0]).not.toContainEqual([1, 2, 3])
        expect(solver.state.regionSegments[3]).toContainEqual([1, 6, 7])
        expect(solver.state.regionSegments[0]).toContainEqual([0, 0, 1])
        if (greedy) expect(solver.stats.finalRoutingStrategy).toBe("greedy")
      }
    }
  }
  const noHook = createCapacityDetourSolver(true, false)
  delete noHook.topology.regionSegmentFeasibility
  noHook.tryFinalAcceptance()
  expect(noHook.state.regionSegments[0]).toContainEqual([1, 2, 3])
  const ownNet = createCapacityDetourSolver(true, true)
  ownNet.problem.routeNet[1] = 0
  ownNet.tryFinalAcceptance()
  expect(ownNet.state.regionSegments[0]).toContainEqual([1, 2, 3])
  class ProbeSolver extends TinyHyperGraphSolver {
    probe(): boolean {
      return this.isSegmentFeasible(0, 2, 3)
    }
  }
  const source = createCapacityDetourSolver(true, false)
  const probe = new ProbeSolver(source.topology, {
    ...source.problem,
    initialAssignments: [],
  })
  let context: TinyHyperGraphRegionSegmentFeasibilityContext | undefined
  probe.topology.regionSegmentFeasibility = (value) => {
    context = value
    return { feasible: false, blockerRouteIds: [] }
  }
  expect(probe.state.regionIntersectionCaches[0]!.existingSegmentCount).toBe(0)
  expect(probe.probe()).toBe(false)
  expect(context!.routeId).toBeUndefined()
  expect(context!.netId).toBeUndefined()
  expect(context!.problem).toBe(probe.problem)
  expect(context!.topology).toBe(probe.topology)
  expect(context!.regionSegments).toBe(probe.state.regionSegments[0]!)
  const resetProblem = { ...probe.problem, routeNet: new Int32Array([8, 9]) }
  const reset = new TinyHyperGraphSolver(source.topology, source.problem)
  reset.resetForProblem(resetProblem)
  reset.computeG({ portId: 2, nextRegionId: 0, f: 0, g: 0, h: 0 }, 3)
  expect(context!.problem).toBe(resetProblem)
  expect(context!.topology).toBe(reset.topology)
  expect(context!.problem.routeNet[1]).toBe(9)
})
