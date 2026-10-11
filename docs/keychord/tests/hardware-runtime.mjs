import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as dataAPI from '../core/data.js';
import * as engineAPI from '../core/engine.js';
import * as plannerAPI from '../core/planner.js';
import * as bufferAPI from '../core/buffer.js';
import {createHardwareProfile} from '../hardware/profile.mjs';
import {createTrialAdapter,plannedTargets} from '../hardware/runtime.mjs';
import {buildErgonomicTrials,ERGONOMIC_CANDIDATES,ErgonomicTrialSession} from '../hardware/trial.mjs';
const core={...dataAPI,...engineAPI,...plannerAPI,...bufferAPI};
const exported=JSON.parse(await readFile(new URL('../data.json',import.meta.url),'utf8'));
const data=core.createRuntimeData(exported);
test('actual native planner supplies short words and executable capital alternatives under limits',()=>{
 const profile=createHardwareProfile(data,{modelID:'generic'});const words=plannedTargets(data,core,profile);assert.equal(words.length,3);assert.deepEqual(words.map(t=>t.label.split(' · ')[0]),['sat','hat','tan']);
 for(const target of words)assert.equal(new core.ChordEngine(data,'english').translate(target.keys,{join:target.shift}).signal,null);
 const capitals=plannedTargets(data,core,profile,'capitals');assert.ok(capitals.length>=4);assert.ok(capitals.every(t=>profile.usable(t.keys)));assert.ok(capitals.some(t=>t.label.startsWith('H')));
 const limited=createHardwareProfile(data,{modelID:'generic',rolloverLimit:2});assert.ok(plannedTargets(data,core,limited,'capitals').every(t=>t.keys.length<=2));
});
test('isolated English proposals exactly replay fresh and after-sat without changing dictionaries or C++',()=>{
 const originalJSON=JSON.stringify(exported);const originalCpp=new core.ChordEngine(data,'cpp').translate(['Quote','U','S']);
 const profile=createHardwareProfile(data,{modelID:'generic'});const adapter=createTrialAdapter(data,core,profile);
 for(const c of ERGONOMIC_CANDIDATES)assert.equal(adapter.compatibility(c).allowed,true);
 const trials=buildErgonomicTrials({optedIn:true,compatibility:adapter.compatibility,makeRoute:adapter.makeRoute});assert.equal(trials.length,16);
 for(const t of trials){assert.equal(adapter.replaySteps(t,t.steps),t.expectedOutput);if(t.route==='proposed')assert.deepEqual(t.steps[0].keys,ERGONOMIC_CANDIDATES.find(c=>c.word===t.word).keys);}
 assert.equal(JSON.stringify(exported),originalJSON);assert.deepEqual(new core.ChordEngine(data,'cpp').translate(['Quote','U','S']),originalCpp);assert.equal(originalCpp.actions[0].text,'using');
 const first=trials[0];const session=new ErgonomicTrialSession([first],{replaySteps:adapter.replaySteps});let tick=100;
 for(const step of first.steps){for(const k of step.keys)session.keyDown(k,{timestamp:tick});if(step.shift)session.keyDown('ShiftRight',{timestamp:tick+2});for(const k of step.keys)session.keyUp(k,{timestamp:tick+10});if(step.shift)session.keyUp('ShiftRight',{timestamp:tick+12});tick+=30;}
 assert.notEqual(session.pendingMilliseconds,null);assert.equal(session.rateComfort(3),true);
});
test('runtime trial collision and rollover checks prevent isolated proposals from being executed',()=>{
 const profile=createHardwareProfile(data,{modelID:'generic',rolloverLimit:2});const adapter=createTrialAdapter(data,core,profile);assert.equal(adapter.compatibility(ERGONOMIC_CANDIDATES[0]).allowed,false);
 const copy=structuredClone(exported);copy.dictionaries.english.push({keys:['Quote','U','S'],entry:{type:'text',text:'existing',kind:'word'}});const collisionData=core.createRuntimeData(copy);const collision=createTrialAdapter(collisionData,core,createHardwareProfile(collisionData));assert.doesNotThrow(()=>collision.compatibility(ERGONOMIC_CANDIDATES[0]));assert.match(collision.compatibility(ERGONOMIC_CANDIDATES[0]).problems.join(' '),/already has/);assert.equal(collision.makeRoute(ERGONOMIC_CANDIDATES[0],'proposed','fresh'),null);assert.equal(collision.compatibility({word:'use',keys:['AbsentKey']}).allowed,false);
});
