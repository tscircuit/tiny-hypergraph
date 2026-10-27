import { expect, test } from "bun:test"
import { DistanceAwareTinyHyperGraphSolver } from "../lib/distance-aware-tiny-hypergraph-solver"
import { SharedScoreSearchSolver } from "../lib/parallel/SharedScoreSearchSolver"
import { createSharedTransitionScores } from "../lib/parallel/SharedTransitionScores"
import { createParallelGrid } from "./fixtures/createParallelGrid"

test("shared worker score caches preserve exact arithmetic across snapshots, nets and congestion", () => {
  const { topology, problem } = createParallelGrid(3)
  for (let region = 0; region < topology.regionCount; region++) {
    topology.regionAvailableZMask![region] = region % 3 === 0 ? 1 : 3
    topology.regionWidth[region] = region === 0 ? 1e-6 : (region + 1) / 3
    topology.regionHeight[region] = region === 1 ? 1e6 : (region + 2) / 7
  }
  problem.portPenalty = Float64Array.from(
    { length: topology.portCount },
    (_, i) => i / 31,
  )
  const options = {
    TRACE_DENSITY_COST_FACTOR: 0.17,
    DISTANCE_TO_COST: 0.05,
    VERBOSE: false,
  }
  const cached = new SharedScoreSearchSolver(topology, problem, options)
  const reference = new DistanceAwareTinyHyperGraphSolver(
    topology,
    problem,
    options,
  )
  cached.setup()
  reference.setup()
  cached.transitionScores = createSharedTransitionScores(cached)
  cached.regionVersions = new Int32Array(topology.regionCount).fill(2)
  for (let round = 0; round < 3; round++) {
    for (let region = 0; region < topology.regionCount; region++) {
      const ports = topology.regionIncidentPorts[region]!
      if (ports.length < 2) continue
      cached.state.currentRouteNetId = round
      cached.regionVersions[region]! += 2
      cached.appendSegmentToRegionCache(
        region,
        ports[0]!,
        ports[ports.length - 1]!,
      )
      cached.state.regionCongestionCost[region] = round / 17
      reference.state.regionIntersectionCaches[region] =
        cached.state.regionIntersectionCaches[region]!
      reference.state.regionCongestionCost[region] =
        cached.state.regionCongestionCost[region]!
      for (const net of [0, 1, 19, 0, 19]) {
        cached.state.currentRouteNetId = reference.state.currentRouteNetId = net
        for (const from of ports) {
          for (const to of ports) {
            for (const g of [0, 1e-12, 10, 1e9]) {
              const candidate = {
                portId: from,
                nextRegionId: region,
                g,
                h: 0,
                f: g,
              }
              for (const maximum of [Infinity, g + 0.0001])
                expect(cached.computeG(candidate, to, maximum)).toBe(
                  reference.computeG(candidate, to, maximum),
                )
            }
          }
        }
      }
    }
  }
})
