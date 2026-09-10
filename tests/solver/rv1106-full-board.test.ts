import "bun-match-svg"
import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import {
  getSvgFromGraphicsObject,
  stackGraphicsVertically,
} from "graphics-debug"
import { createRV1106Solver } from "../fixtures/rv1106-full-board"

test("replays the full RV1106 remaining-phase graph through selective rerips", () => {
  const solver = createRV1106Solver()
  expect(solver.topology.portCount).toBe(9434)
  expect(solver.topology.regionCount).toBe(2527)
  expect(solver.problem.routeCount).toBe(244)
  expect(solver.problem.initialAssignments).toHaveLength(90)
  expect(solver.MAX_ITERATIONS).toBe(2_000_000)
  const before = solver.visualize()

  const snapshotIterationBudget = 50_000
  while (
    !solver.solved &&
    !solver.failed &&
    solver.iterations < snapshotIterationBudget
  ) {
    solver.step()
  }
  expect(solver.iterations).toBe(snapshotIterationBudget)
  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(false)
  expect(solver.getSelectiveReripStats().selectiveRipCount).toBe(15)
  expect(solver.getSelectiveReripStats().selectivelyRippedRouteCount).toBe(22)
  const stateHash = createHash("sha256")
    .update(
      JSON.stringify({
        segments: solver.state.regionSegments,
        unrouted: solver.state.unroutedRoutes,
        stats: solver.getSelectiveReripStats(),
      }),
    )
    .digest("hex")
  expect(stateHash).toBe(
    "d8dcd5ec88decab82d8a4e775983b2938681ca08239a09b2cae82422dc3e9140",
  )

  const svg = getSvgFromGraphicsObject(
    stackGraphicsVertically([before, solver.visualize()], {
      titles: [
        "Full board: preloaded clock and flash paths",
        "Full board: 50,000 iterations, search incomplete",
      ],
    }),
  )
  expect(svg).toMatchSvgSnapshot(import.meta.path)
}, 30_000)
