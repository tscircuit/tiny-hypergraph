// Adapted from the focused progress harness in tiny-hypergraph PR288.
import type {
  TinyHyperGraphProblem,
  TinyHyperGraphSolver,
  TinyHyperGraphSolverOptions,
  TinyHyperGraphTopology,
} from "lib/core"
import { SelectiveReripTinyHyperGraphSolver } from "lib/selective-rerip-tiny-hyper-graph-solver"

export type CompletionMode =
  | "partial"
  | "active-route"
  | "none"
  | "equal-progress"
  | "worse-progress"
  | "reripped-seed"
  | "failed-greedy"
export type CompletionObservation = {
  attempt: number
  remainingRouteIds: number[]
  segments: number[][][]
  portAssignment: number[]
  congestion: number[]
  cacheSegmentCount: number
  maximumIterations: number
  greedyCost: number
}

export function createFinalRouteCompletionHarness(mode: CompletionMode, retainBestPartial?: boolean): {
  solver: SelectiveReripTinyHyperGraphSolver
  observations: CompletionObservation[]
  initialAssignments: TinyHyperGraphProblem["initialAssignments"]
} {
  const topology: TinyHyperGraphTopology = {
    regionCount: 1,
    portCount: 9,
    regionIncidentPorts: [[0, 1, 2, 3, 4, 5, 6, 7, 8]],
    incidentPortRegion: Array.from({ length: 9 }, () => [0]),
    regionWidth: new Float64Array([10]),
    regionHeight: new Float64Array([10]),
    regionCenterX: new Float64Array([0]),
    regionCenterY: new Float64Array([0]),
    regionAvailableZMask: new Int32Array([1]),
    portX: new Float64Array([5, 5, 5, 5, -5, -5, -5, -5, -5]),
    portY: new Float64Array([-4, -3, 1, 2, 1, -1, 4, -3, -4]),
    portZ: new Int32Array(9),
    portAngleForRegion1: new Int32Array([
      900, 1800, 5400, 6300, 21600, 23400, 18900, 25200, 26100,
    ]),
  }
  const initialAssignments = [
    { routeId: 0, regionId: 0, fromPortId: 0, toPortId: 1 },
  ]
  const problem: TinyHyperGraphProblem = {
    routeCount: 5,
    portSectionMask: new Int8Array(9).fill(1),
    routeStartPort: new Int32Array([0, 2, 4, 6, 7]),
    routeEndPort: new Int32Array([1, 3, 5, 6, 8]),
    routeNet: new Int32Array([0, 1, 2, 3, 4]),
    regionNetId: new Int32Array([-1]),
    initialAssignments,
    portNetId: new Int32Array([0, 0, 1, 1, 2, 2, 3, 4, 4]),
  }
  const observations: CompletionObservation[] = []
  class CompletionHarness extends SelectiveReripTinyHyperGraphSolver {
    seedAlreadyConnectedRoute(routeId: number): void {
      if (
        this.problem.routeStartPort[routeId] !==
        this.problem.routeEndPort[routeId]
      ) {
        throw new Error("Fixture seed must already be connected")
      }
      this.state.unroutedRoutes = this.state.unroutedRoutes.filter(
        (pending) => pending !== routeId,
      )
      this.routeSuccessCountByRouteId[routeId] = 1
    }

    protected override createGreedyFinalRouteSolver(
      options: TinyHyperGraphSolverOptions,
      attempt: number,
    ): TinyHyperGraphSolver {
      const candidate = super.createGreedyFinalRouteSolver(options, attempt)
      const originalSolve = candidate.solve
      const routeIsPending = (routeId: number): boolean =>
        candidate.state.currentRouteId === routeId ||
        candidate.state.unroutedRoutes.includes(routeId)
      candidate.solve = (): void => {
        if (attempt < 0) {
          if (
            mode === "partial" ||
            mode === "active-route" ||
            mode === "equal-progress" ||
            mode === "reripped-seed"
          ) {
            // Stop at a deterministic completion boundary instead of spending
            // the full budget on this small fixture.
            const lastCompletedRouteId = mode === "reripped-seed" ? 2 : 1
            while (
              routeIsPending(lastCompletedRouteId) &&
              !candidate.failed &&
              candidate.iterations < 100
            )
              candidate.step()
            if (routeIsPending(lastCompletedRouteId)) {
              throw new Error("Fixture failed to complete its cost-aware route")
            }
          }
          if (mode === "active-route") {
            candidate.step()
            if (candidate.state.currentRouteId !== 2) {
              throw new Error(
                "Fixture did not stop during the next active route",
              )
            }
          }
          if (
            mode === "reripped-seed" ||
            mode === "equal-progress" ||
            mode === "worse-progress"
          ) {
            // Use the same occupancy/cache rebuild as an actual selective
            // rerip, and keep the original seed in the pending queue.
            const rerippable = candidate as unknown as {
              rebuildCommittedState(routeIds: ReadonlySet<number>): void
            }
            rerippable.rebuildCommittedState(new Set([0]))
            candidate.state.unroutedRoutes.push(0)
          }
          candidate.failed = true
          candidate.error = "Fixture cost-aware completion budget boundary"
          return
        }
        observations.push({
          attempt,
          remainingRouteIds: [...candidate.state.unroutedRoutes],
          segments: candidate.state.regionSegments.map((segments) =>
            segments.map((segment) => [...segment]),
          ),
          portAssignment: Array.from(candidate.state.portAssignment),
          congestion: Array.from(candidate.state.regionCongestionCost),
          cacheSegmentCount:
            candidate.state.regionIntersectionCaches[0].existingSegmentCount,
          maximumIterations: candidate.MAX_ITERATIONS,
          greedyCost: candidate.computeG(
            { g: 7 } as Parameters<typeof candidate.computeG>[0],
            3,
          ),
        })
        if (mode === "failed-greedy") {
          while (
            routeIsPending(1) &&
            !candidate.failed &&
            candidate.iterations < 100
          )
            candidate.step()
          candidate.failed = true
          candidate.error = "Fixture greedy completion budget boundary"
        } else {
          originalSolve.call(candidate)
        }
      }
      return candidate
    }
  }
  const solver = new CompletionHarness(topology, problem, {
    ...(retainBestPartial === undefined ? {} : { RETAIN_BEST_PARTIAL_ROUTING: retainBestPartial }),
    MAX_ITERATIONS: 2_000_000,
    GREEDY_FINAL_ROUTE_ITERS: 4,
    STATIC_REACHABILITY_PRECHECK: false,
    RIP_THRESHOLD_RAMP_ATTEMPTS: 0,
  })
  // Route3 is already connected at one port and needs no committed segments.
  solver.seedAlreadyConnectedRoute(3)
  solver.state.regionCongestionCost[0] = 0.125
  return { solver, observations, initialAssignments }
}
