import { expect, test } from "bun:test"
import { loadSerializedHyperGraph } from "lib/compat/loadSerializedHyperGraph"
import { TinyHyperGraphSolver, type TinyHyperGraphProblem } from "lib/core"
import { createImmutablePortCopperGraph } from "tests/fixtures/immutable-port-copper"

test("immutable port copper admits its own net and forces foreign routes onto legal contacts", (): void => {
  for (const [netId, expectedMiddle] of [
    ["net-a", "occupied"],
    ["net-b", "alternate"],
  ]) {
    const { topology, problem } = loadSerializedHyperGraph(
      createImmutablePortCopperGraph([netId!], ["net-a"]),
    )
    const solver = new TinyHyperGraphSolver(topology, problem, {
      RIP_THRESHOLD_RAMP_ATTEMPTS: 0,
      STATIC_REACHABILITY_PRECHECK: false,
    })
    solver.solve()
    expect(solver.failed).toBeFalse()
    expect(solver.solved).toBeTrue()
    expect(
      solver
        .getOutput()
        .solvedRoutes?.[0]?.path.map(
          ({ portId }: { portId: string }): string => portId,
        ),
    ).toEqual(["start-0", expectedMiddle, "end-0"])
    const replay = loadSerializedHyperGraph(solver.getOutput())
    expect(replay.topology.portReservedNetId).toEqual(
      topology.portReservedNetId,
    )
  }

  const { topology, problem } = loadSerializedHyperGraph(
    createImmutablePortCopperGraph(["net-a", "net-b"], ["net-a"]),
  )
  const ownProblem: TinyHyperGraphProblem = {
    ...problem,
    routeCount: 1,
    routeMetadata: [problem.routeMetadata![0]],
    routeStartPort: new Int32Array([problem.routeStartPort[0]!]),
    routeEndPort: new Int32Array([problem.routeEndPort[0]!]),
    routeNet: new Int32Array([problem.routeNet[0]!]),
  }
  const solver = new TinyHyperGraphSolver(topology, ownProblem, {
    RIP_THRESHOLD_RAMP_ATTEMPTS: 0,
    STATIC_REACHABILITY_PRECHECK: false,
  })
  solver.solve()
  expect(solver.getOutput().solvedRoutes?.[0]?.path[1]?.portId).toBe("occupied")
  solver.resetForProblem({
    ...ownProblem,
    routeMetadata: [problem.routeMetadata![1]],
    routeStartPort: new Int32Array([problem.routeStartPort[1]!]),
    routeEndPort: new Int32Array([problem.routeEndPort[1]!]),
    routeNet: new Int32Array([problem.routeNet[1]!]),
  })
  solver.solve()
  expect(solver.failed).toBeFalse()
  expect(solver.getOutput().solvedRoutes?.[0]?.path[1]?.portId).toBe(
    "alternate",
  )
  expect(
    solver.problemSetup.portEndpointNetIds[topology.portCount - 2],
  ).toBeUndefined()

  for (const staticPrecheck of [false, true]) {
    const blockedGraph = createImmutablePortCopperGraph(["net-b"], ["net-a"])
    blockedGraph.ports[0]!.d.immutableCopperNetIds = ["net-a"]
    const blocked = loadSerializedHyperGraph(blockedGraph)
    const blockedSolver = new TinyHyperGraphSolver(
      blocked.topology,
      blocked.problem,
      { STATIC_REACHABILITY_PRECHECK: staticPrecheck },
    )
    blockedSolver.solve()
    expect(blockedSolver.failed).toBeTrue()
    expect(blockedSolver.error).toContain(
      "endpoint port 0 is blocked by immutable copper",
    )
    expect(
      blockedSolver.state.regionSegments.every(
        (segments: Array<[number, number, number]>): boolean =>
          segments.length === 0,
      ),
    ).toBeTrue()
  }

  const disconnectedGraph = createImmutablePortCopperGraph(["net-b"], ["net-a"])
  disconnectedGraph.ports.pop()
  for (const region of disconnectedGraph.regions) {
    region.pointIds = region.pointIds.filter(
      (portId: string): boolean => portId !== "alternate",
    )
  }
  const disconnected = loadSerializedHyperGraph(disconnectedGraph)
  const disconnectedSolver = new TinyHyperGraphSolver(
    disconnected.topology,
    disconnected.problem,
  )
  disconnectedSolver.solve()
  expect(disconnectedSolver.failed).toBeTrue()
  expect(disconnectedSolver.stats.staticallyUnroutableRouteCount).toBe(1)
})
