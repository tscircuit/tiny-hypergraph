import { expect, test } from "bun:test"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { loadSerializedHyperGraph, TinyHyperGraphSolver } from "lib/index"
import chainFixture from "./fixtures/chain.json"

// All orientations of every port in a chain; reverse region storage as well.
// This exercises the actual queue/commit/output code, not a copy of its formula.
const chain = (length: number, orientation: number): SerializedHyperGraph => {
  const ports = Array.from({ length }, (_, p) => ({
    portId: `p${p}`,
    region1Id: `r${p + ((orientation >> p) & 1)}`,
    region2Id: `r${p + 1 - ((orientation >> p) & 1)}`,
    d: { x: p, y: 0, z: 0 },
  }))
  return {
    regions: Array.from({ length: length + 1 }, (_, r) => ({
      regionId: `r${r}`,
      pointIds: ports
        .filter((p) => [p.region1Id, p.region2Id].includes(`r${r}`))
        .map((p) => p.portId),
      d: { center: { x: r - 0.5, y: 0 }, width: 1, height: 1, availableZ: [0] },
    })).reverse(),
    ports,
    connections: [
      {
        connectionId: "route",
        startRegionId: "r0",
        endRegionId: `r${length}`,
        mutuallyConnectedNetworkId: "net",
      },
    ],
  }
}

test("actual candidate transitions, commits, resets and output preserve chain contracts", () => {
  let cases = 0
  let checkedTransitions = 0
  for (let length = 2; length <= 7; length++) {
    for (let orientation = 0; orientation < 2 ** length; orientation++) {
      const { topology, problem } = loadSerializedHyperGraph(
        chain(length, orientation),
      )
      const solver = new TinyHyperGraphSolver(topology, problem, {
        MAX_ITERATIONS: 1000,
      })
      const queue = solver.state.candidateQueue
      const originalQueue = queue.queue.bind(queue)
      queue.queue = (candidate) => {
        expect(topology.incidentPortRegion[candidate.portId]).toContain(
          candidate.nextRegionId,
        )
        const previous = candidate.prevCandidate
        if (previous) {
          checkedTransitions++
          expect(topology.incidentPortRegion[candidate.portId]).toContain(
            previous.nextRegionId,
          )
          expect(topology.incidentPortRegion[previous.portId]).toContain(
            previous.nextRegionId,
          )
          expect(candidate.nextRegionId).not.toBe(previous.nextRegionId)
        }
        originalQueue(candidate)
      }
      solver.solve()
      expect(solver.failed).toBe(false)
      expect(solver.solved).toBe(true)
      let segmentCount = 0
      solver.state.regionSegments.forEach((segments, region) => {
        for (const [route, from, to] of segments) {
          segmentCount++
          expect(route).toBe(0)
          expect(topology.incidentPortRegion[from]).toContain(region)
          expect(topology.incidentPortRegion[to]).toContain(region)
          expect(solver.state.portAssignment[from]).toBe(
            problem.routeNet[route],
          )
          expect(solver.state.portAssignment[to]).toBe(problem.routeNet[route])
        }
      })
      expect(segmentCount).toBe(length - 1)
      const reloaded = loadSerializedHyperGraph(solver.getOutput())
      expect(reloaded.solution.solvedRoutePathSegments[0]).toEqual(
        Array.from({ length: length - 1 }, (_, p) => [p, p + 1]),
      )
      expect(Array.from(reloaded.problem.routeStartPort)).toEqual([0])
      expect(Array.from(reloaded.problem.routeEndPort)).toEqual([length - 1])
      solver.resetRoutingStateForRerip()
      expect(
        solver.state.regionSegments.every((segments) => segments.length === 0),
      ).toBe(true)
      expect(Array.from(solver.state.portAssignment)).toEqual(
        Array(length).fill(-1),
      )
      expect(solver.state.unroutedRoutes).toEqual([0])
      cases++
    }
  }
  expect(cases).toBe(252)
  expect(checkedTransitions).toBeGreaterThan(0)
})

test("shared serialized boundary fixture retains IDs, endpoints and net identity", () => {
  const { topology, problem } = loadSerializedHyperGraph(chainFixture)
  const solver = new TinyHyperGraphSolver(topology, problem)
  solver.solve()
  expect(solver.solved).toBe(true)
  const output = solver.getOutput()
  expect(output.connections).toEqual(chainFixture.connections)
  expect(output.ports.map((p) => [p.portId, p.region1Id, p.region2Id])).toEqual(
    chainFixture.ports.map((p) => [p.portId, p.region1Id, p.region2Id]),
  )
  expect(output.solvedRoutes?.[0].path.map((p) => p.portId)).toEqual([
    "start",
    "middle",
    "end",
  ])
})
