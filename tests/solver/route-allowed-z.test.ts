import { expect, test } from "bun:test"
import {
  loadSerializedHyperGraph,
  OutsideInPartialRipTinyHyperGraphSolver,
  SelectiveReripTinyHyperGraphSolver,
  TinyHyperGraphSectionSolver,
  TinyHyperGraphSolver,
  type TinySerializedHyperGraph,
} from "../../lib"
import { PreparedPortPointRoutingSolver } from "../../lib/prepared/PreparedPortPointRoutingSolver"

test("route layer policies survive serialization, prepared routing, and section rerips without restricting other nets", () => {
  const regions: TinySerializedHyperGraph["regions"] = []
  const ports: TinySerializedHyperGraph["ports"] = []
  for (const [prefix, y] of [
    ["restricted", 0],
    ["free", 3],
  ] as const) {
    const ids = [
      `${prefix}-start`,
      `${prefix}-left`,
      `${prefix}-right`,
      `${prefix}-end`,
    ]
    for (let index = 0; index < ids.length; index++) {
      regions.push({
        regionId: ids[index],
        pointIds: [],
        d: {
          bounds: { minX: index - 1, maxX: index, minY: y - 1, maxY: y + 1 },
          availableZ: [0, 1, 2],
        },
      })
    }
    const points = [
      { name: "start", from: 0, to: 1, x: 0, y, z: 0 },
      { name: "short", from: 1, to: 2, x: 1, y, z: 1 },
      ...(prefix === "restricted"
        ? [{ name: "legal", from: 1, to: 2, x: 1, y: y + 0.25, z: 2 }]
        : []),
      { name: "end", from: 2, to: 3, x: 2, y, z: 0 },
    ]
    for (const { name, from, to, x, y, z } of points) {
      const portId = `${prefix}-${name}-port`
      ports.push({
        portId,
        region1Id: ids[from],
        region2Id: ids[to],
        d: { x, y, z },
      })
      for (const index of [from, to])
        regions
          .find((region) => region.regionId === ids[index])!
          .pointIds.push(portId)
    }
  }
  const graph: TinySerializedHyperGraph = {
    regions,
    ports,
    connections: ["restricted", "free"].map((name) => ({
      connectionId: name,
      mutuallyConnectedNetworkId: name,
      startRegionId: `${name}-start`,
      endRegionId: `${name}-end`,
      ...(name === "restricted" && { allowedZ: [0, 2] }),
    })),
  }
  const options = { STATIC_REACHABILITY_PRECHECK: true, MAX_ITERATIONS: 1000 }
  const usedZ = (solver: TinyHyperGraphSolver, routeId: number) =>
    [
      ...new Set(
        solver.state.regionSegments.flatMap((segments) =>
          segments
            .filter((segment) => segment[0] === routeId)
            .flatMap(([, from, to]) => [
              solver.topology.portZ[from],
              solver.topology.portZ[to],
            ]),
        ),
      ),
    ].sort()
  const { topology, problem } = loadSerializedHyperGraph(graph)
  const control = new TinyHyperGraphSolver(
    topology,
    { ...problem, routeAllowedZ: undefined },
    options,
  )
  control.solve()
  expect(control.solved).toBe(true)
  expect(usedZ(control, 0)).toContain(1)
  let expected: TinyHyperGraphSolver["state"]["regionSegments"] | undefined
  for (const [Solver, owned, sparse] of [
    [TinyHyperGraphSolver, false, false],
    [TinyHyperGraphSolver, true, false],
    [TinyHyperGraphSolver, false, true],
    [SelectiveReripTinyHyperGraphSolver, true, false],
    [PreparedPortPointRoutingSolver, true, false],
    [OutsideInPartialRipTinyHyperGraphSolver, true, false],
  ] as const) {
    const solver = new Solver(topology, problem, {
      ...options,
      OWNED_REGIONAL_HOP_FRONTIER: owned,
      USE_SPARSE_CANDIDATE_STORAGE: sparse,
    })
    solver.solve()
    expect(solver.failed).toBe(false)
    expect(solver.solved).toBe(true)
    expect(usedZ(solver, 0)).toEqual([0, 2])
    expect(usedZ(solver, 1)).toEqual([0, 1])
    expected ??= solver.state.regionSegments
    expect(solver.state.regionSegments).toEqual(expected)
    const output = solver.getOutput()
    expect(
      output.connections?.map((connection) => connection.allowedZ),
    ).toEqual([[0, 2], undefined])
    const replay = loadSerializedHyperGraph(output)
    expect(replay.problem.routeAllowedZ).toEqual([[0, 2], undefined])
    const section = new TinyHyperGraphSectionSolver(
      replay.topology,
      replay.problem,
      replay.solution,
      options,
    )
    section.solve()
    expect(section.failed).toBe(false)
    expect(section.solved).toBe(true)
  }
  expect(
    () =>
      new TinyHyperGraphSolver(topology, {
        ...problem,
        routeAllowedZ: [[2], undefined],
      }),
  ).toThrow('Connection "restricted"')
  expect(
    () =>
      new TinyHyperGraphSolver(topology, {
        ...problem,
        initialAssignments: [
          { routeId: 0, regionId: 1, fromPortId: 0, toPortId: 1 },
        ],
      }),
  ).toThrow('Connection "restricted"')
  const blocked = new TinyHyperGraphSolver(
    topology,
    { ...problem, routeAllowedZ: [[0], undefined] },
    options,
  )
  blocked.solve()
  expect(blocked.failed).toBe(true)
  expect(blocked.error).toContain("restricted")
})
