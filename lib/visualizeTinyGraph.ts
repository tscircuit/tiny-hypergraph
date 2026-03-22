import type { GraphicsObject } from "graphics-debug"
import type { TinyHyperGraphSolver } from "./index"
import type { PortId, RegionId, RouteId } from "./types"

const BOTTOM_LAYER_TRACE_COLOR = "rgba(52, 152, 219, 0.95)"
const BOTTOM_LAYER_TRACE_DASH = "3 2"
const TRANSITION_CROSSING_DASH = "2 4 2"
const PORT_LAYER_CIRCLE_OFFSET = 0.01
const PORT_LAYER_POINT_OFFSET = 0.002
const REGION_RECT_GAP = 0.05
const HOT_REGION_FILL = { r: 255, g: 64, b: 64, a: 0.72 }

type RgbaColor = {
  r: number
  g: number
  b: number
  a: number
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

const getRegionCostLabel = (
  solver: TinyHyperGraphSolver,
  regionId: RegionId,
): string => {
  const regionCache = solver.state.regionIntersectionCaches[regionId]
  const regionCost = getRegionDisplayCost(solver, regionId)
  const congestionCost = solver.state.regionCongestionCost[regionId] ?? 0

  return formatLabel(
    `region: region-${regionId}`,
    `cost: ${regionCost.toFixed(3)}`,
    `congestion: ${congestionCost.toFixed(3)}`,
    `same layer X: ${regionCache?.existingSameLayerIntersections ?? 0}`,
    `trans X: ${regionCache?.existingCrossingLayerIntersections ?? 0}`,
    `entry exit X: ${regionCache?.existingEntryExitLayerChanges ?? 0}`,
  )
}

const getRegionDisplayCost = (
  solver: TinyHyperGraphSolver,
  regionId: RegionId,
): number =>
  (solver.state.regionIntersectionCaches[regionId]?.existingRegionCost ?? 0) +
  (solver.state.regionCongestionCost[regionId] ?? 0)

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
  const cost = clamp01(getRegionDisplayCost(solver, regionId))
  const redness = Math.pow(cost, 0.8)

  return toRgbaString(mixColor(baseFill, HOT_REGION_FILL, redness))
}

const getPortPoint = (solver: TinyHyperGraphSolver, portId: PortId) => ({
  x: solver.topology.portX[portId],
  y: solver.topology.portY[portId],
})

const getPortRenderPoint = (solver: TinyHyperGraphSolver, portId: PortId) => {
  const portPoint = getPortPoint(solver, portId)
  const layerOffset = solver.topology.portZ[portId] * PORT_LAYER_POINT_OFFSET

  return {
    x: portPoint.x + layerOffset,
    y: portPoint.y + layerOffset,
  }
}

