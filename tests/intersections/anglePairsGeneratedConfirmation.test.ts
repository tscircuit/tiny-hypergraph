import { expect, test } from "bun:test"
import { countIntersectionsFromAnglePairsDynamic } from "lib/countIntersectionsFromAnglePairsDynamic"
import { mapPortsToAnglePairs } from "lib/mapPortsToAnglePairs"

type Port = { x: number; y: number; z: number }
type Segment = [Port, Port]

const CENTER = { x: 0, y: 0 }
const SAMPLE_COUNT = 100
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
  const segmentCount = randomInt(random, 2, 12)
  const pointCount = segmentCount * 2
  const points = shuffle(
    Array.from({ length: pointCount }, (_, index) => {
      const angle = (index / pointCount) * Math.PI * 2
      return {
        x: Math.cos(angle),
        y: Math.sin(angle),
        z: randomInt(random, 0, 3),
      }
    }),
    random,
  )

  const segments: Segment[] = []
  for (let i = 0; i < points.length; i += 2) {
    segments.push([points[i], points[i + 1]])
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

test("anglePairsGeneratedConfirmation", () => {
  const random = createMulberry32(0xdecafbad)

  for (let sampleIndex = 0; sampleIndex < SAMPLE_COUNT; sampleIndex++) {
    const sample = generateSample(random)
    const intersectionsFromXY = countIntersectionsFromXY(sample)
    const intersectionsFromAnglePairs = countIntersectionsFromAnglePairsDynamic(
      mapPortsToAnglePairs(CENTER, sample),
    )

    expect({
      sampleIndex,
      result: intersectionsFromAnglePairs,
    }).toEqual({
      sampleIndex,
      result: intersectionsFromXY,
    })
  }
})
