import { expect, test } from "bun:test"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { loadSerializedHyperGraph } from "lib/compat/loadSerializedHyperGraph"
import { TinyHyperGraphSolver } from "lib/core"

const disconnectedGraph = (): SerializedHyperGraph => ({
  regions: [
    { regionId: "s", pointIds: ["p"], d: {} },
    { regionId: "a", pointIds: ["p"], d: {} },
    { regionId: "b", pointIds: ["q"], d: {} },
    { regionId: "t", pointIds: ["q"], d: {} },
  ],
  ports: [
    { portId: "p", region1Id: "s", region2Id: "a", d: {} },
    { portId: "q", region1Id: "b", region2Id: "t", d: {} },
  ],
  connections: [{ connectionId: "c", startRegionId: "s", endRegionId: "t" }],
})

test("rejects an incidence mismatch that previously routed across disconnected components", () => {
  const graph = disconnectedGraph()
  // Before validation, this single extra point produced a successful p -> q
  // path through a, even though q's endpoint regions are b and t.
  graph.regions[1]!.pointIds.push("q")
  expect(() => loadSerializedHyperGraph(graph)).toThrow(
    'Region "a" lists nonincident port "q"',
  )
})

test("a valid disconnected graph remains disconnected", () => {
  const { topology, problem } = loadSerializedHyperGraph(disconnectedGraph())
  const solver = new TinyHyperGraphSolver(topology, problem)
  solver.solve()
  expect(solver.solved).toBe(false)
  expect(solver.failed).toBe(true)
})

test("rejects the other direction of an incidence mismatch", () => {
  const graph = disconnectedGraph()
  graph.regions[1]!.pointIds = []
  expect(() => loadSerializedHyperGraph(graph)).toThrow(
    'Region "a" is missing incident port "p"',
  )
})

test("rejects dangling point IDs instead of silently deleting them", () => {
  const graph = disconnectedGraph()
  graph.regions[1]!.pointIds.push("missing")
  expect(() => loadSerializedHyperGraph(graph)).toThrow(
    'Region "a" references missing port "missing"',
  )
})

test("rejects dangling endpoint regions", () => {
  const graph = disconnectedGraph()
  graph.ports[0]!.region1Id = "missing"
  expect(() => loadSerializedHyperGraph(graph)).toThrow(
    'Port "p" references missing region "missing"',
  )
})

test("rejects duplicate IDs before map indexes can overwrite them", () => {
  const duplicateRegion = disconnectedGraph()
  duplicateRegion.regions.push({ ...duplicateRegion.regions[0]! })
  expect(() => loadSerializedHyperGraph(duplicateRegion)).toThrow(
    'Duplicate region ID "s"',
  )
  const duplicatePort = disconnectedGraph()
  duplicatePort.ports.push({ ...duplicatePort.ports[0]! })
  expect(() => loadSerializedHyperGraph(duplicatePort)).toThrow(
    'Duplicate port ID "p"',
  )
  const duplicateConnection = disconnectedGraph()
  duplicateConnection.connections!.push({
    ...duplicateConnection.connections![0]!,
  })
  expect(() => loadSerializedHyperGraph(duplicateConnection)).toThrow(
    'Duplicate connection ID "c"',
  )
  const duplicatePoint = disconnectedGraph()
  duplicatePoint.regions[0]!.pointIds.push("p")
  expect(() => loadSerializedHyperGraph(duplicatePoint)).toThrow(
    'Region "s" repeats port "p"',
  )
})

test("obstacle filtering prunes point IDs before choosing route endpoints", () => {
  const graph: SerializedHyperGraph = {
    regions: [
      { regionId: "s", pointIds: ["blocked", "p"], d: {} },
      {
        regionId: "obstacle",
        pointIds: ["blocked"],
        d: { _containsObstacle: true },
      },
      { regionId: "middle", pointIds: ["p", "q"], d: {} },
      { regionId: "t", pointIds: ["q"], d: {} },
    ],
    ports: [
      { portId: "blocked", region1Id: "s", region2Id: "obstacle", d: {} },
      { portId: "p", region1Id: "s", region2Id: "middle", d: {} },
      { portId: "q", region1Id: "middle", region2Id: "t", d: {} },
    ],
    connections: [{ connectionId: "c", startRegionId: "s", endRegionId: "t" }],
  }
  const { topology, problem } = loadSerializedHyperGraph(graph)
  expect(topology.regionCount).toBe(3)
  expect(topology.portCount).toBe(2)
  expect(topology.regionIncidentPorts).toEqual([[0], [0, 1], [1]])
  expect(topology.incidentPortRegion).toEqual([
    [0, 1],
    [1, 2],
  ])
  expect(Array.from(problem.routeStartPort)).toEqual([0])
  expect(Array.from(problem.routeEndPort)).toEqual([1])
  expect(graph.regions[0]!.pointIds).toEqual(["blocked", "p"])
  const solver = new TinyHyperGraphSolver(topology, problem)
  solver.solve()
  expect(solver.solved).toBe(true)
})

// Exhaust every possible region-side incidence table for this fixed endpoint
// graph. Exactly the reciprocal table may load; all accepted pairs agree.
test("exhaustive small incidence tables load iff both views agree", () => {
  for (let bits = 0; bits < 256; bits++) {
    const graph = disconnectedGraph()
    for (let region = 0; region < 4; region++) {
      graph.regions[region]!.pointIds = ["p", "q"].filter(
        (_, port) => (bits & (1 << (region * 2 + port))) !== 0,
      )
    }
    const reciprocalBits = (1 << 0) | (1 << 2) | (1 << 5) | (1 << 7)
    if (bits === reciprocalBits) {
      const { topology } = loadSerializedHyperGraph(graph)
      for (let r = 0; r < 4; r++) {
        for (let p = 0; p < 2; p++) {
          expect(topology.regionIncidentPorts[r]!.includes(p)).toBe(
            topology.incidentPortRegion[p]!.includes(r),
          )
        }
      }
    } else {
      expect(() => loadSerializedHyperGraph(graph)).toThrow()
    }
  }
})
