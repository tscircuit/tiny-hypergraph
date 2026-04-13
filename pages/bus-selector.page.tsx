import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import type {
  SerializedHyperGraphPortPointPathingSolverInput,
  SerializedHyperGraphPortPointPathingSolverParams,
} from "lib/compat/convertPortPointPathingSolverInputToSerializedHyperGraph"
import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react"

const cm5ioFixtureUrl = new URL(
  "../tests/fixtures/CM5IO_HyperGraph.json",
  import.meta.url,
).href

const MIN_SCALE = 2
const MAX_SCALE = 240
const POINT_HIT_RADIUS_PX = 12

type RectBounds = {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

type ViewState = {
  centerX: number
  centerY: number
  scale: number
}

type RoutePoint = {
  pointId: string
  x: number
  y: number
  layer: string
  pcbPortId?: string
}

type RegionShape = {
  regionId: string
  minX: number
  maxX: number
  minY: number
  maxY: number
  layer?: string
}

type PointNode = {
  pointId: string
  x: number
  y: number
  layer: string
  pcbPortId?: string
  connectionIds: string[]
  componentId: string
}

type PointBuilder = {
  pointId: string
  x: number
  y: number
  layer: string
  pcbPortId?: string
  connectionIds: Set<string>
}

type ConnectionEdge = {
  connectionId: string
  pointIds: string[]
  pathPointIds: string[]
  componentId?: string
}

type Cm5ioConnection =
  SerializedHyperGraphPortPointPathingSolverParams["connections"][number] & {
    simpleRouteConnection?: {
      pointsToConnect?: unknown[]
    }
  }

type ConnectivityComponent = {
  componentId: string
  pointIds: string[]
  connectionIds: string[]
}

type EditorData = {
  bounds: RectBounds
  regions: RegionShape[]
  points: PointNode[]
  pointById: Map<string, PointNode>
  connections: ConnectionEdge[]
  connectionById: Map<string, ConnectionEdge>
  componentById: Map<string, ConnectivityComponent>
}

type SelectionPatch = {
  connectionId: string
  pointIds: string[]
  _bus: {
    id: string
  }
}

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value)

const createEmptyBounds = (): RectBounds => ({
  minX: Number.POSITIVE_INFINITY,
  maxX: Number.NEGATIVE_INFINITY,
  minY: Number.POSITIVE_INFINITY,
  maxY: Number.NEGATIVE_INFINITY,
})

const expandBounds = (bounds: RectBounds, x: number, y: number) => {
  bounds.minX = Math.min(bounds.minX, x)
  bounds.maxX = Math.max(bounds.maxX, x)
  bounds.minY = Math.min(bounds.minY, y)
  bounds.maxY = Math.max(bounds.maxY, y)
}

const finalizeBounds = (bounds: RectBounds, padding = 4): RectBounds => {
  if (
    !Number.isFinite(bounds.minX) ||
    !Number.isFinite(bounds.maxX) ||
    !Number.isFinite(bounds.minY) ||
    !Number.isFinite(bounds.maxY)
  ) {
    return {
      minX: -10,
      maxX: 10,
      minY: -10,
      maxY: 10,
    }
  }

  return {
    minX: bounds.minX - padding,
    maxX: bounds.maxX + padding,
    minY: bounds.minY - padding,
    maxY: bounds.maxY + padding,
  }
}

const getRegionBounds = (
  region: SerializedHyperGraph["regions"][number],
): RectBounds | undefined => {
  const bounds = region.d?.bounds
  if (
    bounds &&
    isFiniteNumber(bounds.minX) &&
    isFiniteNumber(bounds.maxX) &&
    isFiniteNumber(bounds.minY) &&
    isFiniteNumber(bounds.maxY)
  ) {
    return bounds
  }

  const center = region.d?.center
  const width = region.d?.width
  const height = region.d?.height
  if (
    center &&
    isFiniteNumber(center.x) &&
    isFiniteNumber(center.y) &&
    isFiniteNumber(width) &&
    isFiniteNumber(height)
  ) {
    return {
      minX: center.x - width / 2,
      maxX: center.x + width / 2,
      minY: center.y - height / 2,
      maxY: center.y + height / 2,
    }
  }

  return undefined
}

const getPrimaryParams = (
  input: SerializedHyperGraphPortPointPathingSolverInput,
): SerializedHyperGraphPortPointPathingSolverParams => {
  const params = Array.isArray(input) ? input[0] : input
  if (!params) {
    throw new Error("CM5IO fixture is empty")
  }

  if (params.format !== "serialized-hg-port-point-pathing-solver-params") {
    throw new Error("Unexpected CM5IO fixture format")
  }

  return params
}

