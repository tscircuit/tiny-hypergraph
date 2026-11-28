import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import {
  DuplicateCongestedPortSolver,
  TinyHyperGraphSolver,
  loadSerializedHyperGraph,
  type TinyHyperGraphSolverOptions,
} from "lib/index"

type Pmp23595CongestedPortRepro = {
  serializedHyperGraph: SerializedHyperGraph
  portUseCounts: Record<string, number>
}

const getFreshWorkspacePortUseCounts = (
  graph: SerializedHyperGraph,
  options: TinyHyperGraphSolverOptions,
): Record<string, number> => {
  const { topology, problem } = loadSerializedHyperGraph(graph)
  const counts: Record<string, number> = {}
  for (let routeId = 0; routeId < problem.routeCount; routeId++) {
    const fresh = new TinyHyperGraphSolver(
      topology,
      {
        ...problem,
        routeCount: 1,
        routeStartPort: Int32Array.from([problem.routeStartPort[routeId]!]),
        routeEndPort: Int32Array.from([problem.routeEndPort[routeId]!]),
        routeNet: Int32Array.from([problem.routeNet[routeId]!]),
        routeMetadata: problem.routeMetadata && [
          problem.routeMetadata[routeId],
        ],
        portPenalty: undefined,
      },
      options,
    )
    fresh.solve()
    expect(fresh.solved).toBeTrue()
    expect(fresh.failed).toBeFalse()
    const ports = new Set<number>()
    for (const segments of fresh.state.regionSegments) {
      for (const [, start, end] of segments) {
        ports.add(start)
        ports.add(end)
      }
    }
    if (ports.size === 0) {
      ports.add(problem.routeStartPort[routeId]!)
      ports.add(problem.routeEndPort[routeId]!)
    }
    for (const portId of ports) {
      const metadata = topology.portMetadata![portId]!
      const id: string = metadata.serializedPortId
      counts[id] = (counts[id] ?? 0) + 1
    }
  }
  return counts
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
  const routeSolveOptions: TinyHyperGraphSolverOptions = {
    USE_SPARSE_CANDIDATE_STORAGE: false,
    ACCEPT_BEST_SOLUTION_ON_TIMEOUT: true,
    GREEDY_FINAL_ROUTE_ITERS: 4,
    MAX_ITERATIONS: 2_000_000,
    RIP_THRESHOLD_RAMP_ATTEMPTS: 0,
    STATIC_REACHABILITY_PRECHECK: true,
  }
  const solver = new DuplicateCongestedPortSolver(
    fixture.serializedHyperGraph,
    {
      duplicatePortProximity: 0.05,
      useSerializedPortPenalties: false,
      routeSolveOptions,
    },
  )

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  // Compare reuse with independent searches using the current routing costs.
  expect(solver.report.portUseCounts).toEqual(
    getFreshWorkspacePortUseCounts(
      fixture.serializedHyperGraph,
      routeSolveOptions,
    ),
  )
  expect(solver.report.duplicatedPorts.length).toBeLessThanOrEqual(411)
})
