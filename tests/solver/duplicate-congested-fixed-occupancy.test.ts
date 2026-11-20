import { expect, test } from "bun:test"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { DuplicateCongestedPortSolver } from "lib/index"

test("congestion demand counts actual fixed copper instead of independently rerouting it", (): void => {
  const graph: SerializedHyperGraph = {
    regions: [
      {
        regionId: "start",
        pointIds: ["entry"],
        d: { center: { x: -4, y: 0 }, width: 2, height: 2 },
      },
      {
        regionId: "left",
        pointIds: ["entry", "short", "retained"],
        d: { center: { x: -1, y: 0 }, width: 4, height: 6 },
        assignments: [
          {
            connectionId: "power",
            regionPort1Id: "entry",
            regionPort2Id: "retained",
          },
        ],
      },
      {
        regionId: "right",
        pointIds: ["short", "retained", "exit"],
        d: { center: { x: 1, y: 0 }, width: 4, height: 6 },
        assignments: [
          {
            connectionId: "power",
            regionPort1Id: "retained",
            regionPort2Id: "exit",
          },
        ],
      },
      {
        regionId: "end",
        pointIds: ["exit"],
        d: { center: { x: 4, y: 0 }, width: 2, height: 2 },
      },
    ],
    ports: [
      {
        portId: "entry",
        region1Id: "start",
        region2Id: "left",
        d: { x: -3, y: 0, z: 0 },
      },
      {
        portId: "short",
        region1Id: "left",
        region2Id: "right",
        d: { x: 0, y: 0, z: 0 },
      },
      {
        portId: "retained",
        region1Id: "left",
        region2Id: "right",
        d: { x: 0, y: 2, z: 0 },
      },
      {
        portId: "exit",
        region1Id: "right",
        region2Id: "end",
        d: { x: 3, y: 0, z: 0 },
      },
    ],
    connections: [
      {
        connectionId: "power",
        mutuallyConnectedNetworkId: "power",
        startRegionId: "start",
        endRegionId: "end",
      },
    ],
  }
  Object.assign(graph.connections![0]!, { isFixed: true })
  const original = structuredClone(graph)
  const fixed = new DuplicateCongestedPortSolver(graph)
  fixed.solve()
  expect(fixed.solved, fixed.error ?? "").toBe(true)
  expect(fixed.report.portUseCounts.retained).toBe(1)
  expect(fixed.report.portUseCounts.short).toBeUndefined()
  expect(graph).toEqual(original)
  const movable = structuredClone(graph)
  Object.assign(movable.connections![0]!, { isFixed: false })
  const independent = new DuplicateCongestedPortSolver(movable)
  independent.solve()
  expect(independent.solved, independent.error ?? "").toBe(true)
  expect(independent.report.portUseCounts.short).toBe(1)
  expect(independent.report.portUseCounts.retained).toBeUndefined()
})
