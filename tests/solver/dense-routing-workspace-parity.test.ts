import { expect, test } from "bun:test"
import type {
  Candidate,
  TinyHyperGraphProblem,
  TinyHyperGraphSolverOptions,
  TinyHyperGraphTopology,
} from "../../lib/core"
import {
  DistanceAwareTinyHyperGraphSolver,
  IndexedCandidateHeap,
  TinyHyperGraphSolver,
} from "../../lib/index"
import { DenseRoutingWorkspace } from "../../lib/prepared/DenseRoutingWorkspace"
import { PreparedRoutingGeometry } from "../../lib/prepared/PreparedRoutingGeometry"

type SolverConstructor = new (
  topology: TinyHyperGraphTopology,
  problem: TinyHyperGraphProblem,
  options?: TinyHyperGraphSolverOptions,
) => TinyHyperGraphSolver

const makeTopology = (): TinyHyperGraphTopology => ({
  portCount: 7,
  regionCount: 5,
  regionIncidentPorts: [
    [0, 1, 2, 1, 3, 4, 0],
    [1, 2, 6, 1],
    [3, 6, 5, 6],
    [0],
    [5],
  ],
  incidentPortRegion: [[0, 3], [0, 1], [0, 1], [0, 2], [0], [2, 4], [1, 2]],
  regionWidth: new Float64Array(5).fill(100),
  regionHeight: new Float64Array(5).fill(100),
  regionCenterX: new Float64Array(5),
  regionCenterY: new Float64Array(5),
  portAngleForRegion1: Int32Array.from([0, 1000, 2000, 3000, 4000, 5000, 6000]),
  portAngleForRegion2: Int32Array.from([
    9000, 8000, 7000, 6000, 5000, 4000, 3000,
  ]),
  portX: Float64Array.from([0, 1, 2, 3, 4, 5, 6]),
  portY: Float64Array.from([0, 1, -1, 0, 2, 0, 1]),
  portZ: new Int32Array(7),
})

const makeProblem = (goalPortId = 5): TinyHyperGraphProblem => ({
  routeCount: 1,
  portSectionMask: new Int8Array(7).fill(1),
  routeStartPort: Int32Array.from([0]),
  routeEndPort: Int32Array.from([goalPortId]),
  routeNet: Int32Array.from([7]),
  regionNetId: new Int32Array(5).fill(-1),
})

const makeOptions = (): TinyHyperGraphSolverOptions => ({
  STATIC_REACHABILITY_PRECHECK: false,
  PARTIAL_RIP_ENABLED: false,
  OUTSIDE_IN_ROUTING: false,
  DISTANCE_TO_COST: 1,
})

const candidateSnapshot = (candidate: Candidate): unknown => ({
  hopId: candidate.hopId,
  portId: candidate.portId,
  nextRegionId: candidate.nextRegionId,
  prevRegionId: candidate.prevRegionId,
  g: candidate.g,
  h: candidate.h,
  f: candidate.f,
  prevCandidate: candidate.prevCandidate
    ? candidateSnapshot(candidate.prevCandidate)
    : undefined,
})

const snapshot = (solver: TinyHyperGraphSolver) => ({
  route: solver.state.currentRouteId,
  net: solver.state.currentRouteNetId,
  goal: solver.state.goalPortId,
  queue: solver.state.candidateQueue.toArray().map(candidateSnapshot),
  bestCosts:
    solver.state.candidateBestCostByHopId instanceof Map
      ? [...solver.state.candidateBestCostByHopId]
      : [...solver.state.candidateBestCostByHopId],
  bestCostGenerations:
    solver.state.candidateBestCostGenerationByHopId instanceof Map
      ? [...solver.state.candidateBestCostGenerationByHopId]
      : [...solver.state.candidateBestCostGenerationByHopId],
  bestCostGeneration: solver.state.candidateBestCostGeneration,
  assignments: [...solver.state.portAssignment],
  segments: solver.state.regionSegments.map((segments) =>
    segments.map((segment) => [...segment]),
  ),
  caches: solver.state.regionIntersectionCaches.map((cache) => ({
    ...cache,
    netIds: [...cache.netIds],
    lesserAngles: [...cache.lesserAngles],
    greaterAngles: [...cache.greaterAngles],
    layerMasks: [...cache.layerMasks],
  })),
  congestion: [...solver.state.regionCongestionCost],
  unrouted: [...solver.state.unroutedRoutes],
  ripCount: solver.state.ripCount,
})

const seed = (
  solver: TinyHyperGraphSolver,
  portId: number,
  nextRegionId: number,
  g: number,
  f: number,
) => {
  const hopId = solver.getHopId(portId, nextRegionId)
  solver.setCandidateBestCost(hopId, g)
  solver.state.candidateQueue.queue({ hopId, portId, nextRegionId, g, f, h: 0 })
}

const build = (
  Solver: SolverConstructor,
  goalPortId: number,
): TinyHyperGraphSolver => {
  const topology = makeTopology()
  const solver = new Solver(topology, makeProblem(goalPortId), makeOptions())
  solver._setup()
  solver.state.candidateQueue = new IndexedCandidateHeap(topology.regionCount)
  solver.state.currentRouteId = 0
  solver.state.currentRouteNetId = 7
  solver.state.goalPortId = goalPortId
  solver.state.unroutedRoutes = []
  seed(solver, 0, 0, 0, -100)
  seed(solver, 3, 0, 10, -90)
  return solver
}

// DenseRoutingWorkspace must preserve the native expansion exactly, including
// the solver's ADD_SEGMENT_DISTANCE_TO_G cost composition.
test("dense workspace expansion preserves native candidate costs", () => {
  for (const Solver of [
    TinyHyperGraphSolver,
    DistanceAwareTinyHyperGraphSolver,
  ]) {
    for (const goal of [5, 6]) {
      for (const steps of [1, 2, 3]) {
        const native = build(Solver, goal)
        const dense = build(Solver, goal)
        const workspace = new DenseRoutingWorkspace(
          new PreparedRoutingGeometry(dense.topology),
        )
        for (let index = 0; index < steps; index++) {
          native._step()
          expect(workspace.step(dense)).toBe(true)
        }
        expect(
          snapshot(dense),
          `${Solver.name}/goal-${goal}/steps-${steps}`,
        ).toEqual(snapshot(native))
      }
    }
  }
})
