import "bun-match-svg"
import { writeFileSync } from "node:fs"
import { expect, test } from "bun:test"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { loadSerializedHyperGraph } from "lib/compat/loadSerializedHyperGraph"
import {
  SelectiveReripTinyHyperGraphSolver,
  type TinyHyperGraphSolverOptions,
} from "lib/index"
import fixture from "tests/fixtures/bugreport87-unused-port-repro.json" with {
  type: "json",
}

const repro = fixture as unknown as {
  serializedHyperGraph: SerializedHyperGraph
  solveGraphOptions: TinyHyperGraphSolverOptions
}

const REPRO_TIMEOUT_MS = 30_000

test(
  "repro: unused port triggers a repeated selective rerip cycle",
  () => {
    const { topology, problem } = loadSerializedHyperGraph(
      repro.serializedHyperGraph,
    )
    const solver = new SelectiveReripTinyHyperGraphSolver(
      topology,
      problem,
      repro.solveGraphOptions,
    )

    const timeoutAt = performance.now() + REPRO_TIMEOUT_MS
    while (!solver.solved && !solver.failed && performance.now() < timeoutAt) {
      solver.step()
    }

    expect(solver.solved).toBe(true)
    expect(solver.failed).toBe(false)
    const maxRegionCost = Math.max(
      ...solver.state.regionIntersectionCaches.map(
        (cache) => cache.existingRegionCost,
      ),
    )
    expect(maxRegionCost).toBeLessThanOrEqual(
      Number(solver.stats.bestMaxRegionCost) + 1e-9,
    )
    const svg = getSvgFromGraphicsObject(solver.visualize())
    writeFileSync(
      new URL(
        "./__snapshots__/bugreport87-unused-port-repro.actual.svg",
        import.meta.url,
      ),
      svg,
    )
    console.log(
      JSON.stringify({
        routeCount: problem.routeCount,
        iterations: solver.iterations,
        maxRegionCost,
        routingStats: solver.stats,
      }),
    )
    expect(svg).toMatchSvgSnapshot(import.meta.path)
  },
  REPRO_TIMEOUT_MS + 10_000,
)
