import { expect, test } from "bun:test"
import {
  computeRegionCost,
  computeRegionCostForArea,
} from "../../lib/computeRegionCost"
import {
  TinyHyperGraphSolver,
  type TinyHyperGraphProblem,
  type TinyHyperGraphTopology,
} from "../../lib/core"
import { PolyHyperGraphSolver } from "../../lib/poly"
import type { PolyHyperGraphTopology } from "../../lib/poly-types"

type CostArgs = [number, number, number, number]
type ScalarArgs = [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
]

class CostProbe extends TinyHyperGraphSolver {
  regionCost(args: CostArgs, regionId = 0): number {
    return this.computeRegionCostForRegion(regionId, ...args)
  }
}

class FrozenCostProbe extends CostProbe {
  protected override computeRegionCostForRegion(
    regionId: number,
    same: number,
    cross: number,
    changes: number,
    count: number,
  ): number {
    return computeRegionCost(
      this.topology.regionWidth[regionId],
      this.topology.regionHeight[regionId],
      same,
      cross,
      changes,
      count,
      this.topology.regionAvailableZMask?.[regionId] ?? 0,
      this.minViaPadDiameter,
      this.TRACE_DENSITY_COST_FACTOR,
    )
  }
}

class PolyCostProbe extends PolyHyperGraphSolver {
  regionCost(args: CostArgs, regionId = 0): number {
    return this.computeRegionCostForRegion(regionId, ...args)
  }
}

const makeTopology = (): TinyHyperGraphTopology => ({
  portCount: 0,
  regionCount: 2,
  regionIncidentPorts: [[], []],
  incidentPortRegion: [],
  regionWidth: new Float64Array([3, 5]),
  regionHeight: new Float64Array([7, 9]),
  regionCenterX: new Float64Array(2),
  regionCenterY: new Float64Array(2),
  regionAvailableZMask: new Int32Array([15, 1]),
  portAngleForRegion1: new Int32Array(0),
  portX: new Float64Array(0),
  portY: new Float64Array(0),
  portZ: new Int32Array(0),
})

const makeProblem = (): TinyHyperGraphProblem => ({
  routeCount: 0,
  portSectionMask: new Int8Array(0),
  routeStartPort: new Int32Array(0),
  routeEndPort: new Int32Array(0),
  routeNet: new Int32Array(0),
  regionNetId: new Int32Array([-1, -1]),
})