const getPortCircleCenter = (solver: TinyHyperGraphSolver, portId: PortId) => {
  const portPoint = getPortPoint(solver, portId)
  const layerOffset = solver.topology.portZ[portId] * PORT_LAYER_CIRCLE_OFFSET

  return {
    x: portPoint.x + layerOffset,
    y: portPoint.y + layerOffset,
  }
}

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

  const assignedRouteId = solver.state.portAssignment[portId]
  if (assignedRouteId >= 0) {
    return `net: ${solver.problem.routeNet[assignedRouteId]}`
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

const getSegmentStyle = (
  solver: TinyHyperGraphSolver,
  routeId: RouteId,
  port1Id: PortId,
  port2Id: PortId,
): { strokeColor: string; strokeDash?: string } => {
  const z1 = solver.topology.portZ[port1Id]
  const z2 = solver.topology.portZ[port2Id]

  if (z1 > 0 && z2 > 0) {
    return {
      strokeColor: BOTTOM_LAYER_TRACE_COLOR,
      strokeDash: BOTTOM_LAYER_TRACE_DASH,
    }
  }

  if (z1 !== z2) {
    return {
      strokeColor: "rgba(22, 160, 133, 0.95)",
      strokeDash: TRANSITION_CROSSING_DASH,
    }
  }

  return {
    strokeColor: getRouteColor(solver, routeId),
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
          color: getRouteColor(solver, routeId, 1),
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
      strokeColor: getRouteColor(solver, routeId),
      strokeDash: "3 3",
      label: getRouteLabel(solver, routeId),
    })

    graphics.points.push({
      x: midPoint.x,
      y: midPoint.y,
      color: getRouteColor(solver, routeId, 1),
      label: getRouteLabel(solver, routeId),
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
    const routeColor = getRouteColor(solver, routeId)
    const routeLabel = getRouteLabel(solver, routeId)
    const routeNetLabel = getRouteNetLabel(solver, routeId)

    graphics.points.push({
      x: startPoint.x,
      y: startPoint.y,
      color: routeColor,
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
  const routeColor = getRouteColor(solver, routeId)
  const routeLabel = getRouteLabel(solver, routeId)

  graphics.lines.push({
    points: [startPoint, endPoint],
    strokeColor: routeColor,
    strokeDash: "10 5",
    label: routeLabel,
  })
}

const pushCandidates = (
  solver: TinyHyperGraphSolver,
  graphics: Required<GraphicsObject>,
) => {
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
          ? getRouteColor(solver, routeId)
          : "rgba(0, 160, 120, 0.9)",
    })
  }
}

export const visualizeTinyHyperGraph = (
  solver: TinyHyperGraphSolver,
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

  for (let regionId = 0; regionId < solver.topology.regionCount; regionId++) {
    const regionMetadata = solver.topology.regionMetadata?.[regionId]
    const polygon = regionMetadata?.polygon
    const bounds = getRegionBounds(solver, regionId)
    const center = getRegionCenter(solver, regionId)
    const width = bounds.maxX - bounds.minX
    const height = bounds.maxY - bounds.minY

    const baseFill = toRgbaString(getBaseRegionFillColor(solver, regionId))

    if (Array.isArray(polygon) && polygon.length >= 3) {
      graphics.polygons.push({ points: polygon, fill: baseFill })
    } else {
      graphics.rects.push({
        center,
        width: Math.max(width - REGION_RECT_GAP, 0.05),
        height: Math.max(height - REGION_RECT_GAP, 0.05),
        fill: getRegionRectFill(solver, regionId),
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
      const portPoint = getPortRenderPoint(solver, portId)

      graphics.circles.push({
        center: getPortCircleCenter(solver, portId),
        radius: 0.05,
        fill:
          solver.topology.portZ[portId] > 0
            ? "rgba(52, 152, 219, 0.55)"
            : "rgba(128, 128, 128, 0.5)",
        label: formatLabel(
          getPortLabel(solver, portId),
          getPortZLabel(solver, portId),
        ),
      })

      const [region1Id, region2Id] =
        solver.topology.incidentPortRegion[portId] ?? []
      if (region1Id === undefined || region2Id === undefined) continue

      graphics.lines.push({
        points: [
          getRegionCenter(solver, region1Id),
          portPoint,
          getRegionCenter(solver, region2Id),
        ],
        strokeColor: "rgba(100, 100, 100, 0.3)",
      })
    }

    pushInitialRouteHints(solver, graphics)
  } else {
    pushSolvedRegionSegments(solver, graphics)
    pushRoutePortZPoints(solver, graphics)
    pushActiveRoute(solver, graphics)
    pushCandidates(solver, graphics)
  }

  const pendingCount =
    solver.state.unroutedRoutes.length +
    (solver.state.currentRouteId === undefined ? 0 : 1)
  graphics.title = [
    "Tiny HyperGraph",
    `iter=${solver.iterations}`,
    `pending=${pendingCount}`,
    solver.failed ? "failed" : solver.solved ? "solved" : "running",
  ].join(" | ")

  return graphics
}

export const visualizeTinyGraph = visualizeTinyHyperGraph