const resolveRoutePoint = (
  points: unknown[],
  index: number,
  visited = new Set<number>(),
): RoutePoint | undefined => {
  if (visited.has(index)) {
    return undefined
  }
  visited.add(index)

  const candidate = points[index]
  if (!candidate || typeof candidate !== "object") {
    return undefined
  }

  const point = candidate as {
    x?: unknown
    y?: unknown
    layer?: unknown
    pointId?: unknown
    pcb_port_id?: unknown
    $ref?: unknown
  }

  if (
    typeof point.pointId === "string" &&
    isFiniteNumber(point.x) &&
    isFiniteNumber(point.y) &&
    typeof point.layer === "string"
  ) {
    return {
      pointId: point.pointId,
      x: point.x,
      y: point.y,
      layer: point.layer,
      pcbPortId:
        typeof point.pcb_port_id === "string" ? point.pcb_port_id : undefined,
    }
  }

  if (typeof point.$ref !== "string") {
    return undefined
  }

  const match = /^\$\.pointsToConnect\[(\d+)\]$/.exec(point.$ref)
  if (!match) {
    return undefined
  }

  return resolveRoutePoint(points, Number(match[1]), visited)
}

const resolveConnectionPoints = (
  connection: SerializedHyperGraphPortPointPathingSolverParams["connections"][number],
) => {
  const cm5ioConnection = connection as Cm5ioConnection
  const rawPoints = Array.isArray(cm5ioConnection.simpleRouteConnection?.pointsToConnect)
    ? cm5ioConnection.simpleRouteConnection.pointsToConnect
    : []

  const resolvedPoints: RoutePoint[] = []
  for (let index = 0; index < rawPoints.length; index++) {
    const point = resolveRoutePoint(rawPoints, index)
    if (point) {
      resolvedPoints.push(point)
    }
  }

  return resolvedPoints
}

const buildEditorData = (
  input: SerializedHyperGraphPortPointPathingSolverInput,
): EditorData => {
  const params = getPrimaryParams(input)
  const bounds = createEmptyBounds()
  const regions: RegionShape[] = []
  const pointsById = new Map<string, PointBuilder>()
  const adjacency = new Map<string, Set<string>>()
  const connections: ConnectionEdge[] = []

  for (const region of params.graph.regions) {
    const regionBounds = getRegionBounds(region)
    if (!regionBounds) continue

    expandBounds(bounds, regionBounds.minX, regionBounds.minY)
    expandBounds(bounds, regionBounds.maxX, regionBounds.maxY)

    regions.push({
      regionId: region.regionId,
      minX: regionBounds.minX,
      maxX: regionBounds.maxX,
      minY: regionBounds.minY,
      maxY: regionBounds.maxY,
      layer: typeof region.d?.layer === "string" ? region.d.layer : undefined,
    })
  }

  for (const connection of params.connections) {
    const resolvedPoints = resolveConnectionPoints(connection)
    if (resolvedPoints.length === 0) {
      continue
    }

    const uniquePointIds = Array.from(
      new Set(resolvedPoints.map((point) => point.pointId)),
    )

    for (const point of resolvedPoints) {
      expandBounds(bounds, point.x, point.y)

      const existingPoint = pointsById.get(point.pointId)
      if (existingPoint) {
        existingPoint.connectionIds.add(connection.connectionId)
      } else {
        pointsById.set(point.pointId, {
          pointId: point.pointId,
          x: point.x,
          y: point.y,
          layer: point.layer,
          pcbPortId: point.pcbPortId,
          connectionIds: new Set([connection.connectionId]),
        })
      }

      if (!adjacency.has(point.pointId)) {
        adjacency.set(point.pointId, new Set())
      }
    }

    for (let pointIndex = 0; pointIndex < uniquePointIds.length; pointIndex++) {
      const sourcePointId = uniquePointIds[pointIndex]
      const neighborIds = adjacency.get(sourcePointId)
      if (!neighborIds) continue

      for (
        let neighborIndex = pointIndex + 1;
        neighborIndex < uniquePointIds.length;
        neighborIndex++
      ) {
        const targetPointId = uniquePointIds[neighborIndex]
        neighborIds.add(targetPointId)
        const targetNeighbors = adjacency.get(targetPointId)
        if (targetNeighbors) {
          targetNeighbors.add(sourcePointId)
        }
      }
    }

    connections.push({
      connectionId: connection.connectionId,
      pointIds: uniquePointIds,
      pathPointIds: resolvedPoints.map((point) => point.pointId),
    })
  }

  const pointById = new Map<string, PointNode>()
  const componentById = new Map<string, ConnectivityComponent>()
  const componentIdByPointId = new Map<string, string>()
  let componentIndex = 0

  for (const pointId of pointsById.keys()) {
    if (componentIdByPointId.has(pointId)) {
      continue
    }

    const componentId = `component-${componentIndex++}`
    const stack = [pointId]
    const componentPointIds: string[] = []
    const componentConnectionIds = new Set<string>()

    componentIdByPointId.set(pointId, componentId)

    while (stack.length > 0) {
      const currentPointId = stack.pop()
      if (!currentPointId) continue

      componentPointIds.push(currentPointId)

      const point = pointsById.get(currentPointId)
      if (point) {
        for (const connectionId of point.connectionIds) {
          componentConnectionIds.add(connectionId)
        }
      }

      for (const neighborId of adjacency.get(currentPointId) ?? []) {
        if (componentIdByPointId.has(neighborId)) continue
        componentIdByPointId.set(neighborId, componentId)
        stack.push(neighborId)
      }
    }

    componentById.set(componentId, {
      componentId,
      pointIds: componentPointIds.sort((left, right) =>
        left.localeCompare(right),
      ),
      connectionIds: Array.from(componentConnectionIds).sort((left, right) =>
        left.localeCompare(right),
      ),
    })
  }

  const points = Array.from(pointsById.values())
    .map((point) => ({
      pointId: point.pointId,
      x: point.x,
      y: point.y,
      layer: point.layer,
      pcbPortId: point.pcbPortId,
      connectionIds: Array.from(point.connectionIds).sort((left, right) =>
        left.localeCompare(right),
      ),
      componentId: componentIdByPointId.get(point.pointId) ?? "component-0",
    }))
    .sort((left, right) => left.pointId.localeCompare(right.pointId))

  for (const point of points) {
    pointById.set(point.pointId, point)
  }

  const connectionById = new Map<string, ConnectionEdge>()
  for (const connection of connections) {
    const componentId =
      connection.pointIds[0] !== undefined
        ? componentIdByPointId.get(connection.pointIds[0])
        : undefined
    const enrichedConnection = {
      ...connection,
      componentId,
    }
    connectionById.set(enrichedConnection.connectionId, enrichedConnection)
  }

  return {
    bounds: finalizeBounds(bounds),
    regions,
    points,
    pointById,
    connections: Array.from(connectionById.values()).sort((left, right) =>
      left.connectionId.localeCompare(right.connectionId),
    ),
    connectionById,
    componentById,
  }
}

