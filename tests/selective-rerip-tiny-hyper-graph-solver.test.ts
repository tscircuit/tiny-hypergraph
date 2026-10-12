import { expect, test } from "bun:test"
import {
  orderRoutesAfterSelectiveRerip,
  SelectiveReripTinyHyperGraphSolver,
  selectOwnerRouteIdsToRip,
} from "lib/selective-rerip-tiny-hyper-graph-solver"

test("tries final completion after every whole route has succeeded", () => {
  class SolverWithInspectableFinalCompletion extends SelectiveReripTinyHyperGraphSolver {
    finalCompletionAttemptCount = 0

    markEveryRouteAsSucceeded() {
      this.routeSuccessCountByRouteId.fill(1)
    }

    protected override tryGreedyFinalRouteAcceptance(): boolean {
      this.finalCompletionAttemptCount += 1
      this.solved = true
      return true
    }
  }
  const solver = new SolverWithInspectableFinalCompletion(
    {
      portCount: 0,
      regionCount: 0,
      regionIncidentPorts: [],
      incidentPortRegion: [],
      regionWidth: new Float64Array(),
      regionHeight: new Float64Array(),
      regionCenterX: new Float64Array(),
      regionCenterY: new Float64Array(),
      portAngleForRegion1: new Int32Array(),
      portAngleForRegion2: new Int32Array(),
      portX: new Float64Array(),
      portY: new Float64Array(),
      portZ: new Int32Array(),
    },
    {
      routeCount: 1,
      portSectionMask: new Int8Array(),
      routeStartPort: new Int32Array([0]),
      routeEndPort: new Int32Array([0]),
      routeNet: new Int32Array([0]),
      regionNetId: new Int32Array(),
    },
    {
      WHOLE_ROUTE_OUTSIDE_IN_ROUTING: true,
    },
  )
  solver.markEveryRouteAsSucceeded()

  solver.onOutOfCandidates()

  expect(solver.finalCompletionAttemptCount).toBe(1)
  expect(solver.solved).toBe(true)
})

test("selects alternate owners and rejects a failed route as its only blocker", () => {
  expect([
    ...selectOwnerRouteIdsToRip({
      failedRouteId: 1,
      directOwnerRouteIds: [1, 2],
      alternateOwnerRouteIds: [3, 4],
    }),
  ]).toEqual([3, 4])

  expect(() =>
    selectOwnerRouteIdsToRip({
      failedRouteId: 1,
      directOwnerRouteIds: [1],
    }),
  ).toThrow(
    "SelectiveReripTinyHyperGraphSolver: route 1 has blocker resources but no distinct committed owner can be reripped",
  )
})

test("keeps pending routes ahead of newly ripped routes", () => {
  expect(
    orderRoutesAfterSelectiveRerip({
      failedRouteId: 7,
      pendingRouteIds: [3, 4, 8, 7, 9],
      rippedRouteIds: new Set([4, 2, 7]),
    }),
  ).toEqual([7, 3, 8, 9, 4, 2])
})

test("prefers another blocker owner over a route marked for preservation", () => {
  const searches: number[][] = []
  class SolverWithPreferredPreservedRoute extends SelectiveReripTinyHyperGraphSolver {
    protected override getRouteIdsPreferredForPreservation() {
      return new Set([1])
    }

    protected override findRelaxedBlockerPath(
      forbiddenOwnerRouteIds: ReadonlySet<number> = new Set(),
    ) {
      searches.push([...forbiddenOwnerRouteIds])
      return {
        found: true as const,
        states: [],
        hops: [],
        owners: new Set(forbiddenOwnerRouteIds.has(1) ? [2] : [1]),
        distance: 1,
        expandedLabelCount: 1,
      }
    }

    findPreferredBlockerPath() {
      return this.findRelaxedBlockerPathPreferringPreservedRoutes()
    }
  }
  const solver = Object.create(
    SolverWithPreferredPreservedRoute.prototype,
  ) as SolverWithPreferredPreservedRoute

  const result = solver.findPreferredBlockerPath()

  expect(searches).toEqual([[1]])
  expect(result.found && [...result.owners]).toEqual([2])
})

test("rerips a preserved route when no other blocker path exists", () => {
  const searches: number[][] = []
  class SolverWithUnavoidablePreservedRoute extends SelectiveReripTinyHyperGraphSolver {
    protected override getRouteIdsPreferredForPreservation() {
      return new Set([1])
    }

    protected override findRelaxedBlockerPath(
      forbiddenOwnerRouteIds: ReadonlySet<number> = new Set(),
    ) {
      searches.push([...forbiddenOwnerRouteIds])
      if (forbiddenOwnerRouteIds.has(1)) {
        return {
          found: false as const,
          reason: "no_path" as const,
          expandedLabelCount: 1,
        }
      }
      return {
        found: true as const,
        states: [],
        hops: [],
        owners: new Set([1]),
        distance: 1,
        expandedLabelCount: 1,
      }
    }

    findPreferredBlockerPath() {
      return this.findRelaxedBlockerPathPreferringPreservedRoutes()
    }
  }
  const solver = Object.create(
    SolverWithUnavoidablePreservedRoute.prototype,
  ) as SolverWithUnavoidablePreservedRoute

  const result = solver.findPreferredBlockerPath()

  expect(searches).toEqual([[1], []])
  expect(result.found && [...result.owners]).toEqual([1])
})
