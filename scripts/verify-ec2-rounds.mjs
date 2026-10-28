/** Operador: Node 24 --env-file=/etc/spookython/backend.env scripts/verify-ec2-rounds.mjs
 * Usa el escritor desplegado; no inicia otro backend ni imprime la API key. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
import { writeFile, mkdir } from 'node:fs/promises';
const backendDir=process.env.BACKEND_DIR ?? '/opt/spookython/current/backend';
const require=createRequire(backendDir+'/package.json');
const WebSocket=require('ws');
const {DynamoDBClient}=require('@aws-sdk/client-dynamodb');
const {DynamoDBDocumentClient,GetCommand}=require('@aws-sdk/lib-dynamodb');
const base=process.env.PUBLIC_API_URL ?? 'https://3-128-78-190.sslip.io';
const apiKey=process.env.ROUTE_API_KEY;
if(!apiKey)throw Error('ROUTE_API_KEY requerida desde archivo externo');
const output=process.env.ACCEPTANCE_OUTPUT ?? '/opt/spookython/evidence/rounds.json';
const result={startedAt:new Date().toISOString(),backendCommit:process.env.BACKEND_COMMIT??null,endpoint:base,rounds:[],complete:false};
const raw=new DynamoDBClient({region:process.env.AWS_REGION??'us-east-2'});
const db=DynamoDBDocumentClient.from(raw);
const save=async()=>{await mkdir(output.slice(0,output.lastIndexOf('/')),{recursive:true});await writeFile(output,JSON.stringify(result,null,2));};
const request=async(path,body)=>{
 const response=await fetch(base+path,{method:body?'POST':'GET',headers:body?{'content-type':'application/json','x-api-key':apiKey}:{},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(8000)});
 const json=await response.json();if(!response.ok)throw Error(`${path}: ${response.status} ${json.error?.code??''}`);return json;
};
let socket;
try {
 for(const roundId of [1,2,3]){
  const gameId=`ec2-accept-${Date.now().toString(36)}-r${roundId}`,seed=`ec2-acceptance-${roundId}`;
  const pending=[],waiters=[];
  socket=new WebSocket(base.replace('https:','wss:')+'/ws');
  socket.on('message',data=>{const update=JSON.parse(data.toString());if(update.world?.gameId!==gameId)return;const next=waiters.shift();if(next)next(update.world);else pending.push(update.world);});
  socket.on('error',()=>{});
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Timeout WS')),10000);socket.once('open',()=>{clearTimeout(timer);resolve();});socket.once('error',error=>{clearTimeout(timer);reject(error);});});
  const nextWorld=()=>pending.length?Promise.resolve(pending.shift()):new Promise((resolve,reject)=>{const done=w=>{clearTimeout(timer);resolve(w);};const timer=setTimeout(()=>{const i=waiters.indexOf(done);if(i>=0)waiters.splice(i,1);reject(Error('Timeout TURN_UPDATE'));},12000);waiters.push(done);});
  let current=null;try{current=await request('/estado');}catch(error){if(!String(error).includes('GAME_NOT_STARTED'))throw error;}
  if(current?.status==='running')throw Error('Hay una partida en ejecución; no se reemplaza silenciosamente');
  const start=performance.now();
  await request(current?.status==='paused'?'/simulador/reiniciar':'/simulador/iniciar',{gameId,roundId,seed});
  const summary={roundId,gameId,survivors:[20,80,200][roundId-1],turns:0,maxP95Ms:0,minAvailability:100,deadlineMisses:0,movements:0,routeTargetsObserved:0,blockedSegments:0,httpWsEqual:0,observations:[]};
  result.rounds.push(summary);let previous=null;
  for(let turn=0;turn<=150;turn++){
   const world=await nextWorld();assert.equal(world.turnId,turn);assert.equal(world.gameId,gameId);assert.equal(world.survivors.length,summary.survivors);
   const http=await request('/estado');assert.deepEqual(http,world,'GET /estado y WS difieren');summary.httpWsEqual++;
   assert(world.shelters.every(s=>s.ocupantes.length+s.reservados.length<=s.capacidad));
   assert.equal(world.metrics.activeSurvivors+world.metrics.bittenSurvivors+world.metrics.evacuatedSurvivors,summary.survivors);
   if(previous){const nodes=new Map(previous.survivors.map(s=>[s.id,s.nodeId]));summary.movements+=world.survivors.filter(s=>nodes.get(s.id)!==s.nodeId).length;}
   summary.routeTargetsObserved+=world.survivors.filter(s=>s.targetShelterId!==null).length;
   summary.turns=turn;summary.maxP95Ms=Math.max(summary.maxP95Ms,world.metrics.routeLatencyP95Ms);
   if(world.metrics.routeSamples)summary.minAvailability=Math.min(summary.minAvailability,world.metrics.routeAvailabilityPercent);
   summary.deadlineMisses=world.metrics.deadlineMisses;summary.blockedSegments=world.blockedEdges.filter(b=>b.desbloqueadaEnTurno===null).length;
   summary.observations.push({turnId:turn,worldVersion:world.worldVersion,status:world.status,p95Ms:world.metrics.routeLatencyP95Ms,active:world.metrics.activeSurvivors,saved:world.metrics.evacuatedSurvivors,bitten:world.metrics.bittenSurvivors,deadlineMisses:world.metrics.deadlineMisses,queueDepth:world.metrics.snapshotQueueDepth,lastPersistedTurn:world.metrics.lastSnapshotTurnId});
   if(turn>0&&world.status==='paused'){await save();throw Error(`R${roundId} pausó en turno ${turn}; deadlineMisses=${world.metrics.deadlineMisses}`);}
   assert.equal(world.status,turn===150?'completed':'running');
   if(turn===1||turn%30===0||turn===75||turn===105){await save();console.log(JSON.stringify({event:'round-progress',roundId,turnId:turn,p95Ms:world.metrics.routeLatencyP95Ms,maxP95Ms:summary.maxP95Ms,deadlineMisses:summary.deadlineMisses,blockedSegments:summary.blockedSegments}));}
   previous=world;
  }
  summary.elapsedMs=Math.round(performance.now()-start);summary.completed=true;
  assert.equal(summary.blockedSegments,[0,1,2][roundId-1]);assert(summary.movements>0);assert(summary.routeTargetsObserved>0);
  // El puntero solo se confirma después de persistir el manifiesto completo.
  let pointer;
  for(let i=0;i<50;i++){
   pointer=(await db.send(new GetCommand({TableName:process.env.DYNAMODB_TABLE_NAME??'spookython-manta-state',Key:{gameId:'META#LATEST',turnId:-1},ConsistentRead:true}))).Item;
   if(pointer?.gamePK===`GAME#${gameId}`&&pointer?.turnSK==='TURN#000150')break;
   await new Promise(r=>setTimeout(r,200));
  }
  assert.equal(pointer?.gamePK,`GAME#${gameId}`);assert.equal(pointer?.turnSK,'TURN#000150');summary.dynamoDbTurn150=true;
  summary.slaPassed=summary.maxP95Ms<=150&&summary.minAvailability===100&&summary.deadlineMisses===0;
  await save();console.log(JSON.stringify({event:'round-completed',...summary,observations:undefined}));
  socket.close();socket=null;
 }
 result.complete=true;result.slaPassed=result.rounds.every(r=>r.slaPassed);result.finishedAt=new Date().toISOString();await save();console.log(JSON.stringify({event:'acceptance-completed',slaPassed:result.slaPassed,rounds:3}));
 if(!result.slaPassed)process.exitCode=1;
}catch(error){result.error=error.message;result.finishedAt=new Date().toISOString();await save();console.error(JSON.stringify({event:'acceptance-failed',error:error.message}));process.exitCode=1;}
finally{socket?.terminate();raw.destroy();}