const clampScale = (scale: number) =>
  Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale))

const fitViewToBounds = (
  bounds: RectBounds,
  width: number,
  height: number,
): ViewState => {
  const boundsWidth = Math.max(bounds.maxX - bounds.minX, 1)
  const boundsHeight = Math.max(bounds.maxY - bounds.minY, 1)
  const availableWidth = Math.max(width - 48, 1)
  const availableHeight = Math.max(height - 48, 1)
  const scale = clampScale(
    Math.min(availableWidth / boundsWidth, availableHeight / boundsHeight),
  )

  return {
    centerX: (bounds.minX + bounds.maxX) / 2,
    centerY: (bounds.minY + bounds.maxY) / 2,
    scale,
  }
}

const worldToScreen = (
  x: number,
  y: number,
  view: ViewState,
  width: number,
  height: number,
) => ({
  x: width / 2 + (x - view.centerX) * view.scale,
  y: height / 2 - (y - view.centerY) * view.scale,
})

const screenToWorld = (
  x: number,
  y: number,
  view: ViewState,
  width: number,
  height: number,
) => ({
  x: view.centerX + (x - width / 2) / view.scale,
  y: view.centerY - (y - height / 2) / view.scale,
})

const getVisibleWorldBounds = (
  view: ViewState,
  width: number,
  height: number,
  marginPx = 24,
): RectBounds => ({
  minX: view.centerX - (width / 2 + marginPx) / view.scale,
  maxX: view.centerX + (width / 2 + marginPx) / view.scale,
  minY: view.centerY - (height / 2 + marginPx) / view.scale,
  maxY: view.centerY + (height / 2 + marginPx) / view.scale,
})

const intersectsBounds = (a: RectBounds, b: RectBounds) =>
  !(
    a.maxX < b.minX ||
    a.minX > b.maxX ||
    a.maxY < b.minY ||
    a.minY > b.maxY
  )

