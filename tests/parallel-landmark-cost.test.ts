import { expect, test } from "bun:test"
import { DistanceAwareTinyHyperGraphSolver } from "../lib/distance-aware-tiny-hypergraph-solver"
import { ParallelRouteSearchPool } from "../lib/parallel/ParallelRouteSearchPool"
import {
  createStaticLandmarks,
  landmarkHeuristic,
  prepareStaticLandmarks,
} from "../lib/parallel/StaticLandmarks"
import { createParallelGrid } from "./fixtures/createParallelGrid"
import { createRouteSearchExecutor } from "./fixtures/createRouteSearchExecutor"
import type { Candidate } from "../lib/core"

test("parallel static landmarks give consistent lower bounds and preserve optimal path cost", async () => {
  const executor = createRouteSearchExecutor(4)
  try {
    for (let seed = 1; seed <= 12; seed++) {
      const { topology, problem } = createParallelGrid(seed)
      problem.portPenalty = Float64Array.from(
        { length: topology.portCount },
        (_, i) => ((i * 17 + seed) % 7 === 0 ? 150 : i / 103),
      )
      const options = {
        STATIC_REACHABILITY_PRECHECK: false,
        TRACE_DENSITY_COST_FACTOR: 0.1,
        VERBOSE: false,
      }
      const reference = new DistanceAwareTinyHyperGraphSolver(
        topology,
        problem,
        options,
      )
      const parallel = new DistanceAwareTinyHyperGraphSolver(
        topology,
        problem,
        options,
      )
      reference.setup()
      parallel.setup()
      const landmarks = createStaticLandmarks(reference)
      const control = new Int32Array(new SharedArrayBuffer(10 * 4))
      for (let worker = 0; worker < 4; worker++)
        prepareStaticLandmarks(reference, landmarks, worker, 4, control)
      reference.state.currentRouteId = 0
      reference.state.currentRouteNetId = problem.routeNet[0]!
      reference.state.goalPortId = problem.routeEndPort[0]!
      for (let region = 0; region < topology.regionCount; region++) {
        const ports = topology.regionIncidentPorts[region]!
        for (const from of ports) {
          for (const to of ports) {
            const h = landmarkHeuristic(reference, landmarks, from)
            const edge = reference.computeG(
              { portId: from, nextRegionId: region, g: 0, h: 0, f: 0 },
              to,
            )
            expect(h).toBeLessThanOrEqual(
              edge + landmarkHeuristic(reference, landmarks, to) + 1e-8,
            )
          }
        }
      }
      reference.state.currentRouteId = undefined
      reference.state.currentRouteNetId = undefined
      let expected: Candidate | undefined
      const accept = reference.onPathFound.bind(reference)
      reference.onPathFound = (candidate) => {
        if (candidate.portId === reference.state.goalPortId)
          expected = candidate
        accept(candidate)
      }
      do {
        reference.step()
      } while (
        reference.state.currentRouteId !== undefined &&
        !reference.failed
      )
      expect(expected).toBeDefined()
      const pool = new ParallelRouteSearchPool(parallel, executor, {
        useStaticLandmarks: true,
      })
      try {
        await pool.start()
        const result = await pool.search(0, 100000)
        expect(result.status).toBe("found")
        expect(result.candidate!.g).toBeCloseTo(expected!.g, 10)
      } finally {
        await pool.dispose()
      }
    }
  } finally {
    executor.dispose()
  }
})
