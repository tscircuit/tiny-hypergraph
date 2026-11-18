import { expect, test } from "bun:test"
import {
  PreparedPortPointRoutingSolver,
  type TinyHyperGraphProblem,
  type TinyHyperGraphTopology,
} from "lib/index"

test("static reachability permits a movable preload to reroute and preserves permanent reservations", () => {
  const topology: TinyHyperGraphTopology = {
    portCount: 7,
    regionCount: 7,
    regionIncidentPorts: [
      [0, 1, 3, 5],
      [1, 2, 4, 6],
      [0],
      [2],
      [3],
      [4],
      [5, 6],
    ],
    incidentPortRegion: [
      [0, 2],
      [0, 1],
      [1, 3],
      [0, 4],
      [1, 5],
      [0, 6],
      [1, 6],
    ],
    regionWidth: new Float64Array(7).fill(4),
    regionHeight: new Float64Array(7).fill(4),
    regionCenterX: new Float64Array([-1, 1, -3, 3, -1, 1, 0]),
    regionCenterY: new Float64Array([0, 0, 0, 0, -2, -2, 2]),
    portAngleForRegion1: new Int32Array(7),
    portAngleForRegion2: new Int32Array(7),
    portX: new Float64Array([-2, 0, 2, -1, 1, -1, 1]),
    portY: new Float64Array([0, 0, 0, -1, -1, 1, 1]),
    portZ: new Int32Array(7),
  }
  const problem: TinyHyperGraphProblem = {
    routeCount: 2,
    portSectionMask: new Int8Array(7).fill(1),
    routeStartPort: new Int32Array([0, 3]),
    routeEndPort: new Int32Array([2, 4]),
    routeNet: new Int32Array([0, 1]),
    regionNetId: new Int32Array([-1, -1, -1, -1, -1, -1, 1]),
    routeIsFixed: new Uint8Array(2),
    initialAssignments: [
      { routeId: 1, regionId: 0, fromPortId: 3, toPortId: 1 },
      { routeId: 1, regionId: 1, fromPortId: 1, toPortId: 4 },
    ],
  }
  const solver = new PreparedPortPointRoutingSolver(topology, problem)
  const initialPortAssignment = new Int32Array(solver.state.portAssignment)
  const initialRegionSegments = structuredClone(solver.state.regionSegments)
  solver.setup()
  expect(solver.failed).toBe(false)
  expect(solver.state.portAssignment).toEqual(initialPortAssignment)
  expect(solver.state.regionSegments).toEqual(initialRegionSegments)
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.state.portAssignment[1]).toBe(0)
  expect(solver.state.regionSegments[6]).toContainEqual([1, 5, 6])

  const fixed = new PreparedPortPointRoutingSolver(topology, {
    ...problem,
    routeIsFixed: new Uint8Array([0, 1]),
  })
  fixed.setup()
  expect(fixed.failed).toBe(true)
  expect(fixed.error).toContain("Static reachability precheck failed")

  const sharedFixedCopper = new PreparedPortPointRoutingSolver(topology, {
    ...problem,
    routeCount: 3,
    routeStartPort: new Int32Array([0, 3, 3]),
    routeEndPort: new Int32Array([2, 4, 4]),
    routeNet: new Int32Array([0, 1, 1]),
    routeIsFixed: new Uint8Array([0, 1, 0]),
    initialAssignments: [
      ...problem.initialAssignments!,
      ...problem.initialAssignments!.map((assignment) => ({
        ...assignment,
        routeId: 2,
      })),
    ],
  })
  sharedFixedCopper.setup()
  expect(sharedFixedCopper.failed).toBe(true)
  expect(sharedFixedCopper.error).toContain(
    "Static reachability precheck failed",
  )

  const reservedEndpoint = new PreparedPortPointRoutingSolver(topology, {
    ...problem,
    routeStartPort: new Int32Array([0, 1]),
    initialAssignments: [problem.initialAssignments![1]!],
  })
  reservedEndpoint.setup()
  expect(reservedEndpoint.failed).toBe(true)
  expect(reservedEndpoint.error).toContain(
    "Static reachability precheck failed",
  )
})
