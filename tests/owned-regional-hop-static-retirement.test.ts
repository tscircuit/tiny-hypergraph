import { expect, test } from "bun:test"
import {
  IndexedCandidateHeap,
  TinyHyperGraphSolver,
  type TinyHyperGraphProblem,
  type TinyHyperGraphTopology,
} from "lib/index"

type Frontier = {
  neighbors: number[]
  next: Int32Array
  head: number
}

const makeSolver = (owned: boolean): TinyHyperGraphSolver => {
  const topology: TinyHyperGraphTopology = {
    portCount: 10,
    regionCount: 5,
    regionIncidentPorts: [
      [0, 1, 2, 3, 4, 5, 3, 6, 7, 8, 9],
      [1, 3, 4, 6, 9],
      [5],
      [0, 8],
      [7],
    ],
    incidentPortRegion: [
      [0, 3],
      [0, 1],
      [0],
      [0, 1],
      [0, 1],
      [0, 2],
      [0, 1],
      [0, 4],
      [0, 3],
      [0, 1],
    ],
    regionWidth: new Float64Array(5).fill(100),
    regionHeight: new Float64Array(5).fill(100),
    regionCenterX: new Float64Array(5),
    regionCenterY: new Float64Array(5),
    portAngleForRegion1: Int32Array.from({ length: 10 }, (_, i) => i * 100),
    portAngleForRegion2: Int32Array.from({ length: 10 }, (_, i) => i * 100),
    portX: Float64Array.from({ length: 10 }, (_, i) => i),
    portY: new Float64Array(10),
    portZ: new Int32Array(10),
  }
  const problem: TinyHyperGraphProblem = {
    routeCount: 2,
    portSectionMask: new Int8Array(10).fill(1),
    routeStartPort: Int32Array.from([0, 4]),
    routeEndPort: Int32Array.from([7, 4]),
    routeNet: Int32Array.from([7, 99]),
    regionNetId: Int32Array.from([-1, -1, 99, -1, -1]),
  }
  problem.portSectionMask[1] = 0
  const solver = new TinyHyperGraphSolver(topology, problem, {
    OWNED_REGIONAL_HOP_FRONTIER: owned,
    STATIC_REACHABILITY_PRECHECK: false,
    DISTANCE_TO_COST: 1,
  })
  solver._setup()
  solver.state.candidateQueue = new IndexedCandidateHeap(5)
  solver.state.currentRouteId = 0
  solver.state.currentRouteNetId = 7
  solver.state.goalPortId = 7
  solver.state.unroutedRoutes = []
  solver.state.portAssignment[3] = 99
  solver.state.portAssignment[7] = 99
  return solver
}

const seed = (solver: TinyHyperGraphSolver, portId: number): void => {
  const hopId = solver.getHopId(portId, 0)
  const g = portId === 9 ? -1 : 0
  solver.setCandidateBestCost(hopId, g)
  solver.state.candidateQueue.queue({
    hopId,
    portId,
    nextRegionId: 0,
    g,
    f: -100 + portId,
    h: 0,
  })
}

const activePorts = (solver: TinyHyperGraphSolver): number[] => {
  const frontiers = Reflect.get(solver, "regionalHopFrontiers")
  expect(frontiers).toBeInstanceOf(Map)
  const frontier: Frontier = frontiers.get(0)
  const ports: number[] = []
  for (let index = frontier.head; index !== -1; index = frontier.next[index]!) {
    ports.push(frontier.neighbors[index]!)
    expect(ports.length).toBeLessThanOrEqual(frontier.neighbors.length)
  }
  return ports
}

const compareStep = (
  original: TinyHyperGraphSolver,
  optimized: TinyHyperGraphSolver,
): void => {
  const errors: string[] = []
  for (const solver of [original, optimized]) {
    try {
      solver._step()
      errors.push("")
    } catch (error) {
      errors.push(`${(error as Error).name}: ${(error as Error).message}`)
    }
  }
  expect(errors[1]).toBe(errors[0])
  expect(optimized.state).toEqual(original.state)
  expect(optimized.stats).toEqual(original.stats)
  expect(optimized.solved).toBe(original.solved)
  expect(optimized.failed).toBe(original.failed)
  expect(optimized.error).toBe(original.error)
}

