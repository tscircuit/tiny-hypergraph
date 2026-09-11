import { expect, test } from "bun:test"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { loadSerializedHyperGraph } from "lib/compat/loadSerializedHyperGraph"
import { SelectiveReripTinyHyperGraphSolver } from "lib/index"

test("a rerip cycle uses another occupied channel without restarting completed routes", () => {
  const regions: SerializedHyperGraph["regions"] = []
  const ports: SerializedHyperGraph["ports"] = []
  const routeDefinitions = [
    { name: "flexible", net: 0, y: 0, channels: ["a", "b"] },
    { name: "movable", net: 1, y: 1, channels: ["b", "c"] },
    { name: "constrained", net: 2, y: -1, channels: ["a"] },
  ]
  for (const [channelIndex, channel] of ["a", "b", "c"].entries()) {
    for (const side of ["left", "right"]) {
      regions.push({
        regionId: `${channel}-${side}`,
        pointIds: [],
        d: {
          center: { x: side === "left" ? -1 : 1, y: channelIndex },
          width: 2,
          height: 1,
        },
      })
    }
    ports.push({
      portId: channel,
      region1Id: `${channel}-left`,
      region2Id: `${channel}-right`,
      d: {
        x: 0,
        y: channelIndex,
        z: 0,
        tinyHypergraphPortPenalty: channelIndex * 2,
      },
    })
  }
  for (const route of routeDefinitions) {
    for (const side of ["left", "right"]) {
      const xDirection = side === "left" ? -1 : 1
      for (const [kind, x] of [
        ["terminal", 6],
        ["branch", 4],
      ] as const) {
        regions.push({
          regionId: `${route.name}-${side}-${kind}`,
          pointIds: [],
          d: {
            center: { x: x * xDirection, y: route.y },
            width: 2,
            height: 1,
            netId: route.net,
          },
        })
      }
      ports.push({
        portId: `${route.name}-${side}`,
        region1Id: `${route.name}-${side}-branch`,
        region2Id: `${route.name}-${side}-terminal`,
        d: { x: 5 * xDirection, y: route.y, z: 0 },
      })
      for (const channel of route.channels) {
        ports.push({
          portId: `${route.name}-${side}-${channel}`,
          region1Id: `${route.name}-${side}-branch`,
          region2Id: `${channel}-${side}`,
          d: { x: 2 * xDirection, y: route.y, z: 0 },
        })
      }
    }
  }
  for (const region of regions) {
    region.pointIds = ports
      .filter(
        (port) =>
          port.region1Id === region.regionId ||
          port.region2Id === region.regionId,
      )
      .map((port) => port.portId)
  }
  const { topology, problem } = loadSerializedHyperGraph({
    regions,
    ports,
    connections: routeDefinitions.map((route) => ({
      connectionId: route.name,
      mutuallyConnectedNetworkId: route.name,
      startRegionId: `${route.name}-left-terminal`,
      endRegionId: `${route.name}-right-terminal`,
    })),
  })
  const solver = new SelectiveReripTinyHyperGraphSolver(topology, problem, {
    RIP_THRESHOLD_START: 100,
    RIP_THRESHOLD_END: 100,
    MAX_ITERATIONS: 20_000,
    GREEDY_FINAL_ROUTE_ITERS: 0,
  })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.getSelectiveReripStats().globalReripCount).toBe(0)
  expect(
    solver.getSelectiveReripStats().alternateBlockerSearchCount,
  ).toBeGreaterThan(0)
  const netByChannel = Object.fromEntries(
    ["a", "b", "c"].map((channel) => {
      const portId = topology.portMetadata!.findIndex(
        (port) => port.serializedPortId === channel,
      )
      return [channel, solver.state.portAssignment[portId]]
    }),
  )
  expect(netByChannel).toEqual({ a: 2, b: 0, c: 1 })
})
