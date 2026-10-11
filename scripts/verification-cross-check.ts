import assert from "node:assert/strict"
import { resolve } from "node:path"
import { loadSerializedHyperGraph, TinyHyperGraphSolver } from "../lib/index"

// Run after `cd verification && lake build`. LEAN_LAKE can name an elan binary.
const lake = process.env.LEAN_LAKE ?? "lake"
const result = Bun.spawnSync([lake, "env", "lean", "--run", "Main.lean"], {
  cwd: resolve(import.meta.dir, "../verification"),
})
assert.equal(result.exitCode, 0, result.stderr.toString())
const rows = result.stdout.toString().trim().split("\n")
assert.equal(rows.shift(), "first,second,current,next")
assert.equal(rows.length, 24)
for (const row of rows) {
  const [first, second, current, expectedNext] = row.split(",").map(Number)
  const otherRegions = [0, 1, 2, 3].filter((r) => r !== first && r !== second)
  const ports = [
    {
      portId: "start",
      region1Id: String(otherRegions[0]),
      region2Id: String(current),
      d: { x: 0, y: 0, z: 0 },
    },
    {
      portId: "middle",
      region1Id: String(first),
      region2Id: String(second),
      d: { x: 1, y: 0, z: 0 },
    },
    {
      portId: "end",
      region1Id: String(expectedNext),
      region2Id: String(otherRegions[1]),
      d: { x: 2, y: 0, z: 0 },
    },
  ]
  const { topology, problem } = loadSerializedHyperGraph({
    regions: [0, 1, 2, 3].map((r) => ({
      regionId: String(r),
      pointIds: ports
        .filter((p) => p.region1Id === String(r) || p.region2Id === String(r))
        .map((p) => p.portId),
      d: { width: 10, height: 10, center: { x: 0, y: 0 }, availableZ: [0] },
    })),
    ports,
    connections: [
      {
        connectionId: "route",
        startRegionId: String(otherRegions[0]),
        endRegionId: String(otherRegions[1]),
      },
    ],
  })
  const solver = new TinyHyperGraphSolver(topology, problem, {
    MAX_ITERATIONS: 100,
  })
  const queue = solver.state.candidateQueue
  const originalQueue = queue.queue.bind(queue)
  let observed = false
  queue.queue = (candidate) => {
    if (candidate.portId === 1) {
      observed = true
      assert.equal(candidate.prevCandidate?.nextRegionId, current, row)
      assert.equal(candidate.nextRegionId, expectedNext, row)
    }
    originalQueue(candidate)
  }
  solver.solve()
  assert.equal(observed, true, `missing actual transition: ${row}`)
  assert.equal(solver.solved, true, row)
  assert.equal(solver.failed, false, row)
}
console.log(
  `Checked ${rows.length} Lean transition fixtures against actual TypeScript candidate queues`,
)
