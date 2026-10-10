import { expect, test } from "bun:test"
import type { Candidate, TinyHyperGraphProblem, TinyHyperGraphTopology } from "lib/core"
import { OutsideInPartialRipTinyHyperGraphSolver } from "lib/outside-in-partial-rip-tiny-hypergraph-solver"

test("reverse outside-in edges pay forward target ports and preserve bounded pruning", () => {
  const topology: TinyHyperGraphTopology = {
    portCount: 3,
    regionCount: 2,
    regionIncidentPorts: [[0, 1, 2], []],
    incidentPortRegion: [[0, 1], [0, 1], [0, 1]],
    regionWidth: Float64Array.of(100, 1),
    regionHeight: Float64Array.of(100, 1),
    regionCenterX: new Float64Array(2),
    regionCenterY: new Float64Array(2),
    regionAvailableZMask: Int32Array.of(3, 0),
    portAngleForRegion1: Int32Array.of(0, 12000, 24000),
    portX: Float64Array.of(0, 5, 10),
    portY: new Float64Array(3),
    portZ: new Int32Array(3),
  }
  const problem: TinyHyperGraphProblem = {
    routeCount: 1,
    portSectionMask: new Int8Array(3).fill(1),
    routeStartPort: Int32Array.of(0),
    routeEndPort: Int32Array.of(2),
    routeNet: Int32Array.of(0),
    regionNetId: new Int32Array(2).fill(-1),
    portPenalty: Float64Array.of(1000, 1000, 150),
  }
  const solver = new OutsideInPartialRipTinyHyperGraphSolver(topology, problem, {
    TRACE_DENSITY_COST_FACTOR: 0,
    VIA_COST: 0.6,
  })
  solver.state.currentRouteNetId = 0
  const score = (solver as unknown as {
    computeOutsideInG(candidate: Candidate, neighbor: number, forward: boolean, bound: number, distance: number): number
  }).computeOutsideInG.bind(solver)
  const candidate = (portId: number, g = 0): Candidate => ({ nextRegionId: 0, portId, f: g, g, h: 0 })
  const forwardFirst = score(candidate(0), 1, true, Infinity, 5)
  const forwardTotal = score(candidate(1, forwardFirst), 2, true, Infinity, 5)
  const reverseFirst = score(candidate(2), 1, false, 150.26, 5)
  expect(reverseFirst).toBeCloseTo(150.25)
  expect(score(candidate(2), 1, false, 150.24, 5)).toBe(Infinity)
  const reverseTotal = score(candidate(1, reverseFirst), 0, false, Infinity, 5)
  expect(reverseTotal).toBeCloseTo(forwardTotal)
  expect(forwardFirst + reverseFirst).toBeCloseTo(forwardTotal)
})
