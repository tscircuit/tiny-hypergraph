import { expect, test } from "bun:test"
import { SolverRuntime } from "@tscircuit/solver-utils/runtime/bun"
import { loadSerializedHyperGraph } from "../../lib/compat/loadSerializedHyperGraph"
import { TinyHyperGraphSolver } from "../../lib/core"
import { DistanceAwareTinyHyperGraphSolver } from "../../lib/distance-aware-tiny-hypergraph-solver"
import { OutsideInPartialRipTinyHyperGraphSolver } from "../../lib/outside-in-partial-rip-tiny-hypergraph-solver"
import { SelectiveReripTinyHyperGraphSolver } from "../../lib/selective-rerip-tiny-hyper-graph-solver"
import { sectionSolverFixtureGraph } from "../fixtures/section-solver.fixture"

test("parallel route searches preserve serial output, resumed state, conflicts, and iteration limits", async () => {
  const runtime = new SolverRuntime({
    workerCount: 4,
    workerUrl: new URL("../fixtures/route-search.worker.ts", import.meta.url),
    requireWorker: true,
    startupFailure: "throw",
  })
  try {
    let accepted = 0
    let conflicts = 0
    for (const Solver of [
      TinyHyperGraphSolver,
      DistanceAwareTinyHyperGraphSolver,
      OutsideInPartialRipTinyHyperGraphSolver,
      SelectiveReripTinyHyperGraphSolver,
    ]) {
      for (const maxIterations of [1, 5, 25, 100, 10000]) {
        for (const resume of [0, 1, 3]) {
          const create = () => {
            const { topology, problem } = loadSerializedHyperGraph(
              sectionSolverFixtureGraph,
            )
            return new Solver(topology, problem, {
              MAX_ITERATIONS: maxIterations,
              RIP_THRESHOLD_RAMP_ATTEMPTS: 2,
              GREEDY_FINAL_ROUTE_ITERS: 0,
            })
          }
          const serial = create()
          const parallel = create()
          for (let i = 0; i < resume; i++) parallel.step()
          serial.solve()
          await parallel.solveAsync(runtime)
          if (serial.solved && !serial.failed)
            expect(parallel.getOutput()).toEqual(serial.getOutput())
          expect(parallel.state.regionSegments).toEqual(
            serial.state.regionSegments,
          )
          expect(parallel.state.portAssignment).toEqual(
            serial.state.portAssignment,
          )
          expect(parallel.iterations).toBe(serial.iterations)
          expect(parallel.solved).toBe(serial.solved)
          expect(parallel.failed).toBe(serial.failed)
          expect(parallel.error).toBe(serial.error)
          expect(parallel.stats).toEqual(serial.stats)
          accepted += parallel.asyncStats.acceptedRoutes
          conflicts += parallel.asyncStats.conflictedRoutes
        }
      }
    }
    expect(accepted).toBeGreaterThan(0)
    expect(conflicts).toBeGreaterThan(0)
  } finally {
    await runtime.dispose()
  }
})
