import { expect, test } from "bun:test"
import type { TinyHyperGraphProblem, TinyHyperGraphTopology } from "lib/core"
import { DistanceAwareTinyHyperGraphSolver } from "lib/distance-aware-tiny-hypergraph-solver"
import { PortPenaltyLowerBound } from "lib/PortPenaltyLowerBound"
import { PreparedPortPointRoutingSolver } from "lib/prepared/PreparedPortPointRoutingSolver"

function createFixture() {
  // Two entrances between the same regions: a short costly one and a longer
  // free one. An isolated region exercises unreachable lower-bound queries.
  const topology: TinyHyperGraphTopology = {
    regionCount: 3,
    portCount: 4,
    regionIncidentPorts: [[0, 1, 2], [1, 2, 3], []],
    incidentPortRegion: [[0], [0, 1], [0, 1], [1]],
    regionWidth: new Float64Array(3).fill(100),
    regionHeight: new Float64Array(3).fill(100),
    regionCenterX: new Float64Array([-1, 1, 10]),
    regionCenterY: new Float64Array(3),
    regionAvailableZMask: new Int32Array(3).fill(1),
    portAngleForRegion1: new Int32Array(4),
    portX: new Float64Array([-1, 0, 0, 1]),
    portY: new Float64Array([0, 0, 2, 0]),
    portZ: new Int32Array(4),
  }
  const problem: TinyHyperGraphProblem = {
    routeCount: 1,
    routeStartPort: new Int32Array([0]),
    routeEndPort: new Int32Array([3]),
    routeNet: new Int32Array([0]),
    regionNetId: new Int32Array(3).fill(-1),
    portSectionMask: new Int8Array(4).fill(1),
    portPenalty: new Float64Array([0, 10, 0, 0]),
  }
  return { topology, problem }
}

test("penalty guidance preserves the tradeoff between distance and port cost in both search workspaces", () => {
  for (const Solver of [
    DistanceAwareTinyHyperGraphSolver,
    PreparedPortPointRoutingSolver,
  ]) {
    for (const penalty of [0, 1, 10, Infinity]) {
      const { topology, problem } = createFixture()
      problem.portPenalty![1] = penalty
      const solver = new Solver(topology, problem, { DISTANCE_TO_COST: 1 })
      solver.solve()
      expect(solver.solved).toBe(true)
      const entrance = penalty < 2 * Math.sqrt(5) - 2 ? 1 : 2
      expect(solver.state.regionSegments[0]).toEqual([[0, 0, entrance]])
      expect(solver.state.regionSegments[1]).toEqual([[0, entrance, 3]])
    }
  }
})

test("compressed bounds match uncompressed shortest costs across net, goal and query changes", () => {
  // Compare with all-pairs shortest costs on the original region graph,
  // including zero-cost cycles, parallel gates, masks and fixed reservations.
  const { topology, problem } = createFixture()
  topology.regionCount = 7
  topology.incidentPortRegion = [
    [0],
    [0, 1],
    [1, 2],
    [2, 0],
    [2, 3],
    [2, 3],
    [3, 4],
    [4, 5],
    [5],
    [6],
    [1, 4],
    [0, 5],
    [3, 5],
  ]
  topology.portCount = topology.incidentPortRegion.length
  topology.regionIncidentPorts = Array.from(
    { length: topology.regionCount },
    () => [],
  )
  for (let port = 0; port < topology.portCount; port++) {
    for (const region of topology.incidentPortRegion[port])
      topology.regionIncidentPorts[region].push(port)
  }
  problem.portPenalty = new Float64Array([
    0,
    0,
    0,
    0,
    9,
    3,
    0,
    4,
    0,
    0,
    1,
    0,
    Infinity,
  ])
  problem.portSectionMask = new Int8Array(topology.portCount).fill(1)
  problem.portSectionMask[11] = 0
  problem.regionNetId = new Int32Array([-1, -1, -1, -1, 1, -1, -1])
  const endpointReservations = new Int32Array(topology.portCount).fill(-1)
  endpointReservations[5] = 0
  endpointReservations[10] = -2 // Shared endpoints reserved by different nets.
  const bounds = new PortPenaltyLowerBound({
    topology,
    problem,
    endpointReservations,
  })
  for (const netId of [0, 1, 0]) {
    const allowed = Array.from(
      problem.regionNetId,
      (net) => net === -1 || net === netId,
    )
    const costs = Array.from({ length: topology.regionCount }, (_, from) =>
      Array.from({ length: topology.regionCount }, (_, to) =>
        from === to && allowed[from] ? 0 : Infinity,
      ),
    )
    for (let port = 0; port < topology.portCount; port++) {
      if (
        problem.portSectionMask[port] === 0 ||
        (endpointReservations[port] !== -1 &&
          endpointReservations[port] !== netId)
      )
        continue
      for (const from of topology.incidentPortRegion[port]) {
        for (const to of topology.incidentPortRegion[port]) {
          if (allowed[from] && allowed[to])
            costs[from][to] = Math.min(
              costs[from][to],
              problem.portPenalty[port],
            )
        }
      }
    }
    for (let via = 0; via < topology.regionCount; via++) {
      for (let from = 0; from < topology.regionCount; from++) {
        for (let to = 0; to < topology.regionCount; to++)
          costs[from][to] = Math.min(
            costs[from][to],
            costs[from][via] + costs[via][to],
          )
      }
    }
    for (const endPortId of [8, 0, 9, 8]) {
      for (const portId of [9, 8, 0, 7, 6, 5, 4, 3, 2, 1, 10, 11, 12, 0]) {
        const expected = Math.min(
          ...topology.incidentPortRegion[portId].flatMap((from) =>
            topology.incidentPortRegion[endPortId].map((to) => costs[from][to]),
          ),
        )
        expect(bounds.getLowerBound({ netId, endPortId, portId })).toBe(
          expected,
        )
      }
    }
  }
})
