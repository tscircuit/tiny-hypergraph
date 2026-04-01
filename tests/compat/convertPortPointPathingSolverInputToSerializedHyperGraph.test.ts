import { expect, test } from "bun:test"
import { convertPortPointPathingSolverInputToSerializedHyperGraph } from "lib/compat/convertPortPointPathingSolverInputToSerializedHyperGraph"

test("convertPortPointPathingSolverInputToSerializedHyperGraph flattens solver params into a serialized hypergraph", () => {
  const serializedHyperGraph = convertPortPointPathingSolverInputToSerializedHyperGraph(
    [
      {
        format: "serialized-hg-port-point-pathing-solver-params",
        graph: {
          regions: [
            {
              regionId: "r0",
              pointIds: ["p0"],
              d: { center: { x: 0, y: 0 }, width: 2, height: 2 },
            },
          ],
          ports: [
            {
              portId: "p0",
              region1Id: "r0",
              region2Id: "r1",
              d: { x: 1, y: 0, z: 0 },
            },
          ],
        },
        connections: [
          {
            connectionId: "c0",
            startRegionId: "r0",
            endRegionId: "r1",
            mutuallyConnectedNetworkId: "net-0",
          },
        ],
      },
    ],
  )

  expect(serializedHyperGraph).toEqual({
    regions: [
      {
        regionId: "r0",
        pointIds: ["p0"],
        d: { center: { x: 0, y: 0 }, width: 2, height: 2 },
      },
    ],
    ports: [
      {
        portId: "p0",
        region1Id: "r0",
        region2Id: "r1",
        d: { x: 1, y: 0, z: 0 },
      },
    ],
    connections: [
      {
        connectionId: "c0",
        startRegionId: "r0",
        endRegionId: "r1",
        mutuallyConnectedNetworkId: "net-0",
      },
    ],
  })
})
