import { expect, test } from "bun:test"
import {
  getTinyHyperGraphSolverOptions,
  TinyHyperGraphSolver,
  type TinyHyperGraphProblem,
  type TinyHyperGraphTopology,
} from "lib/core"
import type { OwnedRelaxedHyperedgeRow } from "lib/owned-relaxed-hyperedge-types"
import { SelectiveReripTinyHyperGraphSolver } from "lib/selective-rerip-tiny-hyper-graph-solver"

type Row = OwnedRelaxedHyperedgeRow<number>
type Hop = Row["templates"][number]

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

const rowKey = (sourcePortId: number, regionId: number): string =>
  `${sourcePortId}:${regionId}`

const captureNativeRows = (solver: InheritedSelectiveSolver): Row[] => {
  const rows: Row[] = []
  const inspectable = solver as unknown as {
    getOwnedRelaxedSearchRow: (...args: unknown[]) => Row
  }
  const native = inspectable.getOwnedRelaxedSearchRow
  inspectable.getOwnedRelaxedSearchRow = function (...args) {
    const row = Reflect.apply(native, this, args) as Row
    rows.push(row)
    return row
  }
  return rows
}

const captureLegacyRows = (
  solver: InheritedSelectiveSolver,
): Map<string, readonly Hop[]> => {
  const rows = new Map<string, readonly Hop[]>()
  type Params = {
    state: { portId: number; nextRegionId: number }
    buildRegionTemplates?: boolean
  }
  const inspectable = solver as unknown as {
    getRelaxedSearchHops: (params: Params) => Hop[]
  }
  const native = inspectable.getRelaxedSearchHops
  inspectable.getRelaxedSearchHops = function (params) {
    const hops = Reflect.apply(native, this, [params]) as Hop[]
    if (!params.buildRegionTemplates) {
      rows.set(rowKey(params.state.portId, params.state.nextRegionId), hops)
    }
    return hops
  }
  return rows
}

