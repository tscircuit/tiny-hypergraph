import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { DuplicateCongestedPortSolver } from "lib/DuplicateCongestedPortSolver"

type Pmp23595CongestedPortRepro = {
  source: {
    board: string
    dataset: string
    stage: string
  }
  serializedHyperGraph: SerializedHyperGraph
}

test("duplicates congested ports on the PMP23595 power converter graph", () => {
  const fixture = JSON.parse(
    gunzipSync(
      readFileSync(
        new URL(
          "../fixtures/pmp23595-congested-ports-repro.json.gz",
          import.meta.url,
        ),
      ),
    ).toString("utf8"),
  ) as Pmp23595CongestedPortRepro
  const solver = new DuplicateCongestedPortSolver(
    fixture.serializedHyperGraph,
    {
      duplicatePortProximity: 0.05,
      useSerializedPortPenalties: false,
      routeSolveOptions: {
        ACCEPT_BEST_SOLUTION_ON_TIMEOUT: true,
        GREEDY_FINAL_ROUTE_ITERS: 4,
        MAX_ITERATIONS: 2_000_000,
        RIP_THRESHOLD_RAMP_ATTEMPTS: 0,
        STATIC_REACHABILITY_PRECHECK: true,
        USE_SPARSE_CANDIDATE_STORAGE: false,
        minViaPadDiameter: 0.3,
      },
    },
  )
  const startedAt = performance.now()

  solver.solve()

  const durationMs = performance.now() - startedAt
  const duplicatedPortCount = solver.report.duplicatedPorts.reduce(
    (sum, duplicatedPort) => sum + duplicatedPort.duplicatePortIds.length,
    0,
  )
  console.log(
    `PMP23595 congested-port preprocessing duration=${durationMs.toFixed(3)}ms`,
  )

  expect(fixture.source).toEqual({
    board: "PMP23595 Four-Phase GaN Buck Converter",
    dataset: "dataset-srj24 sample021",
    stage: "Pipeline9 DuplicateCongestedPortSolver",
  })
  expect(fixture.serializedHyperGraph.regions).toHaveLength(29_696)
  expect(fixture.serializedHyperGraph.ports).toHaveLength(136_577)
  expect(fixture.serializedHyperGraph.connections).toHaveLength(458)
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.report.duplicatedPorts).toHaveLength(411)
  expect(duplicatedPortCount).toBe(683)
  expect(solver.getOutput().ports).toHaveLength(137_260)
})
