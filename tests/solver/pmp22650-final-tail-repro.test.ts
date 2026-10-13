import "bun-match-svg"
import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import {
  getSvgFromGraphicsObject,
  stackGraphicsVertically,
  type GraphicsObject,
} from "graphics-debug"
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

const fixture = JSON.parse(
  gunzipSync(
    readFileSync(
      new URL("../fixtures/pmp22650-final-tail.json.gz", import.meta.url),
    ),
  ).toString("utf8"),
) as Pmp22650FinalTailFixture

const topology: TinyHyperGraphTopology = {
  ...fixture.topology,
  regionWidth: new Float64Array(fixture.topology.regionWidth),
  regionHeight: new Float64Array(fixture.topology.regionHeight),
  regionCenterX: new Float64Array(fixture.topology.regionCenterX),
  regionCenterY: new Float64Array(fixture.topology.regionCenterY),
  regionAvailableZMask: new Int32Array(fixture.topology.regionAvailableZMask),
  portAngleForRegion1: new Int32Array(fixture.topology.portAngleForRegion1),
  portAngleForRegion2: new Int32Array(fixture.topology.portAngleForRegion2),
  portX: new Float64Array(fixture.topology.portX),
  portY: new Float64Array(fixture.topology.portY),
  portZ: new Int32Array(fixture.topology.portZ),
}

const problem: TinyHyperGraphProblem = {
  ...fixture.problem,
  portSectionMask: new Int8Array(fixture.problem.portSectionMask),
  routeStartPort: new Int32Array(fixture.problem.routeStartPort),
  routeEndPort: new Int32Array(fixture.problem.routeEndPort),
  routeNet: new Int32Array(fixture.problem.routeNet),
  regionNetId: new Int32Array(fixture.problem.regionNetId),
  portPenalty: new Float64Array(fixture.problem.portPenalty),
}

const getPmp22650FinalTailGraphics = ({
  solver,
  remainingRouteIds,
  title,
}: {
  solver: SelectiveReripTinyHyperGraphSolver
  remainingRouteIds: ReadonlySet<number>
  title: string
}): GraphicsObject => {
  const lines: NonNullable<GraphicsObject["lines"]> = []
  for (const regionSegments of solver.state.regionSegments) {
    for (const [routeId, fromPortId, toPortId] of regionSegments) {
      if (!remainingRouteIds.has(routeId)) continue
      lines.push({
        points: [
          { x: topology.portX[fromPortId], y: topology.portY[fromPortId] },
          { x: topology.portX[toPortId], y: topology.portY[toPortId] },
        ],
        strokeColor: `hsl(${(routeId * 137.508) % 360} 82% 58%)`,
        strokeWidth: 0.18,
      })
    }
  }

  return {
    coordinateSystem: "cartesian",
    title,
    lines,
    points: [],
    circles: fixture.remainingRouteIds.flatMap((routeId) => {
      const startPortId = problem.routeStartPort[routeId]
      const endPortId = problem.routeEndPort[routeId]
      return [startPortId, endPortId].map((portId) => ({
        center: { x: topology.portX[portId], y: topology.portY[portId] },
        radius: 0.35,
        fill: "#e2e8f0",
      }))
    }),
    rects: [],
  }
}

test("routes the PMP22650 final tail", () => {
  expect(fixture.source).toEqual({
    board: "TI PMP22650",
    dataset: "@tscircuit/dataset-srj24 sample024",
    captureBoundary: "before final greedy route acceptance",
  })
  const solver = new SelectiveReripTinyHyperGraphSolver(topology, problem, {
    DISTANCE_TO_COST: 0.05,
    RIP_THRESHOLD_START: 0.05,
    RIP_THRESHOLD_END: 0.8,
    RIP_CONGESTION_REGION_COST_FACTOR: 0.1,
    ACCEPT_BEST_SOLUTION_ON_TIMEOUT: true,
    GREEDY_FINAL_ROUTE_ITERS: 1,
    PARTIAL_RIP_ENABLED: false,
    OUTSIDE_IN_ROUTING: true,
    MULTI_ROUTE_CONNECTION_OUTSIDE_IN_ROUTING: true,
    MULTI_ROUTE_CONNECTION_OUTSIDE_IN_MIN_ROUTE_COUNT: 256,
    STATIC_REACHABILITY_PRECHECK: false,
    USE_SPARSE_CANDIDATE_STORAGE: false,
    RIP_THRESHOLD_RAMP_ATTEMPTS: 10,
    MAX_ITERATIONS: 64_000_000,
  })
  solver.state.regionCongestionCost.set(fixture.regionCongestionCost)
  solver.state.unroutedRoutes = [...fixture.remainingRouteIds]
  solver.state.ripCount = 8
  const remainingRouteIds = new Set(fixture.remainingRouteIds)
  const beforeGraphics = getPmp22650FinalTailGraphics({
    solver,
    remainingRouteIds,
    title: "before final routing",
  })

  solver.tryFinalAcceptance()

  const afterGraphics = getPmp22650FinalTailGraphics({
    solver,
    remainingRouteIds,
    title: "after final routing attempt",
  })
  expect(
    getSvgFromGraphicsObject(
      stackGraphicsVertically([beforeGraphics, afterGraphics]),
      {
        backgroundColor: "#0d1b2a",
        svgWidth: 1400,
        svgHeight: 900,
      },
    ),
  ).toMatchSvgSnapshot(import.meta.path)
  expect(solver.solved).toBeTrue()
  expect(solver.state.unroutedRoutes).toEqual([])
  expect(solver.stats.greedyFinalRouteMaxIterations).toBeGreaterThan(50_000)
}, 120_000)
