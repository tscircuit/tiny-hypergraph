import { expect, test } from "bun:test"
import { loadSerializedHyperGraph } from "lib/compat/loadSerializedHyperGraph"
import { TinyHyperGraphSectionSolver, TinyHyperGraphSolver } from "lib/index"

test("getOutput preserves every segment in a closed same-port route", () => {
  const connection = {
    connectionId: "same-port-route",
    startRegionId: "region-0",
    endRegionId: "region-2",
    mutuallyConnectedNetworkId: "net-0",
  }
  const solver = new TinyHyperGraphSolver(
    {
      portCount: 3,
      regionCount: 3,
      regionIncidentPorts: [
        [0, 1],
        [1, 2],
        [2, 0],
      ],
      incidentPortRegion: [
        [0, 2],
        [0, 1],
        [1, 2],
      ],
      regionWidth: new Float64Array([1, 1, 1]),
      regionHeight: new Float64Array([1, 1, 1]),
      regionCenterX: new Float64Array([0, 1, 0.5]),
      regionCenterY: new Float64Array([0, 0, 1]),
      regionAvailableZMask: new Int32Array([1, 1, 1]),
      regionMetadata: [
        { serializedRegionId: "region-0" },
        { serializedRegionId: "region-1" },
        { serializedRegionId: "region-2" },
      ],
      portAngleForRegion1: new Int32Array([0, 0, 0]),
      portAngleForRegion2: new Int32Array([18000, 18000, 18000]),
      portX: new Float64Array([0, 1, 0.5]),
      portY: new Float64Array([0, 0, 1]),
      portZ: new Int32Array([0, 0, 0]),
      portMetadata: [
        { serializedPortId: "port-0" },
        { serializedPortId: "port-1" },
        { serializedPortId: "port-2" },
      ],
    },
    {
      routeCount: 1,
      portSectionMask: new Int8Array([1, 1, 1]),
      routeMetadata: [connection],
      routeStartPort: new Int32Array([0]),
      routeEndPort: new Int32Array([0]),
      routeNet: new Int32Array([0]),
      regionNetId: new Int32Array([-1, -1]),
    },
  )

  solver.solve()
  solver.state.regionSegments = [
    [[0, 0, 1]],
    [[0, 1, 2]],
    [[0, 2, 0]],
  ]

  expect(solver.solved).toBe(true)
  const output = solver.getOutput()
  expect(
    output.solvedRoutes?.[0]?.path.map((candidate) => ({
      portId: candidate.portId,
      nextRegionId: candidate.nextRegionId,
    })),
  ).toEqual([
    { portId: "port-0", nextRegionId: "region-0" },
    { portId: "port-1", nextRegionId: "region-1" },
    { portId: "port-2", nextRegionId: "region-2" },
    { portId: "port-0", nextRegionId: "region-2" },
  ])

  const replay = loadSerializedHyperGraph(output)
  const sectionSolver = new TinyHyperGraphSectionSolver(
    replay.topology,
    replay.problem,
    replay.solution,
  )
  expect(sectionSolver.baselineSolver.state.regionSegments.flat()).toHaveLength(
    3,
  )
})
