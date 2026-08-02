import "bun-match-svg"
import { expect, test } from "bun:test"
import {
  getSvgFromGraphicsObject,
  stackGraphicsVertically,
} from "graphics-debug"
import {
  DuplicateCongestedPortSolver,
  loadSerializedHyperGraph,
  TinyHyperGraphSolver,
} from "lib/index"
import { sameNetSharedBottleneckFixture } from "tests/fixtures/same-net-shared-bottleneck.fixture"

test("does not duplicate a bottleneck reused by routes on the same net", () => {
  const solver = new DuplicateCongestedPortSolver(
    sameNetSharedBottleneckFixture,
    {
      duplicatePortProximity: 0.4,
      minimumDuplicatePortSpacing: 0.4,
      duplicatePortWidth: 0.2,
    },
  )
  solver.solve()

  const output = solver.getOutput()
  const input = loadSerializedHyperGraph(sameNetSharedBottleneckFixture)
  const { topology, problem } = loadSerializedHyperGraph(output)
  const inputVisualizationSolver = new TinyHyperGraphSolver(
    input.topology,
    input.problem,
  )
  const visualizationSolver = new TinyHyperGraphSolver(topology, problem)
  const bottleneckPortCount = output.ports.filter(
    (port) =>
      port.portId === "shared-x" ||
      port.d?.duplicatedFromPortId === "shared-x",
  ).length

  expect(
    getSvgFromGraphicsObject(
      stackGraphicsVertically(
        [
          inputVisualizationSolver.visualize(),
          visualizationSolver.visualize(),
        ],
        {
          titles: [
            "input: 1 shared bottleneck port",
            `prepass output: ${bottleneckPortCount} bottleneck port${
              bottleneckPortCount === 1 ? "" : "s"
            }`,
          ],
        },
      ),
    ),
  ).toMatchSvgSnapshot(import.meta.path)
  expect(solver.report.portUseCounts["shared-x"]).toBe(1)
  expect(
    solver.report.duplicatedPorts.find(
      ({ sourcePortId }) => sourcePortId === "shared-x",
    ),
  ).toBeUndefined()
})
