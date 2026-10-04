import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { DuplicateCongestedPortSolver } from "lib/index"

type Pmp23595CongestedPortRepro = {
  serializedHyperGraph: SerializedHyperGraph
  portUseCounts: Record<string, number>
}

test("PMP23595 reuses one solver workspace while finding congested ports", () => {
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
        USE_SPARSE_CANDIDATE_STORAGE: false,
        ACCEPT_BEST_SOLUTION_ON_TIMEOUT: true,
        GREEDY_FINAL_ROUTE_ITERS: 4,
        USE_LAZY_ROUTE_HEURISTIC: true,
        MAX_ITERATIONS: 2_000_000,
        RIP_THRESHOLD_RAMP_ATTEMPTS: 0,
        STATIC_REACHABILITY_PRECHECK: true,
      },
    },
  )

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.report.portUseCounts).toEqual(fixture.portUseCounts)
  expect(solver.report.duplicatedPorts).toHaveLength(411)
})
