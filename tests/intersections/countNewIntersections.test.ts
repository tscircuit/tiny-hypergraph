import { expect, test } from "bun:test"
import { countIntersectionsFromAnglePairsDynamic } from "lib/countIntersectionsFromAnglePairsDynamic"
import { countNewIntersections } from "lib/countNewIntersections"
import { mapPortsToAnglePairs } from "lib/mapPortsToAnglePairs"
import type { DynamicAnglePair } from "lib/types"

type Port = { x: number; y: number; z: number; net: number }
type Segment = [Port, Port]
type AnglePair = DynamicAnglePair

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
      toInt32AnglePairs(existingAnglePairs),
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
