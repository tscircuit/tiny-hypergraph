import "bun-match-svg"
import { expect, test } from "bun:test"
import {
  getSvgFromGraphicsObject,
  stackGraphicsVertically,
} from "graphics-debug"
import { loadSerializedHyperGraph } from "lib/compat/loadSerializedHyperGraph"
import { TinyHyperGraphSolver } from "lib/index"
import { yPreExitFixture } from "tests/fixtures/y-pre-exit.fixture"

test("repro: same-net route can join a Y before the exit obstacle", () => {
  const { topology, problem } = loadSerializedHyperGraph(yPreExitFixture)
  const solver = new TinyHyperGraphSolver(topology, problem)
  const beforeSolveGraphics = solver.visualize()

  solver.solve()
  const afterSolveGraphics = solver.visualize()

  const stagedSvg = getSvgFromGraphicsObject(
    stackGraphicsVertically([beforeSolveGraphics, afterSolveGraphics], {
      titles: ["before solve", "after solve"],
    }),
  )
  expect(stagedSvg).toMatchSvgSnapshot(import.meta.path)

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
})
