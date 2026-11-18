import Std

namespace TinyHypergraph

/-- Numeric topology abstraction. Array shape and safe integer representation
    must be established separately at the TypeScript boundary. -/
structure Topology where
  portCount : Nat
  regionCount : Nat
  regionPorts : Nat → List Nat
  portRegions : Nat → List Nat

structure WellFormed (t : Topology) : Prop where
  portBound : ∀ r p, r < t.regionCount → p ∈ t.regionPorts r → p < t.portCount
  regionBound : ∀ p r, p < t.portCount → r ∈ t.portRegions p → r < t.regionCount
  reciprocal : ∀ r p, r < t.regionCount → p < t.portCount →
    (p ∈ t.regionPorts r ↔ r ∈ t.portRegions p)

/-- Exact conditional at core.ts:765–769 for two defined incidence slots. -/
def opposite (first second current : Nat) : Nat :=
  if first = current then second else first

theorem opposite_incident (first second current : Nat) :
    opposite first second current = first ∨ opposite first second current = second := by
  unfold opposite
  split <;> simp_all

theorem opposite_bound (first second current count : Nat)
    (hfirst : first < count) (hsecond : second < count) :
    opposite first second current < count := by
  rcases opposite_incident first second current with h | h
  · simpa [h] using hfirst
  · simpa [h] using hsecond

theorem opposite_crosses (first second current : Nat)
    (distinct : first ≠ second) (incident : current = first ∨ current = second) :
    opposite first second current ≠ current := by
  rcases incident with h | h
  · subst current
    simpa [opposite] using Ne.symm distinct
  · subst current
    simp [opposite, distinct]

structure Candidate where
  port : Nat
  nextRegion : Nat

/-- Invariant before/after a candidate is expanded. -/
def CandidateValid (t : Topology) (c : Candidate) : Prop :=
  c.port < t.portCount ∧ c.nextRegion < t.regionCount ∧
    c.port ∈ t.regionPorts c.nextRegion

structure Segment where
  route : Nat
  region : Nat
  fromPort : Nat
  toPort : Nat

def SegmentValid (t : Topology) (routeCount : Nat) (s : Segment) : Prop :=
  s.route < routeCount ∧ s.region < t.regionCount ∧
    s.fromPort < t.portCount ∧ s.toPort < t.portCount ∧
    s.fromPort ∈ t.regionPorts s.region ∧ s.toPort ∈ t.regionPorts s.region

/-- A selected neighbor forms a legal segment in the region being expanded,
    including the early goal-neighbor branch in core.ts. -/
theorem neighbor_segment_valid (t : Topology) (wf : WellFormed t)
    (c : Candidate) (hc : CandidateValid t c)
    (neighbor route routeCount : Nat) (hn : neighbor ∈ t.regionPorts c.nextRegion)
    (hr : route < routeCount) :
    SegmentValid t routeCount ⟨route, c.nextRegion, c.port, neighbor⟩ := by
  exact ⟨hr, hc.2.1, hc.1, wf.portBound _ _ hc.2.1 hn, hc.2.2, hn⟩

/-- Both stored incidence endpoints and reciprocity are required. This models
    candidate generation after all queue/cost/reservation filters have passed. -/
theorem neighbor_candidate_valid (t : Topology) (wf : WellFormed t)
    (c : Candidate) (hc : CandidateValid t c)
    (neighbor first second : Nat)
    (hn : neighbor ∈ t.regionPorts c.nextRegion)
    (hfirst : first ∈ t.portRegions neighbor)
    (hsecond : second ∈ t.portRegions neighbor) :
    CandidateValid t ⟨neighbor, opposite first second c.nextRegion⟩ := by
  have hp := wf.portBound _ _ hc.2.1 hn
  have hi : opposite first second c.nextRegion ∈ t.portRegions neighbor := by
    rcases opposite_incident first second c.nextRegion with h | h
    · simpa [h] using hfirst
    · simpa [h] using hsecond
  have hr := wf.regionBound _ _ hp hi
  exact ⟨hp, hr, (wf.reciprocal _ _ hr hp).mpr hi⟩

