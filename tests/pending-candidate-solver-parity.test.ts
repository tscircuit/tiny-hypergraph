import { expect, test } from "bun:test"
import type {
  Candidate,
  TinyHyperGraphProblem,
  TinyHyperGraphTopology,
} from "lib/core"
import { DistanceAwareTinyHyperGraphSolver } from "lib/distance-aware-tiny-hypergraph-solver"

class LegacyQueueSolver extends DistanceAwareTinyHyperGraphSolver {
  override _setup(): void {
    super._setup()
    this.state.candidateQueue.queueValues = undefined
  }
}

class CountedValuesSolver extends DistanceAwareTinyHyperGraphSolver {
  decreases = 0
  override _setup(): void {
    super._setup()
    const owner = this
    const queue = this.state.candidateQueue
    const originalValues = queue.queueValues!
    queue.queueValues = function (...args): void {
      const internal = this as any
      const index = internal.getQueuedHopIndex(args[0])
      if (index !== undefined && args[4] < internal.items[index].g)
        owner.decreases++
      originalValues.apply(this, args)
    }
  }
}

const fixture = (): {
  topology: TinyHyperGraphTopology
  problem: TinyHyperGraphProblem
} => ({
  topology: {
    portCount: 7,
    regionCount: 7,
    regionIncidentPorts: [[0, 1, 2], [1, 3], [2, 4], [3, 4, 5], [5, 6], [], []],
    incidentPortRegion: [
      [0, 5],
      [0, 1],
      [0, 2],
      [1, 3],
      [2, 3],
      [3, 4],
      [4, 6],
    ],
    regionWidth: new Float64Array(7).fill(100),
    regionHeight: new Float64Array(7).fill(100),
    regionCenterX: new Float64Array(7),
    regionCenterY: new Float64Array(7),
    regionAvailableZMask: new Int32Array(7).fill(3),
    portAngleForRegion1: Int32Array.from([
      0, 1000, 2000, 3000, 4000, 5000, 6000,
    ]),
    portAngleForRegion2: Int32Array.from([
      9000, 10000, 11000, 12000, 13000, 14000, 15000,
    ]),
    portX: Float64Array.from([0, 1, 0, 4, 1, 1, 5]),
    portY: Float64Array.from([0, 0, 1, 1, 1, 2, 1]),
    portZ: Int32Array.from([0, 0, 0, 0, 0, 1, 0]),
  },
  problem: {
    routeCount: 2,
    portSectionMask: new Int8Array(7).fill(1),
    routeStartPort: Int32Array.from([0, 0]),
    routeEndPort: Int32Array.from([6, 6]),
    routeNet: new Int32Array(2),
    regionNetId: new Int32Array(7).fill(-1),
  },
})

const candidateValue = (candidate?: Candidate): unknown =>
  candidate && [
    candidate.hopId,
    candidate.prevRegionId,
    candidate.nextRegionId,
    candidate.portId,
    candidate.g,
    candidate.h,
    candidate.f,
    candidateValue(candidate.prevCandidate),
  ]

const solverValue = (solver: DistanceAwareTinyHyperGraphSolver) => {
  const { candidateQueue, ...state } = solver.state
  const queue = candidateQueue as any
  return {
    state,
    items: queue.items.map(candidateValue),
    indexes: [...queue.indexByHopId],
    closed: [...queue.closedHopIds],
    generations: queue.hopStateGeneration,
    indexOrClosed: queue.hopIndexOrClosed,
    generation: queue.currentHopStateGeneration,
    iterations: solver.iterations,
    solved: solver.solved,
    failed: solver.failed,
    error: solver.error,
  }
}

test("owned pending upserts preserve compact routing work and final paths", () => {
  for (const sparse of [false, true]) {
    const before = fixture()
    const after = fixture()
    const options = {
      STATIC_REACHABILITY_PRECHECK: false,
      USE_SPARSE_CANDIDATE_STORAGE: sparse,
      DISTANCE_TO_COST: 1,
    }
    const legacy = new LegacyQueueSolver(
      before.topology,
      before.problem,
      options,
    )
    const values = new CountedValuesSolver(
      after.topology,
      after.problem,
      options,
    )
    for (
      let step = 0;
      step < 1000 && !legacy.solved && !legacy.failed;
      step++
    ) {
      legacy.step()
      values.step()
      expect(solverValue(values)).toEqual(solverValue(legacy))
    }
    expect(legacy.solved).toBe(true)
    expect(legacy.failed).toBe(false)
    expect(values.decreases).toBeGreaterThan(0)
    expect(values.getOutput()).toEqual(legacy.getOutput())
    expect(values.state.regionSegments[0]).toEqual([
      [0, 0, 2],
      [1, 0, 2],
    ])
    expect(values.state.regionSegments[4]).toEqual([
      [0, 5, 6],
      [1, 5, 6],
    ])
  }
})
