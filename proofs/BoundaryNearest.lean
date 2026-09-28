import Std

/-!
Stable boundary buckets remove only identity transitions from nearest-port scans.
The transition is arbitrary: no real-number, ordering, or IEEE arithmetic law is
assumed. See BoundaryNearest.md for the implementation correspondence and limits.
-/
namespace BoundaryNearest

variable {Port Key State : Type} [DecidableEq Key]

abbrev Buckets (Key Port : Type) := Key → List Port

/-- Model Map.get(key) ?? [] followed by push, in input order. -/
def appendPort (key : Port → Key) (buckets : Buckets Key Port)
    (port : Port) : Buckets Key Port :=
  fun query => if key port = query then buckets query ++ [port] else buckets query

def buildBuckets (key : Port → Key) (ports : List Port) : Buckets Key Port :=
  ports.foldl (appendPort key) (fun _ => [])

theorem build_from_invariant (key : Port → Key) (ports : List Port)
    (buckets : Buckets Key Port) (query : Key) :
    (ports.foldl (appendPort key) buckets) query =
      buckets query ++ ports.filter (fun port => decide (key port = query)) := by
  induction ports generalizing buckets with
  | nil => simp
  | cons port ports ih =>
    simp only [List.foldl_cons]
    rw [ih]
    by_cases h : key port = query
    · simp [appendPort, h, List.append_assoc]
    · simp [appendPort, h]

/-- Every bucket is precisely the stable filter of the original input. -/
theorem bucket_eq_filter (key : Port → Key) (ports : List Port) (query : Key) :
    buildBuckets key ports query =
      ports.filter (fun port => decide (key port = query)) := by
  simpa [buildBuckets] using
    build_from_invariant key ports (fun _ => []) query

/-- The original full scan: other boundaries do not change the accumulator. -/
def fullScan (key : Port → Key) (query : Key) (step : State → Port → State)
    (initial : State) (ports : List Port) : State :=
  ports.foldl (fun state port => if key port = query then step state port else state)
    initial

theorem filter_scan_eq (key : Port → Key) (query : Key)
    (step : State → Port → State) (ports : List Port) (initial : State) :
    fullScan key query step initial ports =
      (ports.filter (fun port => decide (key port = query))).foldl step initial := by
  induction ports generalizing initial with
  | nil => rfl
  | cons port ports ih =>
    by_cases h : key port = query
    · simpa [fullScan, h] using ih (step initial port)
    · simpa [fullScan, h] using ih initial

/-- Exact accumulator equality, including the selected port and its distance. -/
theorem bucket_scan_eq (key : Port → Key) (query : Key)
    (step : State → Port → State) (ports : List Port) (initial : State) :
    (buildBuckets key ports query).foldl step initial =
      fullScan key query step initial ports := by
  rw [bucket_eq_filter, filter_scan_eq]

/-- The implementation checks same port ID before computing the boundary key.
Reordering these two pure rejection checks leaves every transition unchanged. -/
theorem same_id_guard_order (key : Port → Key) (query : Key)
    (sameId : Port → Bool) (step : State → Port → State)
    (state : State) (port : Port) :
    (if sameId port then state
     else if key port = query then step state port else state) =
    (if key port = query then
       (if sameId port then state else step state port)
     else state) := by
  cases sameId port <;> by_cases hk : key port = query <;> simp [hk]

/-- Covers unchanged same-ID, EPSILON, and nearest-distance Boolean guards. -/
def guardedStep (reject : State → Port → Bool) (update : State → Port → State)
    (state : State) (port : Port) : State :=
  if reject state port then state else update state port

theorem rejected_port_preserves_state (reject : State → Port → Bool)
    (update : State → Port → State) (state : State) (port : Port)
    (h : reject state port = true) :
    guardedStep reject update state port = state := by
  simp [guardedStep, h]

/-- Per-query visited entries never increase. -/
theorem bucket_length_le (key : Port → Key) (ports : List Port) (query : Key) :
    (buildBuckets key ports query).length ≤ ports.length := by
  rw [bucket_eq_filter]
  exact List.length_filter_le _ _

def queryVisits (key : Port → Key) (ports : List Port) (queries : List Key) : Nat :=
  (queries.map (fun query => (buildBuckets key ports query).length)).sum

/-- Across all queries, bucket visits are bounded by the full-scan visits. -/
theorem query_visits_le (key : Port → Key) (ports : List Port) (queries : List Key) :
    queryVisits key ports queries ≤ queries.length * ports.length := by
  induction queries with
  | nil => simp [queryVisits]
  | cons query queries ih =>
    have h := bucket_length_le key ports query
    simp only [queryVisits, List.map_cons, List.sum_cons] at *
    simp only [List.length_cons, Nat.add_mul, Nat.one_mul]
    omega

/-- One grouping pass plus queries costs at most N + Q*N entry visits.
This bound alone does not claim a runtime win; sparse buckets must repay N. -/
theorem grouping_and_queries_bound (key : Port → Key) (ports : List Port)
    (queries : List Key) :
    ports.length + queryVisits key ports queries ≤
      ports.length + queries.length * ports.length := by
  exact Nat.add_le_add_left (query_visits_le key ports queries) _

/-- Entries omitted by a query, including any same-ID entries on other boundaries.
These are loop visits, not distance evaluations or boundary-key evaluations. -/
def rejectedVisits (key : Port → Key) (ports : List Port) (queries : List Key) : Nat :=
  (queries.map (fun query =>
    (ports.filter (fun port => decide (key port ≠ query))).length)).sum

theorem boundary_visit_partition (key : Port → Key) (ports : List Port) (query : Key) :
    ports.length = (buildBuckets key ports query).length +
      (ports.filter (fun port => decide (key port ≠ query))).length := by
  rw [bucket_eq_filter]
  induction ports with
  | nil => simp
  | cons port ports ih =>
    by_cases h : key port = query <;> simp [h] at * <;> omega

/-- Exact accounting of all full-scan loop visits across repeated queries. -/
theorem full_visits_decomposition (key : Port → Key) (ports : List Port)
    (queries : List Key) :
    queries.length * ports.length =
      queryVisits key ports queries + rejectedVisits key ports queries := by
  induction queries with
  | nil => simp [queryVisits, rejectedVisits]
  | cons query queries ih =>
    have h := boundary_visit_partition key ports query
    simp only [queryVisits, rejectedVisits, List.map_cons, List.sum_cons] at *
    simp only [List.length_cons, Nat.add_mul, Nat.one_mul]
    omega

/-- Strictly fewer loop visits including grouping iff omitted visits repay N.
The measurable condition concerns effort only; scan correctness is unconditional. -/
theorem preprocessing_pays_iff (key : Port → Key) (ports : List Port)
    (queries : List Key) :
    ports.length + queryVisits key ports queries < queries.length * ports.length ↔
      ports.length < rejectedVisits key ports queries := by
  rw [full_visits_decomposition key ports queries]
  omega

end BoundaryNearest
