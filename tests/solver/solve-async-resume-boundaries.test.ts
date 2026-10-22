import { expect, test } from "bun:test"
import { SolverRuntime } from "@tscircuit/solver-utils"
import { TinyHyperGraphSectionPipelineSolver } from "../../lib/section-solver/TinyHyperGraphSectionPipelineSolver"
import { sectionSolverFixtureGraph } from "../fixtures/section-solver.fixture"

test("async pipeline resumes terminal children and bounded prefixes without changing iteration accounting", async () => {
  const runtime = new SolverRuntime()
  const create = () =>
    new TinyHyperGraphSectionPipelineSolver({
      serializedHyperGraph: structuredClone(sectionSolverFixtureGraph),
      createSectionMask: ({ topology }) => new Int8Array(topology.portCount),
      solveGraphOptions: { RIP_THRESHOLD_RAMP_ATTEMPTS: 2 },
    })
  try {
    for (const prefix of [0, 1, 5, 20]) {
      const serial = create()
      const parallel = create()
      for (let index = 0; index < prefix; index++) serial.step()
      await parallel.solveAsync(runtime, prefix)
      expect(parallel.iterations).toBe(serial.iterations)
      serial.solve()
      await parallel.solveAsync(runtime)
      expect(parallel.iterations).toBe(serial.iterations)
      expect(parallel.getOutput()).toEqual(serial.getOutput())
    }
    const serial = create()
    const parallel = create()
    for (const solver of [serial, parallel]) {
      solver.step()
      solver.activeSubSolver!.solve()
    }
    serial.solve()
    await parallel.solveAsync(runtime)
    expect(parallel.iterations).toBe(serial.iterations)
    expect(parallel.getOutput()).toEqual(serial.getOutput())
  } finally {
    await runtime.dispose()
  }
})
