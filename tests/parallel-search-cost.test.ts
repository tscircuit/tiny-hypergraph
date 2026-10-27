import { expect, test } from "bun:test"
import { DistanceAwareTinyHyperGraphSolver } from "../lib/distance-aware-tiny-hypergraph-solver"
import { ParallelRouteSearchPool } from "../lib/parallel/ParallelRouteSearchPool"
import type { Candidate } from "../lib/core"
import { createRouteSearchExecutor } from "./fixtures/createRouteSearchExecutor"
import { createParallelGrid } from "./fixtures/createParallelGrid"

test("packed worker A* preserves serial paths, costs and iteration counts", async () => {
  const executor = createRouteSearchExecutor(4)
  try {
    for (let seed = 1; seed <= 12; seed++) {
      const { topology, problem } = createParallelGrid(seed)
      if (seed % 3 === 0) topology.portZ.fill(0)
      problem.portPenalty = Float64Array.from(
        { length: topology.portCount },
        (_, port) => (seed % 2 ? ((port * seed * 17) % 29) / 31 : 0),
      )
      const options = {
        MAX_ITERATIONS: 100000,
        STATIC_REACHABILITY_PRECHECK: false,
        OWNED_REGIONAL_HOP_FRONTIER: seed % 2 === 0,
        VERBOSE: false,
      }
      const serial = new DistanceAwareTinyHyperGraphSolver(
        topology,
        problem,
        options,
      )
      let expected: Candidate | undefined
      const onPathFound = serial.onPathFound.bind(serial)
      serial.onPathFound = (candidate) => {
        if (candidate.portId === serial.state.goalPortId) expected = candidate
        onPathFound(candidate)
      }
      do {
        serial.step()
      } while (serial.state.currentRouteId !== undefined && !serial.failed)
      expect(expected).toBeDefined()
      const frozen = new DistanceAwareTinyHyperGraphSolver(
        topology,
        problem,
        options,
      )
      frozen.setup()
      const pool = new ParallelRouteSearchPool(frozen, executor)
      try {
        await pool.start()
        const result = await pool.search(0, 100000)
        expect(result.status).toBe("found")
        expect(result.candidate!.g).toBeCloseTo(expected!.g, 10)
        expect(result.iterations).toBe(serial.iterations)
        const summarize = (leaf: Candidate | undefined): unknown[] => {
          const nodes = []
          for (let node = leaf; node; node = node.prevCandidate)
            nodes.push([
              node.portId,
              node.nextRegionId,
              node.hopId,
              node.g,
              node.h,
              node.f,
            ])
          return nodes
        }
        expect(summarize(result.candidate)).toEqual(summarize(expected))
        frozen.state.currentRouteId = 0
        frozen.state.currentRouteNetId = problem.routeNet[0]
        const path: Candidate[] = []
        for (let item = result.candidate; item; item = item.prevCandidate)
          path.unshift(item)
        expect(path[0]!.portId).toBe(problem.routeStartPort[0])
        let g = 0
        for (let i = 1; i < path.length; i++) {
          const previous = { ...path[i - 1]!, g }
          expect(topology.regionIncidentPorts[previous.nextRegionId]).toContain(
            path[i]!.portId,
          )
          g = frozen.computeG(previous, path[i]!.portId)
        }
        expect(g).toBeCloseTo(expected!.g, 10)
        expect(result.iterations).toBeLessThanOrEqual(100000)
      } finally {
        await pool.dispose()
      }
    }
  } finally {
    executor.dispose()
  }
})
