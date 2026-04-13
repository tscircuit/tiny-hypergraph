import type { GraphicsObject } from "graphics-debug"
import { getSerializedRegionId } from "./region-graph"
import type {
  RegionPathCandidate,
  RegionPathSolver,
} from "./region-path-solver"
import type { RegionId, RouteId } from "./types"

const REGION_RECT_GAP = 0.05

const clamp01 = (value: number) => Math.min(1, Math.max(0, value))

const formatLabel = (...lines: Array<string | undefined>) =>
  lines.filter((line): line is string => Boolean(line)).join("\n")

const getRegionBounds = (
  solver: RegionPathSolver,
  regionId: RegionId,
): {
  minX: number
  maxX: number
  minY: number
  maxY: number
} => {
  const regionMetadata = solver.regionGraph.regionMetadata?.[regionId]
  const metadataBounds =
    regionMetadata &&
    typeof regionMetadata === "object" &&
    "bounds" in regionMetadata &&
    regionMetadata.bounds &&
    typeof regionMetadata.bounds === "object"
      ? (regionMetadata.bounds as {
          minX?: unknown
          maxX?: unknown
          minY?: unknown
          maxY?: unknown
        })
      : undefined

  if (
    metadataBounds &&
    typeof metadataBounds.minX === "number" &&
    typeof metadataBounds.maxX === "number" &&
    typeof metadataBounds.minY === "number" &&
    typeof metadataBounds.maxY === "number"
  ) {
    return {
      minX: metadataBounds.minX,
      maxX: metadataBounds.maxX,
      minY: metadataBounds.minY,
      maxY: metadataBounds.maxY,
    }
  }

  const width = solver.regionGraph.regionWidth[regionId]
  const height = solver.regionGraph.regionHeight[regionId]
  const centerX = solver.regionGraph.regionCenterX[regionId]
  const centerY = solver.regionGraph.regionCenterY[regionId]

  return {
    minX: centerX - width / 2,
    maxX: centerX + width / 2,
    minY: centerY - height / 2,
    maxY: centerY + height / 2,
  }
}

const getRegionCenter = (solver: RegionPathSolver, regionId: RegionId) => ({
  x: solver.regionGraph.regionCenterX[regionId],
  y: solver.regionGraph.regionCenterY[regionId],
})

const getRouteLabel = (solver: RegionPathSolver, routeId: RouteId) => {
  const routeMetadata = solver.regionProblem.routeMetadata?.[routeId] as
    | {
        connectionId?: unknown
        mutuallyConnectedNetworkId?: unknown
      }
    | undefined

  return (
    (typeof routeMetadata?.connectionId === "string"
      ? routeMetadata.connectionId
      : undefined) ??
    (typeof routeMetadata?.mutuallyConnectedNetworkId === "string"
      ? routeMetadata.mutuallyConnectedNetworkId
      : undefined) ??
    `route-${routeId}`
  )
}

const getRouteColor = (
  solver: RegionPathSolver,
  routeId: RouteId,
  alpha = 0.8,
) => {
  const routeNet = solver.regionProblem.routeNet[routeId]
  const routeLabel = getRouteLabel(solver, routeId)
  const hashSource = `${routeNet}:${routeLabel}`

  let hash = 0
  for (let i = 0; i < hashSource.length; i++) {
    hash = hashSource.charCodeAt(i) * 17777 + ((hash << 5) - hash)
  }

  const hue = Math.abs(hash) % 360
  return `hsla(${hue}, 70%, 50%, ${alpha})`
}

const getRegionFill = (solver: RegionPathSolver, regionId: RegionId) => {
  const usage = solver.state.regionUsage[regionId]
  const capacity = solver.regionGraph.regionCapacity[regionId]
  const utilization = clamp01(usage / capacity)
  const red = Math.round(216 + (239 - 216) * utilization)
  const green = Math.round(240 - 112 * utilization)
  const blue = Math.round(254 - 180 * utilization)
  const alpha = 0.18 + utilization * 0.55

  return `rgba(${red}, ${green}, ${blue}, ${alpha.toFixed(3)})`
}

const getRegionLabel = (solver: RegionPathSolver, regionId: RegionId) => {
  const usage = solver.state.regionUsage[regionId]
  const capacity = solver.regionGraph.regionCapacity[regionId]
  const utilization = usage / capacity
  const reservedNetId = solver.regionProblem.regionNetId[regionId]
  const assignedRoutes = solver.state.regionAssignedRoutes[regionId]

  return formatLabel(
    `region: ${getSerializedRegionId(solver.regionGraph, regionId)}`,
    `capacity: ${capacity.toFixed(3)}`,
    `usage: ${usage}`,
    `fill: ${(utilization * 100).toFixed(1)}%`,
    `net: ${reservedNetId === -1 ? "free" : reservedNetId.toString()}`,
    assignedRoutes.length > 0
      ? `routes: ${assignedRoutes.map((routeId) => getRouteLabel(solver, routeId)).join(", ")}`
      : undefined,
  )
}

