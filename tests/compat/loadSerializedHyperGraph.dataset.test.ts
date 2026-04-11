import { expect, test } from "bun:test"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import * as datasetHg07 from "dataset-hg07"
import { convertPortPointPathingSolverInputToSerializedHyperGraph } from "lib/compat/convertPortPointPathingSolverInputToSerializedHyperGraph"
import { loadSerializedHyperGraph } from "lib/compat/loadSerializedHyperGraph"

const datasetModule = datasetHg07 as Record<string, unknown> & {
  manifest: {
    samples: Array<{
      sampleName: string
    }>
  }
}

test("loadSerializedHyperGraph loads every hg07 dataset sample", () => {
  const fullObstacleErrors: string[] = []

  for (const { sampleName } of datasetModule.manifest.samples) {
    const sample = datasetModule[sampleName] as SerializedHyperGraph

    try {
      loadSerializedHyperGraph(sample)
    } catch (error) {
      if (String(error).includes("references full-obstacle region")) {
        fullObstacleErrors.push(`${sampleName}: ${String(error)}`)
      }
    }
  }

  expect(fullObstacleErrors).toEqual([])
})

test("loadSerializedHyperGraph loads hg07 sample001", () => {
  expect(() =>
    loadSerializedHyperGraph(datasetModule.sample001 as SerializedHyperGraph),
  ).not.toThrow()
})

test("loadSerializedHyperGraph snaps unsolved connection endpoints to the closest connection points", () => {
  const graph: SerializedHyperGraph = {
    regions: [
      {
        regionId: "start",
        pointIds: ["start-low", "start-high"],
        d: { center: { x: 0, y: 0.5 }, width: 1, height: 2 },
      },
      {
        regionId: "end",
        pointIds: ["end-low", "end-high"],
        d: { center: { x: 10, y: 0.5 }, width: 1, height: 2 },
      },
      {
        regionId: "start-low-neighbor",
        pointIds: ["start-low"],
        d: { center: { x: -1, y: 0 }, width: 1, height: 1 },
      },
      {
        regionId: "start-high-neighbor",
        pointIds: ["start-high"],
        d: { center: { x: -1, y: 1 }, width: 1, height: 1 },
      },
      {
        regionId: "end-low-neighbor",
        pointIds: ["end-low"],
        d: { center: { x: 11, y: 0 }, width: 1, height: 1 },
      },
      {
        regionId: "end-high-neighbor",
        pointIds: ["end-high"],
        d: { center: { x: 11, y: 1 }, width: 1, height: 1 },
      },
    ],
    ports: [
      {
        portId: "start-low",
        region1Id: "start",
        region2Id: "start-low-neighbor",
        d: { x: 0, y: 0, z: 0, distToCentermostPortOnZ: 0 },
      },
      {
        portId: "start-high",
        region1Id: "start",
        region2Id: "start-high-neighbor",
        d: { x: 0, y: 1, z: 0, distToCentermostPortOnZ: 5 },
      },
      {
        portId: "end-low",
        region1Id: "end",
        region2Id: "end-low-neighbor",
        d: { x: 10, y: 0, z: 0, distToCentermostPortOnZ: 0 },
      },
      {
        portId: "end-high",
        region1Id: "end",
        region2Id: "end-high-neighbor",
        d: { x: 10, y: 1, z: 0, distToCentermostPortOnZ: 5 },
      },
    ],
    connections: [
      {
        connectionId: "c0",
        startRegionId: "start",
        endRegionId: "end",
        mutuallyConnectedNetworkId: "net-0",
        simpleRouteConnection: {
          name: "c0",
          source_trace_id: "c0",
          rootConnectionName: "c0",
          pointsToConnect: [
            {
              x: 0,
              y: 1,
              layer: "top",
              pointId: "p-start",
              pcb_port_id: "p-start",
            },
            {
              x: 10,
              y: 1,
              layer: "top",
              pointId: "p-end",
              pcb_port_id: "p-end",
            },
          ],
        },
      } as NonNullable<SerializedHyperGraph["connections"]>[number],
    ],
  }

  const { topology, problem } = loadSerializedHyperGraph(graph)

  expect(
    topology.portMetadata?.[problem.routeStartPort[0]]?.serializedPortId,
  ).toBe("start-high")
  expect(
    topology.portMetadata?.[problem.routeEndPort[0]]?.serializedPortId,
  ).toBe("end-high")
})

