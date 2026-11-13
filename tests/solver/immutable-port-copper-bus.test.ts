import { expect, test } from "bun:test"
import { TinyHyperGraphBusSolver } from "lib/bus-solver/TinyHyperGraphBusSolver"
import { loadSerializedHyperGraph } from "lib/compat/loadSerializedHyperGraph"
import { createImmutablePortCopperGraph } from "tests/fixtures/immutable-port-copper"

test("bus centerline respects immutable copper without blocking its own net", (): void => {
  for (const [netId, expectedMiddle] of [
    ["net-a", "occupied"],
    ["net-b", "alternate"],
  ]) {
    const { topology, problem } = loadSerializedHyperGraph(
      createImmutablePortCopperGraph([netId!], ["net-a"]),
    )
    const solver = new TinyHyperGraphBusSolver(topology, problem)
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
  }

  const graph = createImmutablePortCopperGraph(["net-b"], ["net-a"])
  graph.ports[0]!.d.immutableCopperNetIds = ["net-a"]
  const { topology, problem } = loadSerializedHyperGraph(graph)
  const blocked = new TinyHyperGraphBusSolver(topology, problem)
  blocked.solve()
  expect(blocked.failed).toBeTrue()
  expect(blocked.error).toContain(
    "endpoint port 0 is blocked by immutable copper",
  )
  expect(
    blocked.state.regionSegments.every(
      (segments: Array<[number, number, number]>): boolean =>
        segments.length === 0,
    ),
  ).toBeTrue()
})
