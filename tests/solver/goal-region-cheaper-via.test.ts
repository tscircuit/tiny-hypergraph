import "bun-match-svg"
import { expect, test } from "bun:test"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { DistanceAwareTinyHyperGraphSolver } from "lib/distance-aware-tiny-hypergraph-solver"

test("searches other exits before accepting a costly via beside the goal", () => {
  const solver = new DistanceAwareTinyHyperGraphSolver(
    {
      portCount: 4,
      regionCount: 4,
      regionIncidentPorts: [[0, 1, 2, 3], [2, 3], [0], [1]],
      incidentPortRegion: [
        [0, 2],
        [0, 3],
        [0, 1],
        [0, 1],
      ],
      regionWidth: new Float64Array([0.1, 10, 1, 1]),
      regionHeight: new Float64Array([0.1, 10, 1, 1]),
      regionCenterX: new Float64Array(4),
      regionCenterY: new Float64Array(4),
      portAngleForRegion1: new Int32Array([18000, 0, 9000, 9000]),
      portX: new Float64Array([-0.05, 0.05, -0.025, 0.025]),
      portY: new Float64Array([0, 0, 0.05, 0.05]),
      portZ: new Int32Array([0, 1, 0, 1]),
    },
    {
      routeCount: 1,
      portSectionMask: new Int8Array(4).fill(1),
      routeStartPort: new Int32Array([0]),
      routeEndPort: new Int32Array([1]),
      routeNet: new Int32Array([0]),
      regionNetId: new Int32Array(4).fill(-1),
    },
  )
  solver.solve()

  const graphics = solver.visualize()
  graphics.rects = graphics.rects?.filter((rect) => rect.width <= 0.1)
  graphics.circles = graphics.circles?.map((circle) => ({
    ...circle,
    radius: 0.001,
  }))
  expect(
    getSvgFromGraphicsObject(graphics, {
      backgroundColor: "white",
    }),
  ).toMatchSvgSnapshot(import.meta.path)
  expect(solver.solved).toBe(true)
  expect(solver.state.regionSegments[1]).toEqual([[0, 2, 3]])
})
