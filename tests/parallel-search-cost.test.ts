import { expect, test } from "bun:test"
import { DistanceAwareTinyHyperGraphSolver } from "../lib/distance-aware-tiny-hypergraph-solver"
import { DistributedSearchPool } from "../lib/parallel/DistributedSearchPool"
import type { Candidate } from "../lib/core"
import { createDistributedSearchExecutor } from "./fixtures/createDistributedSearchExecutor"
import { createParallelGrid } from "./fixtures/createParallelGrid"

test("distributed A* retains the serial single-route cost on weighted cyclic graphs", async () => {
  const executor = createDistributedSearchExecutor(4)
  try {
    for (let seed = 1; seed <= 12; seed++) {
      const { topology, problem } = createParallelGrid(seed)
      problem.portPenalty = Float64Array.from(
        { length: topology.portCount },
        (_, port) => ((port * seed * 17) % 29) / 31,
      )
      const options = {
        MAX_ITERATIONS: 100000,
        STATIC_REACHABILITY_PRECHECK: false,
        OWNED_REGIONAL_HOP_FRONTIER: false,
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
      const pool = new DistributedSearchPool(frozen, executor)
      try {
        await pool.start()
        const result = await pool.search(0, 100000)
        expect(result.status).toBe("found")
        expect(result.candidate!.g).toBeCloseTo(expected!.g, 10)
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
