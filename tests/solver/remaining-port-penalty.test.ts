import { expect, test } from "bun:test"
import {
  TinyHyperGraphSolver,
  type TinyHyperGraphTopology,
} from "../../lib/core"
import { PreparedPortPointRoutingSolver } from "../../lib/prepared/PreparedPortPointRoutingSolver"

test("a late search crosses the unavoidable priced port before spending its remaining budget in dead ends", (): void => {
  const startPort = 0
  const gate = 1
  const goalPort = 2
  const deadEnds = Array.from({ length: 24 }, (_, index) => index + 3)
  const portCount = deadEnds.length + 3
  const regionCount = deadEnds.length + 2
  const topology: TinyHyperGraphTopology = {
    portCount,
    regionCount,
    regionIncidentPorts: [
      [startPort, gate, ...deadEnds],
      [gate, goalPort],
      ...deadEnds.map((port) => [port]),
    ],
    incidentPortRegion: [
      [0],
      [0, 1],
      [1],
      ...deadEnds.map((_, index) => [0, index + 2]),
    ],
    regionWidth: new Float64Array(regionCount).fill(4),
    regionHeight: new Float64Array(regionCount).fill(4),
    regionCenterX: new Float64Array(regionCount),
    regionCenterY: new Float64Array(regionCount),
    portX: new Float64Array(portCount),
    portY: new Float64Array(portCount),
    portZ: new Int32Array(portCount),
    portAngleForRegion1: new Int32Array(portCount),
    portAngleForRegion2: new Int32Array(portCount),
  }
  const portPenalty = new Float64Array(portCount).fill(1)
  portPenalty[gate] = 100
  portPenalty[startPort] = 0
  portPenalty[goalPort] = 0
  for (const Solver of [TinyHyperGraphSolver, PreparedPortPointRoutingSolver]) {
    const solver = new Solver(
      topology,
      {
        routeCount: 1,
        routeStartPort: Int32Array.of(startPort),
        routeEndPort: Int32Array.of(goalPort),
        routeNet: Int32Array.of(0),
        regionNetId: new Int32Array(regionCount).fill(-1),
        portSectionMask: new Int8Array(portCount).fill(1),
        portPenalty,
      },
      {
        MAX_ITERATIONS: 12,
        RIP_THRESHOLD_RAMP_ATTEMPTS: 0,
        ACCEPT_BEST_SOLUTION_ON_TIMEOUT: false,
      },
    )
    solver.solve()
    expect(solver.solved).toBe(true)
    expect(solver.stats.portPenaltyHeuristicRefinementCount).toBe(1)
    expect(solver.state.regionSegments[0]).toEqual([[0, startPort, gate]])
    expect(solver.state.regionSegments[1]).toEqual([[0, gate, goalPort]])
  }
})
