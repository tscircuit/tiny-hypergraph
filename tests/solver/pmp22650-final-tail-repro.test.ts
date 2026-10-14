import "bun-match-svg"
import { expect, test } from "bun:test"
import {
  getSvgFromGraphicsObject,
  stackGraphicsVertically,
} from "graphics-debug"
import {
  createPmp22650FinalTailSolver,
  getPmp22650FinalTailGraphics,
  pmp22650FinalTailFixture,
} from "./pmp22650-final-tail-fixture"

test("routes the PMP22650 final tail", () => {
  expect(pmp22650FinalTailFixture.source).toEqual({
    board: "TI PMP22650",
    dataset: "@tscircuit/dataset-srj24 sample024",
    captureBoundary: "before final greedy route acceptance",
  })
  const solver = createPmp22650FinalTailSolver()
  const beforeGraphics = getPmp22650FinalTailGraphics({
    solver,
    title: "before final routing",
  })

  solver.tryFinalAcceptance()

  const afterGraphics = getPmp22650FinalTailGraphics({
    solver,
    title: "after final routing attempt",
  })
  expect(
    getSvgFromGraphicsObject(
      stackGraphicsVertically([beforeGraphics, afterGraphics]),
      {
        backgroundColor: "#0d1b2a",
        svgWidth: 1400,
        svgHeight: 900,
      },
    ),
  ).toMatchSvgSnapshot(import.meta.path)
  expect(solver.solved).toBeFalse()
  expect(solver.state.unroutedRoutes).toHaveLength(86)
  expect(solver.stats.greedyFinalRouteMaxIterations).toBe(50_000)
}, 120_000)
