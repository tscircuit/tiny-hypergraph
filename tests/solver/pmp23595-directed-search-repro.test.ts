import "bun-match-svg"
import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { getSvgFromGraphicsObject } from "graphics-debug"
import {
  DuplicateCongestedPortSolver,
  loadSerializedHyperGraph,
  SelectiveReripTinyHyperGraphSolver,
  type TinyHyperGraphInitialAssignment,
} from "lib/index"

type Pmp23595Fixture = {
  serializedHyperGraph: SerializedHyperGraph
  portUseCounts: Record<string, number>
}

type Pmp23595RouteSearchState = {
  source: {
    board: string
    dataset: string
    stage: string
  }
  targetRouteId: number
  initialAssignments: TinyHyperGraphInitialAssignment[]
}

type GraphicsItem = {
  label?: string
}

class Pmp23595DuplicateCongestedPortSolver extends DuplicateCongestedPortSolver {
  duplicateWithCapturedPortUseCounts(
    portUseCounts: Record<string, number>,
  ): SerializedHyperGraph {
    return this.duplicateCongestedPorts(new Map(Object.entries(portUseCounts)))
  }
}

const readCompressedJson = <T>(path: URL): T =>
  JSON.parse(gunzipSync(readFileSync(path)).toString("utf8")) as T

const addAutorouterPortPenalties = (graph: SerializedHyperGraph): void => {
  for (const port of graph.ports) {
    const metadata = port.d as {
      cramped?: boolean
      duplicatedFromPortId?: string
      tinyHypergraphPortPenalty?: number
    }
    const additionalPenalty =
      (metadata.cramped ? 150 : 0) +
      (typeof metadata.duplicatedFromPortId === "string" ? 150 : 0)
    if (additionalPenalty === 0) continue
    metadata.tinyHypergraphPortPenalty =
      Number(metadata.tinyHypergraphPortPenalty ?? 0) + additionalPenalty
  }
}

const getFocusedRouteSearchGraphics = (
  solver: SelectiveReripTinyHyperGraphSolver,
  routeLabel: string,
) => {
  const graphics = solver.visualize()
  const points = (graphics.points ?? []).filter(
    (point: GraphicsItem) =>
      !point.label?.startsWith("route:") || point.label.includes(routeLabel),
  )
  const activeRegionIds = new Set<number>()
  for (const point of points) {
    for (const match of point.label?.matchAll(/region-(\d+)/g) ?? []) {
      activeRegionIds.add(Number(match[1]))
    }
  }

  return {
    ...graphics,
    title: `${routeLabel}: exact bidirectional route after ${solver.iterations.toLocaleString()} iterations`,
    points,
    lines: (graphics.lines ?? []).filter(
      (line: GraphicsItem) => !line.label || line.label.includes(routeLabel),
    ),
    rects: (graphics.rects ?? []).filter((rect: GraphicsItem) => {
      const regionId = Number(rect.label?.match(/^region: region-(\d+)/)?.[1])
      return activeRegionIds.has(regionId)
    }),
  }
}

const SEARCH_ITERATION_BUDGET = 30_000

test("PMP23595 route 298 exhaustively explores from one endpoint", () => {
  const fixture = readCompressedJson<Pmp23595Fixture>(
    new URL(
      "../fixtures/pmp23595-congested-ports-repro.json.gz",
      import.meta.url,
    ),
  )
  const routeSearchState = readCompressedJson<Pmp23595RouteSearchState>(
    new URL(
      "../fixtures/pmp23595-route-298-search-state.json.gz",
      import.meta.url,
    ),
  )
  const duplicateSolver = new Pmp23595DuplicateCongestedPortSolver(
    fixture.serializedHyperGraph,
    {
      duplicatePortProximity: 0.05,
      useSerializedPortPenalties: false,
    },
  )
  const graph = duplicateSolver.duplicateWithCapturedPortUseCounts(
    fixture.portUseCounts,
  )
  graph.solvedRoutes = fixture.serializedHyperGraph.solvedRoutes
  addAutorouterPortPenalties(graph)
  const { topology, problem } = loadSerializedHyperGraph(graph)
  problem.initialAssignments = routeSearchState.initialAssignments
  const solver = new SelectiveReripTinyHyperGraphSolver(topology, problem, {
    DISTANCE_TO_COST: 0.05,
    RIP_THRESHOLD_START: Number.POSITIVE_INFINITY,
    RIP_THRESHOLD_END: Number.POSITIVE_INFINITY,
    RIP_CONGESTION_REGION_COST_FACTOR: 0.1,
    ACCEPT_BEST_SOLUTION_ON_TIMEOUT: false,
    GREEDY_FINAL_ROUTE_ITERS: 0,
    PARTIAL_RIP_ENABLED: false,
    OUTSIDE_IN_ROUTING: false,
    USE_SPARSE_CANDIDATE_STORAGE: false,
    EXACT_BIDIRECTIONAL_FALLBACK_EXPANSION_THRESHOLD: 10_000,
    RIP_THRESHOLD_RAMP_ATTEMPTS: 0,
    MAX_ITERATIONS: 2_000_000,
    STATIC_REACHABILITY_PRECHECK: true,
  })
  solver.state.unroutedRoutes = [routeSearchState.targetRouteId]

  while (
    !solver.solved &&
    !solver.failed &&
    solver.iterations < SEARCH_ITERATION_BUDGET
  ) {
    solver.step()
  }

  const targetRoute = problem.routeMetadata?.[routeSearchState.targetRouteId]
  const routeLabel =
    targetRoute?.connectionId ?? `route-${routeSearchState.targetRouteId}`
  expect(routeSearchState.source).toEqual({
    board: "PMP23595 Four-Phase GaN Buck Converter",
    dataset: "dataset-srj24 sample021",
    stage: "Pipeline9 tiny-hypergraph route search",
  })
  expect(topology.portCount).toBe(137_226)
  expect(topology.regionCount).toBe(29_691)
  expect(problem.routeCount).toBe(458)
  expect(solver.solved).toBe(true)
  expect(solver.iterations).toBeLessThan(SEARCH_ITERATION_BUDGET)
  expect(solver.state.currentRouteId).toBeUndefined()
  expect(solver.stats.exactBidirectionalForwardExpansionCount).toBeGreaterThan(
    0,
  )
  expect(solver.stats.exactBidirectionalReverseExpansionCount).toBeGreaterThan(
    0,
  )
  expect(
    solver.state.regionSegments
      .flat()
      .filter(([routeId]) => routeId === routeSearchState.targetRouteId),
  ).not.toHaveLength(0)
  expect(
    getSvgFromGraphicsObject(
      getFocusedRouteSearchGraphics(solver, routeLabel),
      { backgroundColor: "white" },
    ),
  ).toMatchSvgSnapshot(import.meta.path)
})
