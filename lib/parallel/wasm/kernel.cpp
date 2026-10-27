extern "C" __attribute__((import_module("env"),import_name("owner_job"))) void owner_job();
enum Field { P, R, S, THREADS, QCAP, CONTROL, PARENT, SETTLED, HEAP, POS, FRONTIER_NEXT, FRONTIER_HEAD, FRONTIER_GEN, R_OFF, R_PORT, ADJ_HOP, P_Z, P_A1, P_A2, P_R1, P_R2, R_MASK, R_NET, ROUTE_START, ROUTE_END, ROUTE_NET, P_MASK, ASSIGN, HEADERS, STORAGE, ITERATIONS, COST, HEURISTIC, P_X, P_Y, R_WIDTH, R_HEIGHT, PENALTY, CONGESTION, CACHE_COST, OPTIONS, P_RESERVED, WORK, MASK_META, MASK_GEN, MASK_DATA, MASK_CAP, HOP_ADJ, LAYERS, F_COST, LUT_META, LUT_DATA, LUT_DIRTY, LUT_CAP, CHECK_ENABLED, CHECK_SEEN, CHECK_QUEUE, CHECK_REGION, CHECK_CONTROL, ROOT_STATE };
struct K {
int Pn,Rn,SN,H,T,Q;int CHECK_ENABLED,*CHECK_SEEN,*CHECK_QUEUE,*CHECK_REGION,*CHECK_CONTROL,*ROOT_STATE;int *LUT_META,*LUT_DIRTY;double *LUT_DATA;int LUT_CAP;int *MASK_META,*MASK_GEN,*MASK_DATA,*HOP_ADJ;int MASK_CAP,LAYERS;
int *CONTROL;
int *PARENT;
int *SETTLED;
int *HEAP;
int *POS;
int *FRONTIER_NEXT;
int *FRONTIER_HEAD;
int *FRONTIER_GEN;
int *R_OFF;
int *R_PORT;
int *ADJ_HOP;
int *P_Z;
int *P_A1;
int *P_A2;
int *P_R1;
int *P_R2;
int *R_MASK;
int *R_NET;
int *ROUTE_START;
int *ROUTE_END;
int *ROUTE_NET;
int *P_MASK;
int *ASSIGN;
int *HEADERS;
int *STORAGE;
int *ITERATIONS;
double *COST,*F_COST;
double *HEURISTIC;
double *P_X;
double *P_Y;
double *R_WIDTH;
double *R_HEIGHT;
double *PENALTY;
double *CONGESTION;
double *CACHE_COST;
double *OPTIONS;
int *P_RESERVED;
int *WORK;
K(int*c){ROOT_STATE=(int*)c[::ROOT_STATE];CHECK_ENABLED=c[::CHECK_ENABLED];CHECK_SEEN=(int*)c[::CHECK_SEEN];CHECK_QUEUE=(int*)c[::CHECK_QUEUE];CHECK_REGION=(int*)c[::CHECK_REGION];CHECK_CONTROL=(int*)c[::CHECK_CONTROL];LUT_META=(int*)c[::LUT_META];LUT_DIRTY=(int*)c[::LUT_DIRTY];LUT_DATA=(double*)c[::LUT_DATA];LUT_CAP=c[::LUT_CAP];MASK_META=(int*)c[::MASK_META];MASK_GEN=(int*)c[::MASK_GEN];MASK_DATA=(int*)c[::MASK_DATA];HOP_ADJ=(int*)c[::HOP_ADJ];MASK_CAP=c[::MASK_CAP];LAYERS=c[::LAYERS];Pn=c[::P];Rn=c[::R];SN=c[::S];H=Pn*SN;T=c[::THREADS];Q=c[::QCAP];
CONTROL=(int*)c[::CONTROL];
PARENT=(int*)c[::PARENT];
SETTLED=(int*)c[::SETTLED];
HEAP=(int*)c[::HEAP];
POS=(int*)c[::POS];
FRONTIER_NEXT=(int*)c[::FRONTIER_NEXT];
FRONTIER_HEAD=(int*)c[::FRONTIER_HEAD];
FRONTIER_GEN=(int*)c[::FRONTIER_GEN];
R_OFF=(int*)c[::R_OFF];
R_PORT=(int*)c[::R_PORT];
ADJ_HOP=(int*)c[::ADJ_HOP];
P_Z=(int*)c[::P_Z];
P_A1=(int*)c[::P_A1];
P_A2=(int*)c[::P_A2];
P_R1=(int*)c[::P_R1];
P_R2=(int*)c[::P_R2];
R_MASK=(int*)c[::R_MASK];
R_NET=(int*)c[::R_NET];
ROUTE_START=(int*)c[::ROUTE_START];
ROUTE_END=(int*)c[::ROUTE_END];
ROUTE_NET=(int*)c[::ROUTE_NET];
P_MASK=(int*)c[::P_MASK];
ASSIGN=(int*)c[::ASSIGN];
HEADERS=(int*)c[::HEADERS];
STORAGE=(int*)c[::STORAGE];
ITERATIONS=(int*)c[::ITERATIONS];
COST=(double*)c[::COST];F_COST=(double*)c[::F_COST];
HEURISTIC=(double*)c[::HEURISTIC];
P_X=(double*)c[::P_X];
P_Y=(double*)c[::P_Y];
R_WIDTH=(double*)c[::R_WIDTH];
R_HEIGHT=(double*)c[::R_HEIGHT];
PENALTY=(double*)c[::PENALTY];
CONGESTION=(double*)c[::CONGESTION];
CACHE_COST=(double*)c[::CACHE_COST];
OPTIONS=(double*)c[::OPTIONS];
P_RESERVED=(int*)c[::P_RESERVED];
WORK=(int*)c[::WORK];
}
};
static const int INF_WORD=2147483647; static const double SCALE=1048576.0;
static int load(int*p){return __atomic_load_n(p,__ATOMIC_SEQ_CST);}
static void store(int*p,int n){__atomic_store_n(p,n,__ATOMIC_SEQ_CST);}
static int add(int*p,int n){return __atomic_fetch_add(p,n,__ATOMIC_SEQ_CST);}
static int cas(int*p,int expected,int value){__atomic_compare_exchange_n(p,&expected,value,false,__ATOMIC_SEQ_CST,__ATOMIC_SEQ_CST);return expected;}
static void notify(int*p,int n=4){__builtin_wasm_memory_atomic_notify(p,n);}
static void wait(int*p,int n){__builtin_wasm_memory_atomic_wait32(p,n,-1);}
static double inf(){return __builtin_inf();}
static void fail(K&k,int n){store(k.CONTROL+1,n);notify(k.CONTROL+2);}
static int hop(K&k,int port,int region){return port*k.SN+(k.P_R1[port]==region?0:1);}
static int region(K&k,int node){int port=node/k.SN;return node%k.SN==0?k.P_R1[port]:k.P_R2[port];}
static bool reserved(K&k,int r,int net){return k.R_NET[r]!=-1&&k.R_NET[r]!=net;}
static int layers(int mask){if(mask==0)return 2;return __builtin_popcount((unsigned)mask);}
static double regionCost(K&k,int r,int same,int cross,int changes,int n){
 double area=k.R_WIDTH[r]*k.R_HEIGHT[r],via=k.OPTIONS[1]+0.15,ratio=(double)n/layers(k.R_MASK[r]);
 bool single=k.R_MASK[r]>0&&(k.R_MASK[r]&(k.R_MASK[r]-1))==0;
 return ((same*2+cross+changes)*(via*via)*(1+n/5.0))/area+(single?same*10:0)+k.OPTIONS[2]*(ratio*ratio)*(0.1*0.1)/area;
}
static void buildCostTable(K&k,int r){
 int*m=k.LUT_META+r*4,row=r*8,n=k.HEADERS[row+3];
 for(int w=0;w<2*n+2;w++)k.LUT_DATA[m[1]+w]=regionCost(k,r,k.HEADERS[row+5],k.HEADERS[row+4]+w,k.HEADERS[row+6],k.HEADERS[row+7]+1)-k.CACHE_COST[r];
 store(m,m[3]);
}
static double cachedDelta(K&k,int r,int same,int cross,int changes){
 int*m=k.LUT_META+r*4,version=k.HEADERS[r*8];
 if(k.T==1&&m[0]!=version)buildCostTable(k,r);
 if(load(m)==version)return k.LUT_DATA[m[1]+same*2+cross+changes];
 int row=r*8;return regionCost(k,r,k.HEADERS[row+5]+same,k.HEADERS[row+4]+cross,k.HEADERS[row+6]+changes,k.HEADERS[row+7]+1)-k.CACHE_COST[r];
}
// Crossing parity at the two candidate angles identifies every intersected
// segment. Cache those prefix bitsets per port instead of rescanning segments
// for each port pair; route-specific masks exclude same-net segments.
static bool prepareMask(K&k,int r){
 int*m=k.MASK_META+r*4,row=r*8,n=k.HEADERS[row+3],blocks=(n+31)/32,degree=k.R_OFF[r+1]-k.R_OFF[r],version=k.HEADERS[row];
 if(m[0]<blocks){int cap=1;while(cap<blocks)cap*=2;int words=(degree*2+k.LAYERS+1)*cap,base=k.CONTROL[15];
  if(base+words>k.MASK_CAP){fail(k,13);return false;}k.CONTROL[15]=base+words;m[0]=cap;m[1]=base;m[2]=-1;
 }
 if(m[2]!=version){m[2]=version;m[3]=-1;int*layer=k.MASK_DATA+m[1]+degree*2*m[0];for(int i=0;i<k.LAYERS*m[0];i++)layer[i]=0;
  int offset=k.HEADERS[row+1],capacity=k.HEADERS[row+2];for(int i=0;i<n;i++){int mask=k.STORAGE[offset+capacity*3+i];for(int z=0;z<k.LAYERS;z++)if(mask&(1<<z))layer[z*m[0]+i/32]|=1u<<(i&31);}
 }
 return true;
}
static int portMask(K&k,int r,int port){
 int at=k.HOP_ADJ[hop(k,port,r)],version=k.HEADERS[r*8];
 for(;;){int seen=load(k.MASK_GEN+at);if(seen==version)return 0;if(seen==-2){if(load(k.CONTROL+1))return 0;__builtin_wasm_memory_atomic_wait32(k.MASK_GEN+at,seen,1000000);continue;}if(cas(k.MASK_GEN+at,seen,-2)==seen)break;}
 int*m=k.MASK_META+r*4,row=r*8,degree=k.R_OFF[r+1]-k.R_OFF[r],local=at-k.R_OFF[r],cap=m[0];
 int*less=k.MASK_DATA+m[1]+local*2*cap,*equal=less+cap;for(int b=0;b<cap;b++){less[b]=0;equal[b]=0;}
 int angle=(k.P_R1[port]==r||k.P_R2[port]!=r)?k.P_A1[port]:k.P_A2[port];
 int n=k.HEADERS[row+3],offset=k.HEADERS[row+1],capacity=k.HEADERS[row+2];
 for(int i=0;i<n;i++){int a=k.STORAGE[offset+capacity+i],b=k.STORAGE[offset+capacity*2+i];unsigned bit=1u<<(i&31);
  if((a<angle)!=(b<angle))less[i/32]|=bit;if((a<=angle)!=(b<=angle))equal[i/32]|=bit;
 }
 store(k.MASK_GEN+at,version);notify(k.MASK_GEN+at);return 1;
}
static void crossingCounts(K&k,int net,int r,int a,int b,int mask,int aa,int ba,int&same,int&cross){
 if(aa==ba)return;if(!prepareMask(k,r))return;portMask(k,r,a);portMask(k,r,b);
 int*m=k.MASK_META+r*4,cap=m[0],begin=k.R_OFF[r],degree=k.R_OFF[r+1]-begin;
 int lo=k.HOP_ADJ[hop(k,aa<ba?a:b,r)]-begin,hi=k.HOP_ADJ[hop(k,aa<ba?b:a,r)]-begin;
 int*upper=k.MASK_DATA+m[1]+hi*cap*2,*lower=k.MASK_DATA+m[1]+lo*cap*2+cap,*layers=k.MASK_DATA+m[1]+degree*cap*2,*foreign=layers+k.LAYERS*cap;
 if(m[3]!=k.CONTROL[0]){for(int i=0;i<cap;i++)foreign[i]=0;int row=r*8,n=k.HEADERS[row+3],offset=k.HEADERS[row+1];for(int i=0;i<n;i++)if(k.STORAGE[offset+i]!=net)foreign[i/32]|=1u<<(i&31);m[3]=k.CONTROL[0];}
 for(int i=0;i<cap;i++){unsigned bits=(upper[i]^lower[i])&foreign[i],compatible=0;for(int z=0;z<k.LAYERS;z++)if(mask&(1<<z))compatible|=layers[z*cap+i];same+=__builtin_popcount(bits&compatible);cross+=__builtin_popcount(bits&~compatible);}
}
static double deltaCost(K&k,int net,int r,int a,int b){
 int row=r*8,n=k.HEADERS[row+3],offset=k.HEADERS[row+1],cap=k.HEADERS[row+2],same=0,cross=0;
 int changes=k.P_Z[a]!=k.P_Z[b],mask=(1<<k.P_Z[a])|(1<<k.P_Z[b]);
 int aa=(k.P_R1[a]==r||k.P_R2[a]!=r)?k.P_A1[a]:k.P_A2[a];
 int ba=(k.P_R1[b]==r||k.P_R2[b]!=r)?k.P_A1[b]:k.P_A2[b];
 int lo=aa<ba?aa:ba,hi=aa<ba?ba:aa;
 if(k.HEADERS[row+7]>0){if(n>=16)crossingCounts(k,net,r,a,b,mask,aa,ba,same,cross);else for(int i=0;i<n;i++){
  if(k.STORAGE[offset+i]==net)continue;
  int ea=k.STORAGE[offset+cap+i],eb=k.STORAGE[offset+cap*2+i];
  if((lo<ea&&ea<hi)==(lo<eb&&eb<hi))continue;
  if(mask&k.STORAGE[offset+cap*3+i])same++;else cross++;
 }}
 int available=k.R_MASK[r];if(same>0&&available>0&&(available&(available-1))==0)return inf();
 if(k.OPTIONS[2]==0&&same==0&&cross==0&&changes==0&&k.HEADERS[row+5]==0&&k.HEADERS[row+4]==0&&k.HEADERS[row+6]==0&&k.CACHE_COST[r]==0&&k.R_WIDTH[r]*k.R_HEIGHT[r]>0)return 0;
 double delta=cachedDelta(k,r,same,cross,changes);
 return delta;
}
static double score(K&k,int net,int r,int a,int b,double g,double distance){return g+deltaCost(k,net,r,a,b)+k.CONGESTION[r]+k.PENALTY[b]+distance*k.OPTIONS[0];}
// Certify that every soft edge cost is finite and cannot trigger the
// negative-edge invariant. Larger numeric models keep the ordinary search.
static bool connectivityCostsAreBounded(K&k,int r){
 int row=r*8,n=k.HEADERS[row+3],cross=k.HEADERS[row+4],same=k.HEADERS[row+5],changes=k.HEADERS[row+6],segments=k.HEADERS[row+7];
 if(n!=segments||n<0||n>1000000||cross<0||same<0||changes<0||2.0*same+cross+changes>1e8)return false;
 double cached=k.CACHE_COST[r];if(!__builtin_isfinite(cached)||__builtin_fabs(cached)>1e150)return false;
 if(same==0&&cross==0&&changes==0&&cached==0&&k.OPTIONS[2]==0)return true;
 double minimum=regionCost(k,r,same,cross,changes,segments+1)-cached;
 return __builtin_isfinite(minimum)&&minimum>=-1e-9;
}
// Search backward until meeting the caller's settled frontier. A positive
// result has a complete feasible source-to-goal path, so no further flood is
// needed. An exhausted reverse search is followed by the exact forward count.
static int reverseConnectivity(K&k){
 int generation=-k.CONTROL[0],route=k.CONTROL[3],net=k.ROUTE_NET[route],goal=k.ROUTE_END[route],head=0,tail=0;bool met=false;
 auto enqueue=[&](int node){
  if(k.CHECK_SEEN[node]==generation)return;
  k.CHECK_SEEN[node]=generation;
  if(load(k.SETTLED+node)>0){met=true;return;}
  int b=node/k.SN,next=region(k,node),r=b==goal?next:(k.P_R1[b]==next?k.P_R2[b]:k.P_R1[b]);
  if(r<0||reserved(k,r,net)||reserved(k,next,net))return;
  int pin=k.P_RESERVED[b],assigned=k.ASSIGN[b];
  if(pin==-2||(pin!=-1&&pin!=net)||(assigned!=-1&&assigned!=net)||(b!=goal&&k.P_MASK[b]==0)||!__builtin_isfinite(k.PENALTY[b]))return;
  int mask=k.R_MASK[r],*meta=k.CHECK_REGION+r*3;
  if(mask>0&&(mask&(mask-1))==0){k.CHECK_QUEUE[tail++]=node;return;}
  if(meta[0]!=generation){meta[0]=generation;meta[1]=b;meta[2]=0;k.CHECK_QUEUE[tail++]=node;}
  else if(meta[1]!=b&&meta[2]!=generation){meta[2]=generation;k.CHECK_QUEUE[tail++]=node;}
 };
 if(k.P_R1[goal]>=0)enqueue(hop(k,goal,k.P_R1[goal]));if(k.P_R2[goal]>=0)enqueue(hop(k,goal,k.P_R2[goal]));
 while(head<tail&&!load(k.CONTROL+1)){
  if(load(k.CHECK_CONTROL+4))return -1;
  int node=k.CHECK_QUEUE[head++];if(load(k.SETTLED+node)>0)return 1;
  int b=node/k.SN,next=region(k,node),r=b==goal?next:(k.P_R1[b]==next?k.P_R2[b]:k.P_R1[b]);
  int available=k.R_MASK[r];bool single=available>0&&(available&(available-1))==0;
  int row=r*8,n=k.HEADERS[row+3],offset=k.HEADERS[row+1],capacity=k.HEADERS[row+2],ba=k.P_R1[b]==r?k.P_A1[b]:k.P_A2[b];
  for(int at=k.R_OFF[r];at<k.R_OFF[r+1];at++){
   int a=k.R_PORT[at];if(a==b)continue;
   if(single&&k.HEADERS[row+7]>0){
    int aa=k.P_R1[a]==r?k.P_A1[a]:k.P_A2[a],lo=aa<ba?aa:ba,hi=aa<ba?ba:aa,mask=(1<<k.P_Z[a])|(1<<k.P_Z[b]);bool blocked=false;
    for(int i=0;i<n;i++){
     if(k.STORAGE[offset+i]==net||!(mask&k.STORAGE[offset+capacity*3+i]))continue;
     int x=k.STORAGE[offset+capacity+i],y=k.STORAGE[offset+capacity*2+i];if((lo<x&&x<hi)!=(lo<y&&y<hi)){blocked=true;break;}
    }
    if(blocked)continue;
   }
   enqueue(hop(k,a,r));if(met)return 1;
  }
 }
 return met?1:0;
}
// Hard connectivity is independent of accumulated soft costs. Two incoming
// ports expose every exit in a multilayer region; single-layer regions retain
// every incoming port because crossing feasibility depends on both endpoints.
static void checkConnectivity(K&k){
 for(int r=0;r<k.Rn;r++){
  if((r&63)==0&&(load(k.CHECK_CONTROL+4)||load(k.CONTROL+1))){store(k.CHECK_CONTROL+1,3);notify(k.CHECK_CONTROL+1);return;}
  if(!__builtin_isfinite(k.CONGESTION[r])||k.CONGESTION[r]<0||k.CONGESTION[r]>1e150||!connectivityCostsAreBounded(k,r)){
   store(k.CHECK_CONTROL+1,3);notify(k.CHECK_CONTROL+1);return;
  }
 }
 int backwards=reverseConnectivity(k);
 if(backwards!=0){store(k.CHECK_CONTROL+1,backwards>0?1:3);notify(k.CHECK_CONTROL+1);return;}
 int generation=k.CONTROL[0],route=k.CONTROL[3],net=k.ROUTE_NET[route],goal=k.ROUTE_END[route],head=0,tail=0,count=0;
 int*signal=k.CHECK_CONTROL;
 auto enqueue=[&](int node){
  if(k.CHECK_SEEN[node]==generation)return;
  k.CHECK_SEEN[node]=generation;count++;
  int r=region(k,node),port=node/k.SN,mask=k.R_MASK[r],*meta=k.CHECK_REGION+r*3;
  if(mask>0&&(mask&(mask-1))==0){k.CHECK_QUEUE[tail++]=node;return;}
  if(meta[0]!=generation){meta[0]=generation;meta[1]=port;meta[2]=0;k.CHECK_QUEUE[tail++]=node;}
  else if(meta[1]!=port&&meta[2]!=generation){meta[2]=generation;k.CHECK_QUEUE[tail++]=node;}
 };
 enqueue(signal[3]);
 while(head<tail&&!load(k.CONTROL+1)){
  if(load(signal+4)){store(signal+1,3);notify(signal+1);return;}
  int node=k.CHECK_QUEUE[head++],r=region(k,node),a=node/k.SN;
  if(reserved(k,r,net))continue;
  int available=k.R_MASK[r];bool single=available>0&&(available&(available-1))==0;
  int row=r*8,n=k.HEADERS[row+3],offset=k.HEADERS[row+1],capacity=k.HEADERS[row+2];
  int aa=k.P_R1[a]==r?k.P_A1[a]:k.P_A2[a];
  for(int at=k.R_OFF[r];at<k.R_OFF[r+1];at++){
   int b=k.R_PORT[at];bool isGoal=b==goal;if(!isGoal&&(a==b||k.P_MASK[b]==0))continue;
   int target=isGoal?hop(k,b,r):k.ADJ_HOP[at];if(target<0)continue;
   int pin=k.P_RESERVED[b],assignment=k.ASSIGN[b];
   if(pin==-2||(pin!=-1&&pin!=net)||(assignment!=-1&&assignment!=net)||reserved(k,region(k,target),net)||!__builtin_isfinite(k.PENALTY[b]))continue;
   if(single&&k.HEADERS[row+7]>0){
    int ba=k.P_R1[b]==r?k.P_A1[b]:k.P_A2[b],lo=aa<ba?aa:ba,hi=aa<ba?ba:aa,mask=(1<<k.P_Z[a])|(1<<k.P_Z[b]);bool blocked=false;
    for(int i=0;i<n;i++){
     if(k.STORAGE[offset+i]==net||!(mask&k.STORAGE[offset+capacity*3+i]))continue;
     int x=k.STORAGE[offset+capacity+i],y=k.STORAGE[offset+capacity*2+i];
     if((lo<x&&x<hi)!=(lo<y&&y<hi)){blocked=true;break;}
    }
    if(blocked)continue;
   }
   if(isGoal){store(signal+1,1);notify(signal+1);return;}
   enqueue(target);
  }
 }
 signal[2]=count;store(signal+1,2);notify(signal+1);
}
struct Owner{
 K&k;int id,size=0,generation=0,iterations=0,route=0,net=0,goal=0;
 Owner(K&v,int owner):k(v),id(owner){}
 double f(int node){return k.F_COST[node];}
 int*heap(){return k.HEAP+id*k.Q;}
 void up(int at){int*items=heap(),node=items[at];while(at>0){int p=(at-1)/2;if(f(items[p])<=f(node))break;items[at]=items[p];k.POS[items[at]]=at;at=p;}items[at]=node;k.POS[node]=at;}
 void down(int at){int*items=heap(),node=items[at];for(;;){int l=at*2+1;if(l>=size)break;int r=l+1,c=r<size&&f(items[r])<f(items[l])?r:l;if(f(node)<=f(items[c]))break;items[at]=items[c];k.POS[items[at]]=at;at=c;}items[at]=node;k.POS[node]=at;}
 void queue(int node){int at=k.POS[node];if(at>=0){up(at);return;}heap()[size]=node;k.POS[node]=size;up(size++);}
 int pop(){int*items=heap(),node=items[0];k.POS[node]=-1;size--;if(size){items[0]=items[size];k.POS[items[0]]=0;down(0);}return node;}
 void accept(int node,double g,int parent){if(g>=k.COST[node])return;k.COST[node]=g;k.F_COST[node]=g+k.HEURISTIC[node/k.SN];k.PARENT[node]=parent;queue(node);}
 void expand(int node){int r=region(k,node),a=node/k.SN,wave=load(k.CONTROL+4);double g=k.COST[node];if(reserved(k,r,net))return;
  store(k.SETTLED+node,wave);
  int slot=id*k.Rn+r,start=k.R_OFF[r],end=k.R_OFF[r+1];int*next=k.FRONTIER_NEXT+id*k.R_OFF[k.Rn];
  if(k.FRONTIER_GEN[slot]!=generation){k.FRONTIER_GEN[slot]=generation;k.FRONTIER_HEAD[slot]=start<end?start:-1;for(int i=start;i<end;i++)next[i]=i+1<end?i+1:-1;}
  int at=k.FRONTIER_HEAD[slot],previous=-1;
  while(at!=-1){int following=next[at],b=k.R_PORT[at];bool isGoal=b==goal;
   if(!isGoal&&b==a){previous=at;at=following;continue;}
   int target=isGoal?hop(k,b,r):k.ADJ_HOP[at];
   bool remove=!isGoal&&(target<0||k.P_MASK[b]==0||k.SETTLED[target]>0);
   if(remove){if(previous<0)k.FRONTIER_HEAD[slot]=following;else next[previous]=following;at=following;continue;}
   int pinNet=k.P_RESERVED[b],assigned=k.ASSIGN[b],nextRegion=target>=0?region(k,target):-1;
   // Reservations and assignments stay fixed until this route search ends.
   // Remove rejected columns once instead of checking them on every revisit.
   if(pinNet==-2||(pinNet!=-1&&pinNet!=net)||nextRegion<0||(assigned!=-1&&assigned!=net)||reserved(k,nextRegion,net)){
    if(previous<0)k.FRONTIER_HEAD[slot]=following;else next[previous]=following;at=following;continue;
   }
   {
    double best=k.COST[target];
    if(g<best){
     double dx=k.P_X[a]-k.P_X[b],dy=k.P_Y[a]-k.P_Y[b],dist=__builtin_sqrt(dx*dx+dy*dy);
     double lowerBound=g+k.CONGESTION[r]+k.PENALTY[b]+dist*k.OPTIONS[0];
     if(lowerBound<best){
      double delta=deltaCost(k,net,r,a,b);
      double value=g+delta+k.CONGESTION[r]+k.PENALTY[b]+dist*k.OPTIONS[0];
      if(__builtin_isfinite(value)&&value<best){if(value<g-1e-9)fail(k,12);else accept(target,value,node);}
     }
    }
    if(isGoal)break;
   }
   previous=at;at=following;
  }
 }
 int advance(int chunk){
  generation=k.CONTROL[0];route=k.CONTROL[3];net=k.ROUTE_NET[route];goal=k.ROUTE_END[route];
  int*state=k.ROOT_STATE,budget=state[2];
  if(!state[3]){
   int source=k.ROUTE_START[route],r=k.P_R1[source],other=k.P_R2[source];
   if(k.R_NET[r]!=-1&&other>=0&&k.R_NET[other]==-1)r=other;
   else if(k.R_NET[r]!=-1&&!(other>=0&&k.R_NET[other]==-1)&&k.R_NET[r]!=net&&other>=0&&k.R_NET[other]==net)r=other;
   state[4]=hop(k,source,r);accept(state[4],0,-1);state[3]=1;
  }else{size=state[0];iterations=state[1];}
  int take=chunk<budget-iterations?chunk:budget-iterations,stop=iterations+take;
  while(size&&iterations<stop&&!load(k.CONTROL+1)){
   int node=pop();iterations++;
   if(node/k.SN==goal){k.CONTROL[10]=1;k.CONTROL[11]=node;size=0;break;}
   expand(node);
  }
  state[0]=size;state[1]=iterations;
  return !size||iterations>=budget||load(k.CONTROL+1);
 }


};
static void help(K&k,int owner){
 int ownerGeneration=0,tableGeneration=0,checkGeneration=0;add(k.CONTROL+8,1);notify(k.CONTROL+8);
 while(!load(k.CONTROL+7)&&!load(k.CONTROL+1)){
  int signal=load(k.WORK),requested=load(k.WORK+4);
  if(owner==1&&load(k.WORK+6)!=checkGeneration){checkGeneration=load(k.WORK+6);checkConnectivity(k);continue;}
  if(requested!=ownerGeneration){ownerGeneration=requested;owner_job();continue;}
  int tables=load(k.WORK+5);
  if(tables!=tableGeneration){tableGeneration=tables;
   for(;;){int job=add(k.WORK+2,1);if(job>=k.CONTROL[12])break;int r=k.LUT_DIRTY[job];buildCostTable(k,r);
    if(k.HEADERS[r*8+3]>=16){int masks=0;for(int at=k.R_OFF[r];at<k.R_OFF[r+1];at++)masks+=portMask(k,r,k.R_PORT[at]);add(k.CONTROL+5,masks);}
    add(k.CONTROL+13,1);}
   if(add(k.WORK+3,-1)==1)notify(k.WORK+3);continue;
  }
  wait(k.WORK,signal);
 }
}
extern "C" void run(int owner,int*config){K k(config);help(k,owner);}
extern "C" int advance(int*config,int chunk){K k(config);Owner instance(k,0);return instance.advance(chunk);}
extern "C" int requestConnectivity(int*config){K k(config);
 if(k.T<=1||!k.CHECK_ENABLED||k.WORK[7]<=0)return 0;
 k.CHECK_CONTROL[3]=k.ROOT_STATE[4];k.CONTROL[9]=1;
 add(k.WORK+6,1);add(k.WORK,1);notify(k.WORK);return 1;
}
extern "C" void applyConnectivity(int*config){K k(config);
 int count=k.CHECK_CONTROL[2],*state=k.ROOT_STATE,budget=state[2];
 if(count<state[1]){fail(k,15);return;}
 k.CHECK_CONTROL[6]=(count<budget?count:budget)-state[1];state[1]=count<budget?count:budget;state[0]=0;
}
extern "C" void finishRoute(int*config){K k(config);int*state=k.ROOT_STATE;
 if(k.CONTROL[9]){
  store(k.CHECK_CONTROL+4,1);
  while(!load(k.CHECK_CONTROL+1)&&!load(k.CONTROL+1))wait(k.CHECK_CONTROL+1,0);
  int status=load(k.CHECK_CONTROL+1);
  if((status==2&&k.CONTROL[10])||(status==1&&!k.CONTROL[10]&&state[0]==0)){fail(k,16);}
  if(status==2&&k.CHECK_CONTROL[2]<state[1])fail(k,15);
 }
 while(load(k.WORK+3)>0&&!load(k.CONTROL+1)){int active=load(k.WORK+3);if(active>0)wait(k.WORK+3,active);}
 if(!k.CONTROL[10]&&(state[0]==0||(k.CONTROL[9]&&load(k.CHECK_CONTROL+1)==2)))k.WORK[7]=64;
 else if(state[1]>=2048&&k.WORK[7]>0)k.WORK[7]--;
 k.CONTROL[6]=state[2]-state[1];k.ITERATIONS[0]=state[1];store(k.CONTROL+2,0);
}
extern "C" void single(int*config){K k(config);Owner instance(k,0);instance.advance(k.ROOT_STATE[2]);finishRoute(config);}
extern "C" void prepare(int*config,int route,int budget,double delta){K k(config);int goal=k.ROUTE_END[route],source=k.ROUTE_START[route],net=k.ROUTE_NET[route];
 for(int i=0;i<5;i++)k.ROOT_STATE[i]=0;k.ROOT_STATE[2]=budget;
 int jobs=0;k.CONTROL[9]=0;for(int i=0;i<8;i++)k.CHECK_CONTROL[i]=0;k.CHECK_CONTROL[7]=k.CHECK_ENABLED;
 for(int r=0;r<k.Rn;r++){
  int*m=k.LUT_META+r*4,version=k.HEADERS[r*8],n=k.HEADERS[r*8+3];
  if(m[3]==version&&m[2]>0)continue;
  if(m[2]<2*n+2){int cap=2;while(cap<2*n+2)cap*=2;int base=k.CONTROL[14];if(base+cap>k.LUT_CAP){fail(k,14);return;}k.CONTROL[14]=base+cap;m[1]=base;m[2]=cap;}
  m[3]=version;store(m,-1);if(n>=16&&!prepareMask(k,r))return;k.LUT_DIRTY[jobs++]=r;
 }
 k.CONTROL[12]=jobs;k.CONTROL[13]=0;k.CONTROL[5]=0;
 store(k.WORK+2,0);store(k.WORK+3,k.T-1);if(k.T>1){add(k.WORK+5,1);add(k.WORK,1);notify(k.WORK);}
 for(int i=0;i<k.H;i++){k.COST[i]=inf();k.PARENT[i]=-1;k.SETTLED[i]=0;k.POS[i]=-1;}
 for(int i=0;i<k.Rn;i++)k.FRONTIER_GEN[i]=0;
 for(int i=0;i<k.Pn;i++){double dx=k.P_X[i]-k.P_X[goal],dy=k.P_Y[i]-k.P_Y[goal];k.HEURISTIC[i]=__builtin_sqrt(dx*dx+dy*dy)*k.OPTIONS[0];}
 for(int i=0;i<k.T;i++)k.ITERATIONS[i]=0;
 k.CONTROL[10]=0;k.CONTROL[11]=-1;k.CONTROL[3]=route;k.CONTROL[4]=1;k.CONTROL[6]=budget;
 store(k.CONTROL+2,k.T);add(k.CONTROL,1);
}
