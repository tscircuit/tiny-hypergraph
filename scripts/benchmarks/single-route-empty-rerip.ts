import { createHash } from "node:crypto"
import { mkdirSync, writeFileSync } from "node:fs"
import { TinyHyperGraphSolver } from "../../lib/core"
import { createSingleRouteDisconnectedChain, createSingleRouteViaCapacity } from "../../tests/fixtures/single-route-via-capacity"
const sha = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex")
const results = []
for (const extraRegions of [0, 1000, 10000]) {
  for (const connected of [false, true]) {
    const trials = []
    for (let trial = 0; trial < 3; trial++) {
      const { topology, problem } = createSingleRouteDisconnectedChain(connected)
      for (let i = 0; i < extraRegions; i++) topology.regionIncidentPorts.push([])
      for (const key of ["regionWidth", "regionHeight", "regionCenterX", "regionCenterY", "regionAvailableZMask"] as const) {
        const old = topology[key]!
        const next = new (old.constructor as any)(old.length + extraRegions)
        next.set(old)
        topology[key] = next
      }
      topology.regionCount += extraRegions
      const inputSha256 = sha({ topology, problem }), start = performance.now(), cpu = process.cpuUsage()
      const solver = new TinyHyperGraphSolver(topology, problem, {
        MAX_ITERATIONS: 2000, STATIC_REACHABILITY_PRECHECK: true,
        STATIC_REACHABILITY_PRECHECK_MAX_HOPS: 4, RIP_THRESHOLD_RAMP_ATTEMPTS: 0,
      })
      solver.solve()
      const used = process.cpuUsage(cpu)
      trials.push({ inputSha256, inputUnchanged: sha({ topology, problem }) === inputSha256,
        solved: solver.solved, failed: solver.failed, error: solver.error,
        iterations: solver.iterations, ripCount: solver.state.ripCount,
        outputSha256: sha(solver.state.regionSegments), wallMs: performance.now() - start,
        cpuMs: (used.user + used.system) / 1000, peakRssBytes: process.resourceUsage().maxRSS * 1024 })
      if (process.argv.includes("--visual") && extraRegions === 0 && trial === 0) {
        const { getSvgFromGraphicsObject } = await import("graphics-debug")
        mkdirSync("docs/single-route-empty-rerip", { recursive: true })
        writeFileSync(`docs/single-route-empty-rerip/${connected ? "reachable" : "disconnected"}.svg`, getSvgFromGraphicsObject(solver.visualize()))
      }
    }
    results.push({ extraRegions, connected, trials })
  }
}
for (const [width, endZ] of [[0.2, 0], [1, 1]]) {
  const { topology, problem } = createSingleRouteViaCapacity(width, endZ)
  const solver = new TinyHyperGraphSolver(topology, problem, { MAX_ITERATIONS: 2000, RIP_THRESHOLD_RAMP_ATTEMPTS: 0, minViaPadDiameter: 0.5 })
  solver.solve()
  if (!solver.solved || solver.failed) throw Error("Reachable via/layer control failed")
}
writeFileSync(process.argv[2] ?? "single-route-empty-rerip.json", JSON.stringify({ scope: "Native single-route exhaustion and immutable reachable controls; full datasets measured separately", results }, null, 2) + "\n")
console.log(JSON.stringify(results.map(r => ({ extraRegions: r.extraRegions, connected: r.connected, ...r.trials[0] }))))
