import { expect, test } from "bun:test"
import { countIntersectionsFromAnglePairsDynamic } from "lib/countIntersectionsFromAnglePairsDynamic"
import { countNewIntersections } from "lib/countNewIntersections"
import { mapPortsToAnglePairs } from "lib/mapPortsToAnglePairs"
import type { DynamicAnglePair } from "lib/types"

type Port = { x: number; y: number; z: number; net: number }
type Segment = [Port, Port]
type AnglePair = DynamicAnglePair

const CENTER = { x: 0, y: 0 }
const SAMPLE_COUNT = 10_000
const MIN_PAIR_COUNT = 4
const MAX_PAIR_COUNT = 15
const EPSILON = 1e-9

const createMulberry32 = (seed: number) => {
  let state = seed

  return () => {
    state += 0x6d2b79f5
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const randomInt = (random: () => number, min: number, max: number) =>
  Math.floor(random() * (max - min + 1)) + min

const shuffle = <T>(items: T[], random: () => number) => {
  const shuffled = [...items]

  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }

  return shuffled
}

const generateSample = (random: () => number): Segment[] => {
  const segmentCount = randomInt(random, MIN_PAIR_COUNT, MAX_PAIR_COUNT)
  const pointCount = segmentCount * 2
  const points = shuffle(
    Array.from({ length: pointCount }, (_, index) => {
      const angle = (index / pointCount) * Math.PI * 2
      return {
        x: Math.cos(angle),
        y: Math.sin(angle),
      }
    }),
    random,
  )

  const segments: Segment[] = []
  for (let i = 0; i < points.length; i += 2) {
    const net = randomInt(random, 0, 3)
    segments.push([
      { ...points[i], z: randomInt(random, 0, 3), net },
      { ...points[i + 1], z: randomInt(random, 0, 3), net },
    ])
  }

  return segments
}

const orientation = (a: Port, b: Port, c: Port) =>
  (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)

const hasOppositeSigns = (a: number, b: number) =>
  (a > EPSILON && b < -EPSILON) || (a < -EPSILON && b > EPSILON)

const segmentsIntersectInXY = ([a, b]: Segment, [c, d]: Segment) => {
  const ab_c = orientation(a, b, c)
  const ab_d = orientation(a, b, d)
  const cd_a = orientation(c, d, a)
  const cd_b = orientation(c, d, b)

  return hasOppositeSigns(ab_c, ab_d) && hasOppositeSigns(cd_a, cd_b)
}

const countIntersectionsFromXY = (
  sample: Segment[],
): [number, number, number] => {
  let sameLayerIntersectionCount = 0
  let crossingLayerIntersectionCount = 0
  let entryExitChanges = 0

  for (const [p1, p2] of sample) {
    if (p1.z !== p2.z) {
      entryExitChanges++
    }
  }

  for (let i = 0; i < sample.length; i++) {
    const [a, b] = sample[i]

    for (let u = i + 1; u < sample.length; u++) {
      const [c, d] = sample[u]
      if (a.net === c.net) continue
      if (!segmentsIntersectInXY([a, b], [c, d])) continue

      if (a.z === c.z || b.z === c.z || a.z === d.z || b.z === d.z) {
        sameLayerIntersectionCount++
      } else {
        crossingLayerIntersectionCount++
      }
    }
  }

  return [
    sameLayerIntersectionCount,
    crossingLayerIntersectionCount,
    entryExitChanges,
  ]
}

const toInt32AnglePairs = (anglePairs: AnglePair[]) => {
  const flattened = new Int32Array(anglePairs.length * 5)

  for (let i = 0; i < anglePairs.length; i++) {
    const [net, a, z1, b, z2] = anglePairs[i]
    const offset = i * 5
    flattened[offset] = net
    flattened[offset + 1] = a
    flattened[offset + 2] = z1
    flattened[offset + 3] = b
    flattened[offset + 4] = z2
  }

  return flattened
}

const combineResult = ([sameLayer, crossingLayer, entryExit]: [
  number,
  number,
  number,
]) => sameLayer * 1_000_000 + crossingLayer * 1_000 + entryExit

test("anglePairsXYvsDynamicVsNPlusOnePerf", () => {
  const random = createMulberry32(0x239f10e5)
  const samples = Array.from({ length: SAMPLE_COUNT }, () =>
    generateSample(random),
  )
  const anglePairsBySample = samples.map(
    (sample) => mapPortsToAnglePairs(CENTER, sample) as AnglePair[],
  )
  const nPlusOneInputs = anglePairsBySample.map((anglePairs) => {
    const existingAnglePairs = anglePairs.slice(0, -1)
    return {
      existingPairs: toInt32AnglePairs(existingAnglePairs),
      newPair: anglePairs[anglePairs.length - 1],
    }
  })
  const expectedNPlusOneChecksum = anglePairsBySample.reduce(
    (checksum, anglePairs) => {
      const existingAnglePairs = anglePairs.slice(0, -1)
      const fullCount = countIntersectionsFromAnglePairsDynamic(anglePairs)
      const existingCount =
        countIntersectionsFromAnglePairsDynamic(existingAnglePairs)

      return (
        checksum +
        combineResult([
          fullCount[0] - existingCount[0],
          fullCount[1] - existingCount[1],
          fullCount[2] - existingCount[2],
        ])
      )
    },
    0,
  )

  let xyChecksum = 0
  const xyStart = performance.now()
  for (const sample of samples) {
    xyChecksum += combineResult(countIntersectionsFromXY(sample))
  }
  const xyDurationMs = performance.now() - xyStart

  let dynamicChecksum = 0
  const dynamicStart = performance.now()
  for (const anglePairs of anglePairsBySample) {
    dynamicChecksum += combineResult(
      countIntersectionsFromAnglePairsDynamic(anglePairs),
    )
  }
  const dynamicDurationMs = performance.now() - dynamicStart

  let nPlusOneChecksum = 0
  const nPlusOneStart = performance.now()
  for (const { existingPairs, newPair } of nPlusOneInputs) {
    nPlusOneChecksum += combineResult(
      countNewIntersections(existingPairs, newPair),
    )
  }
  const nPlusOneDurationMs = performance.now() - nPlusOneStart

  console.log(
    [
      `XY: ${xyDurationMs.toFixed(2)}ms total`,
      `Dynamic: ${dynamicDurationMs.toFixed(2)}ms total`,
      `N+1: ${nPlusOneDurationMs.toFixed(2)}ms total`,
      `Samples: ${SAMPLE_COUNT}`,
      `Pairs/sample: ${MIN_PAIR_COUNT}-${MAX_PAIR_COUNT}`,
      `XY avg: ${(xyDurationMs / SAMPLE_COUNT).toFixed(6)}ms/sample`,
      `Dynamic avg: ${(dynamicDurationMs / SAMPLE_COUNT).toFixed(6)}ms/sample`,
      `N+1 avg: ${(nPlusOneDurationMs / SAMPLE_COUNT).toFixed(6)}ms/sample`,
      `XY/Dynamic: ${(xyDurationMs / dynamicDurationMs).toFixed(2)}x`,
      `Dynamic/N+1: ${(dynamicDurationMs / nPlusOneDurationMs).toFixed(2)}x`,
    ].join(" | "),
  )

  expect(dynamicChecksum).toBe(xyChecksum)
  expect(nPlusOneChecksum).toBe(expectedNPlusOneChecksum)
})
