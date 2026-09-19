import { expect, test } from "bun:test"
import { sample032, sample057, sample098 } from "dataset-hg07"
import { TinyHyperGraphSectionPipelineSolver } from "../lib/section-solver/TinyHyperGraphSectionPipelineSolver"
import { FullConnectionRerouteSolver } from "../lib/full-connection-reroute-solver"

test("screening in replay order retains improvements at coincident port angles", () => {
  for (const [graph, expectedMax] of [
    [sample032, 0.2776044641680216],
    [sample057, 0.08520635365896423],
    [sample098, 0.23828118160009798],
  ] as const) {
    const pipeline = new TinyHyperGraphSectionPipelineSolver({
      serializedHyperGraph: graph,
    })
    pipeline.solve()
    expect(pipeline.failed).toBe(false)
    const reroute = pipeline.getSolver<FullConnectionRerouteSolver>(
      "rerouteFullConnections",
    )!
    expect(Number(reroute.stats.finalMaxRegionCost)).toBeLessThanOrEqual(
      expectedMax + 1e-9,
    )
    expect(Number(reroute.stats.rerouteReplayCount)).toBeLessThan(
      Number(reroute.stats.rerouteAttempts),
    )
    expect(pipeline.getOutput()!.solvedRoutes).toHaveLength(
      graph.connections!.length,
    )
  }
})
