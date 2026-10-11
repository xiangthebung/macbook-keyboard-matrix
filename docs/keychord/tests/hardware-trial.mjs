import test from 'node:test';
import assert from 'node:assert/strict';
import {candidateCompatibility,buildErgonomicTrials,ErgonomicTrialSession,ergonomicReport,ERGONOMIC_CANDIDATES} from '../hardware/trial.mjs';
const candidate=ERGONOMIC_CANDIDATES[0];
const allowed={layoutNames:['Quote','U','S','Y','O'],replay:(c,x)=>x==='fresh'?c.word:`sat ${c.word}`};
const makeRoute=(c,route,context)=>({route,steps:[{keys:route==='proposed'?c.keys:['S','C','J'],shift:false}],context});
test('English proposals reject dictionary collisions, rollover, selected limits and spacing/context failures',()=>{
 assert.equal(candidateCompatibility(candidate,allowed).allowed,true);
 for(const changed of [{mode:'cpp'},{layoutNames:['S']},{collision:()=>true},{rolloverLimit:2},{usable:()=>false},{replay:(c,ctx)=>ctx==='fresh'?c.word:`sat${c.word}`}])assert.equal(candidateCompatibility(candidate,{...allowed,...changed}).allowed,false);
});
test('trial requires opt-in and matched routes, two repetitions in both contexts, reversed route order',()=>{
 const args={compatibility:c=>candidateCompatibility(c,allowed),makeRoute};assert.deepEqual(buildErgonomicTrials(args),[]);
 const trials=buildErgonomicTrials({...args,optedIn:true});assert.equal(trials.length,16);
 for(const c of ERGONOMIC_CANDIDATES)for(const context of ['fresh','after-sat']){const first=trials.filter(t=>t.word===c.word&&t.context===context&&t.repetition===1);const second=trials.filter(t=>t.word===c.word&&t.context===context&&t.repetition===2);assert.deepEqual(first.map(t=>t.route),['current','proposed']);assert.deepEqual(second.map(t=>t.route),['proposed','current']);assert.equal(first[0].expectedOutput,context==='fresh'?c.word:`sat ${c.word}`);}
 assert.deepEqual(buildErgonomicTrials({...args,optedIn:true,makeRoute:(c,r,x)=>r==='current'?null:makeRoute(c,r,x)}),[]);
});
const oneTrial={word:'use',route:'proposed',context:'fresh',repetition:1,steps:[{keys:['Quote','U','S']}],expectedOutput:'use'};
function execute(session,keys,time=100){for(const k of keys)session.keyDown(k,{timestamp:time});for(const k of keys)session.keyUp(k,{timestamp:time+10});}
test('physical mistakes count corrections/time; comfort stays separate and invalid ratings give no credit',()=>{
 const s=new ErgonomicTrialSession([oneTrial],{replaySteps:()=> 'use'});execute(s,['Quote'],100);assert.equal(s.corrections,1);execute(s,oneTrial.steps[0].keys,200);assert.equal(s.pendingMilliseconds,110);assert.equal(s.measurements.length,0);
 for(const rating of [0,6,1.5,NaN])assert.equal(s.rateComfort(rating),false);assert.equal(s.rateComfort(4),true);assert.equal(s.measurements[0].corrections,1);assert.equal(s.measurements[0].comfort,4);assert.equal(s.measurements[0].elapsedMilliseconds,110);
});
test('interruption, repeat, skip, cancel or wrong output cannot create human measurements',()=>{
 const s=new ErgonomicTrialSession([oneTrial,oneTrial],{replaySteps:()=> 'use'});s.keyDown('Quote',{timestamp:100});s.interrupt();s.keyUp('Quote',{timestamp:120});assert.equal(s.started,null);assert.equal(s.measurements.length,0);
 s.keyDown('Quote',{timestamp:100});s.keyDown('U',{timestamp:101,repeat:true});assert.equal(s.started,null);assert.equal(s.pendingMilliseconds,null);s.skip();assert.equal(s.index,1);s.cancel();assert.equal(s.measurements.length,0);assert.match(ergonomicReport(s),/No human measurements collected/);
 const bad=new ErgonomicTrialSession([oneTrial],{replaySteps:()=> 'Using'});execute(bad,oneTrial.steps[0].keys);assert.equal(bad.pendingMilliseconds,null);assert.equal(bad.rateComfort(5),false);
});
test('ratings are possible only once all captured keys including late Shift are released',()=>{
 const t={...oneTrial,steps:[{keys:['Quote','U','S'],shift:true}]};const s=new ErgonomicTrialSession([t],{replaySteps:()=> 'use'});for(const k of t.steps[0].keys)s.keyDown(k,{timestamp:100});s.keyDown('ShiftRight',{timestamp:105});for(const k of t.steps[0].keys)s.keyUp(k,{timestamp:110});assert.equal(s.pendingMilliseconds,null);assert.equal(s.rateComfort(4),false);s.keyUp('ShiftRight',{timestamp:115});assert.equal(s.pendingMilliseconds,15);assert.equal(s.rateComfort(4),true);
});

test('invalid or colliding proposals stop before isolated replay and replay failures disable compatibility',()=>{
 let replayed=0;const replay=()=>{replayed++;throw new TypeError('strict dictionary validation');};
 for(const changed of [{collision:()=>true},{layoutNames:['S']},{rolloverLimit:2},{usable:()=>false},{collision:()=>{throw new TypeError('invalid mapping');}}]){
 const result=candidateCompatibility(candidate,{...allowed,...changed,replay});assert.equal(result.allowed,false);
 }
 assert.equal(replayed,0);
 for(const invalid of [null,{word:'use',keys:[]},{word:'',keys:['S']},{word:'use',keys:['S','S']}])assert.doesNotThrow(()=>assert.equal(candidateCompatibility(invalid,{...allowed,replay}).allowed,false));
 assert.equal(replayed,0);const result=candidateCompatibility(candidate,{...allowed,replay});assert.equal(result.allowed,false);assert.match(result.problems.join(' '),/could not run/);assert.equal(replayed,2);
});
