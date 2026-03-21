import { expect, test } from "bun:test"
import { countIntersectionsFromAnglePairsDynamic } from "lib/countIntersectionsFromAnglePairsDynamic"
import { countNewIntersections } from "lib/countNewIntersections"
import { mapPortsToAnglePairs } from "lib/mapPortsToAnglePairs"

type Port = { x: number; y: number; z: number }
type Segment = [Port, Port]
type AnglePair = [number, number, number, number]

const CENTER = { x: 0, y: 0 }
const SAMPLE_COUNT = 100

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
  const segmentCount = randomInt(random, 4, 15)
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

const toFloat64AnglePairs = (anglePairs: AnglePair[]) => {
  const flattened = new Float64Array(anglePairs.length * 4)

  for (let i = 0; i < anglePairs.length; i++) {
    const [a, z1, b, z2] = anglePairs[i]
    const offset = i * 4
    flattened[offset] = a
    flattened[offset + 1] = z1
    flattened[offset + 2] = b
    flattened[offset + 3] = z2
  }

  return flattened
}

test("countNewIntersections matches the incremental delta from the full counter", () => {
  const random = createMulberry32(0x51ced123)

  for (let sampleIndex = 0; sampleIndex < SAMPLE_COUNT; sampleIndex++) {
    const sample = generateSample(random)
    const anglePairs = mapPortsToAnglePairs(CENTER, sample) as AnglePair[]
    const existingAnglePairs = anglePairs.slice(0, -1)
    const newPair = anglePairs[anglePairs.length - 1]

    const fullCount = countIntersectionsFromAnglePairsDynamic(anglePairs)
    const existingCount =
      countIntersectionsFromAnglePairsDynamic(existingAnglePairs)
    const incrementalCount = countNewIntersections(
      toFloat64AnglePairs(existingAnglePairs),
      newPair,
    )

    expect({
      sampleIndex,
      result: incrementalCount,
    }).toEqual({
      sampleIndex,
      result: [
        fullCount[0] - existingCount[0],
        fullCount[1] - existingCount[1],
        fullCount[2] - existingCount[2],
      ],
    })
  }
})