const pushRouteHints = (
  solver: RegionPathSolver,
  graphics: Required<GraphicsObject>,
) => {
  for (let routeId = 0; routeId < solver.regionProblem.routeCount; routeId++) {
    const startRegionId = solver.regionProblem.routeStartRegion[routeId]
    const endRegionId = solver.regionProblem.routeEndRegion[routeId]
    const startPoint = getRegionCenter(solver, startRegionId)
    const endPoint = getRegionCenter(solver, endRegionId)

    graphics.lines.push({
      points: [startPoint, endPoint],
      strokeColor: getRouteColor(solver, routeId, 0.28),
      strokeDash: "4 4",
      label: formatLabel(
        `${getRouteLabel(solver, routeId)} (hint)`,
        `start: ${getSerializedRegionId(solver.regionGraph, startRegionId)}`,
        `end: ${getSerializedRegionId(solver.regionGraph, endRegionId)}`,
      ),
    })
  }
}

const pushSolvedRoutes = (
  solver: RegionPathSolver,
  graphics: Required<GraphicsObject>,
) => {
  solver.state.solvedRouteRegionIds.forEach((regionPath, routeId) => {
    if (regionPath.length < 2) {
      return
    }

    graphics.lines.push({
      points: regionPath.map((regionId) => getRegionCenter(solver, regionId)),
      strokeColor: getRouteColor(solver, routeId, 0.95),
      label: formatLabel(
        `route: ${getRouteLabel(solver, routeId)}`,
        `cost: ${solver.state.solvedRouteCosts[routeId].toFixed(3)}`,
      ),
    })
  })
}

const pushRouteEndpoints = (
  solver: RegionPathSolver,
  graphics: Required<GraphicsObject>,
) => {
  for (let routeId = 0; routeId < solver.regionProblem.routeCount; routeId++) {
    const startRegionId = solver.regionProblem.routeStartRegion[routeId]
    const endRegionId = solver.regionProblem.routeEndRegion[routeId]
    const startPoint = getRegionCenter(solver, startRegionId)
    const endPoint = getRegionCenter(solver, endRegionId)
    const routeColor = getRouteColor(solver, routeId, 1)

    graphics.points.push({
      x: startPoint.x,
      y: startPoint.y,
      color: routeColor,
      label: formatLabel(
        `route: ${getRouteLabel(solver, routeId)}`,
        `endpoint: start`,
        `region: ${getSerializedRegionId(solver.regionGraph, startRegionId)}`,
      ),
    })

    graphics.points.push({
      x: endPoint.x,
      y: endPoint.y,
      color: routeColor,
      label: formatLabel(
        `route: ${getRouteLabel(solver, routeId)}`,
        `endpoint: end`,
        `region: ${getSerializedRegionId(solver.regionGraph, endRegionId)}`,
      ),
    })
  }
}

const pushActiveFrontier = (
  solver: RegionPathSolver,
  graphics: Required<GraphicsObject>,
) => {
  const frontierCandidates = solver.state.candidateQueue
    .toArray()
    .sort((left, right) => left.f - right.f)
    .slice(0, 128)

  frontierCandidates.forEach((candidate: RegionPathCandidate) => {
    const center = getRegionCenter(solver, candidate.regionId)
    graphics.points.push({
      x: center.x,
      y: center.y,
      color: "rgba(245, 158, 11, 0.95)",
      label: formatLabel(
        `frontier: ${getSerializedRegionId(solver.regionGraph, candidate.regionId)}`,
        `g: ${candidate.g.toFixed(3)}`,
        `f: ${candidate.f.toFixed(3)}`,
      ),
    })
  })
}

export const visualizeRegionGraph = (
  solver: RegionPathSolver,
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
    title: "Region Path Graph",
    coordinateSystem: "cartesian",
  }

  for (
    let regionId = 0;
    regionId < solver.regionGraph.regionCount;
    regionId++
  ) {
    const bounds = getRegionBounds(solver, regionId)
    const center = getRegionCenter(solver, regionId)
    graphics.rects.push({
      center,
      width: Math.max(0.05, bounds.maxX - bounds.minX - REGION_RECT_GAP),
      height: Math.max(0.05, bounds.maxY - bounds.minY - REGION_RECT_GAP),
      fill: getRegionFill(solver, regionId),
      stroke:
        solver.state.currentRouteId !== undefined &&
        (solver.regionProblem.routeStartRegion[solver.state.currentRouteId] ===
          regionId ||
          solver.regionProblem.routeEndRegion[solver.state.currentRouteId] ===
            regionId)
          ? "rgba(17, 24, 39, 0.9)"
          : "rgba(148, 163, 184, 0.5)",
      label: getRegionLabel(solver, regionId),
    })
  }

  pushRouteHints(solver, graphics)
  pushSolvedRoutes(solver, graphics)
  pushRouteEndpoints(solver, graphics)

  if (solver.state.currentRouteId !== undefined) {
    pushActiveFrontier(solver, graphics)
  }

  return graphics
}