test("region cost memo preserves live inputs, dispatch and coercion", (): void => {
  const solver = new CostProbe(makeTopology(), makeProblem())
  const values = [
    0,
    -0,
    1,
    -1,
    Number.MIN_VALUE,
    -Number.MIN_VALUE,
    1e154,
    1e155,
    Number.MAX_VALUE,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.NaN,
  ]
  for (let field = 0; field < 9; field++) {
    for (const value of values) {
      const args: ScalarArgs = [3, 7, 2, 3, 4, 5, 15, 0.3, 0]
      args[field] = value
      const [width, height, same, cross, changes, count, mask, via, factor] =
        args
      solver.topology.regionWidth[0] = width
      solver.topology.regionHeight[0] = height
      solver.topology.regionAvailableZMask![0] = mask
      solver.minViaPadDiameter = via!
      solver.TRACE_DENSITY_COST_FACTOR = factor!
      const actualArgs: ScalarArgs = [
        width,
        height,
        same,
        cross,
        changes,
        count,
        solver.topology.regionAvailableZMask![0],
        via,
        factor,
      ]
      const expected = computeRegionCost(...actualArgs)
      for (let repeat = 0; repeat < 3; repeat++) {
        expect(
          Object.is(solver.regionCost([same, cross, changes, count]), expected),
        ).toBe(true)
      }
    }
  }
  for (const mask of values) {
    solver.topology.regionAvailableZMask = [mask] as unknown as Int32Array
    solver.minViaPadDiameter = 0.3
    solver.TRACE_DENSITY_COST_FACTOR = 0
    solver.topology.regionWidth[0] = 3
    solver.topology.regionHeight[0] = 7
    const expected = computeRegionCost(3, 7, 0, 0, 0, 1, mask, 0.3, 0)
    expect(Object.is(solver.regionCost([0, 0, 0, 1]), expected)).toBe(true)
    expect(Object.is(solver.regionCost([0, 0, 0, 1]), expected)).toBe(true)
  }

  const live = new CostProbe(makeTopology(), makeProblem())
  const frozen = new FrozenCostProbe(makeTopology(), makeProblem())
  const args: CostArgs = [2, 3, 4, 5]
  const compare = (regionId = 0): void => {
    expect(
      Object.is(
        live.regionCost(args, regionId),
        frozen.regionCost(args, regionId),
      ),
    ).toBe(true)
    expect(
      Object.is(
        live.regionCost(args, regionId),
        frozen.regionCost(args, regionId),
      ),
    ).toBe(true)
  }
  compare()
  for (const instance of [live, frozen]) {
    instance.topology.regionWidth[0] = 8
    instance.topology.regionHeight[0] = 6
    instance.topology.regionAvailableZMask![0] = 1
    instance.minViaPadDiameter = 0.7
    instance.TRACE_DENSITY_COST_FACTOR = 0.4
  }
  compare()
  compare(1)
  for (const instance of [live, frozen]) {
    instance.topology = makeTopology()
    instance.topology.regionAvailableZMask = undefined
    instance.minViaPadDiameter = -0.15
    instance.TRACE_DENSITY_COST_FACTOR = -0
  }
  compare()
  for (const instance of [live, frozen]) {
    instance.topology.regionAvailableZMask = new Int32Array([8, 3])
    instance.topology.regionWidth = new Float64Array([0, -0])
    instance.topology.regionHeight = new Float64Array([4, 8])
  }
  compare()
  compare(1)

  const readEvents = (instance: CostProbe): string[] => {
    const events: string[] = []
    const topology = instance.topology
    for (const [name, value] of [
      ["regionWidth", topology.regionWidth],
      ["regionHeight", topology.regionHeight],
      ["regionAvailableZMask", topology.regionAvailableZMask],
    ] as const) {
      Object.defineProperty(topology, name, {
        get: (): typeof value => {
          events.push(name)
          return value
        },
      })
    }
    Object.defineProperty(instance, "topology", {
      get: (): TinyHyperGraphTopology => {
        events.push("topology")
        return topology
      },
    })
    for (const name of [
      "minViaPadDiameter",
      "TRACE_DENSITY_COST_FACTOR",
    ] as const) {
      const value = instance[name]
      Object.defineProperty(instance, name, {
        get: (): number => {
          events.push(name)
          return value
        },
      })
    }
    for (let index = 0; index < 3; index++) instance.regionCost(args)
    return events
  }
  expect(readEvents(new CostProbe(makeTopology(), makeProblem()))).toEqual(
    readEvents(new FrozenCostProbe(makeTopology(), makeProblem())),
  )

  const coercionEvents = (instance: CostProbe): string[] => {
    const events: string[] = []
    let conversions = 0
    const coercer = (name: string, value: number): number => {
      return {
        valueOf: (): number => {
          events.push(name)
          conversions++
          return value + conversions / 100
        },
      } as unknown as number
    }
    instance.topology.regionWidth = [
      coercer("width", 3),
    ] as unknown as Float64Array
    instance.topology.regionHeight = [
      coercer("height", 7),
    ] as unknown as Float64Array
    instance.topology.regionAvailableZMask = [
      coercer("mask", 15),
    ] as unknown as Int32Array
    instance.minViaPadDiameter = coercer("via", 0.3)
    instance.TRACE_DENSITY_COST_FACTOR = coercer("density", 0)
    const coercionArgs: CostArgs = [
      coercer("same", 2),
      coercer("cross", 3),
      coercer("changes", 4),
      coercer("count", 5),
    ]
    for (let index = 0; index < 3; index++) {
      events.push(String(instance.regionCost(coercionArgs)))
    }
    return events
  }
  expect(coercionEvents(new CostProbe(makeTopology(), makeProblem()))).toEqual(
    coercionEvents(new FrozenCostProbe(makeTopology(), makeProblem())),
  )

  const reentrantEvents = (instance: CostProbe): string[] => {
    const events: string[] = []
    instance.regionCost([0, 0, 0, 2])
    let count = 0
    const reentrantCount = {
      valueOf: (): number => {
        count++
        instance.minViaPadDiameter = 0.3 + count / 10
        events.push(String(instance.regionCost([0, 0, 0, 2])))
        return count
      },
    } as unknown as number
    for (let index = 0; index < 3; index++) {
      events.push(String(instance.regionCost([0, 0, 0, reentrantCount])))
    }
    events.push(String(instance.regionCost([0, 0, 0, 2])))
    return events
  }
  expect(reentrantEvents(new CostProbe(makeTopology(), makeProblem()))).toEqual(
    reentrantEvents(new FrozenCostProbe(makeTopology(), makeProblem())),
  )

  const getterReentrantEvents = (instance: CostProbe): string[] => {
    const events: string[] = []
    let nested = false
    let via = 0.3
    Object.defineProperty(instance, "minViaPadDiameter", {
      get: (): number => {
        events.push(nested ? "inner-via" : "outer-via")
        if (!nested) {
          nested = true
          events.push(String(instance.regionCost([0, 0, 0, 2], 1)))
          nested = false
          via += 0.1
          instance.topology.regionHeight[0] += 1
        }
        return via
      },
    })
    for (let index = 0; index < 3; index++) {
      events.push(String(instance.regionCost(args)))
    }
    return events
  }
  expect(
    getterReentrantEvents(new CostProbe(makeTopology(), makeProblem())),
  ).toEqual(
    getterReentrantEvents(new FrozenCostProbe(makeTopology(), makeProblem())),
  )

  const runtimeOverride = (instance: CostProbe): number[] => {
    const methods = instance as unknown as {
      computeRegionCostForRegion: (
        regionId: number,
        same: number,
        cross: number,
        changes: number,
        count: number,
      ) => number
    }
    const original = methods.computeRegionCostForRegion
    let calls = 0
    methods.computeRegionCostForRegion = function (
      regionId,
      same,
      cross,
      changes,
      count,
    ): number {
      calls++
      instance.topology.regionWidth[regionId] += 1
      return (
        original.call(instance, regionId, same, cross, changes, count) + calls
      )
    }
    const results: number[] = []
    for (let index = 0; index < 3; index++)
      results.push(instance.regionCost(args))
    results.push(calls)
    return results
  }
  expect(runtimeOverride(new CostProbe(makeTopology(), makeProblem()))).toEqual(
    runtimeOverride(new FrozenCostProbe(makeTopology(), makeProblem())),
  )

  const polyTopology: PolyHyperGraphTopology = {
    ...makeTopology(),
    regionVertexStart: new Int32Array(2),
    regionVertexCount: new Int32Array(2),
    regionVertexX: new Float64Array(0),
    regionVertexY: new Float64Array(0),
    regionArea: new Float64Array([27, 33]),
    regionPerimeter: new Float64Array(2),
    regionBoundsMinX: new Float64Array(2),
    regionBoundsMaxX: new Float64Array(2),
    regionBoundsMinY: new Float64Array(2),
    regionBoundsMaxY: new Float64Array(2),
    portBoundaryPositionForRegion1: new Int32Array(0),
    portBoundaryPositionForRegion2: new Int32Array(0),
    portEdgeIndexForRegion1: new Int32Array(0),
    portEdgeIndexForRegion2: new Int32Array(0),
    portEdgeTForRegion1: new Float64Array(0),
    portEdgeTForRegion2: new Float64Array(0),
  }
  const poly = new PolyCostProbe(polyTopology, makeProblem())
  poly.TRACE_DENSITY_COST_FACTOR = 0.4
  for (let index = 0; index < 3; index++) {
    poly.topology.regionArea[0] += 1
    poly.minViaPadDiameter += 0.1
    const expected = computeRegionCostForArea(
      poly.topology.regionArea[0],
      ...args,
      15,
      poly.minViaPadDiameter,
    )
    expect(Object.is(poly.regionCost(args), expected)).toBe(true)
    expect(Object.is(poly.regionCost(args), expected)).toBe(true)
  }

  for (const instance of [
    new CostProbe(makeTopology(), makeProblem()),
    new FrozenCostProbe(makeTopology(), makeProblem()),
  ]) {
    instance.regionCost(args)
    instance.topology.regionWidth = [
      Symbol("invalid-width"),
    ] as unknown as Float64Array
    expect(() => instance.regionCost(args)).toThrow(TypeError)
    expect(() => instance.regionCost(args)).toThrow(TypeError)
  }
})
