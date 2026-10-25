import { expect, test } from "bun:test"
import {
  getTinyHyperGraphSolverOptions,
  TinyHyperGraphSolver,
  type TinyHyperGraphProblem,
  type TinyHyperGraphTopology,
} from "lib/core"
import { SelectiveReripTinyHyperGraphSolver } from "lib/selective-rerip-tiny-hyper-graph-solver"

test("finite crossings preserve reservations and cloned policy", (): void => {
  const topology: TinyHyperGraphTopology = {
    portCount: 13,
    regionCount: 9,
    regionIncidentPorts: [
      [1, 6, 7, 8, 9, 2, 4, 5],
      [0, 1],
      [2, 3, 6, 7, 10, 11, 12],
      [8, 10],
      [9, 11],
      [4, 5],
      [0],
      [3],
      [12],
    ],
    incidentPortRegion: [
      [1, 6],
      [1, 0],
      [0, 2],
      [2, 7],
      [0, 5],
      [0, 5],
      [0, 2],
      [0, 2],
      [0, 3],
      [0, 4],
      [3, 2],
      [4, 2],
      [2, 8],
    ],
    regionWidth: new Float64Array(9).fill(3),
    regionHeight: new Float64Array(9).fill(3),
    regionCenterX: new Float64Array(9),
    regionCenterY: new Float64Array(9),
    regionAvailableZMask: new Int32Array([1, 3, 3, 3, 3, 3, 3, 3, 3]),
    portAngleForRegion1: new Int32Array([
      0, 0, 18000, 0, 9000, 27000, 4500, 27000, 4500, 4500, 0, 0, 0,
    ]),
    portAngleForRegion2: new Int32Array(13),
    portX: new Float64Array([-2, -1, 1, 2, 0, 0, -1, 0, -1, -1, 1, 1, 2]),
    portY: new Float64Array([0, 0, 0, 0, 1, -1, 1, -1, 1, 1, 1, 1, 1]),
    portZ: new Int32Array(13),
  }
  const problem: TinyHyperGraphProblem = {
    routeCount: 3,
    portSectionMask: new Int8Array(13).fill(1),
    routeStartPort: new Int32Array([0, 4, 6]),
    routeEndPort: new Int32Array([3, 5, 12]),
    routeNet: new Int32Array([0, 1, 2]),
    regionNetId: new Int32Array(9).fill(-1),
    initialAssignments: [
      { routeId: 1, regionId: 0, fromPortId: 4, toPortId: 7 },
      { routeId: 1, regionId: 0, fromPortId: 7, toPortId: 5 },
      { routeId: 2, regionId: 2, fromPortId: 6, toPortId: 12 },
    ],
  }
  problem.portSectionMask[9] = 0
  problem.regionNetId[3] = 9
  const defaults = new TinyHyperGraphSolver(topology, problem, {
    STATIC_REACHABILITY_PRECHECK: false,
  })
  defaults.state.currentRouteId = 0
  defaults.state.currentRouteNetId = 0
  const candidate = { nextRegionId: 0, portId: 1, f: 0, g: 0, h: 0 }
  expect(defaults.NEGOTIATE_SINGLE_LAYER_CROSSINGS).toBe(false)
  expect(defaults.computeG(candidate, 2)).toBe(Number.POSITIVE_INFINITY)

  for (const ownedFrontier of [false, true]) {
    const solver = new TinyHyperGraphSolver(topology, problem, {
      NEGOTIATE_SINGLE_LAYER_CROSSINGS: true,
      OWNED_REGIONAL_HOP_FRONTIER: ownedFrontier,
      STATIC_REACHABILITY_PRECHECK: false,
      RIP_THRESHOLD_RAMP_ATTEMPTS: 0,
      ACCEPT_BEST_SOLUTION_ON_TIMEOUT: false,
      GREEDY_FINAL_ROUTE_ITERS: 0,
      MAX_ITERATIONS: 100,
    })
    solver.state.currentRouteNetId = 0
    const finiteCost = solver.computeG(candidate, 2)
    expect(Number.isFinite(finiteCost)).toBe(true)
    expect(finiteCost).toBeGreaterThan(10)
    expect(solver.isKnownSingleLayerRegion(0)).toBe(true)
    solver.state.currentRouteNetId = undefined
    solver.solve()
    expect(solver.solved).toBe(true)
    expect(solver.failed).toBe(false)
    expect(solver.state.regionSegments[0].filter(([id]) => id === 0)).toEqual([
      [0, 1, 2],
    ])
    expect(solver.state.regionSegments[3]).toEqual([])
    expect(solver.state.regionSegments[4]).toEqual([])
    expect(solver.state.portAssignment[6]).toBe(2)
    expect(solver.state.portAssignment[7]).toBe(1)
    expect(
      solver.state.regionIntersectionCaches[0].existingSameLayerIntersections,
    ).toBeGreaterThan(0)
    const clone = new SelectiveReripTinyHyperGraphSolver(
      topology,
      problem,
      getTinyHyperGraphSolverOptions(solver),
    )
    expect(clone.NEGOTIATE_SINGLE_LAYER_CROSSINGS).toBe(true)
    expect(clone.isKnownSingleLayerRegion(0)).toBe(true)
    clone.state.currentRouteNetId = 0
    expect(Number.isFinite(clone.computeG(candidate, 2))).toBe(true)
    expect(clone.computeG(candidate, 2)).toBeGreaterThan(10)
    clone.solve()
    expect(clone.solved).toBe(true)
    expect(clone.state.regionSegments).toEqual(solver.state.regionSegments)
    const strictClone = new TinyHyperGraphSolver(topology, problem, {
      ...getTinyHyperGraphSolverOptions(clone),
      NEGOTIATE_SINGLE_LAYER_CROSSINGS: false,
    })
    strictClone.state.currentRouteNetId = 0
    expect(strictClone.computeG(candidate, 2)).toBe(Number.POSITIVE_INFINITY)
  }
})
