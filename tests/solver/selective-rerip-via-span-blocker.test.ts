import { expect, test } from "bun:test"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { loadSerializedHyperGraph } from "../../lib/compat/loadSerializedHyperGraph"
import { SelectiveReripTinyHyperGraphSolver } from "../../lib/selective-rerip-tiny-hyper-graph-solver"

test("blocker search identifies a committed via only inside its physical span", (): void => {
  class InspectableSolver extends SelectiveReripTinyHyperGraphSolver {
    getBlockers(routeId: number): { found: boolean; owners: ReadonlySet<number> } {
      this.state.currentRouteId = routeId
      this.state.currentRouteNetId = this.problem.routeNet[routeId]!
      const result = this.findRelaxedBlockerPath()
      return { found: result.found, owners: result.found ? result.owners : new Set() }
    }
  }
  for (const z of [1, 3]) {
    const points = [{x:0,y:0,z:0}, {x:0,y:0,z:2}, {x:0,y:0.2,z}, {x:-1,y:0.2,z}, {x:1,y:0.2,z}]
    const graph: SerializedHyperGraph = {
      regions: [
        {regionId:"via",pointIds:["p0","p1"],d:{center:{x:0,y:0},width:0.3,height:0.3,availableZ:[0,1,2,3]}},
        {regionId:"left",pointIds:["p2","p3"],d:{center:{x:-0.5,y:0.2},width:1,height:1,availableZ:[z]}},
        {regionId:"right",pointIds:["p2","p4"],d:{center:{x:0.5,y:0.2},width:1,height:1,availableZ:[z]}},
        ...points.flatMap((point,i)=>i===2?[]:[{regionId:`t${i}`,pointIds:[`p${i}`],d:{center:point,width:0.001,height:0.001,availableZ:[point.z]}}]),
      ],
      ports:points.map((point,i)=>({portId:`p${i}`,region1Id:i<2?"via":i===4?"right":"left",region2Id:i===2?"right":`t${i}`,d:point})),
      connections:[{connectionId:"via-net",startRegionId:"t0",endRegionId:"t1"},{connectionId:"wire-net",startRegionId:"t3",endRegionId:"t4"}],
    }
    const {topology,problem}=loadSerializedHyperGraph(graph)
    const viaRegion=topology.regionAvailableZMask!.findIndex(mask=>mask===15)
    expect(viaRegion).toBeGreaterThanOrEqual(0)
    const portsByRegion:number[][]=Array.from({length:topology.regionCount},()=>[])
    portsByRegion[viaRegion]=[2]
    problem.viaRegionPortConflicts={portsByRegion,regionsByPort:[[],[],[viaRegion],[],[]]}
    for (const seededRoute of [0, 1]) {
      problem.initialAssignments = seededRoute === 0
        ? [{routeId:0,regionId:viaRegion,fromPortId:0,toPortId:1}]
        : [
            {routeId:1,regionId:topology.incidentPortRegion[3]![0]!,fromPortId:3,toPortId:2},
            {routeId:1,regionId:topology.incidentPortRegion[4]![0]!,fromPortId:2,toPortId:4},
          ]
      const solver=new InspectableSolver(topology,problem)
      const blockers=solver.getBlockers(1-seededRoute)
      expect(blockers.found).toBeTrue()
      expect([...blockers.owners]).toEqual(z===1?[seededRoute]:[])
    }
  }
})
