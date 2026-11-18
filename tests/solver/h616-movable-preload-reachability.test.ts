import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import {
  loadSerializedHyperGraph,
  PreparedPortPointRoutingSolver,
} from "lib/index"

test("H616 RAM reference remains reachable around movable DDR preloads", () => {
  // Full-board Core input at the ordinary-signal stage, after both DDR bytes
  // and the remaining DDR signals have completed routing.
  const graph = JSON.parse(
    gunzipSync(
      readFileSync(
        new URL(
          "../fixtures/h616-ordinary-signals-hypergraph.json.gz",
          import.meta.url,
        ),
      ),
    ).toString("utf8"),
  ) as SerializedHyperGraph
  const { topology, problem } = loadSerializedHyperGraph(graph)
  const solver = new PreparedPortPointRoutingSolver(topology, problem)
  const initialPortAssignment = new Int32Array(solver.state.portAssignment)
  const initialRegionSegments = structuredClone(solver.state.regionSegments)
  expect(problem.initialAssignments?.length).toBeGreaterThan(0)
  expect(
    problem.routeMetadata?.some(
      (route) => route.connectionId === "source_net_1_mst0",
    ),
  ).toBe(true)
  solver.setup()
  expect(solver.failed).toBe(false)
  expect(solver.getStaticallyUnroutableRoutes()).toEqual([])
  expect(solver.state.portAssignment).toEqual(initialPortAssignment)
  expect(solver.state.regionSegments).toEqual(initialRegionSegments)
})
