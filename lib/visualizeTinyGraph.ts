import type { GraphicsObject } from "graphics-debug"
import type { TinyHyperGraphSolver } from "./index"
import { getAvailableZFromMask, getZLayerLabel } from "./layerLabels"
import type { PortId, RegionId, RouteId } from "./types"

const BOTTOM_LAYER_TRACE_COLOR = "rgba(52, 152, 219, 0.95)"
const BOTTOM_LAYER_TRACE_DASH = "3 2"
const TRANSITION_CROSSING_COLOR = "rgba(22, 160, 133, 0.95)"
const TRANSITION_CROSSING_DASH = "2 4 2"
const REGION_RECT_GAP = 0.05
const PORT_LAYER_COORDINATE_OFFSET = 0.005
const HOT_REGION_FILL = { r: 255, g: 64, b: 64, a: 0.72 }
const NEVER_ROUTED_ENDPOINT_STROKE = "rgba(220, 38, 38, 0.98)"
const NEVER_ROUTED_ENDPOINT_FILL = "rgba(220, 38, 38, 0.12)"
const NEVER_ROUTED_ENDPOINT_RADIUS = 1
const NEVER_ROUTED_ENDPOINT_DASH = "10 6"
const NON_CENTER_BUS_TRACE_OPACITY = 0.5

type RgbaColor = {
  r: number
  g: number
  b: number
  a: number
}

export interface TinyHyperGraphVisualizationOptions {
  highlightSectionMask?: boolean
  sectionPortMask?: Int8Array
  showInitialRouteHints?: boolean
  showOnlySectionPortsOnIdle?: boolean
}

const formatLabel = (...lines: Array<string | undefined>) =>
  lines.filter((line): line is string => Boolean(line)).join("\n")

const clamp01 = (value: number) => Math.min(1, Math.max(0, value))

const mixColorChannel = (from: number, to: number, amount: number) =>
  Math.round(from + (to - from) * amount)

const mixColor = (base: RgbaColor, overlay: RgbaColor, amount: number) => ({
  r: mixColorChannel(base.r, overlay.r, amount),
  g: mixColorChannel(base.g, overlay.g, amount),
  b: mixColorChannel(base.b, overlay.b, amount),
  a: Number((base.a + (overlay.a - base.a) * amount).toFixed(3)),
})

const toRgbaString = ({ r, g, b, a }: RgbaColor) =>
  `rgba(${r}, ${g}, ${b}, ${a})`

const getRouteLabel = (
  solver: TinyHyperGraphSolver,
  routeId: RouteId,
): string => {
  const routeMetadata = solver.problem.routeMetadata?.[routeId]
  return (
    routeMetadata?.connectionId ??
    routeMetadata?.mutuallyConnectedNetworkId ??
    `route-${routeId}`
  )
}

const getRouteColor = (
  solver: TinyHyperGraphSolver,
  routeId: RouteId,
  alpha = 0.8,
): string => {
  const routeNet = solver.problem.routeNet[routeId]
  const routeLabel = getRouteLabel(solver, routeId)
  const hashSource = `${routeNet}:${routeLabel}`

  let hash = 0
  for (let i = 0; i < hashSource.length; i++) {
    hash = hashSource.charCodeAt(i) * 17777 + ((hash << 5) - hash)
  }

  const hue = Math.abs(hash) % 360
  return `hsla(${hue}, 70%, 50%, ${alpha})`
}

const isBusVisualizationSolver = (
  solver: TinyHyperGraphSolver,
): solver is TinyHyperGraphSolver & { centerRouteId: RouteId } =>
  typeof (solver as { centerRouteId?: RouteId }).centerRouteId === "number"

const shouldShowBusUnassignedPorts = (
  solver: TinyHyperGraphSolver,
): solver is TinyHyperGraphSolver & {
  centerRouteId: RouteId
  showUnassignedPortsInVisualization: boolean
} =>
  isBusVisualizationSolver(solver) &&
  (solver as { showUnassignedPortsInVisualization?: boolean })
    .showUnassignedPortsInVisualization === true

const getRouteOpacity = (
  solver: TinyHyperGraphSolver,
  routeId: RouteId,
): number => {
  if (!isBusVisualizationSolver(solver)) {
    return 1
  }

  return routeId === solver.centerRouteId ? 1 : NON_CENTER_BUS_TRACE_OPACITY
}

