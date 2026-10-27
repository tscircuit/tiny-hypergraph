typedef unsigned int U;
extern "C" __attribute__((import_module("env"),import_name("load_hops"))) int load_hops(int);
extern "C" __attribute__((import_module("env"),import_name("is_goal"))) int is_goal(int);
extern "C" __attribute__((import_module("env"),import_name("invalid_distance"))) void invalid_distance(int);
extern "C" __attribute__((import_module("env"),import_name("edge_distance"))) double edge_distance(int,int);
#ifdef SHARED_OWNER_KERNEL

#else
static int geometryStride=0,geometryGoal=-1;
extern "C" void geometry(int stride,int goal){geometryStride=stride;geometryGoal=goal;}
static U top;
extern "C" unsigned char __heap_base;
extern "C" void reset(){top=(U)&__heap_base;geometryStride=0;geometryGoal=-1;}
extern "C" U allocate(U bytes){U at=(top+7)&~7u;top=at+bytes;U pages=__builtin_wasm_memory_size(0);if(top>pages*65536u){if(__builtin_wasm_memory_grow(0,(top-pages*65536u+65535u)/65536u)==(U)-1)__builtin_trap();}return at;}
#endif
extern "C" void* memset(void*p,int c,U n){unsigned char*q=(unsigned char*)p;for(U i=0;i<n;i++)q[i]=c;return p;}
extern "C" void* memcpy(void*p,const void*s,U n){unsigned char*q=(unsigned char*)p;const unsigned char*r=(const unsigned char*)s;for(U i=0;i<n;i++)q[i]=r[i];return p;}
struct Arena{
 U top,end;
 Arena(U begin=0,U limit=0):top(begin),end(limit){}
 U take(U bytes){
#ifdef SHARED_OWNER_KERNEL
  U pointer=(top+7)&~7u;if(pointer>end||bytes>end-pointer)invalid_distance(2);top=pointer+bytes;return pointer;
#else
  return allocate(bytes);
#endif
 }
};
template<class T>static T* alloc(Arena&arena,int n){return (T*)arena.take(sizeof(T)*n);}
template<class T>struct Vec{Arena&arena;Vec(Arena&a):arena(a){}T*data=0;int size=0,cap=0;void push(T v){if(size==cap){int next=cap?cap*2:16;T*p=alloc<T>(arena,next);for(int i=0;i<size;i++)p[i]=data[i];data=p;cap=next;}data[size++]=v;}};
struct Bits{int count,wordCount;int*ids;U*words;};
static Bits empty={0,0,0,0};
struct Hop{int target;int*owners;int ownerCount;int column;double distance;};
struct HopList{int count,pad;Hop hops[];};
struct Label{int state,hopIndex;Bits*owners;int active;double distance,order;Label*parent,*next;};
static int labelCount(Label*label){
 return label->active>>1;
}
static bool less(Label*a,Label*b){if(labelCount(a)!=labelCount(b))return labelCount(a)<labelCount(b);if(a->distance!=b->distance)return a->distance<b->distance;return a->order<b->order;}
struct Heap{Vec<Label*>v;Heap(Arena&a):v(a){}void push(Label*l){int at=v.size;v.push(l);while(at){int p=(at-1)/2;if(!less(l,v.data[p]))break;v.data[at]=v.data[p];at=p;}v.data[at]=l;}Label*pop(){if(!v.size)return 0;Label*first=v.data[0],*last=v.data[--v.size];if(v.size){int at=0;for(;;){int l=at*2+1;if(l>=v.size)break;int r=l+1,c=r<v.size&&less(v.data[r],v.data[l])?r:l;if(!less(v.data[c],last))break;v.data[at]=v.data[c];at=c;}v.data[at]=last;}return first;}};
static bool subset(Bits*a,Bits*b){
 if(a==b)return true;if(a->count>b->count)return false;
 if(a->count<a->wordCount){for(int i=0;i<a->count;i++){int id=a->ids[i],word=id>>5;if(word>=b->wordCount||!(b->words[word]&(1u<<(id&31))))return false;}return true;}
 for(int i=0;i<a->wordCount;i++)if(a->words[i]&~(i<b->wordCount?b->words[i]:0))return false;return true;
}
static bool subsetUnion(Bits*a,Bits*b,int*added,int addedCount){
 if(a==b)return true;if(a->count>b->count+addedCount)return false;
 for(int i=0;i<a->count;i++){int id=a->ids[i],word=id>>5;if(word<b->wordCount&&(b->words[word]&(1u<<(id&31))))continue;
  bool found=false;for(int j=0;j<addedCount;j++)if(added[j]==id){found=true;break;}if(!found)return false;
 }return true;
}
static Bits*unite(Arena&arena,Bits*b,Hop&h){int words=b->wordCount,added=0;for(int i=0;i<h.ownerCount;i++){int id=h.owners[i],word=id>>5;U bit=1u<<(id&31);if(word>=b->wordCount||!(b->words[word]&bit))added++;if(word>=words)words=word+1;}if(!added)return b;Bits*out=alloc<Bits>(arena,1);out->count=b->count;out->wordCount=words;out->ids=alloc<int>(arena,b->count+added);out->words=alloc<U>(arena,words);for(int i=0;i<words;i++)out->words[i]=i<b->wordCount?b->words[i]:0;for(int i=0;i<b->count;i++)out->ids[i]=b->ids[i];for(int i=0;i<h.ownerCount;i++){int id=h.owners[i],word=id>>5;U bit=1u<<(id&31);if(!(out->words[word]&bit)){out->words[word]|=bit;out->ids[out->count++]=id;}}return out;}
struct Result{int found,reason,expanded,pathCount;int*path;int ownerCount;int*owners;int pad;double distance;};
#ifdef SHARED_OWNER_KERNEL
extern "C" Result* search(double limit,int startingState,int geometryStride,int geometryGoal,int*bound,int*geometryBase,int*geometryLocal,double*geometryDistances,U arenaBegin,U arenaEnd)
#else
extern "C" Result* search(double limit,int startingState)
#endif
{
#ifdef SHARED_OWNER_KERNEL
 Arena arena(arenaBegin,arenaEnd);
#else
 Arena arena;
#endif
 Vec<Label*>buckets(arena);Vec<HopList*>hops(arena);Heap queue(arena);double order=0;int expanded=0;
 auto ensure=[&](int state){while(buckets.size<=state){buckets.push(0);hops.push(0);}};
 ensure(startingState);Label*start=alloc<Label>(arena,1);*start={startingState,-1,&empty,1,0,order++,0,0};buckets.data[startingState]=start;queue.push(start);
 Result*result=alloc<Result>(arena,1);*result={0,0,0,0,0,0,0,0,0};Label*goal=0;
 for(;;){Label*current;do{current=queue.pop();}while(current&&!(current->active&1));if(!current)break;
  if(geometryStride?current->state/geometryStride==geometryGoal:is_goal(current->state)){
   goal=current;break;
  }if(expanded>=limit){result->reason=1;break;}expanded++;
  HopList*list=hops.data[current->state];if(!list){list=(HopList*)load_hops(current->state);hops.data[current->state]=list;}
  for(int i=0;i<list->count;i++){Hop&hop=list->hops[i];
#ifdef SHARED_OWNER_KERNEL
   if(bound[2]){int*forbidden=(int*)bound[2];bool blocked=false;for(int j=0;j<hop.ownerCount;j++)if(forbidden[hop.owners[j]]){blocked=true;break;}if(blocked)continue;}
#endif
   double hopDistance=hop.distance;
   if(geometryStride&&list->pad){int a=current->state/geometryStride,b=hop.target/geometryStride;if(a==b)continue;
#ifdef SHARED_OWNER_KERNEL
   int row=geometryLocal[current->state],column=hop.column,hi=row>column?row:column,lo=row<column?row:column;
   hopDistance=geometryDistances[geometryBase[current->state]+hi*(hi-1)/2+lo];
#else
   hopDistance=edge_distance(a,b);
#endif
   }
   if(!__builtin_isfinite(hopDistance)||hopDistance<0)invalid_distance(0);double distance=current->distance+hopDistance;if(!__builtin_isfinite(distance))invalid_distance(1);
   ensure(hop.target);double candidateOrder=order++;   bool dominated=false;for(Label*l=buckets.data[hop.target];l;l=l->next)if(l->distance<=distance&&subsetUnion(l->owners,current->owners,hop.owners,hop.ownerCount)){dominated=true;break;}if(dominated)continue;
   Bits*owners=unite(arena,current->owners,hop);Label*candidate=alloc<Label>(arena,1);*candidate={hop.target,i,owners,(owners->count<<1)|1,distance,candidateOrder,current,0};
   Label*previous=0,*next=buckets.data[hop.target];while(next){Label*l=next;next=l->next;if(distance<=l->distance&&subset(owners,l->owners)){l->active&=~1;if(previous)previous->next=next;else buckets.data[hop.target]=next;}else previous=l;}
   if(previous)previous->next=candidate;else buckets.data[hop.target]=candidate;queue.push(candidate);
  }
 }
 result->expanded=expanded;if(!goal)return result;
 result->found=1;result->distance=goal->distance;result->ownerCount=goal->owners->count;result->owners=goal->owners->ids;
 for(Label*l=goal;l;l=l->parent)result->pathCount++;result->path=alloc<int>(arena,result->pathCount*2);int i=result->pathCount-1;for(Label*l=goal;l;l=l->parent){result->path[i*2]=l->state;result->path[i*2+1]=l->hopIndex;i--;}
 return result;
}
#ifdef SHARED_OWNER_KERNEL
static int atomicRead(int*p){return __atomic_load_n(p,__ATOMIC_SEQ_CST);}
static void atomicWrite(int*p,int value){__atomic_store_n(p,value,__ATOMIC_SEQ_CST);}
static int atomicAdd(int*p,int value){return __atomic_fetch_add(p,value,__ATOMIC_SEQ_CST);}
static bool compareSwap(int*p,int&expected,int value){return __atomic_compare_exchange_n(p,&expected,value,false,__ATOMIC_SEQ_CST,__ATOMIC_SEQ_CST);}
static int graphAllocate(int*bound,int bytes){
 int aligned=(bytes+7)&~7,at=atomicAdd(bound+8,aligned);if(at+aligned>bound[9])invalid_distance(4);return at;
}
struct NativeGraph{
 int P,R,S,*R1,*R2,*A1,*A2,*Z,*MASK,*RNET,*ROUTENET,*RESERVED,*SECTION,*ASSIGN,*FORBIDDEN,*OWNER_OFF,*OWNERS,*SEG_OFF,*SEGMENTS,net;
 NativeGraph(int*c):P(c[0]),R(c[1]),S(c[2]),R1((int*)c[3]),R2((int*)c[4]),A1((int*)c[5]),A2((int*)c[6]),Z((int*)c[7]),MASK((int*)c[8]),RNET((int*)c[9]),ROUTENET((int*)c[10]),RESERVED((int*)c[11]),SECTION((int*)c[12]),ASSIGN((int*)c[13]),FORBIDDEN((int*)c[14]),OWNER_OFF((int*)c[15]),OWNERS((int*)c[16]),SEG_OFF((int*)c[17]),SEGMENTS((int*)c[18]),net(c[19]){}
 int hop(int port,int region){return port*S+(R1[port]==region?0:1);}
 int angle(int port,int region){return R1[port]==region?A1[port]:A2[port];}
 bool reserved(int region){return RNET[region]!=-1&&RNET[region]!=net;}
};
static void appendOwner(int*owners,int&count,int owner){for(int i=0;i<count;i++)if(owners[i]==owner)return;owners[count++]=owner;}
extern "C" void prepareNativeGraph(int*config,int*pointers,int*regionOffsets,int*regionPorts,int*geometryLocal,int stride,int goal,int*bound,U arenaBegin,U arenaEnd,int owner){
 NativeGraph g(config);Arena scratch(arenaBegin,arenaEnd);int builtRows=0;
 for(;;){
  if(atomicRead(bound+7))return;
  int task=atomicAdd(bound+10,1);if(task>=g.P*g.S)break;
  int fromPort=task/g.S,slot=task%g.S,region=slot==0?g.R1[fromPort]:g.R2[fromPort];if(region<0)continue;
  int begin=regionOffsets[region],end=regionOffsets[region+1],degree=end-begin;
  bool single=g.MASK[region]>0&&(g.MASK[region]&(g.MASK[region]-1))==0;
  if(!single&&(degree==0||regionPorts[begin]!=fromPort))continue;
  int segmentBegin=g.SEG_OFF[region],segmentEnd=g.SEG_OFF[region+1];
  int maxOwners=segmentEnd-segmentBegin;
  for(int at=begin;at<end;at++){int b=regionPorts[at],n=g.OWNER_OFF[b+1]-g.OWNER_OFF[b];if(n>maxOwners)maxOwners=n;}
  maxOwners+=segmentEnd-segmentBegin;
  scratch.top=arenaBegin;
  int*owners=alloc<int>(scratch,maxOwners+1);
  int sourceCount=1;
  for(int source=0;source<sourceCount;source++){
   int a=fromPort;
   Hop*pending=alloc<Hop>(scratch,degree);int*pendingOwners=alloc<int>(scratch,degree*maxOwners);int pendingCount=0,ownerCount=0;
   if(!g.reserved(region))for(int at=begin;at<end;at++){
    int b=regionPorts[at];if(single&&a==b)continue;
    int reservation=g.RESERVED[b];if(reservation==-2||(reservation!=-1&&reservation!=g.net))continue;
    if(b!=goal&&g.SECTION[b]==0)continue;
    int next=region;if(b!=goal){next=g.R1[b]==region?g.R2[b]:g.R1[b];if(next<0||g.reserved(next))continue;}
    int count=0;
    if(g.ASSIGN[b]!=-1&&g.ASSIGN[b]!=g.net){
     for(int i=g.OWNER_OFF[b];i<g.OWNER_OFF[b+1];i++){int owner=g.OWNERS[i];if(g.ROUTENET[owner]!=g.net)appendOwner(owners,count,owner);}
     if(count==0)invalid_distance(3);
    }
    if(single){
     int aa=g.angle(a,region),ba=g.angle(b,region),lo=aa<ba?aa:ba,hi=aa<ba?ba:aa,mask=(1<<g.Z[a])|(1<<g.Z[b]);
     for(int segment=segmentBegin;segment<segmentEnd;segment++){
      int owner=g.SEGMENTS[segment*3],from=g.SEGMENTS[segment*3+1],to=g.SEGMENTS[segment*3+2];if(g.ROUTENET[owner]==g.net)continue;
      if(!(mask&((1<<g.Z[from])|(1<<g.Z[to]))))continue;
      int x=g.angle(from,region),y=g.angle(to,region),lower=x<y?x:y,upper=x<y?y:x;
      if(lo==lower||lo==upper||hi==lower||hi==upper)continue;
      if((lo<lower&&lower<hi)!=(lo<upper&&upper<hi))appendOwner(owners,count,owner);
     }
    }
    int*output=count?pendingOwners+ownerCount:0;for(int i=0;i<count;i++)output[i]=owners[i];ownerCount+=count;
    pending[pendingCount++]={g.hop(b,next),output,count,at-begin,0};
   }
   // Publish one contiguous row, avoiding a shared allocator operation for
   // every edge's owner list and retaining locality during label expansion.
   HopList*list=(HopList*)graphAllocate(bound,8+pendingCount*sizeof(Hop)+ownerCount*4);list->count=pendingCount;list->pad=1;
   int*output=(int*)((unsigned char*)list+8+pendingCount*sizeof(Hop));
   for(int i=0;i<pendingCount;i++){Hop item=pending[i];int*owners=item.ownerCount?output:0;for(int j=0;j<item.ownerCount;j++)*output++=item.owners[j];item.owners=owners;list->hops[i]=item;}
   builtRows++;
   if(single)atomicWrite(pointers+g.hop(a,region),(int)list);
   else for(int at=begin;at<end;at++)atomicWrite(pointers+g.hop(regionPorts[at],region),(int)list);
  }
 }
 atomicWrite(bound+12+owner,builtRows);
 if(atomicAdd(bound+11,-1)==1)__builtin_wasm_memory_atomic_notify(bound+11,4);
 while(atomicRead(bound+11)>0&&!atomicRead(bound+7)){int active=atomicRead(bound+11);if(active>0)__builtin_wasm_memory_atomic_wait32(bound+11,active,1000000);}
}
// The prepared rows are shared with the label search. Connectivity needs at
// most two incoming ports per multilayer region: the second can return through
// the first port, while every later incoming port exposes the same exits.
extern "C" Result* checkReachability(double limit,int start,int stride,int goal,int*pointers,int*config,int*geometryBase,int*geometryLocal,double*distances,U arenaBegin,U arenaEnd){
 NativeGraph g(config);Arena arena(arenaBegin,arenaEnd);int H=g.P*stride,keys=H*2+g.R*4+4;
 int*queue=alloc<int>(arena,H),*first=alloc<int>(arena,g.R);unsigned char*seen=alloc<unsigned char>(arena,keys),*original=alloc<unsigned char>(arena,H);
 for(int i=0;i<keys;i++)seen[i]=0;for(int i=0;i<H;i++)original[i]=0;for(int i=0;i<g.R;i++)first[i]=-1;
 auto key=[&](int state){int port=state/stride,region=state%stride==0?g.R1[port]:g.R2[port];int mask=g.MASK[region];if(mask>0&&(mask&(mask-1))==0)return state*2+1;
  int a=first[region];if(a<0)first[region]=port;return region*4+(a<0||a==port?0:2);};
 int head=0,tail=1,expanded=0,originalCount=1;double totalDistance=0;queue[0]=start;seen[key(start)]=1;original[start]=1;
 while(head<tail){int state=queue[head++],a=state/stride;if(a==goal)return 0;if(expanded>=limit)return 0;expanded++;
  HopList*list=(HopList*)pointers[state];
  for(int i=0;i<list->count;i++){Hop&hop=list->hops[i];bool blocked=false;for(int j=0;j<hop.ownerCount;j++)if(g.FORBIDDEN[hop.owners[j]]){blocked=true;break;}if(blocked)continue;int b=hop.target/stride;if(a==b)continue;
   int row=geometryLocal[state],column=hop.column,hi=row>column?row:column,lo=row<column?row:column;
   double distance=list->pad?distances[geometryBase[state]+hi*(hi-1)/2+lo]:hop.distance;
   totalDistance+=distance;if(distance<0||!__builtin_isfinite(totalDistance))return 0;
   if(!original[hop.target]){original[hop.target]=1;originalCount++;if(originalCount>limit)return 0;}
   if(b==goal)return 0;int k=key(hop.target);if(seen[k])continue;seen[k]=1;queue[tail++]=hop.target;
  }
 }
 Result*result=alloc<Result>(arena,1);*result={0,0,originalCount,0,0,0,0,0,0};return result;
}
#endif
