import type { GraphicsObject } from "graphics-debug"
import type { TinyHyperGraphSolverView } from "./solver-view"
import { getZLayerLabel } from "./layerLabels"
import type { PortId, RouteId } from "./types"

const PORT_LAYER_COORDINATE_OFFSET = 0.005
const STATIC_REACHABILITY_TRACE_STROKE = "rgba(220, 38, 38, 0.98)"
const STATIC_REACHABILITY_TRACE_FILL = "rgba(220, 38, 38, 0.18)"
const STATIC_REACHABILITY_TRACE_DASH = "8 4"
const STATIC_REACHABILITY_TRACE_RADIUS = 0.12

const formatLabel = (...lines: Array<string | undefined>) =>
  lines.filter((line): line is string => Boolean(line)).join("\n")

export const getStaticallyUnroutableRouteIds = (
  solver: TinyHyperGraphSolverView,
): Set<RouteId> | undefined => {
  const staticallyUnroutableRoutes = solver.getStaticallyUnroutableRoutes()
  if (staticallyUnroutableRoutes.length === 0) {
    return undefined
  }

  return new Set(
    staticallyUnroutableRoutes.map(
      (staticallyUnroutableRoute) => staticallyUnroutableRoute.routeId,
    ),
  )
}

const getPortRenderPoint = (
  solver: TinyHyperGraphSolverView,
  portId: PortId,
) => {
  const layerOffset =
    solver.topology.portZ[portId] * PORT_LAYER_COORDINATE_OFFSET

  return {
    x: solver.topology.portX[portId] + layerOffset,
    y: solver.topology.portY[portId] + layerOffset,
  }
}

const getPortVisualizationLayer = (
  solver: TinyHyperGraphSolverView,
  portId: PortId,
): string => getZLayerLabel([solver.topology.portZ[portId]]) ?? "z0"

const getPortIdentifierLabel = (
  solver: TinyHyperGraphSolverView,
  portId: PortId,
): string => {
  const metadata = solver.topology.portMetadata?.[portId]
  const rawPortId = metadata?.serializedPortId ?? metadata?.portId

  return `port: ${rawPortId ?? `port-${portId}`}`
}

const getPortZLabel = (
  solver: TinyHyperGraphSolverView,
  portId: PortId,
): string => `z: ${solver.topology.portZ[portId]}`

const getPortPairZLabel = (
  solver: TinyHyperGraphSolverView,
  port1Id: PortId,
  port2Id: PortId,
): string => {
  const startZ = solver.topology.portZ[port1Id]
  const endZ = solver.topology.portZ[port2Id]

  return startZ === endZ ? `z: ${startZ}` : `z: ${startZ} -> ${endZ}`
}

const getRouteEndpointZLabel = (
  solver: TinyHyperGraphSolverView,
  routeId: RouteId,
): string =>
  getPortPairZLabel(
    solver,
    solver.problem.routeStartPort[routeId],
    solver.problem.routeEndPort[routeId],
  )

const getRouteNetLabel = (
  solver: TinyHyperGraphSolverView,
  routeId: RouteId,
): string => `net: ${solver.problem.routeNet[routeId]}`

export const visualizeStaticReachabilityFailure = (
  solver: TinyHyperGraphSolverView,
  graphics: Required<GraphicsObject>,
) => {
  for (const staticallyUnroutableRoute of solver.getStaticallyUnroutableRoutes()) {
    const { routeId, connectionId, startPortId, endPortId } =
      staticallyUnroutableRoute
    const startPoint = getPortRenderPoint(solver, startPortId)
    const endPoint = getPortRenderPoint(solver, endPortId)
    const routeLabel = formatLabel(
      `static reachability failed: ${connectionId}`,
      getRouteNetLabel(solver, routeId),
      staticallyUnroutableRoute.startRegionId
        ? `startRegionId: ${staticallyUnroutableRoute.startRegionId}`
        : undefined,
      staticallyUnroutableRoute.endRegionId
        ? `endRegionId: ${staticallyUnroutableRoute.endRegionId}`
        : undefined,
      staticallyUnroutableRoute.pointIds.length >= 2
        ? `points: ${staticallyUnroutableRoute.pointIds.join(" -> ")}`
        : undefined,
      getRouteEndpointZLabel(solver, routeId),
    )

    graphics.lines.push({
      points: [startPoint, endPoint],
      strokeColor: STATIC_REACHABILITY_TRACE_STROKE,
      strokeDash: STATIC_REACHABILITY_TRACE_DASH,
      label: routeLabel,
    })

    graphics.circles.push({
      center: startPoint,
      radius: STATIC_REACHABILITY_TRACE_RADIUS,
      fill: STATIC_REACHABILITY_TRACE_FILL,
      stroke: STATIC_REACHABILITY_TRACE_STROKE,
      layer: getPortVisualizationLayer(solver, startPortId),
      label: formatLabel(
        routeLabel,
        "endpoint: start",
        getPortIdentifierLabel(solver, startPortId),
        getPortZLabel(solver, startPortId),
      ),
    })

    graphics.circles.push({
      center: endPoint,
      radius: STATIC_REACHABILITY_TRACE_RADIUS,
      fill: STATIC_REACHABILITY_TRACE_FILL,
      stroke: STATIC_REACHABILITY_TRACE_STROKE,
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