const scaleColorAlpha = (color: string, opacity: number): string => {
  const alphaMatch = color.match(/^(rgba|hsla)\((.*),\s*([0-9]*\.?[0-9]+)\)$/)
  if (!alphaMatch) {
    return color
  }

  const [, colorFn, body, alphaText] = alphaMatch
  const scaledAlpha = clamp01(Number(alphaText) * opacity)
  return `${colorFn}(${body}, ${Number(scaledAlpha.toFixed(3))})`
}

const getRenderedRouteColor = (
  solver: TinyHyperGraphSolver,
  routeId: RouteId,
  alpha = 0.8,
) => getRouteColor(solver, routeId, alpha * getRouteOpacity(solver, routeId))

const getRouteNetLabel = (
  solver: TinyHyperGraphSolver,
  routeId: RouteId,
): string => `net: ${solver.problem.routeNet[routeId]}`

const getRegionBounds = (solver: TinyHyperGraphSolver, regionId: RegionId) => {
  const regionMetadata = solver.topology.regionMetadata?.[regionId]
  const polygon = regionMetadata?.polygon
  if (Array.isArray(polygon) && polygon.length >= 3) {
    const xs = polygon.map((point: { x: number; y: number }) => point.x)
    const ys = polygon.map((point: { x: number; y: number }) => point.y)
    return {
      minX: Math.min(...xs),
      maxX: Math.max(...xs),
      minY: Math.min(...ys),
      maxY: Math.max(...ys),
    }
  }

  const metadataBounds = regionMetadata?.bounds
  if (
    metadataBounds &&
    typeof metadataBounds.minX === "number" &&
    typeof metadataBounds.maxX === "number" &&
    typeof metadataBounds.minY === "number" &&
    typeof metadataBounds.maxY === "number"
  ) {
    return metadataBounds
  }

  const width = solver.topology.regionWidth[regionId]
  const height = solver.topology.regionHeight[regionId]
  const centerX = solver.topology.regionCenterX[regionId]
  const centerY = solver.topology.regionCenterY[regionId]

  return {
    minX: centerX - width / 2,
    maxX: centerX + width / 2,
    minY: centerY - height / 2,
    maxY: centerY + height / 2,
  }
}

const getRegionCenter = (solver: TinyHyperGraphSolver, regionId: RegionId) => ({
  x: solver.topology.regionCenterX[regionId],
  y: solver.topology.regionCenterY[regionId],
})

const getRegionVisualizationLayer = (
  solver: TinyHyperGraphSolver,
  regionId: RegionId,
): string => {
  const regionMetadata = solver.topology.regionMetadata?.[regionId]
  const metadataAvailableZ = Array.isArray(regionMetadata?.availableZ)
    ? regionMetadata.availableZ.filter(
        (layer: unknown): layer is number =>
          typeof layer === "number" && Number.isInteger(layer) && layer >= 0,
      )
    : []

  if (metadataAvailableZ.length > 0) {
    return getZLayerLabel(metadataAvailableZ) ?? "z0"
  }

  const maskLayers = getAvailableZFromMask(
    solver.topology.regionAvailableZMask?.[regionId] ?? 0,
  )

  if (maskLayers.length > 0) {
    return getZLayerLabel(maskLayers) ?? "z0"
  }

  const incidentPortLayers = [
    ...new Set(
      (solver.topology.regionIncidentPorts[regionId] ?? []).map(
        (portId) => solver.topology.portZ[portId],
      ),
    ),
  ].sort((left, right) => left - right)

  return getZLayerLabel(incidentPortLayers) ?? "z0"
}

const getRegionCostLabel = (
  solver: TinyHyperGraphSolver,
  regionId: RegionId,
): string => {
  const regionCache = solver.state.regionIntersectionCaches[regionId]
  const regionCost = regionCache?.existingRegionCost ?? 0
  const congestionCost = solver.state.regionCongestionCost[regionId] ?? 0
  const regionNetId = solver.problem.regionNetId[regionId]
  const regionNetLabel = regionNetId === -1 ? "free" : `${regionNetId}`

  return formatLabel(
    `region: region-${regionId}`,
    `net: ${regionNetLabel}`,
    solver.getAdditionalRegionLabel(regionId),
    `cost: ${regionCost.toFixed(3)}`,
    `congestion: ${congestionCost.toFixed(3)}`,
    `same layer X: ${regionCache?.existingSameLayerIntersections ?? 0}`,
    `trans X: ${regionCache?.existingCrossingLayerIntersections ?? 0}`,
    `entry exit X: ${regionCache?.existingEntryExitLayerChanges ?? 0}`,
  )
}

