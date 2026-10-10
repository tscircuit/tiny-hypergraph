import { expect, test } from "bun:test"
import {
  getTinyHyperGraphSolverOptions,
  TinyHyperGraphSolver,
  type TinyHyperGraphProblem,
  type TinyHyperGraphTopology,
} from "lib/core"
import { SelectiveReripTinyHyperGraphSolver } from "lib/selective-rerip-tiny-hyper-graph-solver"

class InheritedSelectiveSolver extends SelectiveReripTinyHyperGraphSolver {
  search(forbidden: ReadonlySet<number> = new Set()) {
    return this.findRelaxedBlockerPath(forbidden)
  }
}

const create = (owned: boolean, singleLayer = false) => {
  const topology: TinyHyperGraphTopology = {
    portCount: 6,
    regionCount: 7,
    regionIncidentPorts: [[0, 1], [1, 2, 4, 5], [2, 3], [0], [3], [4], [5]],
    incidentPortRegion: [
      [0, 3],
      [0, 1],
      [1, 2],
      [2, 4],
      [1, 5],
      [1, 6],
    ],
    regionWidth: new Float64Array(7).fill(1),
    regionHeight: new Float64Array(7).fill(1),
    regionCenterX: new Float64Array(7),
    regionCenterY: new Float64Array(7),
    regionAvailableZMask: new Int32Array(7).fill(singleLayer ? 1 : 3),
    portAngleForRegion1: new Int32Array(6),
    portAngleForRegion2: new Int32Array(6),
    portX: new Float64Array([0, 1, 2, 3, 1, 2]),
    portY: new Float64Array([0, 0, 0, 0, 1, 1]),
    portZ: new Int32Array(6),
  }
  const problem: TinyHyperGraphProblem = {
    routeCount: 2,
    routeStartPort: new Int32Array([0, 4]),
    routeEndPort: new Int32Array([3, 5]),
    routeNet: new Int32Array([0, 1]),
    regionNetId: new Int32Array(7).fill(-1),
    portSectionMask: new Int8Array(6).fill(1),
    initialAssignments: [
      { routeId: 1, regionId: 1, fromPortId: 4, toPortId: 1 },
      { routeId: 1, regionId: 1, fromPortId: 1, toPortId: 5 },
    ],
  }
  const solver = new InheritedSelectiveSolver(topology, problem, {
    STATIC_REACHABILITY_PRECHECK: false,
    OWNED_RELAXED_HYPEREDGE_SEARCH: owned,
  })
  solver.state.currentRouteId = 0
  solver.state.currentRouteNetId = 0
  return solver
}

test("owned solvers retain legacy routes and fall back before hook effects", () => {
  const old = create(false)
  const current = create(true)
  expect(
    getTinyHyperGraphSolverOptions(current).OWNED_RELAXED_HYPEREDGE_SEARCH,
  ).toBe(true)
  expect(
    getTinyHyperGraphSolverOptions(old).OWNED_RELAXED_HYPEREDGE_SEARCH,
  ).toBe(false)

  let ownedRows = 0
  const inspectable = current as unknown as {
    getOwnedRelaxedSearchRow: (...args: unknown[]) => unknown
  }
  const nativeRow = inspectable.getOwnedRelaxedSearchRow
  inspectable.getOwnedRelaxedSearchRow = function (...args) {
    ownedRows++
    return Reflect.apply(nativeRow, this, args)
  }
  for (const forbidden of [new Set<number>(), new Set([1])]) {
    expect(current.search(forbidden)).toEqual(old.search(forbidden))
  }
  expect(ownedRows).toBeGreaterThan(0)
  current.topology.portY[2] = 2
  old.topology.portY[2] = 2
  expect(current.search()).toEqual(old.search())

  for (const method of [
    "getHopId",
    "isKnownSingleLayerRegion",
    "isRegionReservedForDifferentNet",
    "isPortReservedForDifferentNet",
    "populateSegmentGeometryScratch",
  ] as const) {
    const traces: unknown[][] = [[], []]
    const pair = [create(false, true), create(true, true)]
    for (let index = 0; index < pair.length; index++) {
      const solver = pair[index]!
      const native = solver[method]
      Object.defineProperty(solver, method, {
        configurable: true,
        value: function (...args: unknown[]) {
          traces[index]!.push(args)
          return Reflect.apply(native, this, args)
        },
      })
    }
    expect(pair[1]!.search()).toEqual(pair[0]!.search())
    expect(traces[1]).toEqual(traces[0])
    expect(traces[1]!.length).toBeGreaterThan(0)
  }

  const accessorTraces: string[][] = [[], []]
  const accessorPair = [create(false), create(true)]
  for (let index = 0; index < accessorPair.length; index++) {
    const solver = accessorPair[index]!
    const native = solver.getHopId
    Object.defineProperty(solver, "getHopId", {
      get() {
        accessorTraces[index]!.push("get")
        return native
      },
    })
  }
  expect(accessorPair[1]!.search()).toEqual(accessorPair[0]!.search())
  expect(accessorTraces[1]).toEqual(accessorTraces[0])

  const canonical = TinyHyperGraphSolver.prototype.getHopId
  const prototypeTrace: string[][] = [[], []]
  try {
    const pair = [create(false), create(true)]
    TinyHyperGraphSolver.prototype.getHopId = function (...args) {
      prototypeTrace[pair.indexOf(this as InheritedSelectiveSolver)]!
        .push("key")
      return Reflect.apply(canonical, this, args)
    }
    expect(pair[1]!.search()).toEqual(pair[0]!.search())
    expect(prototypeTrace[1]).toEqual(prototypeTrace[0])
  } finally {
    TinyHyperGraphSolver.prototype.getHopId = canonical
  }

  const unsafe = [create(false), create(true)]
  for (const solver of unsafe) solver.topology.portX[1] = Number.MAX_VALUE
  expect(() => unsafe[0]!.search()).toThrow("distance overflowed")
  expect(() => unsafe[1]!.search()).toThrow("distance overflowed")

  const hypot = Object.getOwnPropertyDescriptor(Math, "hypot")!
  try {
    Object.defineProperty(Math, "hypot", {
      ...hypot,
      value: () => Number.NaN,
    })
    expect(() => create(false).search()).toThrow("finite distances >= 0")
    expect(() => create(true).search()).toThrow("finite distances >= 0")
  } finally {
    Object.defineProperty(Math, "hypot", hypot)
  }
})
