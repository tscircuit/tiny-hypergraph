import type { GraphicsObject } from "graphics-debug"
import type { TinyHyperGraphSolver } from "./index"
import type { PortId, RegionId, RouteId } from "./types"

const BOTTOM_LAYER_TRACE_COLOR = "rgba(52, 152, 219, 0.95)"
const BOTTOM_LAYER_TRACE_DASH = "3 2"
const PORT_LAYER_CIRCLE_OFFSET = 0.01

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
  const regionCost =
    solver.state.regionIntersectionCaches[regionId]?.existingRegionCost ?? 0
  const congestionCost = solver.state.regionCongestionCost[regionId] ?? 0

  return `region-${regionId}\ncost: ${(regionCost + congestionCost).toFixed(3)}\ncongestion: ${congestionCost.toFixed(3)}`
}

const getPortPoint = (solver: TinyHyperGraphSolver, portId: PortId) => ({
  x: solver.topology.portX[portId],
  y: solver.topology.portY[portId],
})

const getPortCircleCenter = (solver: TinyHyperGraphSolver, portId: PortId) => {
  const portPoint = getPortPoint(solver, portId)
  const layerOffset = solver.topology.portZ[portId] * PORT_LAYER_CIRCLE_OFFSET

  return {
    x: portPoint.x + layerOffset,
    y: portPoint.y + layerOffset,
  }
}

const getPortLabel = (solver: TinyHyperGraphSolver, portId: PortId): string => {
  const r1 = solver.topology.incidentPortRegion[portId]?.[0]
  const r2 = solver.topology.incidentPortRegion[portId]?.[1]

  return `connects region-${r1 ?? "?"} <-> region-${r2 ?? "?"}`
}

const getPortZLabel = (solver: TinyHyperGraphSolver, portId: PortId): string =>
  `z: ${solver.topology.portZ[portId]}`

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
      strokeDash: "2 2",
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
        points: [getPortPoint(solver, port1Id), getPortPoint(solver, port2Id)],
        label: `${getRouteLabel(solver, routeId)} @ region-${regionId}`,
        ...getSegmentStyle(solver, routeId, port1Id, port2Id),
      })
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
    const startPoint = getPortPoint(solver, startPortId)
    const endPoint = getPortPoint(solver, endPortId)
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
    const startPoint = getPortPoint(solver, startPortId)
    const endPoint = getPortPoint(solver, endPortId)
    const routeColor = getRouteColor(solver, routeId)
    const routeLabel = getRouteLabel(solver, routeId)
    const routeNetLabel = getRouteNetLabel(solver, routeId)

    graphics.points.push({
      x: startPoint.x - 0.1,
      y: startPoint.y + 0.1,
      color: routeColor,
      label: `${routeLabel}\n${routeNetLabel}\nstart\n${getPortZLabel(solver, startPortId)}`,
    })

    graphics.points.push({
      x: endPoint.x - 0.1,
      y: endPoint.y + 0.1,
      color: routeColor,
      label: `${routeLabel}\n${routeNetLabel}\nend\n${getPortZLabel(solver, endPortId)}`,
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
  const startPoint = getPortPoint(solver, startPortId)
  const endPoint = getPortPoint(solver, endPortId)
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
  const candidates = solver.state.candidates.slice(-10).reverse()

  for (
    let candidateIndex = 0;
    candidateIndex < candidates.length;
    candidateIndex++
  ) {
    const candidate = candidates[candidateIndex]
    const portPoint = getPortPoint(solver, candidate.portId)
    const isNext = candidateIndex === 0

    graphics.points.push({
      x: portPoint.x,
      y: portPoint.y,
      color: isNext ? "green" : "rgba(128, 128, 128, 0.25)",
      label: [
        getPortLabel(solver, candidate.portId),
        `g: ${candidate.g.toFixed(2)}`,
        `h: ${candidate.h.toFixed(2)}`,
        `f: ${candidate.f.toFixed(2)}`,
      ].join("\n"),
    })
  }

  const nextCandidate = candidates[0]
  if (!nextCandidate) return

  const routeId = solver.state.currentRouteId
  const activePath: { x: number; y: number }[] = []
  let cursor: typeof nextCandidate | undefined = nextCandidate

  while (cursor) {
    activePath.unshift(getPortPoint(solver, cursor.portId))
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

    let fill = "rgba(200, 200, 255, 0.1)"
    if (regionMetadata?.isConnectionRegion) {
      fill = "rgba(255, 100, 255, 0.6)"
    } else if (regionMetadata?.isThroughJumper) {
      fill = "rgba(100, 200, 100, 0.5)"
    } else if (regionMetadata?.isPad) {
      fill = "rgba(255, 200, 100, 0.5)"
    } else if (regionMetadata?.layer === "bottom") {
      fill = "rgba(52, 152, 219, 0.08)"
    }

    if (Array.isArray(polygon) && polygon.length >= 3) {
      graphics.polygons.push({ points: polygon, fill })
    } else {
      graphics.rects.push({
        center,
        width: Math.max(width - 0.1, 0.05),
        height: Math.max(height - 0.1, 0.05),
        fill,
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
      const portPoint = getPortPoint(solver, portId)

      graphics.circles.push({
        center: getPortCircleCenter(solver, portId),
        radius: 0.05,
        fill:
          solver.topology.portZ[portId] > 0
            ? "rgba(52, 152, 219, 0.55)"
            : "rgba(128, 128, 128, 0.5)",
        label: getPortLabel(solver, portId),
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
