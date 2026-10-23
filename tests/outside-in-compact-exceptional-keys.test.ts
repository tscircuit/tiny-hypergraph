import { expect, test } from "bun:test"
import {
  OutsideInPartialRipTinyHyperGraphSolver,
  type Candidate,
  type TinyHyperGraphProblem,
  type TinyHyperGraphTopology,
} from "lib/index"

type Frontier = {
  queue: { queue(candidate: Candidate): void }
  bestCostByHopId: Map<number, number>
}
type FrontierMethods = {
  createOutsideInFrontier(start: number, region: number, goal: number): Frontier
  dequeueFreshCandidate(frontier: Frontier): Candidate | undefined
}

test("outside-in dense state retains exceptional hop keys in sparse storage", (): void => {
  for (const key of [-1, 0.5, Number.NaN, Infinity, -Infinity, 2 ** 32]) {
    const results: unknown[] = []
    for (const sparse of [false, true]) {
      const topology: TinyHyperGraphTopology = {
        portCount: 2,
        regionCount: 3,
        regionIncidentPorts: [[0], [0, 1], [1]],
        incidentPortRegion: [
          [0, 1],
          [1, 2],
        ],
        regionWidth: new Float64Array(3).fill(10),
        regionHeight: new Float64Array(3).fill(10),
        regionCenterX: new Float64Array(3),
        regionCenterY: new Float64Array(3),
        portAngleForRegion1: new Int32Array(2),
        portAngleForRegion2: new Int32Array(2),
        portX: Float64Array.from([0, 1]),
        portY: new Float64Array(2),
        portZ: new Int32Array(2),
      }
      const problem: TinyHyperGraphProblem = {
        routeCount: 1,
        portSectionMask: new Int8Array(2).fill(1),
        routeStartPort: Int32Array.from([0]),
        routeEndPort: Int32Array.from([1]),
        routeNet: Int32Array.from([0]),
        regionNetId: new Int32Array(3).fill(-1),
      }
      const solver = new OutsideInPartialRipTinyHyperGraphSolver(
        topology,
        problem,
        {
          STATIC_REACHABILITY_PRECHECK: false,
          USE_SPARSE_CANDIDATE_STORAGE: sparse,
        },
      )
      solver.getHopId = (): number => key
      const methods = solver as unknown as FrontierMethods
      const frontier = methods.createOutsideInFrontier(0, 1, 1)
      const first = methods.dequeueFreshCandidate(frontier)
      expect(first).toBeDefined()
      const improved = { ...first!, g: 1, f: 1 }
      frontier.bestCostByHopId.set(key, 2)
      frontier.queue.queue(improved)
      const next = methods.dequeueFreshCandidate(frontier)
      expect(next).toEqual(improved)
      frontier.bestCostByHopId.set(key, 0.5)
      frontier.queue.queue(improved)
      expect(methods.dequeueFreshCandidate(frontier)).toBeUndefined()
      results.push([first, next])
    }
    expect(results[0]).toEqual(results[1])
  }
})
