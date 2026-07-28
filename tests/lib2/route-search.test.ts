import { expect, test } from "bun:test"
import type {
  Candidate,
  TinyHyperGraphProblem,
  TinyHyperGraphTopology,
  TinyHyperGraphWorkingState,
} from "lib2/domain"
import { MinHeap } from "lib2/min-heap"
import { runRouteSearchStep } from "lib2/route-search"

const compareCandidate = (left: Candidate, right: Candidate) =>
  left.f - right.f

test("route search accepts a goal neighbor before route-cost checks", () => {
  const topology: TinyHyperGraphTopology = {
    portCount: 2,
    regionCount: 1,
    regionIncidentPorts: [[0, 1]],
    incidentPortRegion: [[0], [0]],
    regionWidth: new Float64Array([1]),
    regionHeight: new Float64Array([1]),
    regionCenterX: new Float64Array([0]),
    regionCenterY: new Float64Array([0]),
    portAngleForRegion1: new Int32Array([0, 9000]),
    portX: new Float64Array([0, 1]),
    portY: new Float64Array([0, 0]),
    portZ: new Int32Array([0, 0]),
  }
  const problem: TinyHyperGraphProblem = {
    routeCount: 1,
    portSectionMask: new Int8Array([1, 0]),
    routeStartPort: new Int32Array([0]),
    routeEndPort: new Int32Array([1]),
    routeNet: new Int32Array([2]),
    regionNetId: new Int32Array([-1]),
  }
  const state: TinyHyperGraphWorkingState = {
    portAssignment: new Int32Array([-1, -1]),
    regionSegments: [[]],
    regionIntersectionCaches: [],
    currentRouteNetId: undefined,
    currentRouteId: undefined,
    unroutedRoutes: [0],
    candidateQueue: new MinHeap([], compareCandidate),
    candidateBestCostByHopId: new Float64Array(2),
    candidateBestCostGenerationByHopId: new Uint32Array(2),
    candidateBestCostGeneration: 1,
    goalPortId: -1,
    ripCount: 0,
    regionCongestionCost: new Float64Array([0]),
  }
  const bestCostByHopId = new Map<number, number>()
  let routeAttemptCount = 0
  let routeCostWasRead = false

  const result = runRouteSearchStep({
    topology,
    problem,
    state,
    getHopId: (portId, nextRegionId) => portId * 10 + nextRegionId,
    getCandidateBestCost: (hopId) =>
      bestCostByHopId.get(hopId) ?? Number.POSITIVE_INFINITY,
    setCandidateBestCost: (hopId, cost) => {
      bestCostByHopId.set(hopId, cost)
    },
    resetCandidateBestCosts: () => {
      bestCostByHopId.clear()
    },
    getStartingNextRegionId: () => 0,
    isPortReservedForDifferentNet: () => false,
    isRegionReservedForDifferentNet: () => false,
    computeG: () => {
      routeCostWasRead = true
      return Number.POSITIVE_INFINITY
    },
    computeH: () => 0,
    onRouteAttempt: () => {
      routeAttemptCount += 1
    },
  })

  expect(typeof result).toBe("object")
  if (typeof result === "object" && !("_tag" in result)) {
    expect(result.portId).toBe(0)
  }
  expect(routeAttemptCount).toBe(1)
  expect(routeCostWasRead).toBe(false)
})

test("route search reports missing region incident ports as failure", () => {
  const topology: TinyHyperGraphTopology = {
    portCount: 2,
    regionCount: 2,
    regionIncidentPorts: [[0, 1]],
    incidentPortRegion: [[0], [0]],
    regionWidth: new Float64Array([1, 1]),
    regionHeight: new Float64Array([1, 1]),
    regionCenterX: new Float64Array([0, 1]),
    regionCenterY: new Float64Array([0, 0]),
    portAngleForRegion1: new Int32Array([0, 9000]),
    portX: new Float64Array([0, 1]),
    portY: new Float64Array([0, 0]),
    portZ: new Int32Array([0, 0]),
  }
  const problem: TinyHyperGraphProblem = {
    routeCount: 1,
    portSectionMask: new Int8Array([1, 1]),
    routeStartPort: new Int32Array([0]),
    routeEndPort: new Int32Array([1]),
    routeNet: new Int32Array([2]),
    regionNetId: new Int32Array([-1, -1]),
  }
  const state: TinyHyperGraphWorkingState = {
    portAssignment: new Int32Array([-1, -1]),
    regionSegments: [[], []],
    regionIntersectionCaches: [],
    currentRouteNetId: undefined,
    currentRouteId: undefined,
    unroutedRoutes: [0],
    candidateQueue: new MinHeap([], compareCandidate),
    candidateBestCostByHopId: new Float64Array(4),
    candidateBestCostGenerationByHopId: new Uint32Array(4),
    candidateBestCostGeneration: 1,
    goalPortId: -1,
    ripCount: 0,
    regionCongestionCost: new Float64Array([0, 0]),
  }

  const result = runRouteSearchStep({
    topology,
    problem,
    state,
    getHopId: (portId, nextRegionId) => portId * 10 + nextRegionId,
    getCandidateBestCost: () => Number.POSITIVE_INFINITY,
    setCandidateBestCost: () => {},
    resetCandidateBestCosts: () => {},
    getStartingNextRegionId: () => 1,
    isPortReservedForDifferentNet: () => false,
    isRegionReservedForDifferentNet: () => false,
    computeG: () => 0,
    computeH: () => 0,
    onRouteAttempt: () => {},
  })

  expect(result).toEqual({
    _tag: "failed",
    reason: "missingRegionIncidentPorts",
    error: "Region 1 is missing incident ports during route search",
  })
})
