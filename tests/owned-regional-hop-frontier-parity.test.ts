import { expect, test } from "bun:test"
import {
  type Candidate,
  DistanceAwareTinyHyperGraphSolver,
  IndexedCandidateHeap,
  OutsideInPartialRipTinyHyperGraphSolver,
  SelectiveReripTinyHyperGraphSolver,
  type TinyHyperGraphCandidateQueue,
  type TinyHyperGraphProblem,
  TinyHyperGraphSolver,
  type TinyHyperGraphSolverOptions,
  type TinyHyperGraphTopology,
} from "lib/index"

type SolverConstructor = new (
  topology: TinyHyperGraphTopology,
  problem: TinyHyperGraphProblem,
  options?: TinyHyperGraphSolverOptions,
) => TinyHyperGraphSolver

class InheritedSolver extends SelectiveReripTinyHyperGraphSolver {}

test("fixed metadata retirement preserves filter combinations and epoch resets", () => {
  for (let filters = 0; filters < 32; filters++) {
    for (const compact of [false, true]) {
      for (const reversed of [false, true]) {
        for (const transition of [
          "clear",
          "heap",
          "goal",
          "neighbors",
          "route",
          "net",
        ]) {
          const prepare = (owned: boolean) => {
            const result = makeManual(owned, compact)
            const { solver } = result
            solver.topology.regionIncidentPorts[0] = reversed
              ? [3, 2, 1, 2, 0, 1]
              : [0, 1, 2, 2, 1, 3]
            if (filters & 1) solver.problem.portSectionMask[2] = 0
            if (filters & 2) solver.topology.incidentPortRegion[2] = [0]
            if (filters & 4)
              solver.problemSetup.portEndpointReservationNetId[2] = 9
            if (filters & 8) solver.problem.regionNetId[1] = 9
            if (filters & 16) solver.state.portAssignment[2] = 9
            return result
          }
          const original = prepare(false)
          const optimized = prepare(true)
          for (let index = 0; index < 2; index++) {
            expect(step(optimized.solver)).toEqual(step(original.solver))
          }
          // Occupancy remains live; only immutable filters retire occurrences.
          expect(
            remainingFrontierPorts(optimized.solver).filter(
              (port) => port === 2,
            ).length,
          ).toBe(filters & 7 || (filters & 8 && !(filters & 16)) ? 0 : 2)
          for (const { solver } of [original, optimized]) {
            solver.problem.portSectionMask[2] = 1
            solver.topology.incidentPortRegion[2] = [0, 1]
            solver.problemSetup.portEndpointReservationNetId[2] = -1
            solver.problem.regionNetId[1] = -1
            solver.state.portAssignment[2] = -1
            solver.resetCandidateBestCosts()
            if (transition === "clear") solver.state.candidateQueue.clear()
            if (transition === "heap")
              solver.state.candidateQueue = makeHeap(solver.topology, compact)
            if (transition === "goal") solver.state.goalPortId = 2
            if (transition === "neighbors")
              solver.topology.regionIncidentPorts[0] = [
                ...solver.topology.regionIncidentPorts[0]!,
              ]
            if (transition === "route") solver.state.currentRouteId = 1
            if (transition === "net") solver.state.currentRouteNetId = 8
            seed(solver, 0, 0, 0, -100)
          }
          expect(
            step(optimized.solver),
            `${filters}/${compact}/${reversed}/${transition}`,
          ).toEqual(step(original.solver))
        }
      }
    }
  }
})

test("fixed metadata retirement keeps occupancy live within the same epoch", () => {
  for (const compact of [false, true]) {
    const original = makeManual(false, compact)
    const optimized = makeManual(true, compact)
    for (const { solver } of [original, optimized])
      solver.state.portAssignment[2] = 9
    expect(step(optimized.solver)).toEqual(step(original.solver))
    for (const { solver } of [original, optimized])
      solver.state.portAssignment[2] = -1
    expect(step(optimized.solver)).toEqual(step(original.solver))
    expect(
      optimized.solver.state.candidateQueue
        .toArray()
        .some((candidate) => candidate.portId === 2),
    ).toBe(true)
  }
})

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

const makeOptions = (
  owned: boolean | undefined,
  sparse = false,
): TinyHyperGraphSolverOptions => ({
  OWNED_REGIONAL_HOP_FRONTIER: owned,
  USE_SPARSE_CANDIDATE_STORAGE: sparse,
  STATIC_REACHABILITY_PRECHECK: false,
  PARTIAL_RIP_ENABLED: false,
  OUTSIDE_IN_ROUTING: false,
  DISTANCE_TO_COST: 1,
  VERBOSE: false,
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

// Observe decisions without changing routing methods or mutating search state.
// Every budget compares a prefix of the original flag-off loop.
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
  solved: solver.solved,
  failed: solver.failed,
  error: solver.error,
  stats: { ...solver.stats },
})

