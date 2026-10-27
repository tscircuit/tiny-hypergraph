import { expect, test } from "bun:test"
import { solveWithParallelCosts } from "../lib/core-parallel"
import { SelectiveReripTinyHyperGraphSolver } from "../lib/selective-rerip-tiny-hyper-graph-solver"
import type { TinyHyperGraphProblem, TinyHyperGraphTopology } from "../lib/core"
import { createRegionCostExecutor } from "./fixtures/createRegionCostExecutor"

test("parallel region costs preserve exact TypeScript routes and budgets across overlapping nets", async () => {
  const executor = createRegionCostExecutor(4)
  try {
    let hits = 0
    for (let seed = 1; seed <= 12; seed++) {
      const side = 5,
        regionCount = side * side
      const regionIncidentPorts: number[][] = Array.from(
        { length: regionCount },
        () => [],
      )
      const incidentPortRegion: number[][] = [],
        xs: number[] = [],
        ys: number[] = []
      const add = (x: number, y: number, regions: number[]): number => {
        const port = xs.length
        xs.push(x)
        ys.push(y)
        incidentPortRegion.push(regions)
        for (const region of regions) regionIncidentPorts[region]!.push(port)
        return port
      }
      for (let y = 0; y < side; y++)
        for (let x = 0; x < side; x++) {
          const region = y * side + x
          if (x + 1 < side)
            for (let slot = 0; slot < 3; slot++)
              add(x + 0.5, y + (slot - 1) / 4, [region, region + 1])
          if (y + 1 < side)
            for (let slot = 0; slot < 3; slot++)
              add(x + (slot - 1) / 4, y + 0.5, [region, region + side])
        }
      const pairs = [
        [0, 24],
        [4, 20],
        [0, 4],
        [20, 24],
        [5, 19],
        [9, 15],
        [1, 23],
        [3, 21],
      ]
      const starts: number[] = [],
        ends: number[] = []
      for (const [index, [a, b]] of pairs.entries()) {
        starts.push(add((a! % side) + index / 100, Math.floor(a! / side), [a!]))
        ends.push(add((b! % side) - index / 100, Math.floor(b! / side), [b!]))
      }
      const portCount = xs.length
      const topology: TinyHyperGraphTopology = {
        portCount,
        regionCount,
        incidentPortRegion,
        regionIncidentPorts,
        portX: Float64Array.from(xs),
        portY: Float64Array.from(ys),
        portZ: Int32Array.from(xs, (_, index) => (index + seed) % 2),
        portAngleForRegion1: new Int32Array(portCount),
        portAngleForRegion2: new Int32Array(portCount),
        regionAvailableZMask: new Int32Array(regionCount).fill(3),
        regionWidth: new Float64Array(regionCount).fill(1),
        regionHeight: new Float64Array(regionCount).fill(1),
        regionCenterX: Float64Array.from(
          { length: regionCount },
          (_, i) => i % side,
        ),
        regionCenterY: Float64Array.from({ length: regionCount }, (_, i) =>
          Math.floor(i / side),
        ),
      }
      for (let port = 0; port < portCount; port++)
        for (let slot = 0; slot < incidentPortRegion[port]!.length; slot++) {
          const region = incidentPortRegion[port]![slot]!
          const angle = Math.round(
            ((Math.atan2(
              ys[port]! - Math.floor(region / side),
              xs[port]! - (region % side),
            ) *
              18000) /
              Math.PI +
              36000) %
              36000,
          )
          ;(slot
            ? topology.portAngleForRegion2!
            : topology.portAngleForRegion1)[port] = angle
        }
      const problem: TinyHyperGraphProblem = {
        routeCount: pairs.length,
        routeStartPort: Int32Array.from(starts),
        routeEndPort: Int32Array.from(ends),
        routeNet: Int32Array.from(starts, (_, i) => i),
        regionNetId: new Int32Array(regionCount).fill(-1),
        portSectionMask: new Int8Array(portCount).fill(1),
      }
      const options = {
        STATIC_REACHABILITY_PRECHECK: false,
        PARTIAL_RIP_ENABLED: false,
        OUTSIDE_IN_ROUTING: false,
        MAX_ITERATIONS: 100000,
        VERBOSE: false,
      }
      const serial = new SelectiveReripTinyHyperGraphSolver(
        topology,
        problem,
        options,
      )
      const parallel = new SelectiveReripTinyHyperGraphSolver(
        topology,
        problem,
        options,
      )
      serial.solve()
      await solveWithParallelCosts(parallel, executor)
      expect(parallel.solved).toBe(serial.solved)
      expect(parallel.failed).toBe(serial.failed)
      expect(parallel.iterations).toBe(serial.iterations)
      expect(parallel.state.regionSegments).toEqual(serial.state.regionSegments)
      expect(parallel.state.portAssignment).toEqual(serial.state.portAssignment)
      expect(parallel.stats.parallelRouteWorkers).toBe(4)
      expect(parallel.stats.maximumParticipatingCostWorkers).toBe(4)
      hits += Number(parallel.stats.parallelCostCacheHits)
    }
    expect(hits).toBeGreaterThan(0)
  } finally {
    executor.dispose()
  }
})