const BusCanvas = ({
  editorData,
  selectedConnectionIds,
  hoveredPointId,
  onHoverPointChange,
  onTogglePointComponent,
}: {
  editorData: EditorData
  selectedConnectionIds: Set<string>
  hoveredPointId?: string
  onHoverPointChange: (pointId?: string) => void
  onTogglePointComponent: (pointId: string) => void
}) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const dragStateRef = useRef<
    | {
        pointerId: number
        x: number
        y: number
        moved: boolean
      }
    | undefined
  >(undefined)

  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const [view, setView] = useState<ViewState>()

  useEffect(() => {
    const container = containerRef.current
    if (!container) {
      return
    }

    const updateSize = () => {
      const nextWidth = Math.round(container.clientWidth)
      const nextHeight = Math.round(container.clientHeight)
      setCanvasSize((current) => {
        if (
          current.width === nextWidth &&
          current.height === nextHeight
        ) {
          return current
        }
        return {
          width: nextWidth,
          height: nextHeight,
        }
      })
    }

    updateSize()

    const observer = new ResizeObserver(updateSize)
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (canvasSize.width === 0 || canvasSize.height === 0) {
      return
    }

    setView((currentView) => {
      if (currentView) {
        return currentView
      }
      return fitViewToBounds(
        editorData.bounds,
        canvasSize.width,
        canvasSize.height,
      )
    })
  }, [canvasSize.height, canvasSize.width, editorData.bounds])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !view || canvasSize.width === 0 || canvasSize.height === 0) {
      return
    }

    const devicePixelRatio = window.devicePixelRatio || 1
    canvas.width = Math.max(Math.round(canvasSize.width * devicePixelRatio), 1)
    canvas.height = Math.max(
      Math.round(canvasSize.height * devicePixelRatio),
      1,
    )
    canvas.style.width = `${canvasSize.width}px`
    canvas.style.height = `${canvasSize.height}px`

    const context = canvas.getContext("2d")
    if (!context) {
      return
    }

    context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0)
    context.clearRect(0, 0, canvasSize.width, canvasSize.height)
    context.fillStyle = "#f5f5f4"
    context.fillRect(0, 0, canvasSize.width, canvasSize.height)

    const visibleBounds = getVisibleWorldBounds(
      view,
      canvasSize.width,
      canvasSize.height,
    )
    const hoveredComponentId = hoveredPointId
      ? editorData.pointById.get(hoveredPointId)?.componentId
      : undefined

    const selectedPointIds = new Set<string>()
    for (const connectionId of selectedConnectionIds) {
      const connection = editorData.connectionById.get(connectionId)
      if (!connection) continue
      for (const pointId of connection.pointIds) {
        selectedPointIds.add(pointId)
      }
    }

    const boardTopLeft = worldToScreen(
      editorData.bounds.minX,
      editorData.bounds.maxY,
      view,
      canvasSize.width,
      canvasSize.height,
    )
    const boardBottomRight = worldToScreen(
      editorData.bounds.maxX,
      editorData.bounds.minY,
      view,
      canvasSize.width,
      canvasSize.height,
    )
    context.fillStyle = "#fffdf7"
    context.fillRect(
      boardTopLeft.x,
      boardTopLeft.y,
      boardBottomRight.x - boardTopLeft.x,
      boardBottomRight.y - boardTopLeft.y,
    )
    context.strokeStyle = "#d6d3d1"
    context.lineWidth = 1
    context.strokeRect(
      boardTopLeft.x,
      boardTopLeft.y,
      boardBottomRight.x - boardTopLeft.x,
      boardBottomRight.y - boardTopLeft.y,
    )

    for (const region of editorData.regions) {
      if (!intersectsBounds(region, visibleBounds)) {
        continue
      }

      const topLeft = worldToScreen(
        region.minX,
        region.maxY,
        view,
        canvasSize.width,
        canvasSize.height,
      )
      const bottomRight = worldToScreen(
        region.maxX,
        region.minY,
        view,
        canvasSize.width,
        canvasSize.height,
      )
      const rectWidth = bottomRight.x - topLeft.x
      const rectHeight = bottomRight.y - topLeft.y

      if (rectWidth <= 0 || rectHeight <= 0) {
        continue
      }

      context.fillStyle =
        region.layer === "bottom"
          ? "rgba(59, 130, 246, 0.06)"
          : "rgba(100, 116, 139, 0.08)"
      context.fillRect(topLeft.x, topLeft.y, rectWidth, rectHeight)

      if (rectWidth >= 8 && rectHeight >= 8) {
        context.strokeStyle =
          region.layer === "bottom"
            ? "rgba(59, 130, 246, 0.14)"
            : "rgba(100, 116, 139, 0.14)"
        context.strokeRect(topLeft.x, topLeft.y, rectWidth, rectHeight)
      }
    }

    for (const connection of editorData.connections) {
      const pathPoints = connection.pathPointIds
        .map((pointId) => editorData.pointById.get(pointId))
        .filter((point): point is PointNode => Boolean(point))
      if (pathPoints.length === 0) {
        continue
      }

      const isSelected = selectedConnectionIds.has(connection.connectionId)
      const isHovered =
        hoveredComponentId !== undefined &&
        hoveredComponentId === connection.componentId

      context.beginPath()
      pathPoints.forEach((point, pointIndex) => {
        const screenPoint = worldToScreen(
          point.x,
          point.y,
          view,
          canvasSize.width,
          canvasSize.height,
        )
        if (pointIndex === 0) {
          context.moveTo(screenPoint.x, screenPoint.y)
        } else {
          context.lineTo(screenPoint.x, screenPoint.y)
        }
      })

      context.strokeStyle = isSelected
        ? "#d97706"
        : isHovered
          ? "#2563eb"
          : "rgba(71, 85, 105, 0.4)"
      context.lineWidth = isSelected ? 3 : isHovered ? 2.4 : 1.2
      context.stroke()

      if (
        pathPoints.length === 2 &&
        pathPoints[0]?.pointId === pathPoints[1]?.pointId
      ) {
        const point = pathPoints[0]
        if (point) {
          const center = worldToScreen(
            point.x,
            point.y,
            view,
            canvasSize.width,
            canvasSize.height,
          )
          context.beginPath()
          context.arc(center.x, center.y, isSelected ? 8 : 6, 0, Math.PI * 2)
          context.strokeStyle = isSelected ? "#d97706" : "#94a3b8"
          context.lineWidth = isSelected ? 2 : 1.25
          context.stroke()
        }
      }
    }

    for (const point of editorData.points) {
      const isSelected = selectedPointIds.has(point.pointId)
      const isHovered =
        hoveredComponentId !== undefined &&
        hoveredComponentId === point.componentId
      const screenPoint = worldToScreen(
        point.x,
        point.y,
        view,
        canvasSize.width,
        canvasSize.height,
      )

      const radius = isSelected ? 5.5 : isHovered ? 5 : 3.5
      context.beginPath()
      context.arc(screenPoint.x, screenPoint.y, radius, 0, Math.PI * 2)
      context.fillStyle = isSelected
        ? "#f59e0b"
        : isHovered
          ? "#2563eb"
          : "#1f2937"
      context.fill()
      context.lineWidth = 1.5
      context.strokeStyle = "#fffdf7"
      context.stroke()
    }

    const labeledPoints = [
      hoveredPointId ? editorData.pointById.get(hoveredPointId) : undefined,
      ...Array.from(selectedPointIds)
        .slice(0, 24)
        .map((pointId) => editorData.pointById.get(pointId)),
    ].filter((point, index, list): point is PointNode => {
      if (!point) return false
      return list.findIndex((candidate) => candidate?.pointId === point.pointId) === index
    })

    context.font = "12px ui-monospace, SFMono-Regular, Menlo, monospace"
    context.textBaseline = "bottom"
    for (const point of labeledPoints) {
      const screenPoint = worldToScreen(
        point.x,
        point.y,
        view,
        canvasSize.width,
        canvasSize.height,
      )
      context.fillStyle = "rgba(255, 253, 247, 0.92)"
      context.fillRect(screenPoint.x + 8, screenPoint.y - 18, 118, 18)
      context.fillStyle = "#0f172a"
      context.fillText(point.pointId, screenPoint.x + 12, screenPoint.y - 5)
    }
  }, [
    canvasSize.height,
    canvasSize.width,
    editorData,
    hoveredPointId,
    selectedConnectionIds,
    view,
  ])

  const getCanvasRelativePoint = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current
    if (!canvas) return undefined

    const rect = canvas.getBoundingClientRect()
    return {
      x: clientX - rect.left,
      y: clientY - rect.top,
    }
  }

  const getNearestPointId = (screenX: number, screenY: number) => {
    if (!view || canvasSize.width === 0 || canvasSize.height === 0) {
      return undefined
    }

    let nearestPointId: string | undefined
    let nearestDistance = Number.POSITIVE_INFINITY

    for (const point of editorData.points) {
      const screenPoint = worldToScreen(
        point.x,
        point.y,
        view,
        canvasSize.width,
        canvasSize.height,
      )
      const dx = screenPoint.x - screenX
      const dy = screenPoint.y - screenY
      const distance = Math.hypot(dx, dy)
      if (distance > POINT_HIT_RADIUS_PX || distance >= nearestDistance) {
        continue
      }

      nearestDistance = distance
      nearestPointId = point.pointId
    }

    return nearestPointId
  }

  const handlePointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0) {
      return
    }

    const relativePoint = getCanvasRelativePoint(event.clientX, event.clientY)
    if (!relativePoint) {
      return
    }

    dragStateRef.current = {
      pointerId: event.pointerId,
      x: relativePoint.x,
      y: relativePoint.y,
      moved: false,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const relativePoint = getCanvasRelativePoint(event.clientX, event.clientY)
    if (!relativePoint) {
      return
    }

    const dragState = dragStateRef.current
    if (
      dragState &&
      dragState.pointerId === event.pointerId &&
      view &&
      canvasSize.width > 0 &&
      canvasSize.height > 0
    ) {
      const dx = relativePoint.x - dragState.x
      const dy = relativePoint.y - dragState.y

      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
        dragState.moved = true
      }

      if (dragState.moved) {
        setIsDragging(true)
        setView((currentView) => {
          if (!currentView) {
            return currentView
          }

          return {
            ...currentView,
            centerX: currentView.centerX - dx / currentView.scale,
            centerY: currentView.centerY + dy / currentView.scale,
          }
        })
      }

      dragState.x = relativePoint.x
      dragState.y = relativePoint.y

      if (dragState.moved) {
        onHoverPointChange(undefined)
        return
      }
    }

    onHoverPointChange(getNearestPointId(relativePoint.x, relativePoint.y))
  }

  const handlePointerUp = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const dragState = dragStateRef.current
    dragStateRef.current = undefined
    setIsDragging(false)

    if (!dragState || dragState.pointerId !== event.pointerId) {
      return
    }

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }

    const relativePoint = getCanvasRelativePoint(event.clientX, event.clientY)
    if (!relativePoint) {
      return
    }

    const nearestPointId = getNearestPointId(relativePoint.x, relativePoint.y)
    onHoverPointChange(nearestPointId)

    if (!dragState.moved && nearestPointId) {
      onTogglePointComponent(nearestPointId)
    }
  }

  const handlePointerLeave = () => {
    if (!dragStateRef.current?.moved) {
      onHoverPointChange(undefined)
    }
  }

  const handleWheel = (event: ReactWheelEvent<HTMLCanvasElement>) => {
    event.preventDefault()
    event.stopPropagation()

    if (!view || canvasSize.width === 0 || canvasSize.height === 0) {
      return
    }

    const relativePoint = getCanvasRelativePoint(event.clientX, event.clientY)
    if (!relativePoint) {
      return
    }

    const worldPoint = screenToWorld(
      relativePoint.x,
      relativePoint.y,
      view,
      canvasSize.width,
      canvasSize.height,
    )

    const zoomFactor = Math.exp(-event.deltaY * 0.0015)
    const nextScale = clampScale(view.scale * zoomFactor)

    setView({
      centerX: worldPoint.x - (relativePoint.x - canvasSize.width / 2) / nextScale,
      centerY: worldPoint.y + (relativePoint.y - canvasSize.height / 2) / nextScale,
      scale: nextScale,
    })
  }

  return (
    <div className="relative h-full min-h-[28rem] overflow-hidden overscroll-none rounded-[1.5rem] border border-stone-300 bg-stone-50">
      <div ref={containerRef} className="absolute inset-0">
        <canvas
          ref={canvasRef}
          className="h-full w-full touch-none overscroll-none"
          onPointerDown={handlePointerDown}
          onPointerLeave={handlePointerLeave}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onWheelCapture={handleWheel}
          style={{
            cursor: isDragging
              ? "grabbing"
              : hoveredPointId
                ? "pointer"
                : "grab",
          }}
        />
      </div>

      <div className="pointer-events-none absolute left-4 top-4 rounded-2xl border border-stone-300/80 bg-white/90 px-4 py-3 text-xs text-stone-700 shadow-sm backdrop-blur">
        <div className="font-semibold text-stone-900">CM5IO Bus Selector</div>
        <div>Drag to pan. Scroll to zoom. Click a point to toggle its component.</div>
      </div>

      <div className="absolute bottom-4 right-4 flex gap-2">
        <button
          className="rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm text-stone-700 shadow-sm transition hover:border-stone-400 hover:text-stone-950"
          onClick={() =>
            setView((currentView) =>
              currentView
                ? {
                    ...currentView,
                    scale: clampScale(currentView.scale * 1.2),
                  }
                : currentView,
            )
          }
          type="button"
        >
          Zoom In
        </button>
        <button
          className="rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm text-stone-700 shadow-sm transition hover:border-stone-400 hover:text-stone-950"
          onClick={() =>
            setView((currentView) =>
              currentView
                ? {
                    ...currentView,
                    scale: clampScale(currentView.scale / 1.2),
                  }
                : currentView,
            )
          }
          type="button"
        >
          Zoom Out
        </button>
        <button
          className="rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm text-stone-700 shadow-sm transition hover:border-stone-400 hover:text-stone-950"
          onClick={() => {
            if (canvasSize.width === 0 || canvasSize.height === 0) return
            setView(
              fitViewToBounds(
                editorData.bounds,
                canvasSize.width,
                canvasSize.height,
              ),
            )
          }}
          type="button"
        >
          Fit
        </button>
      </div>
    </div>
  )
}