const step = (solver: TinyHyperGraphSolver) => {
  let error: { name: string; message: string } | undefined
  try {
    solver._step()
  } catch (caught) {
    const exception = caught as Error
    error = { name: exception.name, message: exception.message }
  }
  return { error, state: snapshot(solver) }
}

const frontierCount = (solver: TinyHyperGraphSolver): number =>
  (
    solver as unknown as {
      regionalHopFrontiers?: Map<number, unknown>
    }
  ).regionalHopFrontiers?.size ?? 0

const remainingFrontierPorts = (solver: TinyHyperGraphSolver): number[] => {
  const frontier = (
    solver as unknown as {
      regionalHopFrontiers: Map<
        number,
        { neighbors: number[]; next: Int32Array; head: number }
      >
    }
  ).regionalHopFrontiers.get(0)!
  const ports: number[] = []
  let index = frontier.head
  while (index !== -1 && ports.length <= frontier.neighbors.length) {
    ports.push(frontier.neighbors[index]!)
    index = frontier.next[index]!
  }
  expect(index).toBe(-1)
  return ports
}

const makeHeap = (
  topology: TinyHyperGraphTopology,
  compact: boolean,
): IndexedCandidateHeap => {
  if (!compact) return new IndexedCandidateHeap(topology.regionCount)
  const stride = Math.max(
    1,
    ...Array.from(
      { length: topology.portCount },
      (_, portId) => topology.incidentPortRegion[portId]?.length ?? 0,
    ),
  )
  return new IndexedCandidateHeap(topology.regionCount, {
    hopCapacity: topology.portCount * stride,
    hopSlotStride: stride,
    firstRegionByPortId: Int32Array.from(
      Array.from(
        { length: topology.portCount },
        (_, portId) => topology.incidentPortRegion[portId]?.[0] ?? -1,
      ),
    ),
    secondRegionByPortId: Int32Array.from(
      Array.from(
        { length: topology.portCount },
        (_, portId) => topology.incidentPortRegion[portId]?.[1] ?? -1,
      ),
    ),
    incidentPortRegion: topology.incidentPortRegion,
  })
}

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

const makeManual = (
  owned: boolean | undefined,
  compact: boolean,
  Solver: SolverConstructor = DistanceAwareTinyHyperGraphSolver,
  problem = makeProblem(),
) => {
  const topology = makeTopology()
  topology.regionIncidentPorts[0] = [0, 1, 2, 1, 3]
  const solver = new Solver(topology, problem, makeOptions(owned, !compact))
  solver._setup()
  const heap = makeHeap(topology, compact)
  solver.state.candidateQueue = heap
  solver.state.currentRouteId = 0
  solver.state.currentRouteNetId = 7
  solver.state.goalPortId = 5
  solver.state.unroutedRoutes = []
  // Close the outgoing 1 -> region 1 hop before either incoming source is
  // expanded. Both raw occurrences of port 1 must be handled independently.
  const closedHopId = solver.getHopId(1, 1)
  heap.queue({
    hopId: closedHopId,
    portId: 1,
    nextRegionId: 1,
    g: 0,
    f: 0,
    h: 0,
  })
  heap.dequeue()
  seed(solver, 0, 0, 10, -100)
  seed(solver, 3, 0, 0, -90)
  return { solver, heap, closedHopId }
}

