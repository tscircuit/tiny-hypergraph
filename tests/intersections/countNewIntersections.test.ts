import { expect, test } from "bun:test"
import { countIntersectionsFromAnglePairsDynamic } from "lib/countIntersectionsFromAnglePairsDynamic"
import {
  classifyIntersectionLayerMasks,
  countNewIntersections,
  createDynamicAnglePairArrays,
} from "lib/countNewIntersections"
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
      createDynamicAnglePairArrays(existingAnglePairs),
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

test("routing-risk classification matches downstream crossing categories", () => {
  const z0 = 1 << 0
  const z1 = 1 << 1
  const transition = z0 | z1

  expect(classifyIntersectionLayerMasks(z0, z0, "routing-risk")).toBe(
    "same-layer",
  )
  expect(
    classifyIntersectionLayerMasks(transition, transition, "routing-risk"),
  ).toBe("transition-pair")
  expect(classifyIntersectionLayerMasks(z0, z1, "routing-risk")).toBeUndefined()
  expect(
    classifyIntersectionLayerMasks(transition, z0, "routing-risk"),
  ).toBeUndefined()
})

test("routing-complexity classifies detailed-router blocking interactions", () => {
  const z0 = 1 << 0
  const z1 = 1 << 1
  const transition = z0 | z1

  expect(classifyIntersectionLayerMasks(z0, z0, "routing-complexity")).toBe(
    "same-layer",
  )
  expect(
    classifyIntersectionLayerMasks(
      transition,
      transition,
      "routing-complexity",
    ),
  ).toBe("transition-pair")
  expect(
    classifyIntersectionLayerMasks(transition, z0, "routing-complexity"),
  ).toBe("same-layer")
  expect(
    classifyIntersectionLayerMasks(z0, z1, "routing-complexity"),
  ).toBeUndefined()
})

test("routing-risk counts crossing routes on the same electrical net", () => {
  const existingPairs = createDynamicAnglePairArrays([[7, 0, 0, 2, 0]])
  const crossingRouteWithDistinctOwner: DynamicAnglePair = [8, 1, 0, 3, 0]
  const crossingRouteWithSameOwner: DynamicAnglePair = [7, 1, 0, 3, 0]

  expect(
    countNewIntersections(
      existingPairs,
      crossingRouteWithDistinctOwner,
      "routing-risk",
    ),
  ).toEqual([1, 0, 0])
  expect(
    countNewIntersections(
      existingPairs,
      crossingRouteWithSameOwner,
      "routing-risk",
    ),
  ).toEqual([0, 0, 0])
})

test("routing-risk ignores shared endpoints and repeated route segments", () => {
  const existingPairs = createDynamicAnglePairArrays([[3, 0, 0, 2, 0]])

  expect(
    countNewIntersections(existingPairs, [4, 0, 0, 3, 0], "routing-risk"),
  ).toEqual([0, 0, 0])
  expect(
    countNewIntersections(existingPairs, [3, 1, 0, 3, 1], "routing-risk"),
  ).toEqual([0, 0, 0])
})
