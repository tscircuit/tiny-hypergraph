import { expect, test } from "bun:test"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { loadSerializedHyperGraph } from "../../lib/compat/loadSerializedHyperGraph"
import { TinyHyperGraphSolver } from "../../lib/core"
import { SelectiveReripTinyHyperGraphSolver } from "../../lib/selective-rerip-tiny-hyper-graph-solver"

test("advisory layers keep hard reservations", (): void => {
  const points = [
    { x: -1, y: 0 },
    { x: 1, y: 0 },
    { x: 0, y: -1 },
    { x: 0, y: 1 },
  ]
  const graph: SerializedHyperGraph = {
    regions: [
      {
        regionId: "center",
        pointIds: ["p0", "p1", "p2", "p3"],
        d: {
          center: { x: 0, y: 0 },
          width: 2,
          height: 2,
          availableZ: [0],
        },
      },
      ...points.map((point, i) => ({
        regionId: `t${i}`,
        pointIds: [`p${i}`],
        d: {
          center: point,
          width: 0.001,
          height: 0.001,
          availableZ: [0],
        },
      })),
    ],
    ports: points.map((point, i) => ({
      portId: `p${i}`,
      region1Id: "center",
      region2Id: `t${i}`,
      d: { ...point, z: 0 },
    })),
    connections: [
      { connectionId: "horizontal", startRegionId: "t0", endRegionId: "t1" },
      { connectionId: "vertical", startRegionId: "t2", endRegionId: "t3" },
    ],
  }
  for (const Solver of [
    TinyHyperGraphSolver,
    SelectiveReripTinyHyperGraphSolver,
  ]) {
    for (const binding of [undefined, true, false]) {
      for (const reserveGoal of [false, true]) {
        const { topology, problem } = loadSerializedHyperGraph(graph)
        problem.regionLayerMasksAreBinding = binding
        if (reserveGoal) {
          problem.portReservedNetId = new Int32Array(topology.portCount).fill(-1)
          problem.portReservedNetId[problem.routeEndPort[1]!] = -2
        }
        const solver = new Solver(topology, problem, {
          MAX_ITERATIONS: 100,
          RIP_THRESHOLD_RAMP_ATTEMPTS: 0,
        })
        solver.solve()
        expect(solver.solved).toBe(binding === false && !reserveGoal)
        if (solver.solved) {
          expect(
            solver.state.regionIntersectionCaches[0]!.existingSameLayerIntersections,
          ).toBe(1)
          expect(
            solver.state.regionIntersectionCaches[0]!.existingRegionCost,
          ).toBeGreaterThan(10)
        }
      }
    }
  }
})
