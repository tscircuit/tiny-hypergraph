import "bun-match-svg"
import { expect, test } from "bun:test"
import {
  getSvgFromGraphicsObject,
  stackGraphicsVertically,
} from "graphics-debug"
import { loadSerializedHyperGraph } from "lib/compat/loadSerializedHyperGraph"
import { TinyHyperGraphSolver } from "lib/index"
import { sameNetSharedBottleneckFixture } from "tests/fixtures/same-net-shared-bottleneck.fixture"

test("repro: two same-net routes must share one bottleneck port to solve", () => {
  const { topology, problem } = loadSerializedHyperGraph(
    sameNetSharedBottleneckFixture,
  )
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