const getBaseRegionFillColor = (
  solver: TinyHyperGraphSolver,
  regionId: RegionId,
): RgbaColor => {
  const regionMetadata = solver.topology.regionMetadata?.[regionId]

  if (regionMetadata?.isConnectionRegion) {
    return { r: 255, g: 100, b: 255, a: 0.6 }
  }

  if (regionMetadata?.isThroughJumper) {
    return { r: 100, g: 200, b: 100, a: 0.5 }
  }

  if (regionMetadata?.isPad) {
    return { r: 255, g: 200, b: 100, a: 0.5 }
  }

  if (regionMetadata?.layer === "bottom") {
    return { r: 52, g: 152, b: 219, a: 0.08 }
  }

  return { r: 200, g: 200, b: 255, a: 0.1 }
}

const getRegionRectFill = (
  solver: TinyHyperGraphSolver,
  regionId: RegionId,
): string => {
  const baseFill = getBaseRegionFillColor(solver, regionId)
  const cost = clamp01(
    solver.state.regionIntersectionCaches[regionId]?.existingRegionCost ?? 0,
  )
  const redness = Math.pow(cost, 0.8)

  return toRgbaString(mixColor(baseFill, HOT_REGION_FILL, redness))
}

const getPortPoint = (solver: TinyHyperGraphSolver, portId: PortId) => ({
  x: solver.topology.portX[portId],
  y: solver.topology.portY[portId],
})

const getPortRenderPoint = (
  solver: TinyHyperGraphSolver,
  portId: PortId,
) => {
  const portPoint = getPortPoint(solver, portId)
  const layerOffset =
    solver.topology.portZ[portId] * PORT_LAYER_COORDINATE_OFFSET

  return {
    x: portPoint.x + layerOffset,
    y: portPoint.y + layerOffset,
  }
}

const getPortCircleCenter = getPortRenderPoint

const getPortVisualizationLayer = (
  solver: TinyHyperGraphSolver,
  portId: PortId,
): string => getZLayerLabel([solver.topology.portZ[portId]]) ?? "z0"

const getPortIdentifierLabel = (
  solver: TinyHyperGraphSolver,
  portId: PortId,
): string => {
  const metadata = solver.topology.portMetadata?.[portId]
  const rawPortId = metadata?.serializedPortId ?? metadata?.portId

  return `port: ${rawPortId ?? `port-${portId}`}`
}

const getPortConnectionLabel = (
  solver: TinyHyperGraphSolver,
  portId: PortId,
): string => {
  const r1 = solver.topology.incidentPortRegion[portId]?.[0]
  const r2 = solver.topology.incidentPortRegion[portId]?.[1]

  return `connects: region-${r1 ?? "?"} <-> region-${r2 ?? "?"}`
}

const getPortNetLabel = (
  solver: TinyHyperGraphSolver,
  portId: PortId,
  routeId?: RouteId,
): string | undefined => {
  if (routeId !== undefined) {
    return `net: ${solver.problem.routeNet[routeId]}`
  }

  const assignedNetId = solver.state.portAssignment[portId]
  if (assignedNetId >= 0) {
    return `net: ${assignedNetId}`
  }

  const netIds = new Set<number>()
  for (
    let candidateRouteId = 0;
    candidateRouteId < solver.problem.routeCount;
    candidateRouteId++
  ) {
    if (
      solver.problem.routeStartPort[candidateRouteId] === portId ||
      solver.problem.routeEndPort[candidateRouteId] === portId
    ) {
      netIds.add(solver.problem.routeNet[candidateRouteId])
    }
  }

  if (netIds.size === 0) {
    return undefined
  }

  return `net: ${Array.from(netIds)
    .sort((a, b) => a - b)
    .join(", ")}`
}

const getPortZLabel = (solver: TinyHyperGraphSolver, portId: PortId): string =>
  `z: ${solver.topology.portZ[portId]}`

