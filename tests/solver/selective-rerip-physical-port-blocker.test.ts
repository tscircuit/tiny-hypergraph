import { expect, test } from "bun:test"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { loadSerializedHyperGraph } from "../../lib/compat/loadSerializedHyperGraph"
import { SelectiveReripTinyHyperGraphSolver } from "../../lib/selective-rerip-tiny-hyper-graph-solver"

test("selective rerip moves the owner of a nearby conflicting port", (): void => {
  const positions = [
    { x: -1, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 2 },
    { x: -1, y: 0.05 }, { x: 1, y: 0.05 }, { x: 0, y: 0.05 },
  ]
  const regions = [
    { regionId: "a-left", pointIds: ["p0", "p2", "p3"], d: { center: {x:-0.5,y:1}, width: 1, height: 4, availableZ: [0] } },
    { regionId: "a-right", pointIds: ["p1", "p2", "p3"], d: { center: {x:0.5,y:1}, width: 1, height: 4, availableZ: [0] } },
    { regionId: "b-left", pointIds: ["p4", "p6"], d: { center: {x:-0.5,y:0.05}, width: 1, height: 1, availableZ: [0] } },
    { regionId: "b-right", pointIds: ["p5", "p6"], d: { center: {x:0.5,y:0.05}, width: 1, height: 1, availableZ: [0] } },
    ...[0,1,4,5].map(i=>({regionId:`t${i}`,pointIds:[`p${i}`],d:{center:positions[i]!,width:0.001,height:0.001,availableZ:[0]}})),
  ]
  const ends = [["a-left","t0"],["a-right","t1"],["a-left","a-right"],["a-left","a-right"],["b-left","t4"],["b-right","t5"],["b-left","b-right"]]
  const graph: SerializedHyperGraph = {
    regions,
    ports:positions.map((position,i)=>({portId:`p${i}`,region1Id:ends[i]![0]!,region2Id:ends[i]![1]!,d:{...position,z:0}})),
    connections:[{connectionId:"a",startRegionId:"t0",endRegionId:"t1"},{connectionId:"b",startRegionId:"t4",endRegionId:"t5"}],
  }
  const {topology,problem}=loadSerializedHyperGraph(graph)
  problem.portConflicts=[[],[],[6],[],[],[],[2]]
  const solver=new SelectiveReripTinyHyperGraphSolver(topology,problem,{MAX_ITERATIONS:5000,GREEDY_FINAL_ROUTE_ITERS:0,RIP_THRESHOLD_RAMP_ATTEMPTS:0})
  solver.solve()
  expect(solver.solved).toBeTrue()
  expect(solver.getSelectiveReripStats().selectiveRipCount).toBeGreaterThan(0)
  expect(solver.state.portAssignment[2]).toBe(-1)
  expect(solver.state.portAssignment[3]).toBe(problem.routeNet[0]!)
  expect(solver.state.portAssignment[6]).toBe(problem.routeNet[1]!)
})
