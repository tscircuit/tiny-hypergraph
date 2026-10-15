import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import type { TinyHyperGraphProblem, TinyHyperGraphTopology } from "lib/core"
import { SelectiveReripTinyHyperGraphSolver } from "lib/selective-rerip-tiny-hyper-graph-solver"

type SerializedPmp22650GoalEntryFixture = {
  source: {
    board: string
    dataset: string
    connectionId: string
    originalRouteId: number
    captureBoundary: string
  }
  topology: Omit<
    TinyHyperGraphTopology,
    | "regionWidth"
    | "regionHeight"
    | "regionCenterX"
    | "regionCenterY"
    | "regionAvailableZMask"
    | "portAngleForRegion1"
    | "portAngleForRegion2"
    | "portX"
    | "portY"
    | "portZ"
  > & {
    regionWidth: number[]
    regionHeight: number[]
    regionCenterX: number[]
    regionCenterY: number[]
    regionAvailableZMask: number[]
    portAngleForRegion1: number[]
    portAngleForRegion2: number[]
    portX: number[]
    portY: number[]
    portZ: number[]
  }
  problem: Omit<
    TinyHyperGraphProblem,
    | "portSectionMask"
    | "routeStartPort"
    | "routeEndPort"
    | "routeNet"
    | "regionNetId"
    | "portPenalty"
  > & {
    portSectionMask: number[]
    routeStartPort: number[]
    routeEndPort: number[]
    routeNet: number[]
    regionNetId: number[]
    portPenalty: number[]
  }
}

export const pmp22650GoalEntryFixture = JSON.parse(
  gunzipSync(
    readFileSync(
      new URL(
        "../fixtures/pmp22650-goal-entry-penalty.json.gz",
        import.meta.url,
      ),
    ),
  ).toString("utf8"),
) as SerializedPmp22650GoalEntryFixture

export const pmp22650GoalEntryTopology: TinyHyperGraphTopology = {
  ...pmp22650GoalEntryFixture.topology,
  regionWidth: new Float64Array(pmp22650GoalEntryFixture.topology.regionWidth),
  regionHeight: new Float64Array(
    pmp22650GoalEntryFixture.topology.regionHeight,
  ),
  regionCenterX: new Float64Array(
    pmp22650GoalEntryFixture.topology.regionCenterX,
  ),
  regionCenterY: new Float64Array(
    pmp22650GoalEntryFixture.topology.regionCenterY,
  ),
  regionAvailableZMask: new Int32Array(
    pmp22650GoalEntryFixture.topology.regionAvailableZMask,
  ),
  portAngleForRegion1: new Int32Array(
    pmp22650GoalEntryFixture.topology.portAngleForRegion1,
  ),
  portAngleForRegion2: new Int32Array(
    pmp22650GoalEntryFixture.topology.portAngleForRegion2,
  ),
  portX: new Float64Array(pmp22650GoalEntryFixture.topology.portX),
  portY: new Float64Array(pmp22650GoalEntryFixture.topology.portY),
  portZ: new Int32Array(pmp22650GoalEntryFixture.topology.portZ),
}

export const pmp22650GoalEntryProblem: TinyHyperGraphProblem = {
  ...pmp22650GoalEntryFixture.problem,
  portSectionMask: new Int8Array(
    pmp22650GoalEntryFixture.problem.portSectionMask,
  ),
  routeStartPort: new Int32Array(
    pmp22650GoalEntryFixture.problem.routeStartPort,
  ),
  routeEndPort: new Int32Array(pmp22650GoalEntryFixture.problem.routeEndPort),
  routeNet: new Int32Array(pmp22650GoalEntryFixture.problem.routeNet),
  regionNetId: new Int32Array(pmp22650GoalEntryFixture.problem.regionNetId),
  portPenalty: new Float64Array(pmp22650GoalEntryFixture.problem.portPenalty),
}

export const createPmp22650GoalEntrySolver =
  (): SelectiveReripTinyHyperGraphSolver =>
    new SelectiveReripTinyHyperGraphSolver(
      pmp22650GoalEntryTopology,
      pmp22650GoalEntryProblem,
      {
        DISTANCE_TO_COST: 0.05,
        RIP_THRESHOLD_START: 0.05,
        RIP_THRESHOLD_END: 0.8,
        RIP_CONGESTION_REGION_COST_FACTOR: 0.1,
        ACCEPT_BEST_SOLUTION_ON_TIMEOUT: true,
        GREEDY_FINAL_ROUTE_ITERS: 4,
        PARTIAL_RIP_ENABLED: false,
        OUTSIDE_IN_ROUTING: false,
        STATIC_REACHABILITY_PRECHECK: true,
        OWNED_REGIONAL_HOP_FRONTIER: true,
        USE_SPARSE_CANDIDATE_STORAGE: false,
        RIP_THRESHOLD_RAMP_ATTEMPTS: 10,
        MAX_ITERATIONS: 2_000_000,
      },
    )