test("loadSerializedHyperGraph preserves suggested solver tuning from port-point inputs", () => {
  const input = {
    format: "serialized-hg-port-point-pathing-solver-params" as const,
    graph: {
      regions: [
        {
          regionId: "start",
          pointIds: ["p0"],
          d: { center: { x: 0, y: 0 }, width: 1, height: 1 },
        },
        {
          regionId: "end",
          pointIds: ["p1"],
          d: { center: { x: 10, y: 0 }, width: 1, height: 1 },
        },
        {
          regionId: "start-neighbor",
          pointIds: ["p0"],
          d: { center: { x: -1, y: 0 }, width: 1, height: 1 },
        },
        {
          regionId: "end-neighbor",
          pointIds: ["p1"],
          d: { center: { x: 11, y: 0 }, width: 1, height: 1 },
        },
      ],
      ports: [
        {
          portId: "p0",
          region1Id: "start",
          region2Id: "start-neighbor",
          d: { x: 0, y: 0, z: 0, distToCentermostPortOnZ: 0 },
        },
        {
          portId: "p1",
          region1Id: "end",
          region2Id: "end-neighbor",
          d: { x: 10, y: 0, z: 0, distToCentermostPortOnZ: 0 },
        },
      ],
    },
    connections: [
      {
        connectionId: "c0",
        startRegionId: "start",
        endRegionId: "end",
        mutuallyConnectedNetworkId: "net-0",
      },
    ],
    weights: {
      START_RIPPING_PF_THRESHOLD: 0.3,
      END_RIPPING_PF_THRESHOLD: 1,
      STRAIGHT_LINE_DEVIATION_PENALTY_FACTOR: 4,
    },
  }

  const serializedHyperGraph =
    convertPortPointPathingSolverInputToSerializedHyperGraph(input)
  const { problem } = loadSerializedHyperGraph(serializedHyperGraph)

  expect(problem.suggestedSolverOptions).toEqual({
    RIP_THRESHOLD_START: 0.3,
    RIP_THRESHOLD_END: 1,
    STRAIGHT_LINE_DEVIATION_PENALTY_FACTOR: 4,
  })
})

