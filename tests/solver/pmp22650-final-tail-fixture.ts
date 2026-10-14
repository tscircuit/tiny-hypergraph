import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import type { GraphicsObject } from "graphics-debug"
import type { TinyHyperGraphProblem, TinyHyperGraphTopology } from "lib/core"
import { SelectiveReripTinyHyperGraphSolver } from "lib/selective-rerip-tiny-hyper-graph-solver"

type Pmp22650FinalTailFixture = {
  source: {
    board: string
    dataset: string
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
  remainingRouteIds: number[]
  regionCongestionCost: number[]
}

export const pmp22650FinalTailFixture = JSON.parse(
  gunzipSync(
    readFileSync(
      new URL("../fixtures/pmp22650-final-tail.json.gz", import.meta.url),
    ),
  ).toString("utf8"),
) as Pmp22650FinalTailFixture

export const pmp22650FinalTailTopology: TinyHyperGraphTopology = {
  ...pmp22650FinalTailFixture.topology,
  regionWidth: new Float64Array(pmp22650FinalTailFixture.topology.regionWidth),
  regionHeight: new Float64Array(
    pmp22650FinalTailFixture.topology.regionHeight,
  ),
  regionCenterX: new Float64Array(
    pmp22650FinalTailFixture.topology.regionCenterX,
  ),
  regionCenterY: new Float64Array(
    pmp22650FinalTailFixture.topology.regionCenterY,
  ),
  regionAvailableZMask: new Int32Array(
    pmp22650FinalTailFixture.topology.regionAvailableZMask,
  ),
  portAngleForRegion1: new Int32Array(
    pmp22650FinalTailFixture.topology.portAngleForRegion1,
  ),
  portAngleForRegion2: new Int32Array(
    pmp22650FinalTailFixture.topology.portAngleForRegion2,
  ),
  portX: new Float64Array(pmp22650FinalTailFixture.topology.portX),
  portY: new Float64Array(pmp22650FinalTailFixture.topology.portY),
  portZ: new Int32Array(pmp22650FinalTailFixture.topology.portZ),
}

export const pmp22650FinalTailProblem: TinyHyperGraphProblem = {
  ...pmp22650FinalTailFixture.problem,
  portSectionMask: new Int8Array(
    pmp22650FinalTailFixture.problem.portSectionMask,
  ),
  routeStartPort: new Int32Array(
    pmp22650FinalTailFixture.problem.routeStartPort,
  ),
  routeEndPort: new Int32Array(pmp22650FinalTailFixture.problem.routeEndPort),
  routeNet: new Int32Array(pmp22650FinalTailFixture.problem.routeNet),
  regionNetId: new Int32Array(pmp22650FinalTailFixture.problem.regionNetId),
  portPenalty: new Float64Array(pmp22650FinalTailFixture.problem.portPenalty),
}

export const createPmp22650FinalTailSolver =
  (): SelectiveReripTinyHyperGraphSolver => {
    const solver = new SelectiveReripTinyHyperGraphSolver(
      pmp22650FinalTailTopology,
      pmp22650FinalTailProblem,
      {
        DISTANCE_TO_COST: 0.05,
        RIP_THRESHOLD_START: 0.05,
        RIP_THRESHOLD_END: 0.8,
        RIP_CONGESTION_REGION_COST_FACTOR: 0.1,
        ACCEPT_BEST_SOLUTION_ON_TIMEOUT: true,
        GREEDY_FINAL_ROUTE_ITERS: 1,
        PARTIAL_RIP_ENABLED: false,
        OUTSIDE_IN_ROUTING: true,
        STATIC_REACHABILITY_PRECHECK: false,
        USE_SPARSE_CANDIDATE_STORAGE: false,
        RIP_THRESHOLD_RAMP_ATTEMPTS: 10,
        MAX_ITERATIONS: 64_000_000,
      },
    )
    solver.state.regionCongestionCost.set(
      pmp22650FinalTailFixture.regionCongestionCost,
    )
    solver.state.unroutedRoutes = [
      ...pmp22650FinalTailFixture.remainingRouteIds,
    ]
    solver.state.ripCount = 8
    return solver
  }

export const getPmp22650FinalTailGraphics = ({
  solver,
  title,
  showRatsnest = false,
}: {
  solver: SelectiveReripTinyHyperGraphSolver
  title: string
  showRatsnest?: boolean
}): GraphicsObject => {
  const remainingRouteIds = new Set(pmp22650FinalTailFixture.remainingRouteIds)
  const lines: NonNullable<GraphicsObject["lines"]> = showRatsnest
    ? pmp22650FinalTailFixture.remainingRouteIds.map((routeId) => {
        const startPortId = pmp22650FinalTailProblem.routeStartPort[routeId]
        const endPortId = pmp22650FinalTailProblem.routeEndPort[routeId]
        return {
          points: [
            {
              x: pmp22650FinalTailTopology.portX[startPortId],
              y: pmp22650FinalTailTopology.portY[startPortId],
            },
            {
              x: pmp22650FinalTailTopology.portX[endPortId],
              y: pmp22650FinalTailTopology.portY[endPortId],
            },
          ],
          strokeColor: "#334155",
          strokeWidth: 0.1,
        }
      })
    : []
  for (const regionSegments of solver.state.regionSegments) {
    for (const [routeId, fromPortId, toPortId] of regionSegments) {
      const isRemainingRoute = remainingRouteIds.has(routeId)
      if (!isRemainingRoute) continue
      lines.push({
        points: [
          {
            x: pmp22650FinalTailTopology.portX[fromPortId],
            y: pmp22650FinalTailTopology.portY[fromPortId],
          },
          {
            x: pmp22650FinalTailTopology.portX[toPortId],
            y: pmp22650FinalTailTopology.portY[toPortId],
          },
        ],
        strokeColor: `hsl(${(routeId * 137.508) % 360} 82% 58%)`,
        strokeWidth: showRatsnest ? 0.42 : 0.18,
      })
    }
  }

  return {
    coordinateSystem: "cartesian",
    title,
    lines,
    points: [],
    circles: pmp22650FinalTailFixture.remainingRouteIds.flatMap((routeId) => {
      const startPortId = pmp22650FinalTailProblem.routeStartPort[routeId]
      const endPortId = pmp22650FinalTailProblem.routeEndPort[routeId]
      return [startPortId, endPortId].map((portId) => ({
        center: {
          x: pmp22650FinalTailTopology.portX[portId],
          y: pmp22650FinalTailTopology.portY[portId],
        },
        radius: showRatsnest ? 0.55 : 0.35,
        fill: "#e2e8f0",
      }))
    }),
    rects: [],
  }
}
