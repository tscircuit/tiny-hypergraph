import { expect, test } from "bun:test"
import {
  type TinyHyperGraphProblem,
  TinyHyperGraphSolver,
  type TinyHyperGraphTopology,
} from "lib/index"

test("greedy final routing preserves single-layer crossing constraints", () => {
  for (const z of [0, 1, 2, 3]) {
    const topology: TinyHyperGraphTopology = {
      portCount: 4,
      regionCount: 5,
      regionIncidentPorts: [[0, 1, 2, 3], [0], [1], [2], [3]],
      incidentPortRegion: [
        [0, 1],
        [0, 2],
        [0, 3],
        [0, 4],
      ],
      regionWidth: new Float64Array(5).fill(3),
      regionHeight: new Float64Array(5).fill(3),
      regionCenterX: new Float64Array(5),
      regionCenterY: new Float64Array(5),
      regionAvailableZMask: new Int32Array(5).fill(1 << z),
      portAngleForRegion1: new Int32Array([0, 9000, 18000, 27000]),
      portAngleForRegion2: new Int32Array(4),
      portX: new Float64Array([1, 0, -1, 0]),
      portY: new Float64Array([0, 1, 0, -1]),
      portZ: new Int32Array(4).fill(z),
    }
    const problem: TinyHyperGraphProblem = {
      routeCount: 2,
      portSectionMask: new Int8Array(4).fill(1),
      routeStartPort: new Int32Array([0, 1]),
      routeEndPort: new Int32Array([2, 3]),
      routeNet: new Int32Array([0, 1]),
      regionNetId: new Int32Array(5).fill(-1),
      initialAssignments: [
        { routeId: 0, regionId: 0, fromPortId: 0, toPortId: 2 },
      ],
    }
    const solver = new TinyHyperGraphSolver(topology, problem)
    solver.tryFinalAcceptance()

    expect(solver.solved).toBe(false)
    expect(solver.stats.acceptedGreedyFinalRouteOnTimeout).toBeUndefined()
    expect(solver.state.regionSegments[0]).toEqual([[0, 0, 2]])
    expect(
      solver.state.regionIntersectionCaches[0].existingSameLayerIntersections,
    ).toBe(0)

    topology.regionAvailableZMask!.fill((1 << z) | (1 << ((z + 1) % 4)))
    const multilayerSolver = new TinyHyperGraphSolver(topology, problem)
    multilayerSolver.tryFinalAcceptance()
    expect(multilayerSolver.solved).toBe(true)
    expect(multilayerSolver.state.regionSegments[0]).toHaveLength(2)
  }
})
