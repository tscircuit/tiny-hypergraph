import "bun-match-svg"
import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import {
  type GraphicsObject,
  getSvgFromGraphicsObject,
  stackGraphicsHorizontally,
} from "graphics-debug"
import {
  loadSerializedHyperGraph,
  TinyHyperGraphSectionSolver,
  TinyHyperGraphSolver,
} from "lib/index"

type T113RouteRepro = {
  source: {
    circuit: string
    error: string
    stage: string
  }
  serializedHyperGraph: SerializedHyperGraph
  solvedRegionSegments: Array<Array<[number, number, number]>>
  route201: {
    metadata: {
      connectionId: string
      preloadedTraceSection: {
        startPoint: { x: number; y: number; z: number }
      }
    }
    startPortId: number
    endPortId: number
    segments: Array<{
      regionId: number
      fromPortId: number
      toPortId: number
    }>
  }
}

const focusOnClosedRoute = (
  graphics: GraphicsObject,
  connectionId: string,
  center: { x: number; y: number },
): GraphicsObject => {
  const viewRadius = 0.4
  const isLocalPoint = (point: { x: number; y: number }) =>
    Math.abs(point.x - center.x) <= viewRadius &&
    Math.abs(point.y - center.y) <= viewRadius
  const hasConnectionId = (label?: string) => label?.includes(connectionId)

  return {
    coordinateSystem: graphics.coordinateSystem,
    rects: graphics.rects?.filter(
      (rect) =>
        Math.abs(rect.center.x - center.x) <= rect.width / 2 + viewRadius &&
        Math.abs(rect.center.y - center.y) <= rect.height / 2 + viewRadius,
    ),
    circles: graphics.circles?.filter((circle) => isLocalPoint(circle.center)),
    points: graphics.points?.filter((point) => hasConnectionId(point.label)),
    lines: graphics.lines?.filter((line) => hasConnectionId(line.label)),
  }
}

test("serializes the closed preloaded route from the T113 Pipeline9 PCB", () => {
  const fixture = JSON.parse(
    gunzipSync(
      readFileSync(
        new URL(
          "../fixtures/t113-route201-real-repro.json.gz",
          import.meta.url,
        ),
      ),
    ).toString("utf8"),
  ) as T113RouteRepro

  expect(fixture.source).toEqual({
    circuit: "T113-S3 Linux board",
    stage: "Pipeline9 portPointPathingSolver",
    error: "Route 201 could not determine endpoint regions",
  })
  expect(fixture.serializedHyperGraph.ports).toHaveLength(47_061)
  expect(fixture.serializedHyperGraph.connections).toHaveLength(234)
  expect(fixture.route201.startPortId).toBe(fixture.route201.endPortId)
  expect(fixture.route201.segments).toHaveLength(2)

  const loaded = loadSerializedHyperGraph(fixture.serializedHyperGraph)
  const solver = new TinyHyperGraphSolver(loaded.topology, loaded.problem)
  solver.state.regionSegments = fixture.solvedRegionSegments
  solver.solved = true
  const routeCenter = fixture.route201.metadata.preloadedTraceSection.startPoint
  const beforeRoundTripGraphics = focusOnClosedRoute(
    solver.visualize(),
    fixture.route201.metadata.connectionId,
    routeCenter,
  )

  const output = solver.getOutput()
  const route = output.solvedRoutes?.[201]
  expect(route?.path).toHaveLength(3)
  expect(route?.path[0]?.portId).toBe(route?.path[2]?.portId)
  const replay = loadSerializedHyperGraph(output)
  expect(replay.solution.solvedRoutePathSegments[201]).toHaveLength(2)

  const sectionSolver = new TinyHyperGraphSectionSolver(
    replay.topology,
    replay.problem,
    replay.solution,
  )
  sectionSolver.tryFinalAcceptance()
  expect(sectionSolver.getOutput().solvedRoutes?.[201]?.path).toHaveLength(3)

  const afterRoundTripGraphics = focusOnClosedRoute(
    sectionSolver.visualize(),
    fixture.route201.metadata.connectionId,
    routeCenter,
  )
  const stagedSvg = getSvgFromGraphicsObject(
    stackGraphicsHorizontally(
      [beforeRoundTripGraphics, afterRoundTripGraphics],
      {
        titles: [
          "actual T113 closed fanout route before serialization",
          "same route preserved after serialization and section replay",
        ],
      },
    ),
    { svgWidth: 1_000, svgHeight: 420 },
  )
  expect(stagedSvg).toMatchSvgSnapshot(import.meta.path)
})
