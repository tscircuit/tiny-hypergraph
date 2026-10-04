import { expect, test } from "bun:test"
import { DistanceAwareTinyHyperGraphSolver } from "lib/distance-aware-tiny-hypergraph-solver"

test("accounts for an unavoidable layer transition before entering a narrow region", () => {
  const solver = new DistanceAwareTinyHyperGraphSolver(
    {
      portCount: 6,
      regionCount: 6,
      regionIncidentPorts: [[0, 1, 4], [1, 2], [2, 3, 5], [4, 5], [0], [3]],
      incidentPortRegion: [
        [0, 4],
        [0, 1],
        [1, 2],
        [2, 5],
        [0, 3],
        [3, 2],
      ],
      regionWidth: new Float64Array([3, 0.1, 3, 10, 1, 1]),
      regionHeight: new Float64Array([3, 0.1, 3, 10, 1, 1]),
      regionCenterX: new Float64Array(6),
      regionCenterY: new Float64Array(6),
      portAngleForRegion1: new Int32Array(6),
      portX: new Float64Array([0, 1, 1.1, 2, 0, 2]),
      portY: new Float64Array([0, 0, 0, 0, 1, 1]),
      portZ: new Int32Array([0, 0, 1, 1, 0, 1]),
    },
    {
      routeCount: 1,
      portSectionMask: new Int8Array(6).fill(1),
      routeStartPort: new Int32Array([0]),
      routeEndPort: new Int32Array([3]),
      routeNet: new Int32Array([0]),
      regionNetId: new Int32Array(6).fill(-1),
      portPenalty: new Float64Array([0, 1, 0, 0, 1, 0]),
    },
  )
  solver.step()

  expect(solver.state.candidateQueue.toArray()[0]?.portId).toBe(4)
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.state.regionSegments[3]).toEqual([[0, 4, 5]])
})