const getPortPairZLabel = (
  solver: TinyHyperGraphSolver,
  port1Id: PortId,
  port2Id: PortId,
): string => {
  const startZ = solver.topology.portZ[port1Id]
  const endZ = solver.topology.portZ[port2Id]

  return startZ === endZ ? `z: ${startZ}` : `z: ${startZ} -> ${endZ}`
}

const getRouteEndpointZLabel = (
  solver: TinyHyperGraphSolver,
  routeId: RouteId,
): string =>
  getPortPairZLabel(
    solver,
    solver.problem.routeStartPort[routeId],
    solver.problem.routeEndPort[routeId],
  )

const getPortLabel = (
  solver: TinyHyperGraphSolver,
  portId: PortId,
  routeId?: RouteId,
): string =>
  formatLabel(
    getPortIdentifierLabel(solver, portId),
    getPortConnectionLabel(solver, portId),
    getPortNetLabel(solver, portId, routeId),
  )

const getHighlightedSectionPortMask = (
  solver: TinyHyperGraphSolver,
  options?: TinyHyperGraphVisualizationOptions,
) => {
  if (!options?.highlightSectionMask) {
    return undefined
  }

  const sectionPortMask =
    options.sectionPortMask ?? solver.problem.portSectionMask
  if (sectionPortMask.length !== solver.topology.portCount) {
    return undefined
  }

  let sectionPortCount = 0
  let outsideSectionPortCount = 0

  for (let portId = 0; portId < sectionPortMask.length; portId++) {
    if (sectionPortMask[portId] === 1) {
      sectionPortCount += 1
    } else {
      outsideSectionPortCount += 1
    }
  }

  if (sectionPortCount === 0 || outsideSectionPortCount === 0) {
    return undefined
  }

  return sectionPortMask
}

const getSectionRegionIds = (
  solver: TinyHyperGraphSolver,
  sectionPortMask: Int8Array,
) => {
  const sectionRegionIds = new Set<RegionId>()

  for (let portId = 0; portId < sectionPortMask.length; portId++) {
    if (sectionPortMask[portId] !== 1) continue

    for (const regionId of solver.topology.incidentPortRegion[portId] ?? []) {
      sectionRegionIds.add(regionId)
    }
  }

  return sectionRegionIds
}

const getSegmentStyle = (
  solver: TinyHyperGraphSolver,
  routeId: RouteId,
  port1Id: PortId,
  port2Id: PortId,
): { strokeColor: string; strokeDash?: string } => {
  const z1 = solver.topology.portZ[port1Id]
  const z2 = solver.topology.portZ[port2Id]

  if (z1 !== z2) {
    return {
      strokeColor: scaleColorAlpha(
        TRANSITION_CROSSING_COLOR,
        getRouteOpacity(solver, routeId),
      ),
      strokeDash: TRANSITION_CROSSING_DASH,
    }
  }

  if (z1 > 0) {
    return {
      strokeColor: scaleColorAlpha(
        BOTTOM_LAYER_TRACE_COLOR,
        getRouteOpacity(solver, routeId),
      ),
      strokeDash: BOTTOM_LAYER_TRACE_DASH,
    }
  }

  return {
    strokeColor: getRenderedRouteColor(solver, routeId),
  }
}

const pushSolvedRegionSegments = (
  solver: TinyHyperGraphSolver,
  graphics: Required<GraphicsObject>,
) => {
  for (
    let regionId = 0;
    regionId < solver.state.regionSegments.length;
    regionId++
  ) {
    const regionSegments = solver.state.regionSegments[regionId] ?? []

    for (const [routeId, port1Id, port2Id] of regionSegments) {
      graphics.lines.push({
        points: [
          getPortRenderPoint(solver, port1Id),
          getPortRenderPoint(solver, port2Id),
        ],
        label: formatLabel(
          `route: ${getRouteLabel(solver, routeId)}`,
          `region: region-${regionId}`,
          getPortPairZLabel(solver, port1Id, port2Id),
        ),
        ...getSegmentStyle(solver, routeId, port1Id, port2Id),
      })
    }
  }
}

