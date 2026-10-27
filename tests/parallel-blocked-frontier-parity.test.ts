import { expect, test } from "bun:test"
import type { Candidate } from "../lib/core"
import { DistanceAwareTinyHyperGraphSolver } from "../lib/distance-aware-tiny-hypergraph-solver"
import { ParallelRouteSearchPool } from "../lib/parallel/ParallelRouteSearchPool"
import { createParallelGrid } from "./fixtures/createParallelGrid"
import { createRouteSearchExecutor } from "./fixtures/createRouteSearchExecutor"

test("compacted frontiers preserve exact paths and iterations with blocked ports and early goals", async () => {
  const executor = createRouteSearchExecutor(4)
  try {
    for (let seed = 1; seed <= 12; seed++) {
      const { topology, problem } = createParallelGrid(seed)
      problem.routeCount = 1
      problem.routeStartPort = problem.routeStartPort.slice(0, 1)
      problem.routeEndPort = problem.routeEndPort.slice(0, 1)
      problem.routeNet = problem.routeNet.slice(0, 1)
      problem.portPenalty = Float64Array.from(
        { length: topology.portCount },
        (_, port) => ((port * 17 + seed) % 7 === 0 ? 150 : port / 103),
      )
      const goal = problem.routeEndPort[0]!
      const region = topology.incidentPortRegion[goal]![0]!
      const ports = topology.regionIncidentPorts[region]!
      ports.splice(ports.indexOf(goal), 1)
      ports.splice(seed % ports.length, 0, goal)
      const options = { STATIC_REACHABILITY_PRECHECK: false, VERBOSE: false }
      const serial = new DistanceAwareTinyHyperGraphSolver(
        topology,
        problem,
        options,
      )
      const frozen = new DistanceAwareTinyHyperGraphSolver(
        topology,
        problem,
        options,
      )
      serial.setup()
      frozen.setup()
      for (let port = 0; port < topology.portCount; port++) {
        if (
          (port + seed) % 7 === 0 &&
          port !== goal &&
          port !== problem.routeStartPort[0]
        ) {
          serial.state.portAssignment[port] = 99
          frozen.state.portAssignment[port] = 99
        }
      }
      let expected: Candidate | undefined
      const accept = serial.onPathFound.bind(serial)
      serial.onPathFound = (candidate): void => {
        if (candidate.portId === goal) expected = candidate
        accept(candidate)
      }
      do {
        serial.step()
      } while (serial.state.currentRouteId !== undefined && !serial.failed)
      expect(expected).toBeDefined()
      const pool = new ParallelRouteSearchPool(frozen, executor)
      try {
        await pool.start()
        const result = await pool.search(0, 100000)
        expect(result.status).toBe("found")
        expect(result.iterations).toBe(serial.iterations)
        const path = (candidate: Candidate | undefined): number[][] => {
          const nodes: number[][] = []
          for (let node = candidate; node; node = node.prevCandidate)
            nodes.push([node.portId, node.nextRegionId, node.g, node.h, node.f])
          return nodes
        }
        expect(path(result.candidate)).toEqual(path(expected))
      } finally {
        await pool.dispose()
      }
    }
  } finally {
    executor.dispose()
  }
})