test("owned frontier retires static rejections across epochs", (): void => {
  for (const boundary of [
    "clear",
    "best-costs",
    "neighbors",
    "goal",
    "rerip",
    "problem-reset",
    "restore",
  ]) {
    const original = makeSolver(false)
    const optimized = makeSolver(true)
    for (const solver of [original, optimized]) {
      seed(solver, 0)
      seed(solver, 8)
    }
    compareStep(original, optimized)
    expect(activePorts(optimized)).toEqual([0, 6, 7, 8, 9])
    compareStep(original, optimized)
    expect(activePorts(optimized)).toEqual([0, 6, 7, 8, 9])

    for (const solver of [original, optimized]) {
      if (boundary === "clear") solver.state.candidateQueue.clear()
      if (boundary === "best-costs") solver.resetCandidateBestCosts()
      if (boundary === "neighbors") {
        solver.topology.regionIncidentPorts[0] = [
          ...solver.topology.regionIncidentPorts[0]!,
        ]
      }
      if (boundary === "goal") solver.state.goalPortId = 3
      if (boundary === "rerip") solver.resetRoutingStateForRerip()
      if (boundary === "problem-reset") solver.resetForProblem(solver.problem)
      if (boundary === "restore") {
        Reflect.set(solver, "bestSolvedStateSnapshot", {
          portAssignment: solver.state.portAssignment,
          regionSegments: solver.state.regionSegments,
          regionIntersectionCaches: solver.state.regionIntersectionCaches,
          regionCongestionCost: solver.state.regionCongestionCost,
          ripCount: solver.state.ripCount,
        })
        const restore = Reflect.get(solver, "restoreBestSolvedState")
        expect(restore).toBeInstanceOf(Function)
        restore.call(solver)
      }
      solver.problem.portSectionMask[1] = 1
      solver.topology.incidentPortRegion[2] = [0, 1]
      solver.state.portAssignment[3] = -1
      solver.state.portAssignment[7] = 99
      solver.problem.regionNetId[2] = -1
      solver.state.currentRouteId = 0
      solver.state.currentRouteNetId = 7
      solver.state.unroutedRoutes = []
      solver.state.goalPortId = boundary === "goal" ? 3 : 7
      seed(solver, 9)
    }
    compareStep(original, optimized)
    if (boundary !== "goal") {
      const queuedPorts = optimized.state.candidateQueue
        .toArray()
        .map((candidate) => candidate.portId)
      for (const portId of [1, 2, 3, 5]) {
        expect(queuedPorts, boundary).toContain(portId)
      }
    } else {
      expect(optimized.state.currentRouteId).toBeUndefined()
    }
  }

  // A blocked goal remains in place and is checked before static metadata.
  // Its availability can change without making it an ordinary outgoing hop.
  const originalGoal = makeSolver(false)
  const optimizedGoal = makeSolver(true)
  for (const solver of [originalGoal, optimizedGoal]) {
    seed(solver, 0)
    seed(solver, 8)
  }
  compareStep(originalGoal, optimizedGoal)
  expect(activePorts(optimizedGoal)).toContain(7)
  for (const solver of [originalGoal, optimizedGoal]) {
    solver.state.portAssignment[7] = 7
  }
  compareStep(originalGoal, optimizedGoal)
  expect(optimizedGoal.state.currentRouteId).toBeUndefined()

  // Retirement reached before a later error must not consume or prepare its
  // untouched suffix. Repairing that incidence can then resume the same epoch.
  const originalThrow = makeSolver(false)
  const optimizedThrow = makeSolver(true)
  for (const solver of [originalThrow, optimizedThrow]) {
    Object.defineProperty(solver.topology.incidentPortRegion, 9, {
      configurable: true,
      get: () => {
        throw new Error("later incidence failure")
      },
    })
    seed(solver, 0)
    seed(solver, 8)
  }
  compareStep(originalThrow, optimizedThrow)
  expect(activePorts(optimizedThrow)).toEqual([0, 6, 7, 8, 9])
  for (const solver of [originalThrow, optimizedThrow]) {
    Object.defineProperty(solver.topology.incidentPortRegion, 9, {
      configurable: true,
      writable: true,
      value: [0, 1],
    })
  }
  compareStep(originalThrow, optimizedThrow)
})
