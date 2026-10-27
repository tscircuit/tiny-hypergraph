import { expect, test } from "bun:test"
import { RegionCostKernel } from "../../lib/parallel/RegionCostKernel"
import { computeRegionCostForArea, isKnownSingleLayerMask } from "../../lib/computeRegionCost"
import { setNewIntersectionCounts } from "../../lib/countNewIntersections"
import { COST_SEGMENT_CAPACITY, type RegionCostWorkerInput } from "../../lib/parallel/regionCostTypes"

test("Wasm transition costs are bit-identical to the JavaScript cost formula", (): void => {
  const kernel = new RegionCostKernel()
  let seed = 1234
  const random = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 4294967296
  }
  let compared = 0
  for (let trial = 0; trial < 100; trial++) {
    const n = 2 + Math.floor(random() * 70)
    const count = Math.floor(random() * 40)
    const angles = Int32Array.from({ length: n }, () => Math.floor(random() * 36000))
    const layers = Int32Array.from({ length: n }, () => Math.floor(random() * 4))
    const segments = Int32Array.from(
      { length: COST_SEGMENT_CAPACITY * 4 }, () => Math.floor(random() * 36000),
    )
    for (let i = 0; i < count; i++) {
      segments[i] = Math.floor(random() * 4)
      segments[COST_SEGMENT_CAPACITY * 3 + i] = 1 << Math.floor(random() * 4)
    }
    const data: RegionCostWorkerInput = {
      control: new Int32Array(), resultVersions: new Int32Array(),
      scores: new Float64Array(), pairOffsets: new Float64Array(),
      portOffsets: Int32Array.from([0, n]), angles, layers, maxPorts: n,
      portMasks: new Uint8Array(n).fill(1), slotSegments: segments,
      slotCounts: Float64Array.from([random() * 10, random() * 10, random() * 10, random() * 10, count]),
      areas: Float64Array.from([random() * 20]),
      layerMasks: Int32Array.from([Math.floor(random() * 16)]),
      minViaPadDiameter: random(), traceDensityCostFactor: random(),
    }
    const actual = kernel.compute(data, 0, 0, count, 2)
    const cache = {
      netIds: segments.subarray(0, count),
      lesserAngles: segments.subarray(COST_SEGMENT_CAPACITY, COST_SEGMENT_CAPACITY + count),
      greaterAngles: segments.subarray(COST_SEGMENT_CAPACITY * 2, COST_SEGMENT_CAPACITY * 2 + count),
      layerMasks: segments.subarray(COST_SEGMENT_CAPACITY * 3, COST_SEGMENT_CAPACITY * 3 + count),
    }
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const scratch = {
          netId: 2,
          lesserAngle: Math.min(angles[i]!, angles[j]!),
          greaterAngle: Math.max(angles[i]!, angles[j]!),
          layerMask: (1 << layers[i]!) | (1 << layers[j]!),
          entryExitLayerChanges: layers[i] !== layers[j] ? 1 : 0,
          sameLayerIntersectionCount: 0, crossingLayerIntersectionCount: 0,
        }
        setNewIntersectionCounts(cache, scratch)
        const expected = scratch.sameLayerIntersectionCount > 0 && isKnownSingleLayerMask(data.layerMasks[0]!)
          ? Infinity
          : computeRegionCostForArea(
              data.areas[0]!, data.slotCounts[0]! + scratch.sameLayerIntersectionCount,
              data.slotCounts[1]! + scratch.crossingLayerIntersectionCount,
              data.slotCounts[2]! + scratch.entryExitLayerChanges,
              data.slotCounts[4]! + 1, data.layerMasks[0]!,
              data.minViaPadDiameter, data.traceDensityCostFactor,
            ) - data.slotCounts[3]!
        if (!Object.is(actual[i * n + j], expected)) {
          throw new Error(`Mismatch ${actual[i * n + j]} !== ${expected}`)
        }
        compared++
      }
    }
  }
  expect(compared).toBeGreaterThan(100_000)
})
