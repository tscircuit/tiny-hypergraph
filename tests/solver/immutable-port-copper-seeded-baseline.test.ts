import { expect, test } from "bun:test"
import { loadSerializedHyperGraph } from "lib/compat/loadSerializedHyperGraph"
import { TinyHyperGraphSolver } from "lib/core"
import { createImmutablePortCopperGraph } from "tests/fixtures/immutable-port-copper"

test("immutable copper preserves provided baseline assignments but constrains new searches", (): void => {
  for (const blockedStart of [false, true]) {
    const graph = createImmutablePortCopperGraph(["net-b"], ["net-a"])
    if (blockedStart) graph.ports[0]!.d.immutableCopperNetIds = ["net-a"]
    graph.regions.find(
      (region): boolean => region.regionId === "left",
    )!.assignments = [
      {
        connectionId: "route-0",
        regionPort1Id: "start-0",
        regionPort2Id: "occupied",
      },
    ]
    graph.regions.find(
      (region): boolean => region.regionId === "right",
    )!.assignments = [
      {
        connectionId: "route-0",
        regionPort1Id: "occupied",
        regionPort2Id: "end-0",
      },
    ]
    const { topology, problem } = loadSerializedHyperGraph(graph)
    const solver = new TinyHyperGraphSolver(topology, problem, {
      GREEDY_FINAL_ROUTE_ITERS: 0,
      RIP_THRESHOLD_RAMP_ATTEMPTS: 0,
    })
    solver.solve()
    expect(solver.failed).toBeFalse()
    expect(solver.solved).toBeTrue()
    expect(solver.stats.initiallyRoutedRouteCount).toBe(1)
    expect(
      solver
        .getOutput()
        .solvedRoutes?.[0]?.path.map(
          ({ portId }: { portId: string }): string => portId,
        ),
    ).toEqual(["start-0", "occupied", "end-0"])

    solver.resetForProblem({ ...problem, initialAssignments: undefined })
    solver.solve()
    if (blockedStart) {
      expect(solver.failed).toBeTrue()
      expect(solver.error).toContain(
        "endpoint port 0 is blocked by immutable copper",
      )
    } else {
      expect(solver.failed).toBeFalse()
      expect(
        solver
          .getOutput()
          .solvedRoutes?.[0]?.path.map(
            ({ portId }: { portId: string }): string => portId,
          ),
      ).toEqual(["start-0", "alternate", "end-0"])
    }
  }
})
