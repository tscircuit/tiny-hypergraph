import { expect, test } from "bun:test"
import { loadSerializedHyperGraph } from "lib/compat/loadSerializedHyperGraph"
import { DistanceAwareTinyHyperGraphSolver } from "lib/distance-aware-tiny-hypergraph-solver"
import { portChokepointFixture } from "tests/fixtures/port-chokepoint.fixture"

test("global rerip gives the blocked route its required corridor before rerouting flexible routes", () => {
  const graph = structuredClone(portChokepointFixture)
  graph.regions.push({
    regionId: "a-detour",
    pointIds: ["detour-in", "detour-out"],
    d: { center: { x: 4, y: 20 }, width: 4, height: 4, netId: 0 },
  })
  graph.regions[0].pointIds.push("detour-in")
  graph.regions[4].pointIds.push("detour-out")
  graph.ports.push(
    {
      portId: "detour-in",
      region1Id: "a-start",
      region2Id: "a-detour",
      d: { x: 2, y: 20, z: 0 },
    },
    {
      portId: "detour-out",
      region1Id: "a-detour",
      region2Id: "a-end",
      d: { x: 6, y: 20, z: 0 },
    },
  )
  const { topology, problem } = loadSerializedHyperGraph(graph)
  const solver = new DistanceAwareTinyHyperGraphSolver(topology, problem)
  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.state.ripCount).toBe(1)
  expect(solver.state.regionSegments[3].map(([routeId]) => routeId)).toEqual([
    1,
  ])
  expect(solver.state.regionSegments[7].map(([routeId]) => routeId)).toEqual([
    0,
  ])
})
