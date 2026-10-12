import { expect, test } from "bun:test"
import { TinyHyperGraphSolver } from "lib/core"

test("searches every region incident to a route terminal", () => {
  const solver = new TinyHyperGraphSolver(
    {
      portCount: 3,
      regionCount: 3,
      regionIncidentPorts: [[0], [0, 1], [1, 2]],
      incidentPortRegion: [[0, 1], [1, 2], [2]],
      regionWidth: new Float64Array(3).fill(1),
      regionHeight: new Float64Array(3).fill(1),
      regionCenterX: new Float64Array([0, 1, 2]),
      regionCenterY: new Float64Array(3),
      portAngleForRegion1: new Int32Array(3),
      portAngleForRegion2: new Int32Array(3),
      portX: new Float64Array([0, 1, 2]),
      portY: new Float64Array(3),
      portZ: new Int32Array(3),
    },
    {
      routeCount: 1,
      portSectionMask: new Int8Array(3).fill(1),
      routeStartPort: new Int32Array([0]),
      routeEndPort: new Int32Array([2]),
      routeNet: new Int32Array([0]),
      regionNetId: new Int32Array(3).fill(-1),
    },
  )

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.state.regionSegments[1]).toEqual([[0, 0, 1]])
  expect(solver.state.regionSegments[2]).toEqual([[0, 1, 2]])
})
