import "bun-match-svg"
import { expect, test } from "bun:test"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { createRV1106Solver } from "../fixtures/rv1106-full-board"

// Opt in because the full two-million-iteration search takes many minutes.
test.skipIf(process.env.RV1106_FULL_REPRO !== "1")(
  "captures the accepted full-board graph at the solver iteration limit",
  () => {
    const solver = createRV1106Solver()
    solver.solve()
    expect(solver.solved).toBe(true)
    expect(solver.failed).toBe(false)
    expect(solver.problem.routeCount).toBe(244)
    expect(solver.state.unroutedRoutes).toHaveLength(0)
    expect(getSvgFromGraphicsObject(solver.visualize())).toMatchSvgSnapshot(
      import.meta.path,
    )
  },
  20 * 60 * 1000,
)
