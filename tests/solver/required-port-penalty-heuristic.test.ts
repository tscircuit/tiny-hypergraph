import { expect, test } from "bun:test"
import { DistanceAwareTinyHyperGraphSolver } from "lib/distance-aware-tiny-hypergraph-solver"

test("required port costs guide search past occupied and reserved shortcuts", () => {
  const incidentPortRegion = [
    [0, 3],
    [0, 1],
    [1, 4],
    [0, 2],
    [2, 1],
    [0, 1],
    [0, 5],
    [0, 1],
    [6, 7],
  ]
  const regionIncidentPorts: number[][] = Array.from({ length: 8 }, () => [])
  for (const [portId, regions] of incidentPortRegion.entries()) {
    for (const regionId of regions) regionIncidentPorts[regionId].push(portId)
  }
  const solver = new DistanceAwareTinyHyperGraphSolver(
    {
      portCount: 9,
      regionCount: 8,
      incidentPortRegion,
      regionIncidentPorts,
      regionWidth: new Float64Array(8).fill(10),
      regionHeight: new Float64Array(8).fill(10),
      regionCenterX: new Float64Array(8),
      regionCenterY: new Float64Array(8),
      portAngleForRegion1: new Int32Array(9),
      portX: new Float64Array([0, 1, 2, 0.5, 1.5, 1, 0.7, 1, 5]),
      portY: new Float64Array([0, 0, 0, 0.2, 0.2, 0.3, -0.2, 0.4, 5]),
      portZ: new Int32Array(9),
    },
    {
      routeCount: 2,
      portSectionMask: new Int8Array(9).fill(1),
      routeStartPort: new Int32Array([0, 7]),
      routeEndPort: new Int32Array([2, 8]),
      routeNet: new Int32Array([0, 1]),
      regionNetId: new Int32Array([-1, -1, 1, -1, -1, -1, -1, -1]),
      portPenalty: new Float64Array([0, 150, 0, 0, 0, 0, 0, 0, 0]),
    },
    { STATIC_REACHABILITY_PRECHECK: false },
  )
  solver.state.portAssignment[5] = 1
  solver.step()

  expect(solver.state.candidateQueue.toArray()[0]?.portId).toBe(1)
  const blockedEstimate = solver.computeH(6, 5)
  solver.state.portAssignment[5] = -1
  solver.resetCandidateBestCosts()
  expect(blockedEstimate - solver.computeH(6, 5)).toBeCloseTo(150)
})
