import { expect, test } from "bun:test"
import type { Candidate } from "lib2/domain"
import { createEmptyCache, MutableRegionCache } from "lib2/region-cache"
import { computeRouteG } from "lib2/route-cost"
import {
  readSegmentGeometry,
  SegmentGeometryTopologyError,
  type SegmentGeometry,
} from "lib2/segment-geometry"

const currentCandidate: Candidate = {
  nextRegionId: 0,
  portId: 0,
  g: 7,
  h: 0,
  f: 7,
}

const baseGeometry: SegmentGeometry = {
  lesserAngle: 1000,
  greaterAngle: 7000,
  layerMask: 1,
  entryExitLayerChanges: 0,
}

const crossingGeometry: SegmentGeometry = {
  lesserAngle: 3000,
  greaterAngle: 9000,
  layerMask: 1,
  entryExitLayerChanges: 0,
}

test("computeRouteG rejects same-layer crossings in known single-layer regions", () => {
  const cache = MutableRegionCache.from(createEmptyCache())
  const delta = cache.countDelta(1, baseGeometry)
  cache.append(1, baseGeometry, delta, () => 0)

  const routeCost = computeRouteG({
    currentCandidate,
    neighborPortId: 1,
    routeNetId: 2,
    regionCache: cache,
    regionCongestionCost: 3,
    portPenalty: 5,
    segmentGeometry: crossingGeometry,
    isKnownSingleLayerRegion: true,
    computeRegionCost: () => 0,
  })

  expect(routeCost).toBe(Number.POSITIVE_INFINITY)
})

test("computeRouteG adds region cost delta, congestion, and port penalty", () => {
  const cache = MutableRegionCache.from(createEmptyCache())
  const delta = cache.countDelta(1, baseGeometry)
  cache.append(1, baseGeometry, delta, () => 0)

  const routeCost = computeRouteG({
    currentCandidate,
    neighborPortId: 1,
    routeNetId: 2,
    regionCache: cache,
    regionCongestionCost: 3,
    portPenalty: 5,
    segmentGeometry: crossingGeometry,
    isKnownSingleLayerRegion: false,
    computeRegionCost: (sameLayerIntersections) => sameLayerIntersections * 11,
  })

  expect(routeCost).toBe(26)
})

test("readSegmentGeometry rejects ports outside the requested region", () => {
  const topology = {
    portCount: 2,
    regionCount: 2,
    regionIncidentPorts: [[0], [1]],
    incidentPortRegion: [[0], [1]],
    regionWidth: new Float64Array([1, 1]),
    regionHeight: new Float64Array([1, 1]),
    regionCenterX: new Float64Array([0, 1]),
    regionCenterY: new Float64Array([0, 0]),
    portAngleForRegion1: new Int32Array([0, 9000]),
    portX: new Float64Array([0, 1]),
    portY: new Float64Array([0, 0]),
    portZ: new Int32Array([0, 0]),
  }

  expect(() =>
    readSegmentGeometry(
      topology,
      0,
      0,
      1,
      {
        lesserAngle: 0,
        greaterAngle: 0,
        layerMask: 0,
        entryExitLayerChanges: 0,
      },
    ),
  ).toThrow(SegmentGeometryTopologyError)
})
