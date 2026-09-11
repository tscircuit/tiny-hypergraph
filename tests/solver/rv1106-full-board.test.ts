import "bun-match-svg"
import { expect, test } from "bun:test"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { createRV1106Solver } from "../fixtures/rv1106-full-board"

test.skipIf(process.env.RV1106_FULL_REPRO !== "1")(
  "captures the full RV1106 graph",
  () => {
    const solver = createRV1106Solver()
    expect(solver.topology.portCount).toBe(9434)
    expect(solver.topology.regionCount).toBe(2527)
    expect(solver.problem.routeCount).toBe(244)
    expect(solver.problem.initialAssignments).toHaveLength(90)
    solver.solve()
    expect(solver.solved).toBe(true)
    expect(solver.failed).toBe(false)
    expect(solver.state.unroutedRoutes).toHaveLength(0)
    expect(getSvgFromGraphicsObject(solver.visualize())).toMatchSvgSnapshot(
      import.meta.path,
    )
  },
  20 * 60 * 1000,
)