const checkNativeDistanceMemo = () => {
  const cases = [
    {
      x: [0, 2, 5, 9, 2, 5],
      y: [0, 1, 0, 2, 1, 1],
      positive: true,
      zero: false,
    },
    {
      x: [0, -0, 0, -0, 1, 2],
      y: [-0, 0, -0, 0, 0, 0],
      positive: false,
      zero: true,
    },
    {
      x: [
        0,
        Number.MIN_VALUE,
        2 * Number.MIN_VALUE,
        5 * Number.MIN_VALUE,
        1,
        2,
      ],
      y: [0, 0, Number.MIN_VALUE, 2 * Number.MIN_VALUE, 0, 0],
      positive: true,
      zero: false,
    },
    {
      x: [
        1,
        1 + Number.EPSILON,
        1 + 2 * Number.EPSILON,
        1 + 4 * Number.EPSILON,
        0,
        2,
      ],
      y: [0, Number.EPSILON, 0, Number.EPSILON, 0, 0],
      positive: true,
      zero: false,
    },
  ]
  for (const coordinates of cases) {
    const old = create(false)
    const current = create(true)
    for (const solver of [old, current]) {
      solver.topology.portX.set(coordinates.x)
      solver.topology.portY.set(coordinates.y)
      solver.topology.regionIncidentPorts[0] = [0, 1, 1]
      solver.topology.regionIncidentPorts[1] = [1, 2, 4, 5, 2]
      solver.topology.regionIncidentPorts[2] = [2, 3, 3]
    }
    const rows = captureNativeRows(current)
    const legacyRows = captureLegacyRows(old)
    const connected = current.search()
    expect(connected).toEqual(old.search())
    expect(connected.found).toBe(true)
    // A second, disconnected search prepares native reachability rows without
    // running weighted relaxation. Its positive raw occurrences start cold.
    for (const solver of [old, current]) {
      solver.topology.regionIncidentPorts[2] = [2]
    }
    rows.length = 0
    legacyRows.clear()
    const disconnected = current.search()
    expect(disconnected).toEqual(old.search())
    expect(disconnected.found).toBe(false)
    const sharedRows = rows.filter((row) => row.getHopDistance !== undefined)
    expect(sharedRows.length).toBeGreaterThan(0)

    const hypot = Object.getOwnPropertyDescriptor(Math, "hypot")!
    const nativeHypot = hypot.value as typeof Math.hypot
    const float64Array = Object.getOwnPropertyDescriptor(
      globalThis,
      "Float64Array",
    )!
    const nativeFloat64Array = Float64Array
    let calculations = 0
    let allocations = 0
    let positiveQueries = 0
    let zeroQueries = 0
    let duplicatedRows = 0
    try {
      // Search has completed with the native guard active. Count only direct
      // row calculations, never search requests or independent oracle calls.
      Object.defineProperty(Math, "hypot", {
        ...hypot,
        value: (...values: number[]) => {
          calculations++
          return Reflect.apply(nativeHypot, Math, values) as number
        },
      })
      Object.defineProperty(globalThis, "Float64Array", {
        ...float64Array,
        value: new Proxy(nativeFloat64Array, {
          construct(target, args, newTarget): Float64Array {
            allocations++
            return Reflect.construct(target, args, newTarget) as Float64Array
          },
        }),
      })
      for (const row of sharedRows) {
        const beforeRow = allocations
        const legacyHops = legacyRows.get(
          rowKey(row.sourcePortId, row.regionId),
        )!
        expect(legacyHops).toBeDefined()
        const destinations = new Set<number>()
        const queries: Array<{ index: number; distance: number }> = []
        let duplicate = false
        let yieldedIndex = 0
        for (let index = 0; index < row.templates.length; index++) {
          if (row.excludedTemplateIndices.includes(index)) continue
          const template = row.templates[index]!
          duplicate ||= destinations.has(template.state.portId)
          destinations.add(template.state.portId)
          const legacyHop = legacyHops[yieldedIndex]!
          const expected = Reflect.apply(nativeHypot, Math, [
            current.topology.portX[row.sourcePortId]! -
              current.topology.portX[template.state.portId]!,
            current.topology.portY[row.sourcePortId]! -
              current.topology.portY[template.state.portId]!,
          ]) as number
          queries.push({ index, distance: expected })
          expect(Object.is(legacyHop.distance, expected)).toBe(true)
          const beforeFirst = calculations
          const first = row.getHopDistance!(index)
          expect(Object.is(first, expected)).toBe(true)
          expect(calculations - beforeFirst).toBe(1)
          if (expected > 0) positiveQueries++
          else zeroQueries++
          for (let repeat = 0; repeat < 3; repeat++) {
            const beforeRepeat = calculations
            expect(Object.is(row.getHopDistance!(index), expected)).toBe(true)
            expect(calculations - beforeRepeat).toBe(expected > 0 ? 0 : 1)
          }
          const beforeMaterialization = calculations
          const explicit = row.getHop(index, yieldedIndex, expected)
          expect(calculations).toBe(beforeMaterialization)
          const implicit = row.getHop(index, yieldedIndex)
          expect(calculations - beforeMaterialization).toBe(
            expected > 0 ? 0 : 1,
          )
          for (const hop of [explicit, implicit]) {
            expect(hop).toEqual(legacyHop)
            expect(Object.is(hop.distance, expected)).toBe(true)
            expect(hop.state).toBe(template.state)
            expect(hop.owners).toBe(template.owners)
            expect(hop.data).toBe(template.data)
          }
          expect(explicit).not.toBe(implicit)
          yieldedIndex++
        }
        expect(yieldedIndex).toBe(legacyHops.length)
        expect(allocations).toBe(beforeRow)
        const previousLastIndex = queries.at(-1)?.index
        // The second distinct-index scan fills the buffer; the previous last
        // positive occurrence is seeded without recalculating its distance.
        for (let pass = 0; pass < 2; pass++) {
          for (const { index, distance: expected } of queries) {
            const before = calculations
            expect(Object.is(row.getHopDistance!(index), expected)).toBe(true)
            const firstRepeatMiss = pass === 0 && index !== previousLastIndex
            expect(calculations - before).toBe(
              expected > 0 ? (firstRepeatMiss ? 1 : 0) : 1,
            )
          }
        }
        expect(allocations - beforeRow).toBe(queries.length > 1 ? 1 : 0)
        for (const { index, distance: expected } of [...queries].reverse()) {
          const before = calculations
          expect(Object.is(row.getHopDistance!(index), expected)).toBe(true)
          expect(calculations - before).toBe(expected > 0 ? 0 : 1)
        }
        expect(allocations - beforeRow).toBe(queries.length > 1 ? 1 : 0)
        if (duplicate) duplicatedRows++
      }
    } finally {
      Object.defineProperty(Math, "hypot", hypot)
      Object.defineProperty(globalThis, "Float64Array", float64Array)
    }
    expect(positiveQueries > 0).toBe(coordinates.positive)
    expect(zeroQueries > 0).toBe(coordinates.zero)
    expect(duplicatedRows).toBeGreaterThan(0)
  }
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

  const ownedRows = captureNativeRows(current)
  for (const forbidden of [new Set<number>(), new Set([1])]) {
    expect(current.search(forbidden)).toEqual(old.search(forbidden))
  }
  expect(ownedRows.length).toBeGreaterThan(0)
  const lazyRows = ownedRows.filter((row) => row.hyperedgeId !== undefined)
  expect(lazyRows.length).toBeGreaterThan(1)
  const firstLazyRow = lazyRows[0]!
  for (const row of lazyRows) {
    expect(Object.hasOwn(row, "getHopDistance")).toBe(false)
    expect(Object.hasOwn(row, "getHop")).toBe(false)
    expect(row.getHopDistance).toBe(firstLazyRow.getHopDistance)
    expect(row.getHop).toBe(firstLazyRow.getHop)
    expect(row.hyperedgeId).toBe(row.templates)
    for (let index = 0; index < row.templates.length; index++) {
      const template = row.templates[index]!
      const distance = Math.hypot(
        current.topology.portX[row.sourcePortId]! -
          current.topology.portX[template.state.portId]!,
        current.topology.portY[row.sourcePortId]! -
          current.topology.portY[template.state.portId]!,
      )
      expect(row.getHopDistance!(index)).toBe(distance)
      const hop = row.getHop(index, 0)
      expect(hop.state).toBe(template.state)
      expect(hop.owners).toBe(template.owners)
      expect(hop.data).toBe(template.data)
      expect(hop.distance).toBe(distance)
      expect(Object.keys(hop)).toEqual(["state", "owners", "data", "distance"])
      const supplied = row.getHop(index, 0, distance)
      expect(Object.is(supplied.distance, distance)).toBe(true)
      expect(supplied).not.toBe(hop)
      const signedZero = row.getHop(index, 0, -0)
      expect(Object.is(signedZero.distance, -0)).toBe(true)
    }
  }
  const previousRow = ownedRows.find(
    (row) => row.regionId === 1 && row.sourcePortId === 1,
  )!
  const previousIndex = previousRow.templates.findIndex(
    (hop) => hop.state.portId === 2,
  )
  const previousDistance = previousRow.getHopDistance!(previousIndex)
  const nextSearchRowStart = ownedRows.length
  current.topology.portY[2] = 2
  old.topology.portY[2] = 2
  expect(current.search()).toEqual(old.search())
  const nextRow = ownedRows
    .slice(nextSearchRowStart)
    .find((row) => row.regionId === 1 && row.sourcePortId === 1)!
  expect(nextRow).not.toBe(previousRow)
  const nextIndex = nextRow.templates.findIndex((hop) => hop.state.portId === 2)
  const nextDistance = nextRow.getHopDistance!(nextIndex)
  expect(nextDistance).toBe(Math.hypot(1 - 2, 0 - 2))
  expect(nextDistance).not.toBe(previousDistance)

  checkNativeDistanceMemo()

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
      prototypeTrace[pair.indexOf(this as InheritedSelectiveSolver)]!.push(
        "key",
      )
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
