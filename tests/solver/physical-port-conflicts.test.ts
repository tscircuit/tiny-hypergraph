import { expect, test } from "bun:test"
import {
  TinyHyperGraphSolver,
  type TinyHyperGraphProblem,
  type TinyHyperGraphTopology,
} from "lib/core"

test("routes around capacity occupied through a conflicting port", (): void => {
  const centers = [
    [-2, 0],
    [0, 0.5],
    [0, -1],
    [2, 0],
  ]
  const points = [
    [-2, 0],
    [-1, 0.1],
    [1, 0.1],
    [-1, -1],
    [1, -1],
    [2, 0],
    [1, 0.15],
    [1, 0.2],
  ]
  const incident = [[0], [0, 1], [1, 3], [0, 2], [2, 3], [3], [1], [1]]
  const angle = (port: number, region: number): number => {
    const point = points[port]!,
      center = centers[region]!
    return Math.round(
      (((Math.atan2(point[1]! - center[1]!, point[0]! - center[0]!) * 180) /
        Math.PI +
        360) %
        360) *
        100,
    )
  }
  const topology: TinyHyperGraphTopology = {
    portCount: points.length,
    regionCount: centers.length,
    regionIncidentPorts: centers.map((_, region) =>
      incident.flatMap((owners, port) =>
        owners.includes(region) ? [port] : [],
      ),
    ),
    incidentPortRegion: incident,
    regionWidth: new Float64Array([2, 2, 2, 2]),
    regionHeight: new Float64Array([3, 1, 1, 3]),
    regionCenterX: Float64Array.from(centers.map((p) => p[0]!)),
    regionCenterY: Float64Array.from(centers.map((p) => p[1]!)),
    regionAvailableZMask: new Int32Array([1, 1, 1, 1]),
    portAngleForRegion1: Int32Array.from(
      incident.map((owners, port) => angle(port, owners[0]!)),
    ),
    portAngleForRegion2: Int32Array.from(
      incident.map((owners, port) => angle(port, owners.at(-1)!)),
    ),
    portX: Float64Array.from(points.map((p) => p[0]!)),
    portY: Float64Array.from(points.map((p) => p[1]!)),
    portZ: new Int32Array(points.length),
  }
  const problem: TinyHyperGraphProblem = {
    routeCount: 2,
    portSectionMask: new Int8Array(points.length).fill(1),
    routeStartPort: new Int32Array([0, 6]),
    routeEndPort: new Int32Array([5, 7]),
    routeNet: new Int32Array([0, 1]),
    regionNetId: new Int32Array(centers.length).fill(-1),
    routeIsFixed: new Uint8Array([0, 1]),
    initialAssignments: [
      { routeId: 1, regionId: 1, fromPortId: 6, toPortId: 7 },
    ],
    portConflicts: [[], [], [6], [], [], [], [2], []],
  }
  const parent = new TinyHyperGraphSolver(topology, problem)
  const solver = parent["createGreedyFinalRouteSolver"]({}, 0)
  solver.solve()
  expect(solver.solved).toBeTrue()
  expect(solver.state.portAssignment[2]).toBe(-1)
  expect(solver.state.portAssignment[3]).toBe(0)
  expect(solver.state.portAssignment[4]).toBe(0)
  expect(solver.state.regionSegments[1]).toContainEqual([1, 6, 7])
})
