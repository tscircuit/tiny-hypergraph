import { expect, test } from "bun:test"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { TinyHyperGraphBusSolver } from "../../lib/bus-solver/TinyHyperGraphBusSolver"
import { loadSerializedHyperGraph } from "../../lib/compat/loadSerializedHyperGraph"
import { TinyHyperGraphSolver } from "../../lib/core"

class SnapshotSolver extends TinyHyperGraphSolver {
  copyCommittedStateTo(target: TinyHyperGraphSolver): void {
    this.applySnapshotToGreedyFinalRouteSolver(
      target,
      {
        portAssignment: this.state.portAssignment,
        regionSegments: this.state.regionSegments,
        regionIntersectionCaches: this.state.regionIntersectionCaches,
        regionCongestionCost: this.state.regionCongestionCost,
        ripCount: this.state.ripCount,
      },
      [],
    )
  }
}

test("shared MST copper consumes one resource without bypassing hard checks", (): void => {
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
        pointIds: points.map((_, i) => `p${i}`),
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
      {
        connectionId: "first",
        startRegionId: "t0",
        endRegionId: "t1",
        mutuallyConnectedNetworkId: "signal",
      },
      {
        connectionId: "alias",
        startRegionId: "t0",
        endRegionId: "t1",
        mutuallyConnectedNetworkId: "signal",
      },
      { connectionId: "foreign", startRegionId: "t2", endRegionId: "t3" },
    ],
  }
  for (const share of [false, true]) {
    const { topology, problem } = loadSerializedHyperGraph(graph)
    problem.regionLayerMasksAreBinding = false
    problem.shareSameNetCopper = share
    const solver = new SnapshotSolver(topology, problem, {
      MAX_ITERATIONS: 100,
      RIP_THRESHOLD_RAMP_ATTEMPTS: 0,
    })
    solver.solve()
    expect(solver.solved).toBe(true)
    expect(solver.state.regionSegments[0]).toHaveLength(3)
    const cache = solver.state.regionIntersectionCaches[0]!
    expect(cache.existingSegmentCount).toBe(share ? 2 : 3)
    expect(cache.existingSameLayerIntersections).toBe(share ? 1 : 2)

    const child = new SnapshotSolver(topology, problem)
    solver.copyCommittedStateTo(child)
    expect(child.state.regionIntersectionCaches[0]).toEqual(cache)
    if (share) {
      expect(
        child.state.regionIntersectionCaches[0]!.sharedCopperSegmentKeys,
      ).not.toBe(cache.sharedCopperSegmentKeys)
    }

    const [, from, to] = solver.state.regionSegments[0]!.find(
      ([route]) => problem.routeNet[route] === problem.routeNet[0],
    )!
    if (share) {
      child.state.currentRouteNetId = problem.routeNet[0]!
      child.appendSegmentToRegionCache(0, to, from)
      expect(
        child.state.regionIntersectionCaches[0]!.existingSegmentCount,
      ).toBe(2)
      expect(() => new TinyHyperGraphBusSolver(topology, problem)).toThrow(
        "shareSameNetCopper is unsupported",
      )
    }
    solver.state.currentRouteNetId = problem.routeNet[0]!
    solver.state.regionCongestionCost[0] = 7
    problem.portPenalty = new Float64Array(topology.portCount).fill(13)
    const candidate = { portId: from, nextRegionId: 0, g: 5, h: 0, f: 5 }
    const cost = solver.computeG(candidate, to, Infinity, 0)
    if (share) {
      expect(cost).toBe(5)
      expect(solver.computeG(candidate, to, 5, 0)).toBe(5)
      expect(solver.computeG(candidate, to, 4, 0)).toBe(Infinity)
    } else expect(cost).toBeGreaterThan(25)

    problem.portReservedNetId = new Int32Array(topology.portCount).fill(-1)
    problem.portReservedNetId[to] = -2
    expect(solver.computeG(candidate, to)).toBe(Infinity)
    problem.portReservedNetId[to] = -1
    problem.regionLayerMasksAreBinding = true
    expect(solver.computeG(candidate, to)).toBe(Infinity)
  }
})
