import { expect, test } from "bun:test"
import { loadSerializedHyperGraph } from "lib/compat/loadSerializedHyperGraph"
import { sameNetSharedBottleneckFixture } from "tests/fixtures/same-net-shared-bottleneck.fixture"

test("serialized regions carry viaAreaFraction into the topology", () => {
  const withFraction = (viaAreaFraction: unknown) => ({
    ...sameNetSharedBottleneckFixture,
    regions: sameNetSharedBottleneckFixture.regions.map((region, index) =>
      index === 0 ? { ...region, d: { ...region.d, viaAreaFraction } } : region,
    ),
  })

  const { topology } = loadSerializedHyperGraph(withFraction(0.1))
  const regionIndex = topology.regionMetadata!.findIndex(
    (metadata) => metadata?.viaAreaFraction === 0.1,
  )
  expect(regionIndex).toBeGreaterThanOrEqual(0)
  expect(topology.regionViaAreaFraction![regionIndex]).toBe(0.1)
  expect(
    [...topology.regionViaAreaFraction!].filter((value) => value !== 1),
  ).toEqual([0.1])

  expect(() => loadSerializedHyperGraph(withFraction(0))).toThrow(
    "expected a number in (0, 1]",
  )
})
