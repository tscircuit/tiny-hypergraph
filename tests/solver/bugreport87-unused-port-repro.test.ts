import "bun-match-svg"
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
    expect(getSvgFromGraphicsObject(solver.visualize())).toMatchSvgSnapshot(
      import.meta.path,
    )
  },
  REPRO_TIMEOUT_MS + 10_000,
)