test("loadSerializedHyperGraph preserves bounded bus endpoint candidates", () => {
  const graph: SerializedHyperGraph = {
    regions: [
      {
        regionId: "start",
        pointIds: ["s0", "s1", "s2", "s3", "s4"],
        d: { center: { x: 0, y: 0.2 }, width: 1, height: 2 },
      },
      {
        regionId: "end",
        pointIds: ["e0", "e1", "e2", "e3", "e4"],
        d: { center: { x: 10, y: 0.2 }, width: 1, height: 2 },
      },
      {
        regionId: "start-n0",
        pointIds: ["s0"],
        d: { center: { x: -1, y: 0 }, width: 1, height: 1 },
      },
      {
        regionId: "start-n1",
        pointIds: ["s1"],
        d: { center: { x: -1, y: 0.1 }, width: 1, height: 1 },
      },
      {
        regionId: "start-n2",
        pointIds: ["s2"],
        d: { center: { x: -1, y: 0.2 }, width: 1, height: 1 },
      },
      {
        regionId: "start-n3",
        pointIds: ["s3"],
        d: { center: { x: -1, y: 0.3 }, width: 1, height: 1 },
      },
      {
        regionId: "start-n4",
        pointIds: ["s4"],
        d: { center: { x: -1, y: 1.5 }, width: 1, height: 1 },
      },
      {
        regionId: "end-n0",
        pointIds: ["e0"],
        d: { center: { x: 11, y: 0 }, width: 1, height: 1 },
      },
      {
        regionId: "end-n1",
        pointIds: ["e1"],
        d: { center: { x: 11, y: 0.1 }, width: 1, height: 1 },
      },
      {
        regionId: "end-n2",
        pointIds: ["e2"],
        d: { center: { x: 11, y: 0.2 }, width: 1, height: 1 },
      },
      {
        regionId: "end-n3",
        pointIds: ["e3"],
        d: { center: { x: 11, y: 0.3 }, width: 1, height: 1 },
      },
      {
        regionId: "end-n4",
        pointIds: ["e4"],
        d: { center: { x: 11, y: 1.5 }, width: 1, height: 1 },
      },
    ],
    ports: [
      {
        portId: "s0",
        region1Id: "start",
        region2Id: "start-n0",
        d: { x: 0, y: 0, z: 0, distToCentermostPortOnZ: 0 },
      },
      {
        portId: "s1",
        region1Id: "start",
        region2Id: "start-n1",
        d: { x: 0, y: 0.1, z: 0, distToCentermostPortOnZ: 1 },
      },
      {
        portId: "s2",
        region1Id: "start",
        region2Id: "start-n2",
        d: { x: 0, y: 0.2, z: 0, distToCentermostPortOnZ: 2 },
      },
      {
        portId: "s3",
        region1Id: "start",
        region2Id: "start-n3",
        d: { x: 0, y: 0.3, z: 0, distToCentermostPortOnZ: 3 },
      },
      {
        portId: "s4",
        region1Id: "start",
        region2Id: "start-n4",
        d: { x: 0, y: 1.5, z: 0, distToCentermostPortOnZ: 4 },
      },
      {
        portId: "e0",
        region1Id: "end",
        region2Id: "end-n0",
        d: { x: 10, y: 0, z: 0, distToCentermostPortOnZ: 0 },
      },
      {
        portId: "e1",
        region1Id: "end",
        region2Id: "end-n1",
        d: { x: 10, y: 0.1, z: 0, distToCentermostPortOnZ: 1 },
      },
      {
        portId: "e2",
        region1Id: "end",
        region2Id: "end-n2",
        d: { x: 10, y: 0.2, z: 0, distToCentermostPortOnZ: 2 },
      },
      {
        portId: "e3",
        region1Id: "end",
        region2Id: "end-n3",
        d: { x: 10, y: 0.3, z: 0, distToCentermostPortOnZ: 3 },
      },
      {
        portId: "e4",
        region1Id: "end",
        region2Id: "end-n4",
        d: { x: 10, y: 1.5, z: 0, distToCentermostPortOnZ: 4 },
      },
    ],
    connections: [
      {
        connectionId: "c-bus",
        startRegionId: "start",
        endRegionId: "end",
        mutuallyConnectedNetworkId: "net-bus",
        simpleRouteConnection: {
          name: "c-bus",
          source_trace_id: "c-bus",
          rootConnectionName: "c-bus",
          pointsToConnect: [
            {
              x: 0,
              y: 0.15,
              layer: "top",
              pointId: "p-start",
              pcb_port_id: "p-start",
            },
            {
              x: 10,
              y: 0.15,
              layer: "top",
              pointId: "p-end",
              pcb_port_id: "p-end",
            },
          ],
        },
        _bus: {
          id: "bus-0",
          order: 0,
          orderingVector: { x: 1, y: 0 },
        },
      } as NonNullable<SerializedHyperGraph["connections"]>[number],
    ],
  }

  const { topology, problem } = loadSerializedHyperGraph(graph)

  expect(
    problem.routeStartPortCandidates?.[0]?.map(
      (portId) => topology.portMetadata?.[portId]?.serializedPortId,
    ),
  ).toEqual(["s1", "s2", "s0", "s3"])
  expect(
    problem.routeEndPortCandidates?.[0]?.map(
      (portId) => topology.portMetadata?.[portId]?.serializedPortId,
    ),
  ).toEqual(["e1", "e2", "e0", "e3"])
})