const pushRoutePortZPoints = (
  solver: TinyHyperGraphSolver,
  graphics: Required<GraphicsObject>,
) => {
  const seenRoutePorts = new Set<string>()

  for (
    let regionId = 0;
    regionId < solver.state.regionSegments.length;
    regionId++
  ) {
    const regionSegments = solver.state.regionSegments[regionId] ?? []

    for (const [routeId, port1Id, port2Id] of regionSegments) {
      for (const portId of [port1Id, port2Id]) {
        const key = `${routeId}:${portId}`
        if (seenRoutePorts.has(key)) continue
        seenRoutePorts.add(key)

        const portPoint = getPortRenderPoint(solver, portId)
        graphics.points.push({
          x: portPoint.x,
          y: portPoint.y,
          color: getRenderedRouteColor(solver, routeId, 1),
          layer: getPortVisualizationLayer(solver, portId),
          label: formatLabel(
            `route: ${getRouteLabel(solver, routeId)}`,
            getPortIdentifierLabel(solver, portId),
            getPortNetLabel(solver, portId, routeId),
            getPortZLabel(solver, portId),
          ),
        })
      }
    }
  }
}

const isRouteEndpointPort = (solver: TinyHyperGraphSolver, portId: PortId) => {
  for (let routeId = 0; routeId < solver.problem.routeCount; routeId++) {
    if (
      solver.problem.routeStartPort[routeId] === portId ||
      solver.problem.routeEndPort[routeId] === portId
    ) {
      return true
    }
  }

  return false
}

const pushUnassignedPortCircles = (
  solver: TinyHyperGraphSolver,
  graphics: Required<GraphicsObject>,
) => {
  for (let portId = 0; portId < solver.topology.portCount; portId++) {
    if (
      solver.state.portAssignment[portId] >= 0 ||
      isRouteEndpointPort(solver, portId)
    ) {
      continue
    }

    graphics.circles.push({
      center: getPortCircleCenter(solver, portId),
      radius: 0.04,
      fill:
        solver.topology.portZ[portId] > 0
          ? "rgba(52, 152, 219, 0.2)"
          : "rgba(128, 128, 128, 0.2)",
      stroke:
        solver.topology.portZ[portId] > 0
          ? "rgba(52, 152, 219, 0.6)"
          : "rgba(128, 128, 128, 0.6)",
      layer: getPortVisualizationLayer(solver, portId),
      label: formatLabel(
        getPortLabel(solver, portId),
        getPortZLabel(solver, portId),
        "state: unassigned",
      ),
    })
  }
}

const pushInitialRouteHints = (
  solver: TinyHyperGraphSolver,
  graphics: Required<GraphicsObject>,
) => {
  for (let routeId = 0; routeId < solver.problem.routeCount; routeId++) {
    const startPortId = solver.problem.routeStartPort[routeId]
    const endPortId = solver.problem.routeEndPort[routeId]
    const startPoint = getPortRenderPoint(solver, startPortId)
    const endPoint = getPortRenderPoint(solver, endPortId)
    const midPoint = {
      x: (startPoint.x + endPoint.x) / 2,
      y: (startPoint.y + endPoint.y) / 2,
    }

    graphics.lines.push({
      points: [startPoint, endPoint],
      strokeColor: getRenderedRouteColor(solver, routeId),
      strokeDash: "3 3",
      label: formatLabel(
        getRouteLabel(solver, routeId),
        getRouteEndpointZLabel(solver, routeId),
      ),
    })

    graphics.points.push({
      x: midPoint.x,
      y: midPoint.y,
      color: getRenderedRouteColor(solver, routeId, 1),
      label: formatLabel(
        getRouteLabel(solver, routeId),
        getRouteEndpointZLabel(solver, routeId),
      ),
    })
  }
}