export default function BusSelectorPage() {
  const [editorData, setEditorData] = useState<EditorData>()
  const [errorMessage, setErrorMessage] = useState<string>()
  const [selectedConnectionIds, setSelectedConnectionIds] = useState<Set<string>>(
    () => new Set(),
  )
  const [hoveredPointId, setHoveredPointId] = useState<string>()
  const [busLabel, setBusLabel] = useState("bus-name")
  const [copyStatus, setCopyStatus] = useState<string>()

  useEffect(() => {
    const html = document.documentElement
    const body = document.body
    const previousStyles = {
      htmlOverflow: html.style.overflow,
      htmlOverscrollBehavior: html.style.overscrollBehavior,
      bodyMargin: body.style.margin,
      bodyOverflow: body.style.overflow,
      bodyOverscrollBehavior: body.style.overscrollBehavior,
    }

    html.style.overflow = "hidden"
    html.style.overscrollBehavior = "none"
    body.style.margin = "0"
    body.style.overflow = "hidden"
    body.style.overscrollBehavior = "none"

    return () => {
      html.style.overflow = previousStyles.htmlOverflow
      html.style.overscrollBehavior = previousStyles.htmlOverscrollBehavior
      body.style.margin = previousStyles.bodyMargin
      body.style.overflow = previousStyles.bodyOverflow
      body.style.overscrollBehavior = previousStyles.bodyOverscrollBehavior
    }
  }, [])

  useEffect(() => {
    let isCancelled = false

    const loadFixture = async () => {
      try {
        const response = await fetch(cm5ioFixtureUrl)
        if (!response.ok) {
          throw new Error(`Failed to load fixture (${response.status})`)
        }

        const input =
          (await response.json()) as SerializedHyperGraphPortPointPathingSolverInput
        if (!isCancelled) {
          setEditorData(buildEditorData(input))
          setErrorMessage(undefined)
        }
      } catch (error) {
        if (!isCancelled) {
          setErrorMessage(
            error instanceof Error
              ? error.message
              : "Failed to load CM5IO fixture",
          )
        }
      }
    }

    void loadFixture()

    return () => {
      isCancelled = true
    }
  }, [])

  if (errorMessage) {
    return (
      <div className="flex h-screen items-center justify-center bg-stone-100 p-6">
        <div className="rounded-2xl border border-red-300 bg-white p-4 text-sm text-red-700 shadow-sm">
          {errorMessage}
        </div>
      </div>
    )
  }

  if (!editorData) {
    return (
      <div className="flex h-screen items-center justify-center bg-stone-100 p-6 text-sm text-stone-600">
        Loading CM5IO fixture...
      </div>
    )
  }

  const hoveredPoint = hoveredPointId
    ? editorData.pointById.get(hoveredPointId)
    : undefined
  const hoveredComponent = hoveredPoint
    ? editorData.componentById.get(hoveredPoint.componentId)
    : undefined

  const selectedConnections = editorData.connections.filter((connection) =>
    selectedConnectionIds.has(connection.connectionId),
  )
  const selectedPointIds = new Set<string>()
  for (const connection of selectedConnections) {
    for (const pointId of connection.pointIds) {
      selectedPointIds.add(pointId)
    }
  }

  const selectedPoints = Array.from(selectedPointIds)
    .map((pointId) => editorData.pointById.get(pointId))
    .filter((point): point is PointNode => Boolean(point))
    .sort((left, right) => left.pointId.localeCompare(right.pointId))

  const effectiveBusLabel = busLabel.trim() || "bus-name"
  const selectionPatches: SelectionPatch[] = selectedConnections.map(
    (connection) => ({
      connectionId: connection.connectionId,
      pointIds: connection.pointIds,
      _bus: {
        id: effectiveBusLabel,
      },
    }),
  )
  const copyPayload = JSON.stringify(
    {
      busId: effectiveBusLabel,
      pointIds: selectedPoints.map((point) => point.pointId),
      connectionPatches: selectionPatches,
    },
    null,
    2,
  )

  const togglePointComponent = (pointId: string) => {
    const point = editorData.pointById.get(pointId)
    if (!point) return

    const component = editorData.componentById.get(point.componentId)
    if (!component) return

    setSelectedConnectionIds((currentSelection) => {
      const nextSelection = new Set(currentSelection)
      const allSelected = component.connectionIds.every((connectionId) =>
        nextSelection.has(connectionId),
      )

      for (const connectionId of component.connectionIds) {
        if (allSelected) {
          nextSelection.delete(connectionId)
        } else {
          nextSelection.add(connectionId)
        }
      }

      return nextSelection
    })
    setCopyStatus(undefined)
  }

  return (
    <div className="box-border flex h-[100dvh] overflow-hidden bg-[linear-gradient(180deg,#fafaf9_0%,#f5f5f4_100%)] p-3 lg:flex-row lg:gap-3">
      <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
        <BusCanvas
          editorData={editorData}
          hoveredPointId={hoveredPointId}
          onHoverPointChange={setHoveredPointId}
          onTogglePointComponent={togglePointComponent}
          selectedConnectionIds={selectedConnectionIds}
        />
      </div>

      <aside className="mt-3 flex max-h-[40dvh] w-full shrink-0 flex-col gap-3 overflow-y-auto overscroll-contain lg:mt-0 lg:max-h-none lg:min-h-0 lg:w-[28rem]">
        <section className="rounded-[1.5rem] border border-stone-300 bg-white p-4 shadow-sm">
          <div className="text-sm font-semibold text-stone-950">
            Selection Rules
          </div>
          <div className="mt-2 text-sm leading-6 text-stone-700">
            Each click toggles the entire point-connected component into the bus.
            On the current CM5IO fixture, each component is one source trace, so
            selecting either endpoint adds both endpoints and that trace.
          </div>
        </section>

        <section className="rounded-[1.5rem] border border-stone-300 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm font-semibold text-stone-950">
              Bus Output
            </div>
            <div className="text-xs text-stone-500">
              {selectedConnections.length} connections • {selectedPoints.length} points
            </div>
          </div>

          <label className="mt-4 block text-sm text-stone-700">
            <span className="mb-2 block font-medium text-stone-900">
              Bus Label
            </span>
            <input
              className="w-full rounded-xl border border-stone-300 bg-stone-50 px-3 py-2 text-sm text-stone-950 outline-none transition focus:border-amber-400 focus:bg-white"
              onChange={(event) => {
                setBusLabel(event.currentTarget.value)
                setCopyStatus(undefined)
              }}
              placeholder="bus-name"
              type="text"
              value={busLabel}
            />
          </label>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900 transition hover:border-amber-400 hover:bg-amber-100"
              onClick={() => {
                if (!navigator.clipboard?.writeText) {
                  setCopyStatus("Clipboard API is unavailable in this browser.")
                  return
                }

                void navigator.clipboard
                  .writeText(copyPayload)
                  .then(() => {
                    setCopyStatus("Copied bus payload to clipboard.")
                  })
                  .catch((error: unknown) => {
                    setCopyStatus(
                      error instanceof Error
                        ? error.message
                        : "Failed to copy payload.",
                    )
                  })
              }}
              type="button"
            >
              Copy Payload
            </button>
            <button
              className="rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm text-stone-700 transition hover:border-stone-400 hover:text-stone-950"
              onClick={() => {
                setSelectedConnectionIds(new Set())
                setCopyStatus(undefined)
              }}
              type="button"
            >
              Clear Selection
            </button>
          </div>

          {copyStatus ? (
            <div className="mt-3 rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-700">
              {copyStatus}
            </div>
          ) : null}
        </section>

        <section className="min-h-0 rounded-[1.5rem] border border-stone-300 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm font-semibold text-stone-950">
              Bus Members
            </div>
            <div className="text-xs text-stone-500">
              {selectionPatches.length} entries
            </div>
          </div>

          <div className="mt-3 max-h-56 space-y-2 overflow-auto pr-1">
            {selectionPatches.length === 0 ? (
              <div className="rounded-xl border border-dashed border-stone-300 bg-stone-50 px-3 py-4 text-sm text-stone-500">
                Click points in the editor to build a bus.
              </div>
            ) : (
              selectionPatches.map((patch) => (
                <div
                  key={patch.connectionId}
                  className="rounded-xl border border-stone-200 bg-stone-50 px-3 py-3"
                >
                  <div className="text-sm font-medium text-stone-950">
                    {patch.connectionId}
                  </div>
                  <div className="mt-2 text-xs leading-5 text-stone-600">
                    {patch.pointIds.join("  •  ")}
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="rounded-[1.5rem] border border-stone-300 bg-white p-4 shadow-sm">
          <div className="text-sm font-semibold text-stone-950">
            Hovered Component
          </div>
          {hoveredPoint && hoveredComponent ? (
            <div className="mt-3 space-y-2 text-sm text-stone-700">
              <div>
                <span className="font-medium text-stone-950">
                  {hoveredPoint.pointId}
                </span>
                <span className="ml-2 text-xs text-stone-500">
                  ({hoveredPoint.x.toFixed(3)}, {hoveredPoint.y.toFixed(3)})
                </span>
              </div>
              <div className="text-xs leading-5 text-stone-600">
                Connections: {hoveredComponent.connectionIds.join(", ")}
              </div>
              <div className="text-xs leading-5 text-stone-600">
                Points: {hoveredComponent.pointIds.join(", ")}
              </div>
            </div>
          ) : (
            <div className="mt-3 text-sm text-stone-500">
              Hover a point to inspect the component that will be toggled.
            </div>
          )}
        </section>

      </aside>
    </div>
  )
}
