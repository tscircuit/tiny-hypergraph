import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
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
    startPortId: number
    endPortId: number
    segments: Array<{
      regionId: number
      fromPortId: number
      toPortId: number
    }>
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
})