/-- Reciprocal topology plus an exact two-endpoint incidence row establishes
    the current-region premise used by the crossing theorem. -/
theorem reciprocal_two_endpoint_crossing (t : Topology) (wf : WellFormed t)
    (c : Candidate) (hc : CandidateValid t c)
    (neighbor first second : Nat)
    (hn : neighbor ∈ t.regionPorts c.nextRegion)
    (pair : t.portRegions neighbor = [first, second])
    (distinct : first ≠ second) :
    opposite first second c.nextRegion ≠ c.nextRegion := by
  have hp := wf.portBound _ _ hc.2.1 hn
  have hi := (wf.reciprocal _ _ hc.2.1 hp).mp hn
  have incident : c.nextRegion = first ∨ c.nextRegion = second := by
    simpa [pair] using hi
  exact opposite_crosses first second c.nextRegion distinct incident

/-- A linked candidate path whose successive candidates are valid neighbors.
    The TypeScript predecessor chain must additionally be acyclic/finite for
    its while-loop reconstruction to correspond to this inductive model. -/
inductive CandidatePath (t : Topology) : Candidate → Candidate → Prop where
  | start (c : Candidate) : CandidateValid t c → CandidatePath t c c
  | extend {start last next : Candidate} : CandidatePath t start last →
      CandidateValid t next → next.port ∈ t.regionPorts last.nextRegion →
      CandidatePath t start next

theorem path_final_valid (t : Topology) (start last : Candidate)
    (path : CandidatePath t start last) : CandidateValid t last := by
  cases path with
  | start h => exact h
  | extend _ h _ => exact h

/-- Every appended predecessor edge is a valid segment; the new segment starts
    at the old final candidate port, so concatenation preserves continuity. -/
theorem path_extension_segment_valid (t : Topology) (wf : WellFormed t)
    (start last next : Candidate) (path : CandidatePath t start last)
    (hn : next.port ∈ t.regionPorts last.nextRegion)
    (route routeCount : Nat) (hr : route < routeCount) :
    SegmentValid t routeCount ⟨route, last.nextRegion, last.port, next.port⟩ := by
  exact neighbor_segment_valid t wf last (path_final_valid t start last path)
    next.port route routeCount hn hr

/-- Flat list abstraction of the region-indexed segment store. -/
def SegmentsValid (t : Topology) (routeCount : Nat) (ss : List Segment) : Prop :=
  ∀ s ∈ ss, SegmentValid t routeCount s

theorem append_segments_preserves (t : Topology) (routeCount : Nat)
    (old fresh : List Segment) (ho : SegmentsValid t routeCount old)
    (hf : SegmentsValid t routeCount fresh) :
    SegmentsValid t routeCount (old ++ fresh) := by
  intro s hs
  rcases List.mem_append.mp hs with h | h
  · exact ho s h
  · exact hf s h

/-- The actual rerip currently resets every segment list to empty. -/
theorem reset_segments_valid (t : Topology) (routeCount : Nat) :
    SegmentsValid t routeCount [] := by
  intro s hs
  cases hs

/-- Generic removal lemma; NOT a claim that the current solver performs
    selective route removal (its rerip resets the entire store). -/
theorem filter_segments_preserves (t : Topology) (routeCount : Nat)
    (ss : List Segment) (keep : Segment → Bool) (hs : SegmentsValid t routeCount ss) :
    SegmentsValid t routeCount (ss.filter keep) := by
  intro s h
  exact hs s (List.mem_filter.mp h).1

#print axioms opposite_incident
#print axioms opposite_bound
#print axioms opposite_crosses
#print axioms neighbor_segment_valid
#print axioms neighbor_candidate_valid
#print axioms reciprocal_two_endpoint_crossing
#print axioms path_final_valid
#print axioms path_extension_segment_valid
#print axioms append_segments_preserves
#print axioms reset_segments_valid
#print axioms filter_segments_preserves

end TinyHypergraph
