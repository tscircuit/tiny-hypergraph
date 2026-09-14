import { expect, test } from "bun:test"
import { loadSerializedHyperGraph } from "lib/compat/loadSerializedHyperGraph"
import { TinyHyperGraphSectionSolver, TinyHyperGraphSolver } from "lib/index"

test("preserves a closed routed cycle through serialization and section loading", () => {
  const connection = {
    connectionId: "closed-route",
    mutuallyConnectedNetworkId: "closed-net",
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
        { serializedRegionId: "region-a" },
        { serializedRegionId: "region-b" },
        { serializedRegionId: "region-c" },
      ],
      portAngleForRegion1: new Int32Array(3),
      portAngleForRegion2: new Int32Array([18000, 18000, 18000]),
      portX: new Float64Array([0, 1, 0.5]),
      portY: new Float64Array([0, 0, 1]),
      portZ: new Int32Array(3),
      portMetadata: [
        { serializedPortId: "port-a" },
        { serializedPortId: "port-b" },
        { serializedPortId: "port-c" },
      ],
    },
    {
      routeCount: 1,
      portSectionMask: new Int8Array([1, 1, 1]),
      routeMetadata: [connection],
      routeStartPort: new Int32Array([0]),
      routeEndPort: new Int32Array([0]),
      routeNet: new Int32Array([0]),
      regionNetId: new Int32Array([-1, -1, -1]),
    },
  )
  solver.state.regionSegments = [
    [[0, 0, 1]],
    [[0, 1, 2]],
    [[0, 2, 0]],
  ]
  solver.solved = true

  const output = solver.getOutput()
  expect(output.solvedRoutes?.[0]?.path.map(({ portId }) => portId)).toEqual([
    "port-a",
    "port-b",
    "port-c",
    "port-a",
  ])

  const loaded = loadSerializedHyperGraph(output)
  const sectionSolver = new TinyHyperGraphSectionSolver(
    loaded.topology,
    loaded.problem,
    loaded.solution,
  )
  expect(sectionSolver.baselineSolver.state.regionSegments.flat()).toHaveLength(
    3,
  )
})
