import "bun-match-svg"
import { expect, test } from "bun:test"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { RegionPathSolver } from "lib/index"
import {
  negotiatedRegionPathProblem,
  negotiatedRegionPathTopology,
} from "tests/fixtures/negotiated-region-path.fixture"

test("region path planner assigns a constrained one-lane boundary", () => {
  const solver = new RegionPathSolver(
    negotiatedRegionPathTopology,
    negotiatedRegionPathProblem,
    { USE_TOPOLOGY_CAPACITY: true },
  )

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(getSvgFromGraphicsObject(solver.visualize())).toMatchSvgSnapshot(
    import.meta.path,
  )
})