test("owned regional frontier preserves routing and search invalidation", () => {
  for (const Solver of [
    DistanceAwareTinyHyperGraphSolver,
    OutsideInPartialRipTinyHyperGraphSolver,
    SelectiveReripTinyHyperGraphSolver,
    InheritedSolver,
  ]) {
    for (const goal of [0, 5, 6]) {
      for (const variant of [
        "duplicates",
        "reversed",
        "masked",
        "occupied",
        "reserved",
      ]) {
        for (const budget of [0, 1, 2, 4, 8, 16, 32]) {
          const run = (owned: boolean) => {
            const topology = makeTopology()
            const problem = makeProblem(goal)
            if (variant === "reversed") {
              topology.regionIncidentPorts = topology.regionIncidentPorts.map(
                (ports) => [...ports].reverse(),
              )
            }
            if (variant === "masked") {
              problem.portSectionMask[2] = 0
              problem.portSectionMask[goal] = 0
            }
            if (variant === "reserved") problem.regionNetId[1] = 9
            const solver = new Solver(topology, problem, makeOptions(owned))
            solver._setup()
            if (variant === "occupied") solver.state.portAssignment[3] = 9
            const states = [snapshot(solver)]
            for (let index = 0; index < budget; index++) {
              const next = step(solver)
              states.push(next.state)
              if (next.error || solver.solved || solver.failed) {
                return { states, error: next.error }
              }
            }
            return { states, error: undefined }
          }
          expect(
            run(true),
            `${Solver.name}/${goal}/${variant}/${budget}`,
          ).toEqual(run(false))
        }
      }
    }
  }

  // A retained occurrence can later become the goal even though its ordinary
  // outgoing hop is closed. A clear must also reopen every removed occurrence.
  for (const compact of [false, true]) {
    for (const Solver of [
      DistanceAwareTinyHyperGraphSolver,
      OutsideInPartialRipTinyHyperGraphSolver,
      SelectiveReripTinyHyperGraphSolver,
      InheritedSolver,
    ]) {
      const original = makeManual(false, compact, Solver)
      const optimized = makeManual(true, compact, Solver)
      expect(step(optimized.solver)).toEqual(step(original.solver))
      expect(step(optimized.solver)).toEqual(step(original.solver))
      expect(frontierCount(optimized.solver), Solver.name).toBeGreaterThan(0)
      expect(remainingFrontierPorts(optimized.solver)).toEqual([0, 2, 3])
    }
    for (const transition of [
      "clear",
      "clear-wrap",
      "heap",
      "goal",
      "best-costs",
    ]) {
      const original = makeManual(false, compact)
      const optimized = makeManual(true, compact)
      for (let index = 0; index < 2; index++) {
        expect(step(optimized.solver)).toEqual(step(original.solver))
      }
      expect(frontierCount(optimized.solver)).toBeGreaterThan(0)
      expect(
        original.heap.toArray().map((candidate) => candidate.portId),
      ).not.toContain(1)
      for (const { solver, heap } of [original, optimized]) {
        if (transition === "clear" || transition === "clear-wrap") {
          if (transition === "clear-wrap" && compact) {
            const heapState = heap as unknown as {
              currentHopStateGeneration: number
            }
            heapState.currentHopStateGeneration = 0xffffffff
          }
          const oldEpoch = heap.closureEpoch
          heap.clear()
          expect(heap.closureEpoch).not.toBe(oldEpoch)
          seed(solver, 0, 0, 0, -100)
        } else if (transition === "heap") {
          solver.state.candidateQueue = makeHeap(solver.topology, compact)
          seed(solver, 0, 0, 0, -100)
        } else if (transition === "goal") {
          solver.state.goalPortId = 1
          seed(solver, 2, 0, 0, -100)
        } else {
          solver.resetCandidateBestCosts()
          seed(solver, 2, 0, 0, -100)
        }
      }
      expect(step(optimized.solver), `${compact}/${transition}`).toEqual(
        step(original.solver),
      )
      if (transition !== "best-costs") {
        expect(
          original.solver.state.candidateQueue
            .toArray()
            .map((candidate) => candidate.portId),
        ).toContain(1)
      }
    }
  }

  for (const boundary of ["neighbors", "route", "net"]) {
    const prepare = (owned: boolean) => {
      const problem = makeProblem()
      problem.routeCount = 2
      problem.routeStartPort = Int32Array.from([0, 0])
      problem.routeEndPort = Int32Array.from([5, 5])
      problem.routeNet = Int32Array.from([7, boundary === "route" ? 7 : 8])
      return makeManual(owned, true, DistanceAwareTinyHyperGraphSolver, problem)
    }
    const original = prepare(false)
    const optimized = prepare(true)
    expect(step(optimized.solver)).toEqual(step(original.solver))
    expect(step(optimized.solver)).toEqual(step(original.solver))
    const optimizedFrontiers = (
      optimized.solver as unknown as {
        regionalHopFrontiers: Map<number, { neighbors: number[] }>
      }
    ).regionalHopFrontiers
    const oldFrontier = optimizedFrontiers.get(0)
    expect(oldFrontier).toBeDefined()
    for (const { solver } of [original, optimized]) {
      if (boundary === "neighbors") {
        solver.topology.regionIncidentPorts[0] = [0, 1, 2, 1, 3, 6]
      } else if (boundary === "route") {
        solver.state.currentRouteId = 1
        solver.state.currentRouteNetId = solver.problem.routeNet[1]
      } else {
        // The original loop takes the active net from working state. Change
        // that token alone so a route-id check cannot conceal a stale net.
        solver.state.currentRouteNetId = 8
      }
      seed(solver, 2, 0, 0, -100)
    }
    expect(step(optimized.solver), boundary).toEqual(step(original.solver))
    const freshFrontier = optimizedFrontiers.get(0)
    expect(freshFrontier).not.toBe(oldFrontier)
    expect(freshFrontier?.neighbors).toBe(
      optimized.solver.topology.regionIncidentPorts[0],
    )
    if (boundary === "neighbors") {
      expect(
        original.solver.state.candidateQueue
          .toArray()
          .map((candidate) => candidate.portId),
      ).toContain(6)
    }
  }

  // Do not inspect later incidence before the original loop reaches it. Goal,
  // source and mask checks precede those reads, including malformed metadata.
  for (const variant of [
    "early-goal",
    "goal-is-source",
    "masked-invalid",
    "self-invalid",
    "invalid-first",
    "earlier-score-error",
  ]) {
    const run = (owned: boolean) => {
      const topology = makeTopology()
      const problem = makeProblem(variant === "goal-is-source" ? 0 : 1)
      topology.regionIncidentPorts[0] =
        variant === "invalid-first" ? [0, 2, 1] : [0, 1, 2]
      delete topology.incidentPortRegion[2]
      problem.portSectionMask[1] = 0
      if (variant === "masked-invalid") {
        topology.regionIncidentPorts[0] = [0, 2, 1]
        problem.portSectionMask[2] = 0
      }
      if (variant === "self-invalid") delete topology.incidentPortRegion[0]
      if (variant === "earlier-score-error") {
        problem.routeEndPort[0] = 5
        problem.portSectionMask[1] = 1
      }
      const solver = new TinyHyperGraphSolver(
        topology,
        problem,
        makeOptions(owned),
      )
      solver._setup()
      solver.state.candidateQueue = makeHeap(topology, true)
      solver.state.currentRouteId = 0
      solver.state.currentRouteNetId = 7
      solver.state.goalPortId = problem.routeEndPort[0]!
      solver.state.unroutedRoutes = []
      seed(solver, 0, 0, 0, 0)
      if (variant === "earlier-score-error") {
        solver.computeG = () => {
          throw new Error("earlier scoring failure")
        }
      }
      return step(solver)
    }
    const original = run(false)
    expect(run(true), variant).toEqual(original)
    if (variant === "invalid-first")
      expect(original.error?.name).toBe("TypeError")
    else if (variant === "earlier-score-error") {
      expect(original.error?.message).toBe("earlier scoring failure")
    } else {
      expect(original.error).toBeUndefined()
      expect(original.state.route).toBeUndefined()
    }
  }

  // Custom queue objects keep the original callback schedule even when the
  // caller enables the frontier. Only IndexedCandidateHeap supplies its epoch.
  for (const useHopId of [false, true]) {
    const run = (owned: boolean) => {
      const { solver, heap, closedHopId } = makeManual(owned, true)
      const calls: number[] = []
      let targetQueries = 0
      const isClosed = (hopId: number): boolean => {
        calls.push(hopId)
        if (hopId !== closedHopId) return heap.isClosedHopId(hopId)
        targetQueries++
        // Only literal true rejects a candidate in the original loop.
        if (targetQueries % 3 === 1) return undefined as unknown as boolean
        return targetQueries % 3 === 2
      }
      const queue: TinyHyperGraphCandidateQueue = {
        get length() {
          return heap.length
        },
        toArray: () => heap.toArray(),
        clear: () => heap.clear(),
        queue: (candidate) => heap.queue(candidate),
        dequeue: () => heap.dequeue(),
      }
      if (useHopId) {
        queue.isClosedHopId = isClosed
      } else {
        queue.isClosedHop = (portId, regionId) =>
          isClosed(solver.getHopId(portId, regionId))
      }
      solver.state.candidateQueue = queue
      const states = [step(solver), step(solver)]
      return { states, calls, frontierCount: frontierCount(solver) }
    }
    const original = run(false)
    expect(run(true)).toEqual(original)
    expect(original.calls.length).toBeGreaterThan(0)
    expect(original.frontierCount).toBe(0)
  }

  // Ownership is opt-in. A custom key hook that clears the heap during a scan
  // must leave it disabled so the later duplicate observes the reopened hop.
  const { solver, heap } = makeManual(undefined, true)
  const originalGetHopId = solver.getHopId.bind(solver)
  const keyQueries: number[] = []
  let sourceQueries = 0
  solver.getHopId = (portId, regionId) => {
    keyQueries.push(portId)
    if (portId === 2 && ++sourceQueries === 2) heap.clear()
    return originalGetHopId(portId, regionId)
  }
  step(solver)
  step(solver)
  expect(solver.OWNED_REGIONAL_HOP_FRONTIER).toBe(false)
  expect(frontierCount(solver)).toBe(0)
  expect(keyQueries.filter((portId) => portId === 1)).toHaveLength(4)
  expect(heap.toArray().map((candidate) => candidate.portId)).toContain(1)
})
