import { expect, test } from "bun:test"
import {
  TinyHyperGraphSolver,
  type Candidate,
  type TinyHyperGraphProblem,
  type TinyHyperGraphTopology,
} from "lib/index"

class ScoringSolver extends TinyHyperGraphSolver {
  override computeG(candidate: Candidate): number {
    return candidate.g + 1
  }
  override computeH(): number {
    return 0
  }
}

test("owned frontier does not coerce unusual region numbers into cached indices", (): void => {
  for (const nextRegion of [
    -1,
    -2,
    0.5,
    2 ** 31,
    2 ** 32,
    2 ** 32 + 1,
    Number.NaN,
  ]) {
    const snapshots: unknown[][] = []
    for (const owned of [false, true]) {
      const topology: TinyHyperGraphTopology = {
        portCount: 4,
        regionCount: 2,
        regionIncidentPorts: [
          [0, 1, 2],
          [0, 2, 3],
        ],
        incidentPortRegion: [[0, 1], [0, nextRegion], [0, 1], [1]],
        regionWidth: new Float64Array(2).fill(10),
        regionHeight: new Float64Array(2).fill(10),
        regionCenterX: new Float64Array(2),
        regionCenterY: new Float64Array(2),
        portAngleForRegion1: new Int32Array(4),
        portAngleForRegion2: new Int32Array(4),
        portX: Float64Array.from([0, 1, 2, 3]),
        portY: new Float64Array(4),
        portZ: new Int32Array(4),
      }
      const problem: TinyHyperGraphProblem = {
        routeCount: 1,
        portSectionMask: new Int8Array(4).fill(1),
        routeStartPort: Int32Array.from([0]),
        routeEndPort: Int32Array.from([3]),
        routeNet: Int32Array.from([0]),
        regionNetId: new Int32Array(2).fill(-1),
      }
      const solver = new ScoringSolver(topology, problem, {
        OWNED_REGIONAL_HOP_FRONTIER: owned,
        STATIC_REACHABILITY_PRECHECK: false,
      })
      solver._setup()
      solver.state.currentRouteId = 0
      solver.state.currentRouteNetId = 0
      solver.state.goalPortId = 3
      solver.state.unroutedRoutes = []
      for (const [portId, g, f] of [
        [0, 10, -100],
        [2, 0, -90],
      ]) {
        const hopId = solver.getHopId(portId, 0)
        solver.setCandidateBestCost(hopId, g)
        solver.state.candidateQueue.queue({
          hopId,
          portId,
          nextRegionId: 0,
          g,
          f,
          h: 0,
        })
      }
      const states: unknown[] = []
      for (let index = 0; index < 2; index++) {
        solver.step()
        states.push({
          queue: structuredClone(solver.state.candidateQueue.toArray()),
          iterations: solver.iterations,
          error: solver.error,
          failed: solver.failed,
        })
      }
      snapshots.push(states)
    }
    expect(snapshots[1]).toEqual(snapshots[0])
  }
})