const pushRouteEndpoints = (
  solver: TinyHyperGraphSolver,
  graphics: Required<GraphicsObject>,
) => {
  for (let routeId = 0; routeId < solver.problem.routeCount; routeId++) {
    const startPortId = solver.problem.routeStartPort[routeId]
    const endPortId = solver.problem.routeEndPort[routeId]
    const startPoint = getPortRenderPoint(solver, startPortId)
    const endPoint = getPortRenderPoint(solver, endPortId)
    const routeColor = getRenderedRouteColor(solver, routeId)
    const routeLabel = getRouteLabel(solver, routeId)
    const routeNetLabel = getRouteNetLabel(solver, routeId)

    graphics.points.push({
      x: startPoint.x,
      y: startPoint.y,
      color: routeColor,
      layer: getPortVisualizationLayer(solver, startPortId),
      label: formatLabel(
        `route: ${routeLabel}`,
        routeNetLabel,
        "endpoint: start",
        getPortIdentifierLabel(solver, startPortId),
        getPortZLabel(solver, startPortId),
      ),
    })

    graphics.points.push({
      x: endPoint.x,
      y: endPoint.y,
      color: routeColor,
      layer: getPortVisualizationLayer(solver, endPortId),
      label: formatLabel(
        `route: ${routeLabel}`,
        routeNetLabel,
        "endpoint: end",
        getPortIdentifierLabel(solver, endPortId),
        getPortZLabel(solver, endPortId),
      ),
    })
  }
}

const pushActiveRoute = (
  solver: TinyHyperGraphSolver,
  graphics: Required<GraphicsObject>,
) => {
  const routeId = solver.state.currentRouteId
  if (routeId === undefined || solver.solved) return

  const startPortId = solver.problem.routeStartPort[routeId]
  const endPortId = solver.problem.routeEndPort[routeId]
  const startPoint = getPortRenderPoint(solver, startPortId)
  const endPoint = getPortRenderPoint(solver, endPortId)
  const routeColor = getRenderedRouteColor(solver, routeId)
  const routeLabel = getRouteLabel(solver, routeId)

  graphics.lines.push({
    points: [startPoint, endPoint],
    strokeColor: routeColor,
    strokeDash: "10 5",
    label: formatLabel(routeLabel, getRouteEndpointZLabel(solver, routeId)),
  })
}

const pushCandidates = (
  solver: TinyHyperGraphSolver,
  graphics: Required<GraphicsObject>,
) => {
  if (solver.solved) return

  const routeId = solver.state.currentRouteId
  const candidates = solver.state.candidateQueue
    .toArray()
    .sort((left, right) => left.f - right.f)
    .slice(0, 10)

  for (
    let candidateIndex = 0;
    candidateIndex < candidates.length;
    candidateIndex++
  ) {
    const candidate = candidates[candidateIndex]
    const portPoint = getPortRenderPoint(solver, candidate.portId)
    const isNext = candidateIndex === 0

    graphics.points.push({
      x: portPoint.x,
      y: portPoint.y,
      color: isNext ? "green" : "rgba(128, 128, 128, 0.25)",
      layer: getPortVisualizationLayer(solver, candidate.portId),
      label: formatLabel(
        getPortLabel(solver, candidate.portId, routeId),
        getPortZLabel(solver, candidate.portId),
        `g: ${candidate.g.toFixed(2)}`,
        `h: ${candidate.h.toFixed(2)}`,
        `f: ${candidate.f.toFixed(2)}`,
      ),
    })
  }

  const nextCandidate = candidates[0]
  if (!nextCandidate) return

  const activePath: { x: number; y: number }[] = []
  let cursor: typeof nextCandidate | undefined = nextCandidate

  while (cursor) {
    activePath.unshift(getPortRenderPoint(solver, cursor.portId))
    cursor = cursor.prevCandidate
  }

  if (activePath.length > 1) {
    graphics.lines.push({
      points: activePath,
      strokeColor:
        routeId !== undefined
          ? getRenderedRouteColor(solver, routeId)
          : "rgba(0, 160, 120, 0.9)",
    })
  }
}

