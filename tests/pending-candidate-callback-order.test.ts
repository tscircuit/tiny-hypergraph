import { expect, test } from "bun:test"
import type {
  Candidate,
  TinyHyperGraphProblem,
  TinyHyperGraphTopology,
} from "lib/core"
import { DistanceAwareTinyHyperGraphSolver } from "lib/distance-aware-tiny-hypergraph-solver"

const topology: TinyHyperGraphTopology = {
  portCount: 3,
  regionCount: 2,
  regionIncidentPorts: [[0, 1, 2], []],
  incidentPortRegion: [
    [0, 1],
    [0, 1],
    [0, 1],
  ],
  regionWidth: new Float64Array(2).fill(100),
  regionHeight: new Float64Array(2).fill(100),
  regionCenterX: new Float64Array(2),
  regionCenterY: new Float64Array(2),
  portAngleForRegion1: new Int32Array(3),
  portAngleForRegion2: new Int32Array(3),
  portX: Float64Array.from([0, 1, 10]),
  portY: new Float64Array(3),
  portZ: new Int32Array(3),
}
const problem: TinyHyperGraphProblem = {
  routeCount: 1,
  portSectionMask: new Int8Array(3).fill(1),
  routeStartPort: Int32Array.from([0]),
  routeEndPort: Int32Array.from([2]),
  routeNet: new Int32Array(1),
  regionNetId: new Int32Array(2).fill(-1),
}

test("values dispatch preserves the second goal check and field evaluation", () => {
  class GoalChangingSolver extends DistanceAwareTinyHyperGraphSolver {
    captured?: Candidate
    popped?: Candidate
    override _setup(): void {
      super._setup()
      const owner = this
      const queue = this.state.candidateQueue
      const originalDequeue = queue.dequeue
      queue.dequeue = function () {
        const candidate = originalDequeue.call(this)
        owner.popped = candidate
        return candidate
      }
    }
    override computeH(portId: number): number {
      this.state.goalPortId = portId
      const owner = this
      return {
        valueOf() {
          owner.popped!.nextRegionId = 1
          return 0
        },
      } as unknown as number
    }
    override onPathFound(candidate: Candidate): void {
      this.captured = candidate
      this.solved = true
    }
  }
  const solver = new GoalChangingSolver(topology, problem, {
    STATIC_REACHABILITY_PRECHECK: false,
  })
  solver.step()
  expect(solver.captured?.portId).toBe(1)
  expect(solver.captured?.prevRegionId).toBe(0)
  expect(solver.captured?.nextRegionId).toBe(1)
  expect(solver.captured?.prevCandidate).toBe(solver.popped)
  expect(solver.popped?.nextRegionId).toBe(1)
  expect(solver.captured?.f).toBe(solver.captured?.g)

  const goalSolver = new DistanceAwareTinyHyperGraphSolver(topology, problem, {
    STATIC_REACHABILITY_PRECHECK: false,
  })
  goalSolver._setup()
  goalSolver.state.currentRouteId = 0
  goalSolver.state.currentRouteNetId = 0
  goalSolver.state.goalPortId = 2
  const predecessor: Candidate = {
    portId: 1,
    nextRegionId: 0,
    g: 2,
    h: 0,
    f: 2,
  }
  const queue = goalSolver.state.candidateQueue
  const originalQueue = queue.queue
  let queueReads = 0
  Object.defineProperty(queue, "queue", {
    get() {
      queueReads++
      predecessor.nextRegionId = 1
      return originalQueue
    },
  })
  goalSolver.onPathFound(predecessor)
  const goal = queue.toArray()[0]
  expect(queueReads).toBe(1)
  expect(goal.prevRegionId).toBe(1)
  expect(goal.nextRegionId).toBe(1)
  expect(goal.prevCandidate).toBe(predecessor)
})
