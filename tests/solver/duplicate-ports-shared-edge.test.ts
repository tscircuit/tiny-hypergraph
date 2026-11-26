import "bun-match-svg"
import { expect, test } from "bun:test"
import { getSvgFromGraphicsObject } from "graphics-debug"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { DuplicateCongestedPortSolver } from "lib/DuplicateCongestedPortSolver"

test("duplicated ports stay on the finite shared edge of offset rectangles", (): void => {
  for (const transpose of [false, true]) {
    for (const sharedY of [1.499, 1.5]) {
      const graph: SerializedHyperGraph = {
        regions: [
          {
            regionId: "start-a",
            pointIds: ["a-in"],
            d: { center: { x: -3, y: 0.7 }, width: 2, height: 0.2 },
          },
          {
            regionId: "start-b",
            pointIds: ["b-in"],
            d: { center: { x: -3, y: 1.3 }, width: 2, height: 0.2 },
          },
          {
            regionId: "left",
            pointIds: ["a-in", "b-in", "shared"],
            d: { center: { x: -1, y: 0 }, width: 2, height: 4 },
          },
          {
            regionId: "right",
            pointIds: ["shared", "a-out", "b-out"],
            d: { center: { x: 1, y: 1 }, width: 2, height: 1 },
          },
          {
            regionId: "end-a",
            pointIds: ["a-out"],
            d: { center: { x: 3, y: 0.7 }, width: 2, height: 0.2 },
          },
          {
            regionId: "end-b",
            pointIds: ["b-out"],
            d: { center: { x: 3, y: 1.3 }, width: 2, height: 0.2 },
          },
        ],
        ports: [
          {
            portId: "a-in",
            region1Id: "start-a",
            region2Id: "left",
            d: { x: -2, y: 0.7, z: 0 },
          },
          {
            portId: "b-in",
            region1Id: "start-b",
            region2Id: "left",
            d: { x: -2, y: 1.3, z: 0 },
          },
          {
            portId: "shared",
            region1Id: "left",
            region2Id: "right",
            d: { x: 0, y: sharedY, z: 0 },
          },
          {
            portId: "a-out",
            region1Id: "right",
            region2Id: "end-a",
            d: { x: 2, y: 0.7, z: 0 },
          },
          {
            portId: "b-out",
            region1Id: "right",
            region2Id: "end-b",
            d: { x: 2, y: 1.3, z: 0 },
          },
        ],
        connections: [
          {
            connectionId: "a",
            startRegionId: "start-a",
            endRegionId: "end-a",
            mutuallyConnectedNetworkId: "a",
          },
          {
            connectionId: "b",
            startRegionId: "start-b",
            endRegionId: "end-b",
            mutuallyConnectedNetworkId: "b",
          },
        ],
      }
      if (transpose) {
        for (const region of graph.regions) {
          const { center, width, height } = region.d!
          region.d = {
            center: { x: center.y, y: center.x },
            width: height,
            height: width,
          }
        }
        for (const port of graph.ports) {
          const { x, y, z } = port.d!
          port.d = { x: y, y: x, z }
        }
      }
      const solver = new DuplicateCongestedPortSolver(graph)
      solver.solve()
      expect(solver.failed).toBe(false)
      expect(solver.solved).toBe(true)
      const duplicates = solver
        .getOutput()
        .ports.filter((port) => port.d?.duplicatedFromPortId === "shared")
      expect(duplicates).toHaveLength(1)
      const duplicate = duplicates[0]!.d!
      if (!transpose && sharedY === 1.5) {
        expect(
          getSvgFromGraphicsObject(
            {
              title: "Duplicate port at the end of a shared edge",
              coordinateSystem: "cartesian",
              rects: [
                {
                  center: { x: -0.025, y: 1.5 },
                  width: 0.05,
                  height: 0.1,
                  fill: "rgba(0,120,255,0.15)",
                },
                {
                  center: { x: 0.025, y: 1.475 },
                  width: 0.05,
                  height: 0.05,
                  fill: "rgba(0,120,255,0.15)",
                },
              ],
              lines: [
                {
                  points: [
                    { x: 0, y: 1.45 },
                    { x: 0, y: 1.5 },
                  ],
                  strokeColor: "#64748b",
                  strokeWidth: 0.0002,
                },
              ],
              points: [
                { x: 0, y: sharedY, label: "Original port", color: "#334155" },
                {
                  x: duplicate.x,
                  y: duplicate.y,
                  label: "Duplicate",
                  color: "#16a34a",
                },
              ],
            },
            { backgroundColor: "white", includeTextLabels: true },
          ),
        ).toMatchSvgSnapshot(import.meta.path)
      }
      expect(transpose ? duplicate.y : duplicate.x).toBe(0)
      const alongEdge = transpose ? duplicate.x : duplicate.y
      expect(alongEdge).toBeGreaterThanOrEqual(0.5)
      expect(alongEdge).toBeLessThanOrEqual(1.5)
      expect(alongEdge).not.toBe(sharedY)
    }
  }
})
