import { expect, test } from "bun:test"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { DuplicateCongestedPortSolver } from "../../lib/DuplicateCongestedPortSolver"

test("cramped boundaries can retain their capacity while ordinary ports are duplicated", (): void => {
  const graph: SerializedHyperGraph = {
    regions: [
      ...["a", "b"].map((net, index) => ({
        regionId: `${net}-start`,
        pointIds: [`${net}-start-port`],
        d: {
          center: { x: -4, y: (index - 0.5) * 0.001 },
          width: 2,
          height: 0.001,
        },
      })),
      {
        regionId: "left",
        pointIds: ["a-start-port", "b-start-port", "narrow"],
        d: { center: { x: -2, y: 0 }, width: 2, height: 0.003 },
      },
      {
        regionId: "middle",
        pointIds: ["narrow", "wide"],
        d: { center: { x: 0, y: 0 }, width: 2, height: 2 },
      },
      {
        regionId: "right",
        pointIds: ["wide", "a-end-port", "b-end-port"],
        d: { center: { x: 2, y: 0 }, width: 2, height: 2 },
      },
      ...["a", "b"].map((net, index) => ({
        regionId: `${net}-end`,
        pointIds: [`${net}-end-port`],
        d: { center: { x: 4, y: index - 0.5 }, width: 2, height: 1 },
      })),
    ],
    ports: [
      ...["a", "b"].map((net, index) => ({
        portId: `${net}-start-port`,
        region1Id: `${net}-start`,
        region2Id: "left",
        d: { x: -3, y: (index - 0.5) * 0.001, z: 0 },
      })),
      {
        portId: "narrow",
        region1Id: "left",
        region2Id: "middle",
        d: { x: -1, y: 0, z: 0, cramped: true },
      },
      ...["a", "b"].map((net, index) => ({
        portId: `${net}-end-port`,
        region1Id: "right",
        region2Id: `${net}-end`,
        d: { x: 3, y: index - 0.5, z: 0 },
      })),
      {
        portId: "wide",
        region1Id: "middle",
        region2Id: "right",
        d: { x: 1, y: 0, z: 0 },
      },
    ],
    connections: ["a", "b"].map((net) => ({
      connectionId: net,
      mutuallyConnectedNetworkId: net,
      startRegionId: `${net}-start`,
      endRegionId: `${net}-end`,
    })),
  }
  for (const duplicateCrampedPorts of [false, true]) {
    const solver = new DuplicateCongestedPortSolver(graph, {
      duplicateCrampedPorts,
    })
    solver.solve()
    expect(solver.solved).toBe(true)
    expect(solver.report.portUseCounts.narrow).toBe(2)
    expect(solver.report.portUseCounts.wide).toBe(2)
    expect(
      solver.report.duplicatedPorts.map((port) => port.sourcePortId),
    ).toEqual(duplicateCrampedPorts ? ["narrow", "wide"] : ["wide"])
  }
  expect(graph.ports).toHaveLength(6)
})
