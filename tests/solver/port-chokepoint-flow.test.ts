import { expect, test } from "bun:test"
import { loadSerializedHyperGraph } from "lib/compat/loadSerializedHyperGraph"
import { analyzePortCapacityMinCut } from "lib/index"
import { busRegionSpanFixture } from "tests/fixtures/bus-region-span.fixture"
import { portChokepointFixture } from "tests/fixtures/port-chokepoint.fixture"
import { sameNetSharedBottleneckFixture } from "tests/fixtures/same-net-shared-bottleneck.fixture"

const getSerializedPortIds = (
  topology: ReturnType<typeof loadSerializedHyperGraph>["topology"],
  portIds: number[],
) =>
  portIds.map(
    (portId) =>
      (topology.portMetadata?.[portId] as { serializedPortId?: string })
        ?.serializedPortId ?? String(portId),
  )

test("max-flow min-cut finds the synthetic one-port chokepoint corridor", () => {
  const { topology, problem } = loadSerializedHyperGraph(portChokepointFixture)
  const analysis = analyzePortCapacityMinCut({ topology, problem })

  expect(analysis.demand).toBe(2)
  expect(analysis.maxFlow).toBe(1)
  expect(getSerializedPortIds(topology, analysis.minCutPortIds)).toEqual([
    "left-center-choke",
  ])
})

test("max-flow min-cut does not flag same-net shared bottleneck as different-net capacity failure", () => {
  const { topology, problem } = loadSerializedHyperGraph(
    sameNetSharedBottleneckFixture,
  )
  const analysis = analyzePortCapacityMinCut({ topology, problem })

  expect(analysis.demand).toBe(1)
  expect(analysis.maxFlow).toBe(1)
  expect(analysis.minCutPortIds).toHaveLength(0)
})

test("max-flow min-cut sees enough capacity in split bus fixture", () => {
  const { topology, problem } = loadSerializedHyperGraph(busRegionSpanFixture)
  const analysis = analyzePortCapacityMinCut({ topology, problem })

  expect(analysis.demand).toBe(6)
  expect(analysis.maxFlow).toBe(6)
  expect(analysis.minCutPortIds).toHaveLength(0)
})
