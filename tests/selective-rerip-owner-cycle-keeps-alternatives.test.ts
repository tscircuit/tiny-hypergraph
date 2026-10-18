import { expect, test } from "bun:test"
import { loadSerializedHyperGraph } from "../lib/compat/loadSerializedHyperGraph"
import { SelectiveReripTinyHyperGraphSolver } from "../lib/selective-rerip-tiny-hyper-graph-solver"

type KnownBlockerPath = {
  found: true
  states: never[]
  hops: never[]
  owners: Set<number>
  distance: number
  expandedLabelCount: number
}

class AvoidableOwnerCycleSolver extends SelectiveReripTinyHyperGraphSolver {
  readonly forbiddenSearches: number[][] = []

  protected override findRelaxedBlockerPath(
    forbidden: ReadonlySet<number> = new Set(),
  ): KnownBlockerPath {
    this.forbiddenSearches.push([...forbidden])
    const owner =
      this.state.currentRouteId === 0
        ? 1
        : forbidden.has(2)
          ? 3
          : forbidden.has(0)
            ? 2
            : 0
    return {
      found: true,
      states: [],
      hops: [],
      owners: new Set([owner]),
      distance: 1,
      expandedLabelCount: 1,
    }
  }
}

test("rerips remember chosen alternate owners", (): void => {
  const { topology, problem } = loadSerializedHyperGraph({
    regions: [0, 1, 2, 3].map((r) => ({
      regionId: `r${r}`,
      pointIds: [`p${r}a`, `p${r}b`],
      d: { center: { x: r * 2, y: 0 }, width: 1, height: 1 },
    })),
    ports: [0, 1, 2, 3].flatMap((r) =>
      ["a", "b"].map((end, i) => ({
        portId: `p${r}${end}`,
        region1Id: `r${r}`,
        region2Id: `r${r}`,
        d: { x: r * 2 + i - 0.5, y: 0, z: 0 },
      })),
    ),
    connections: [0, 1, 2, 3].map((r) => ({
      connectionId: `net${r}`,
      startRegionId: `r${r}`,
      endRegionId: `r${r}`,
    })),
  })
  const solver = new AvoidableOwnerCycleSolver(topology, problem, {
    STATIC_REACHABILITY_PRECHECK: false,
  })
  solver.state.currentRouteId = 0
  solver.state.currentRouteNetId = 0
  solver.onOutOfCandidates()
  solver.state.currentRouteId = 1
  solver.state.currentRouteNetId = 1
  solver.onOutOfCandidates()
  solver.state.currentRouteId = 1
  solver.state.currentRouteNetId = 1
  solver.onOutOfCandidates()

  expect(solver.forbiddenSearches).toEqual([[], [], [0], [], [0, 2]])
  expect(solver.getSelectiveReripStats()).toMatchObject({
    globalReripCount: 0,
    alternateBlockerSearchCount: 2,
    lastDirectOwnerRouteIds: [0],
    lastAlternateOwnerRouteIds: [3],
    lastRippedRouteIds: [3],
  })
})
