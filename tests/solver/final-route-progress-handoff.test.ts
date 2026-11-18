import { expect, test } from "bun:test"
import type {
  TinyHyperGraphSolver,
  TinyHyperGraphSolverOptions,
} from "lib/core"
import { SelectiveReripTinyHyperGraphSolver } from "lib/selective-rerip-tiny-hyper-graph-solver"

class ObservedFinalRoutingSolver extends SelectiveReripTinyHyperGraphSolver {
  readonly attempts: Array<{
    attempt: number
    solver: TinyHyperGraphSolver
    pendingRouteIds: number[]
    segments: TinyHyperGraphSolver["state"]["regionSegments"]
  }> = []

  constructor(
    private readonly limits: { costAware: number; greedy: number },
    options: TinyHyperGraphSolverOptions = {},
  ) {
    super(
      {
        portCount: 11,
        regionCount: 9,
        regionIncidentPorts: [
          [0, 1, 3, 5],
          [1, 2, 4, 6],
          [5, 6],
          [0],
          [2],
          [3],
          [4],
          [7, 8],
          [9, 10],
        ],
        incidentPortRegion: [
          [0, 3],
          [0, 1],
          [1, 4],
          [0, 5],
          [1, 6],
          [0, 2],
          [2, 1],
          [7],
          [7],
          [8],
          [8],
        ],
        regionWidth: new Float64Array(9).fill(4),
        regionHeight: new Float64Array(9).fill(4),
        regionCenterX: Float64Array.from([0, 2, 1, -1, 3, 0, 2, 10, 20]),
        regionCenterY: Float64Array.from([0, 0, 2, 0, 0, 1, 1, 0, 0]),
        regionAvailableZMask: new Int32Array(9).fill(3),
        portAngleForRegion1: Int32Array.from([
          18000, 0, 0, 27000, 27000, 9000, 0, 18000, 0, 18000, 0,
        ]),
        portAngleForRegion2: Int32Array.from([
          0, 18000, 18000, 0, 0, 18000, 9000, 0, 0, 0, 0,
        ]),
        portX: Float64Array.from([0, 1, 2, 0, 2, 0.5, 1.5, 9, 11, 19, 21]),
        portY: Float64Array.from([0, 0, 0, 1, 1, 2, 2, 0, 0, 0, 0]),
        portZ: new Int32Array(11),
      },
      {
        routeCount: 4,
        portSectionMask: new Int8Array(11).fill(1),
        routeStartPort: Int32Array.from([0, 3, 7, 9]),
        routeEndPort: Int32Array.from([2, 4, 8, 10]),
        routeNet: Int32Array.from([0, 1, 2, 3]),
        // Only blocker 1 can use the detour through region 2.
        regionNetId: Int32Array.from([-1, -1, 1, -1, -1, -1, -1, -1, -1]),
        routeIsFixed: Uint8Array.from([0, 0, 0, 1]),
        initialAssignments: [
          { routeId: 1, regionId: 0, fromPortId: 3, toPortId: 1 },
          { routeId: 1, regionId: 1, fromPortId: 1, toPortId: 4 },
          { routeId: 3, regionId: 8, fromPortId: 9, toPortId: 10 },
        ],
      },
      {
        MAX_ITERATIONS: 200,
        GREEDY_FINAL_ROUTE_ITERS: 1,
        STATIC_REACHABILITY_PRECHECK: false,
        PARTIAL_RIP_ENABLED: false,
        OUTSIDE_IN_ROUTING: false,
        RIP_THRESHOLD_START: 1e6,
        RIP_THRESHOLD_END: 1e6,
        ...options,
      },
    )
  }

  protected override createGreedyFinalRouteSolver(
    options: TinyHyperGraphSolverOptions,
    attempt: number,
  ): TinyHyperGraphSolver {
    const solver = super.createGreedyFinalRouteSolver(options, attempt)
    // Bound the real searches at the handoff; no routing result is fabricated.
    solver.MAX_ITERATIONS =
      attempt < 0 ? this.limits.costAware : this.limits.greedy
    const solve = solver.solve.bind(solver)
    solver.solve = (): void => {
      this.attempts.push({
        attempt,
        solver,
        pendingRouteIds: [...solver.state.unroutedRoutes],
        segments: structuredClone(solver.state.regionSegments),
      })
      solve()
    }
    return solver
  }

  runFinalRouting(): boolean {
    return this.tryGreedyFinalRouteAcceptance()
  }
}

