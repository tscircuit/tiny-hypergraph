import { expect, test } from "bun:test"
import {
  type Candidate,
  IndexedCandidateHeap,
  type TinyHyperGraphProblem,
  type TinyHyperGraphTopology,
  TinyHyperGraphSolver,
} from "lib/index"

type FrontierScene = {
  solver: TinyHyperGraphSolver
  topology: TinyHyperGraphTopology
  events: unknown[]
  goalCalls: () => number
}

const createScene = (owned: boolean, overflow: boolean): FrontierScene => {
  const topology: TinyHyperGraphTopology = {
    portCount: 5,
    regionCount: 2,
    regionIncidentPorts: [[0, 1, 1, 2, 3, 4], [0, 1, 2, 3, 4]],
    incidentPortRegion: Array.from({ length: 5 }, () => [0, 1]),
    regionWidth: new Float64Array(2).fill(100),
    regionHeight: new Float64Array(2).fill(100),
    regionCenterX: new Float64Array(2),
    regionCenterY: new Float64Array(2),
    portAngleForRegion1: Int32Array.from([0, 1000, 2000, 3000, 4000]),
    portAngleForRegion2: Int32Array.from([9000, 8000, 7000, 6000, 5000]),
    portX: Float64Array.from([0, 1, 2, 3, 4]),
    portY: Float64Array.from([0, 1, -1, 0, 1]),
    portZ: new Int32Array(5),
  }
  const problem: TinyHyperGraphProblem = {
    routeCount: 1,
    routeStartPort: Int32Array.from([0]),
    routeEndPort: Int32Array.from([2]),
    routeNet: Int32Array.from([7]),
    regionNetId: new Int32Array(2).fill(-1),
    portSectionMask: new Int8Array(5).fill(1),
  }
  const solver = new TinyHyperGraphSolver(topology, problem, {
    OWNED_REGIONAL_HOP_FRONTIER: owned,
    STATIC_REACHABILITY_PRECHECK: false,
    PARTIAL_RIP_ENABLED: false,
    OUTSIDE_IN_ROUTING: false,
    DISTANCE_TO_COST: 1,
    VERBOSE: false,
  })
  solver._setup()
  solver.state.candidateQueue = new IndexedCandidateHeap(topology.regionCount)
  if (overflow) {
    solver.getHopId = (portId, regionId): number =>
      -(portId * topology.regionCount + regionId + 1)
  }
  solver.state.currentRouteId = 0
  solver.state.currentRouteNetId = 7
  solver.state.goalPortId = 2
  solver.state.unroutedRoutes = []
  const queue = solver.state.candidateQueue
  const closedHop = solver.getHopId(1, 1)
  queue.queue({
    hopId: closedHop,
    portId: 1,
    nextRegionId: 1,
    g: 0,
    h: 0,
    f: 0,
  })
  queue.dequeue()
  const events: unknown[] = []
  let goalCalls = 0
  solver.onPathFound = (candidate: Candidate): void => {
    // Deliberately retain the route and frontier for another expansion.
    goalCalls++
    events.push(["goal", candidate.portId, candidate.g, candidate.f])
  }
  const computeG = solver.computeG.bind(solver)
  solver.computeG = (...args): number => {
    const value = computeG(...args)
    events.push(["g", args[0].portId, args[1], value])
    return value
  }
  const queueCandidate = queue.queue.bind(queue)
  queue.queue = (candidate: Candidate): void => {
    events.push([
      "queue",
      candidate.hopId,
      candidate.portId,
      candidate.g,
      candidate.h,
      candidate.f,
    ])
    queueCandidate(candidate)
  }
  return { solver, topology, events, goalCalls: (): number => goalCalls }
}

const seedAndStep = (solver: TinyHyperGraphSolver, portId = 0): unknown => {
  const hopId = solver.getHopId(portId, 0)
  solver.setCandidateBestCost(hopId, 0)
  const candidate: Candidate = {
    hopId,
    portId,
    nextRegionId: 0,
    g: 0,
    h: 0,
    f: -100,
  }
  solver.state.candidateQueue.queue(candidate)
  let error: string | undefined
  try {
    solver._step()
  } catch (caught) {
    error = (caught as Error).message
  }
  const state = JSON.stringify(solver.state, (_key, value) => {
    if (ArrayBuffer.isView(value)) return Object.values(value)
    if (value instanceof Map) return [...value]
    if (value instanceof Set) return [...value]
    if (typeof value === "number" && !Number.isFinite(value)) {
      return String(value)
    }
    return value
  })
  return { error, state, stats: { ...solver.stats } }
}

const livePorts = (solver: TinyHyperGraphSolver): number[] => {
  const frontier = solver["regionalHopFrontiers"].get(0)!
  return Array.from(frontier.indices.slice(0, frontier.length))
    .filter((index) => index !== -1)
    .map((index) => frontier.neighbors[index]!)
}

test("packed frontiers preserve an untouched suffix across goals, throws and reopening", (): void => {
  for (const overflow of [false, true]) {
    for (const blockedGoal of [false, true]) {
      const original = createScene(false, overflow)
      const packed = createScene(true, overflow)
      const scenes = [original, packed]
      const lateReads = [0, 0]
      const initialReads = blockedGoal ? 1 : 0
      for (const [index, { solver, topology }] of scenes.entries()) {
        if (blockedGoal) solver.state.portAssignment[2] = 9
        Object.defineProperty(topology.incidentPortRegion, 4, {
          configurable: true,
          get: () => {
            lateReads[index]++
            throw new Error("late incidence read")
          },
        })
      }
      expect(seedAndStep(packed.solver)).toEqual(seedAndStep(original.solver))
      expect(packed.events).toEqual(original.events)
      expect(packed.goalCalls()).toBe(blockedGoal ? 0 : 1)
      expect(lateReads).toEqual([initialReads, initialReads])
      expect(livePorts(packed.solver)).toEqual([0, 2, 3, 4])

      for (const { solver } of scenes) solver.state.portAssignment[2] = 9
      expect(seedAndStep(packed.solver, 3)).toEqual(
        seedAndStep(original.solver, 3),
      )
      expect(packed.events).toEqual(original.events)
      expect(lateReads).toEqual([initialReads + 1, initialReads + 1])
      expect(livePorts(packed.solver)).toEqual([0, 2, 3, 4])

      for (const { topology } of scenes) {
        Object.defineProperty(topology.incidentPortRegion, 4, {
          configurable: true,
          writable: true,
          value: [0, 1],
        })
      }
      expect(seedAndStep(packed.solver, 4)).toEqual(
        seedAndStep(original.solver, 4),
      )
      expect(packed.events).toEqual(original.events)

      for (const { solver } of scenes) {
        solver.state.candidateQueue.clear()
        solver.state.portAssignment[2] = -1
      }
      expect(seedAndStep(packed.solver)).toEqual(seedAndStep(original.solver))
      expect(packed.events).toEqual(original.events)
      expect(packed.goalCalls()).toBe(blockedGoal ? 1 : 2)
      expect(livePorts(packed.solver)).toEqual([0, 1, 1, 2, 3, 4])
    }
  }
})
