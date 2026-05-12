import "bun-match-svg"
import { expect, test } from "bun:test"
import {
  getSvgFromGraphicsObject,
  stackGraphicsVertically,
} from "graphics-debug"
import { loadSerializedHyperGraph } from "lib/compat/loadSerializedHyperGraph"
import { TinyHyperGraphSolver } from "lib/index"
import { portChokepointFixture } from "tests/fixtures/port-chokepoint.fixture"

test("repro: two different nets cannot share the one-port chokepoint", () => {
  const { topology, problem } = loadSerializedHyperGraph(portChokepointFixture)
  const solver = new TinyHyperGraphSolver(topology, problem, {
    MAX_ITERATIONS: 20_000,
    STATIC_REACHABILITY_PRECHECK: false,
  })
  const beforeSolveGraphics = solver.visualize()

  solver.solve()
  const afterSolveGraphics = solver.visualize()

  const stagedSvg = getSvgFromGraphicsObject(
    stackGraphicsVertically([beforeSolveGraphics, afterSolveGraphics], {
      titles: ["before solve", "after failed solve"],
    }),
  )
  expect(stagedSvg).toMatchSvgSnapshot(import.meta.path)

  expect(solver.solved).toBe(false)
  expect(solver.failed).toBe(true)
  expect(solver.error).toBe("TinyHyperGraphSolver ran out of iterations")
})