const pushSectionMaskOverlay = (
  solver: TinyHyperGraphSolver,
  graphics: Required<GraphicsObject>,
  sectionPortMask: Int8Array,
) => {
  const sectionRegionIds = getSectionRegionIds(solver, sectionPortMask)
  const sectionStroke = "rgba(245, 158, 11, 0.95)"
  const sectionFill = "rgba(245, 158, 11, 0.08)"

  for (const regionId of sectionRegionIds) {
    const regionMetadata = solver.topology.regionMetadata?.[regionId]
    const polygon = regionMetadata?.polygon
    const bounds = getRegionBounds(solver, regionId)
    const center = getRegionCenter(solver, regionId)
    const width = bounds.maxX - bounds.minX
    const height = bounds.maxY - bounds.minY
    const regionLayer = getRegionVisualizationLayer(solver, regionId)
    const label = formatLabel(
      "section region",
      getRegionCostLabel(solver, regionId),
    )

    if (Array.isArray(polygon) && polygon.length >= 3) {
      graphics.polygons.push({
        points: polygon,
        fill: sectionFill,
        stroke: sectionStroke,
        strokeWidth: 2,
        layer: regionLayer,
        label,
      })
    } else {
      graphics.rects.push({
        center,
        width: Math.max(width - REGION_RECT_GAP, 0.05),
        height: Math.max(height - REGION_RECT_GAP, 0.05),
        fill: sectionFill,
        stroke: sectionStroke,
        layer: regionLayer,
        label,
      })
    }
  }

  for (let portId = 0; portId < sectionPortMask.length; portId++) {
    if (sectionPortMask[portId] !== 1) continue

    graphics.circles.push({
      center: getPortCircleCenter(solver, portId),
      radius: 0.07,
      fill: "rgba(251, 191, 36, 0.18)",
      stroke: sectionStroke,
      layer: getPortVisualizationLayer(solver, portId),
      label: formatLabel(
        getPortLabel(solver, portId),
        getPortZLabel(solver, portId),
        "section port",
      ),
    })
  }
}

const pushNeverSuccessfullyRoutedEndpoints = (
  solver: TinyHyperGraphSolver,
  graphics: Required<GraphicsObject>,
) => {
  if (!solver.failed) {
    return
  }

  for (const neverSuccessfullyRoutedRoute of solver.getNeverSuccessfullyRoutedRoutes()) {
    const { routeId, connectionId, attempts, startPortId, endPortId } =
      neverSuccessfullyRoutedRoute
    const routeNetLabel = getRouteNetLabel(solver, routeId)
    const startPoint = getPortCircleCenter(solver, startPortId)
    const endPoint = getPortCircleCenter(solver, endPortId)
    const routeLabel = formatLabel(
      `never routed: ${connectionId}`,
      `attempts: ${attempts}`,
      routeNetLabel,
      neverSuccessfullyRoutedRoute.startRegionId
        ? `startRegionId: ${neverSuccessfullyRoutedRoute.startRegionId}`
        : undefined,
      neverSuccessfullyRoutedRoute.endRegionId
        ? `endRegionId: ${neverSuccessfullyRoutedRoute.endRegionId}`
        : undefined,
    )

    graphics.lines.push({
      points: [
        { x: 0, y: 0 },
        { x: startPoint.x, y: startPoint.y },
      ],
      strokeColor: NEVER_ROUTED_ENDPOINT_STROKE,
      strokeDash: NEVER_ROUTED_ENDPOINT_DASH,
      layer: getPortVisualizationLayer(solver, startPortId),
      label: formatLabel(routeLabel, "origin guide", "endpoint: start"),
    })

    graphics.circles.push({
      center: startPoint,
      radius: NEVER_ROUTED_ENDPOINT_RADIUS,
      fill: NEVER_ROUTED_ENDPOINT_FILL,
      stroke: NEVER_ROUTED_ENDPOINT_STROKE,
      layer: getPortVisualizationLayer(solver, startPortId),
      label: formatLabel(
        routeLabel,
        "endpoint: start",
        getPortIdentifierLabel(solver, startPortId),
        getPortZLabel(solver, startPortId),
      ),
    })

    graphics.lines.push({
      points: [
        { x: 0, y: 0 },
        { x: endPoint.x, y: endPoint.y },
      ],
      strokeColor: NEVER_ROUTED_ENDPOINT_STROKE,
      strokeDash: NEVER_ROUTED_ENDPOINT_DASH,
      layer: getPortVisualizationLayer(solver, endPortId),
      label: formatLabel(routeLabel, "origin guide", "endpoint: end"),
    })

    graphics.circles.push({
      center: endPoint,
      radius: NEVER_ROUTED_ENDPOINT_RADIUS,
      fill: NEVER_ROUTED_ENDPOINT_FILL,
      stroke: NEVER_ROUTED_ENDPOINT_STROKE,
      layer: getPortVisualizationLayer(solver, endPortId),
      label: formatLabel(
        routeLabel,
        "endpoint: end",
        getPortIdentifierLabel(solver, endPortId),
        getPortZLabel(solver, endPortId),
      ),
    })
  }
}

