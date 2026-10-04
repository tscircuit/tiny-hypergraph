import { expect, test } from "bun:test"
import {
  computeRegionCost,
  computeRegionCostForArea,
} from "../../lib/computeRegionCost"
import {
  computeRegionCost as originalComputeRegionCost,
  computeRegionCostForArea as originalComputeRegionCostForArea,
} from "../fixtures/Frozen4eRegionCost"

type CostArgs = Parameters<typeof computeRegionCostForArea>

test("zero density costs preserve exceptional arithmetic", (): void => {
  const values = [
    0,
    -0,
    1,
    -1,
    3,
    0.3,
    -0.15,
    Number.MIN_VALUE,
    -Number.MIN_VALUE,
    1e154,
    -1e154,
    1e155,
    Number.MAX_VALUE,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.NaN,
  ]
  const masks = [0, -0, 1, 2, 3, 15, 0x7fffffff, -1, 0.5, Number.NaN]
  const factors = [0, -0, 0.01, 1, Number.POSITIVE_INFINITY, Number.NaN]
  const compare = (args: CostArgs): void => {
    const expected = originalComputeRegionCostForArea(...args)
    const actual = computeRegionCostForArea(...args)
    expect(Object.is(actual, expected)).toBe(true)
  }

  for (const area of values) {
    for (const traceCount of values) {
      for (const mask of masks) {
        for (const factor of factors) {
          compare([area, 0, 0, 0, traceCount, mask, 0.3, factor])
          compare([area, -0, -0, -0, traceCount, mask, -0.15, factor])
        }
      }
    }
  }
  for (let bit = 0; bit < 32; bit++) {
    for (const value of values) {
      for (let field = 0; field < 8; field++) {
        const args: CostArgs = [5, 2, 3, 4, 5, 1 << bit, 0.3, 0]
        args[field] = value
        compare(args)
      }
    }
  }

  let seed = 0x4e215690
  const random = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 0x100000000
  }
  for (let index = 0; index < 10_000; index++) {
    const width = (random() - 0.5) * 20
    const height = (random() - 0.5) * 20
    const args: CostArgs = [
      width * height,
      Math.floor(random() * 10),
      Math.floor(random() * 10),
      Math.floor(random() * 10),
      Math.floor(random() * 100),
      Math.floor(random() * 16),
      random(),
      index % 3 === 0 ? -0 : index % 3 === 1 ? 0 : random(),
    ]
    compare(args)
    const [, same, cross, changes, count, mask, viaSize, factor] = args
    expect(
      Object.is(
        computeRegionCost(
          width,
          height,
          same,
          cross,
          changes,
          count,
          mask,
          viaSize,
          factor,
        ),
        originalComputeRegionCost(
          width,
          height,
          same,
          cross,
          changes,
          count,
          mask,
          viaSize,
          factor,
        ),
      ),
    ).toBe(true)
  }
})
