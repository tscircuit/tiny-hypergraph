import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import type { GraphicsObject } from "graphics-debug"
import type { TinyHyperGraphProblem, TinyHyperGraphTopology } from "lib/core"
import { SelectiveReripTinyHyperGraphSolver } from "lib/selective-rerip-tiny-hyper-graph-solver"

type Pmp22650RouteFixture = {
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
  targetRouteId: number
  regionCongestionCost: number[]
  ripCount: number
}

export const pmp22650RouteFixture = JSON.parse(
  gunzipSync(
    readFileSync(
      new URL(
        "../fixtures/pmp22650-route158-corrected.json.gz",
        import.meta.url,
      ),
    ),
  ).toString("utf8"),
) as Pmp22650RouteFixture

export const pmp22650RouteTopology: TinyHyperGraphTopology = {
  ...pmp22650RouteFixture.topology,
  regionWidth: new Float64Array(pmp22650RouteFixture.topology.regionWidth),
  regionHeight: new Float64Array(pmp22650RouteFixture.topology.regionHeight),
  regionCenterX: new Float64Array(pmp22650RouteFixture.topology.regionCenterX),
  regionCenterY: new Float64Array(pmp22650RouteFixture.topology.regionCenterY),
  regionAvailableZMask: new Int32Array(
    pmp22650RouteFixture.topology.regionAvailableZMask,
  ),
  portAngleForRegion1: new Int32Array(
    pmp22650RouteFixture.topology.portAngleForRegion1,
  ),
  portAngleForRegion2: new Int32Array(
    pmp22650RouteFixture.topology.portAngleForRegion2,
  ),
  portX: new Float64Array(pmp22650RouteFixture.topology.portX),
  portY: new Float64Array(pmp22650RouteFixture.topology.portY),
  portZ: new Int32Array(pmp22650RouteFixture.topology.portZ),
}

export const pmp22650RouteProblem: TinyHyperGraphProblem = {
  ...pmp22650RouteFixture.problem,
  portSectionMask: new Int8Array(pmp22650RouteFixture.problem.portSectionMask),
  routeStartPort: new Int32Array(pmp22650RouteFixture.problem.routeStartPort),
  routeEndPort: new Int32Array(pmp22650RouteFixture.problem.routeEndPort),
  routeNet: new Int32Array(pmp22650RouteFixture.problem.routeNet),
  regionNetId: new Int32Array(pmp22650RouteFixture.problem.regionNetId),
  portPenalty: new Float64Array(pmp22650RouteFixture.problem.portPenalty),
}

export const createPmp22650RouteSolver = () => {
  const solver = new SelectiveReripTinyHyperGraphSolver(
    pmp22650RouteTopology,
    pmp22650RouteProblem,
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
    pmp22650RouteFixture.regionCongestionCost,
  )
  solver.state.unroutedRoutes = [pmp22650RouteFixture.targetRouteId]
  solver.state.ripCount = pmp22650RouteFixture.ripCount
  return solver
}

export const getPmp22650RouteGraphics = ({
  solver,
  title,
  showRatsnest = false,
}: {
  solver: SelectiveReripTinyHyperGraphSolver
  title: string
  showRatsnest?: boolean
}): GraphicsObject => {
  const targetRouteIds = new Set([pmp22650RouteFixture.targetRouteId])
  const lines: NonNullable<GraphicsObject["lines"]> = showRatsnest
    ? [pmp22650RouteFixture.targetRouteId].map((routeId) => {
        const startPortId = pmp22650RouteProblem.routeStartPort[routeId]
        const endPortId = pmp22650RouteProblem.routeEndPort[routeId]
        return {
          points: [
            {
              x: pmp22650RouteTopology.portX[startPortId],
              y: pmp22650RouteTopology.portY[startPortId],
            },
            {
              x: pmp22650RouteTopology.portX[endPortId],
              y: pmp22650RouteTopology.portY[endPortId],
            },
          ],
          strokeColor: "#334155",
          strokeWidth: 0.015,
        }
      })
    : []
  for (const regionSegments of solver.state.regionSegments) {
    for (const [routeId, fromPortId, toPortId] of regionSegments) {
      if (!targetRouteIds.has(routeId)) continue
      lines.push({
        points: [
          {
            x: pmp22650RouteTopology.portX[fromPortId],
            y: pmp22650RouteTopology.portY[fromPortId],
          },
          {
            x: pmp22650RouteTopology.portX[toPortId],
            y: pmp22650RouteTopology.portY[toPortId],
          },
        ],
        strokeColor: `hsl(${(routeId * 137.508) % 360} 82% 58%)`,
        strokeWidth: showRatsnest ? 0.05 : 0.02,
      })
    }
  }

  return {
    coordinateSystem: "cartesian",
    title,
    lines,
    points: [],
    circles: [pmp22650RouteFixture.targetRouteId].flatMap((routeId) => {
      const startPortId = pmp22650RouteProblem.routeStartPort[routeId]
      const endPortId = pmp22650RouteProblem.routeEndPort[routeId]
      return [startPortId, endPortId].map((portId) => ({
        center: {
          x: pmp22650RouteTopology.portX[portId],
          y: pmp22650RouteTopology.portY[portId],
        },
        radius: 0.03,
        fill: "#e2e8f0",
      }))
    }),
    rects: [],
  }
}