test("final routing tries recovered progress only after the original attempts fail", () => {
  const solver = new ObservedFinalRoutingSolver(
    { costAware: 8, greedy: 32 },
    { GREEDY_FINAL_ROUTE_ITERS: 4 },
  )
  expect(solver.runFinalRouting()).toBe(true)
  expect(solver.attempts.map(({ attempt }) => attempt)).toEqual([
    -1, 0, 1, 2, 3, 4,
  ])
  const costAware = solver.attempts[0]
  const recovery = solver.attempts[5]
  expect(costAware.pendingRouteIds).toEqual([0, 2])
  expect(costAware.solver.state.ripCount).toBe(1)
  // Recovery finished routes 0 and 2, but the displaced owner is still active.
  expect(costAware.solver.state.currentRouteId).toBe(1)
  expect(costAware.solver.state.unroutedRoutes).toEqual([])
  for (const original of solver.attempts.slice(1, 5)) {
    expect(original.pendingRouteIds).toEqual([0, 2])
    expect(original.segments).toEqual(costAware.segments)
    expect(original.solver.failed).toBe(true)
  }
  // Failed original attempts mutate their copies without losing the saved recovery.
  expect(solver.attempts[1].solver.state.regionSegments[0]).toEqual([])
  expect(recovery.pendingRouteIds).toEqual([1])
  expect(recovery.segments).toEqual(costAware.solver.state.regionSegments)
  expect(costAware.solver.state.regionSegments[2]).toEqual([])
  expect(solver.stats.finalRoutingStrategy).toBe("greedy")
  expect(solver.stats.greedyFinalRouteIter).toBe(4)
  expect(solver.stats.greedyFinalRouteRemainingRouteCount).toBe(1)
  expect(solver.state.regionSegments).toEqual([
    [
      [0, 0, 1],
      [1, 3, 5],
    ],
    [
      [0, 1, 2],
      [1, 6, 4],
    ],
    [[1, 5, 6]],
    [],
    [],
    [],
    [],
    [[2, 7, 8]],
    [[3, 9, 10]],
  ])
  expect(solver.state.unroutedRoutes).toEqual([])

  // The original first greedy attempt succeeds naturally with enough steps.
  // Its seed, 49-step search and result must win before the recovered seed.
  const successful = new ObservedFinalRoutingSolver(
    { costAware: 8, greedy: 64 },
    { GREEDY_FINAL_ROUTE_ITERS: 4 },
  )
  expect(successful.runFinalRouting()).toBe(true)
  expect(successful.attempts.map(({ attempt }) => attempt)).toEqual([-1, 0])
  expect(successful.attempts[1].pendingRouteIds).toEqual([0, 2])
  expect(successful.attempts[1].segments).toEqual(
    successful.attempts[0].segments,
  )
  expect(successful.attempts[1].solver.iterations).toBe(49)
  expect(successful.stats.greedyFinalRouteIter).toBe(0)
  expect(successful.state.regionSegments).toEqual(solver.state.regionSegments)
  expect(Array.from(successful.state.portAssignment)).toEqual([
    0, 0, 0, 1, 1, 1, 1, 2, 2, 3, 3,
  ])

  // Equal or worse progress, and partial-route modes, add no extra attempt.
  for (const [costAwareLimit, options] of [
    [2, {}],
    [6, {}],
    [8, { PARTIAL_RIP_ENABLED: true }],
    [8, { OUTSIDE_IN_ROUTING: true }],
  ] satisfies Array<[number, TinyHyperGraphSolverOptions]>) {
    const unchanged = new ObservedFinalRoutingSolver(
      { costAware: costAwareLimit, greedy: 8 },
      options,
    )
    unchanged.runFinalRouting()
    expect(unchanged.attempts.map(({ attempt }) => attempt)).toEqual([-1, 0])
    expect(unchanged.attempts[1].pendingRouteIds).toEqual([0, 2])
    expect(unchanged.attempts[1].segments).toEqual(
      unchanged.attempts[0].segments,
    )
  }

  const failed = new ObservedFinalRoutingSolver(
    { costAware: 8, greedy: 3 },
    { GREEDY_FINAL_ROUTE_ITERS: 4 },
  )
  expect(failed.runFinalRouting()).toBe(false)
  expect(failed.attempts.map(({ attempt }) => attempt)).toEqual([
    -1, 0, 1, 2, 3, 4,
  ])
  expect(failed.stats.greedyFinalRouteAttemptCount).toBe(5)
  expect(failed.attempts[5].solver.state.regionSegments[2]).toEqual([[1, 5, 6]])
  expect(failed.attempts[0].solver.state.regionSegments[2]).toEqual([])
  expect(failed.state.regionSegments).toEqual(failed.attempts[0].segments)

  const budgetSpent = new ObservedFinalRoutingSolver(
    { costAware: 8, greedy: 3 },
    { GREEDY_FINAL_ROUTE_ITERS: 4 },
  )
  budgetSpent.state.ripCount = 8
  expect(budgetSpent.runFinalRouting()).toBe(false)
  expect(budgetSpent.attempts.map(({ attempt }) => attempt)).toEqual([
    0, 1, 2, 3,
  ])
  expect(budgetSpent.stats.greedyFinalRouteAttemptCount).toBe(4)

  const disabled = new ObservedFinalRoutingSolver(
    { costAware: 8, greedy: 64 },
    { GREEDY_FINAL_ROUTE_ITERS: 0 },
  )
  expect(disabled.runFinalRouting()).toBe(false)
  expect(disabled.attempts).toEqual([])
})
