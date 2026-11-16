import { expect, test } from "bun:test"
import type {
  TinyHyperGraphProblem,
  TinyHyperGraphTopology,
} from "lib/core"
import { PreparedPortPointRoutingSolver } from "lib/prepared/PreparedPortPointRoutingSolver"

test("live reachability recovers a blocked route within its bounded search budget", (): void => {
  const regionIncidentPorts = [
    [0, 1, 3, 5],
    [1, 2, 4, 6],
    [0],
    [2],
    [3],
    [4],
    [5, 6],
  ]
  const incidentPortRegion = [
    [0, 2],
    [0, 1],
    [1, 3],
    [0, 4],
    [1, 5],
    [0, 6],
    [1, 6],
  ]
  const xs = [-2, 0, 2, -1, 1, -1, 1]
  const ys = [0, 0, 0, -1, -1, 1, 1]
  const centersX = [-1, 1, -3, 3, -1, 1, 0]
  const centersY = [0, 0, 0, 0, -2, -2, 2]
  // The occupied bridge disconnects net0; these 24 penalized hops cannot reach
  // its goal. Exhausting them exceeds the 16-step budget for the whole solve.
  for (let index = 0; index < 24; index++) {
    const regionId = regionIncidentPorts.length
    const portId = xs.length
    const previousRegionId = index === 0 ? 0 : regionId - 1
    regionIncidentPorts[previousRegionId]!.push(portId)
    regionIncidentPorts.push([portId])
    incidentPortRegion.push([previousRegionId, regionId])
    xs.push(-1)
    ys.push(-2 - index)
    centersX.push(-1)
    centersY.push(-2.5 - index)
  }
  const topology: TinyHyperGraphTopology = {
    portCount: xs.length,
    regionCount: regionIncidentPorts.length,
    regionIncidentPorts,
    incidentPortRegion,
    regionWidth: new Float64Array(regionIncidentPorts.length).fill(4),
    regionHeight: new Float64Array(regionIncidentPorts.length).fill(4),
    regionCenterX: Float64Array.from(centersX),
    regionCenterY: Float64Array.from(centersY),
    portAngleForRegion1: new Int32Array(xs.length),
    portAngleForRegion2: new Int32Array(xs.length),
    portX: Float64Array.from(xs),
    portY: Float64Array.from(ys),
    portZ: new Int32Array(xs.length),
  }
  const problem: TinyHyperGraphProblem = {
    routeCount: 2,
    routeStartPort: new Int32Array([0, 3]),
    routeEndPort: new Int32Array([2, 4]),
    routeNet: new Int32Array([0, 1]),
    regionNetId: new Int32Array(regionIncidentPorts.length).fill(-1),
    portSectionMask: new Int8Array(xs.length).fill(1),
    portPenalty: new Float64Array(xs.length).fill(1000, 7),
    initialAssignments: [
      { routeId: 1, regionId: 0, fromPortId: 3, toPortId: 1 },
      { routeId: 1, regionId: 1, fromPortId: 1, toPortId: 4 },
    ],
  }
  problem.regionNetId[6] = 1
  const solver = new PreparedPortPointRoutingSolver(topology, problem, {
    MAX_ITERATIONS: 16,
    // Keep the public budget strict instead of starting optional final solves.
    ACCEPT_BEST_SOLUTION_ON_TIMEOUT: false,
  })
  solver.setup()
  expect(solver.failed).toBe(false)
  expect(solver.state.portAssignment[1]).toBe(1)
  solver.solve()

  expect(solver.error).toBeNull()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.iterations).toBeLessThan(solver.MAX_ITERATIONS)
  expect(solver.getSelectiveReripStats().selectiveRipCount).toBe(1)
  expect(solver.state.regionSegments[0]).toContainEqual([0, 0, 1])
  expect(solver.state.regionSegments[1]).toContainEqual([0, 1, 2])
  expect(solver.state.regionSegments[6]).toContainEqual([1, 5, 6])
})