export const visualizeTinyHyperGraph = (
  solver: TinyHyperGraphSolver,
  options: TinyHyperGraphVisualizationOptions = {},
): GraphicsObject => {
  const graphics: Required<GraphicsObject> = {
    arrows: [],
    circles: [],
    infiniteLines: [],
    lines: [],
    points: [],
    polygons: [],
    rects: [],
    texts: [],
    title: "Tiny HyperGraph",
    coordinateSystem: "cartesian",
  }
  const sectionPortMask = getHighlightedSectionPortMask(solver, options)

  for (let regionId = 0; regionId < solver.topology.regionCount; regionId++) {
    const regionMetadata = solver.topology.regionMetadata?.[regionId]
    const polygon = regionMetadata?.polygon
    const bounds = getRegionBounds(solver, regionId)
    const center = getRegionCenter(solver, regionId)
    const width = bounds.maxX - bounds.minX
    const height = bounds.maxY - bounds.minY
    const regionLayer = getRegionVisualizationLayer(solver, regionId)

    const baseFill = toRgbaString(getBaseRegionFillColor(solver, regionId))

    if (Array.isArray(polygon) && polygon.length >= 3) {
      graphics.polygons.push({
        points: polygon,
        fill: baseFill,
        layer: regionLayer,
      })
    } else {
      graphics.rects.push({
        center,
        width: Math.max(width - REGION_RECT_GAP, 0.05),
        height: Math.max(height - REGION_RECT_GAP, 0.05),
        fill: getRegionRectFill(solver, regionId),
        layer: regionLayer,
        label: getRegionCostLabel(solver, regionId),
      })
    }
  }

  pushRouteEndpoints(solver, graphics)

  if (solver.iterations === 0) {
    for (const polygon of graphics.polygons) {
      polygon.stroke = "rgba(128, 128, 128, 0.5)"
    }

    for (const rect of graphics.rects) {
      rect.stroke = "rgba(128, 128, 128, 0.5)"
    }
  }

  if (solver.iterations === 0) {
    for (let portId = 0; portId < solver.topology.portCount; portId++) {
      const isSectionPort = sectionPortMask?.[portId] === 1
      if (options.showOnlySectionPortsOnIdle && !isSectionPort) {
        continue
      }

      graphics.circles.push({
        center: getPortCircleCenter(solver, portId),
        radius: 0.05,
        fill:
          solver.topology.portZ[portId] > 0
            ? "rgba(52, 152, 219, 0.55)"
            : "rgba(128, 128, 128, 0.5)",
        layer: getPortVisualizationLayer(solver, portId),
        label: formatLabel(
          getPortLabel(solver, portId),
          getPortZLabel(solver, portId),
        ),
      })
    }

    if (options.showInitialRouteHints !== false) {
      pushInitialRouteHints(solver, graphics)
    }
  } else {
    pushSolvedRegionSegments(solver, graphics)
    pushRoutePortZPoints(solver, graphics)
    if (shouldShowBusUnassignedPorts(solver)) {
      pushUnassignedPortCircles(solver, graphics)
    }
    if (!isBusVisualizationSolver(solver)) {
      pushActiveRoute(solver, graphics)
      pushCandidates(solver, graphics)
    }
  }

  if (sectionPortMask) {
    pushSectionMaskOverlay(solver, graphics, sectionPortMask)
  }

  pushNeverSuccessfullyRoutedEndpoints(solver, graphics)

  const pendingCount =
    solver.state.unroutedRoutes.length +
    (solver.state.currentRouteId === undefined ? 0 : 1)
  const sectionPortCount = sectionPortMask
    ? sectionPortMask.reduce(
        (count, inSection) => count + Number(inSection === 1),
        0,
      )
    : 0
  graphics.title = [
    "Tiny HyperGraph",
    `iter=${solver.iterations}`,
    `pending=${pendingCount}`,
    sectionPortMask ? `sectionPorts=${sectionPortCount}` : undefined,
    solver.failed ? "failed" : solver.solved ? "solved" : "running",
  ]
    .filter(Boolean)
    .join(" | ")

  return graphics
}

export const visualizeTinyGraph = visualizeTinyHyperGraph
