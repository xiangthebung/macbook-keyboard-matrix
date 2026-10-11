import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PracticeProgress,restoreDeclaredMode} from '../learning.js';
import {createRuntimeData,keyMeanings} from '../core/data.js';
import {initialContext,ChordEngine} from '../core/engine.js';
import {planText,replayGuide,matchGuideProgress} from '../core/planner.js';
import {createBuffer,applyActions} from '../core/buffer.js';
const data=createRuntimeData(JSON.parse(await readFile(new URL('../data.json',import.meta.url),'utf8')));
const track=guide=>new PracticeProgress(guide,replayGuide(data,guide),initialContext(),matchGuideProgress);
test('temporary suffix bases are correct and the suffix remains the next guided step',()=>{
  const guide=planText('making',{data,mode:'english',profile:'generic'});const replay=replayGuide(data,guide);const tracker=track(guide);
  const suffix=guide.steps.findIndex(step=>step.kind==='suffix');assert.ok(suffix>0,'real engine should choose make + ing');
  const before=replay.results[suffix-1];assert.equal(before.buffer.text,'make');assert.equal('making'.startsWith(before.buffer.text),false);
  const p=tracker.update({text:before.buffer.text,cursor:before.buffer.cursor,context:before.context});assert.equal(p.correct,true);assert.equal(p.complete,false);assert.equal(p.nextStep,suffix);
  const after=replay.results[suffix];assert.equal(after.buffer.text,'making');assert.equal(tracker.update({text:after.buffer.text,cursor:after.buffer.cursor,context:after.context}).complete,true);
});
test('zero-output capital command needs actual engine context and is never inferred at an empty field',()=>{
  const sat=planText('sat',{data,mode:'english',profile:'generic'});const keys=keyMeanings(data).capitalizeNextKeys;
  const engine=new ChordEngine(data);engine.translate(keys);const command={action:{type:'chord',keys,shift:false},kind:'command',output:'',textEnd:0,tail:'',source:[0,3],contextAfter:engine.currentContext};
  const guide={...sat,text:'Sat',steps:[command,...sat.steps.map(step=>({...step,output:step.output.replace('sat','Sat')}))]};const replay=replayGuide(data,guide),tracker=track(guide);
  assert.equal(tracker.update({text:'',cursor:0,context:initialContext()}).nextStep,0);
  assert.equal(tracker.contextFor('',0).pendingCap,false);
  assert.equal(tracker.update({text:'',cursor:0,context:replay.results[0].context}).nextStep,1);
  const final=replay.results.at(-1);assert.equal(final.buffer.text,'Sat');assert.equal(tracker.update({text:final.buffer.text,cursor:final.buffer.cursor,context:final.context}).complete,true);
});
test('C++ snippets track cursor and exit command despite unchanged full-buffer text',()=>{
  const steps=[{action:{type:'chord',keys:['I','F','Quote']},kind:'symbol',output:'if ()',note:'if snippet'},...planText('sat',{data,mode:'cpp'}).steps,{action:{type:'chord',keys:['RBracket','Backslash']},kind:'command',output:'',note:'jump out of the snippet'}];
  const guide={text:'if (sat)',mode:'cpp',steps};const replay=replayGuide(data,guide);
  guide.steps=steps.map((step,i)=>({...step,source:[0,8],group:i,textEnd:replay.results[i].buffer.text.length,tail:replay.results[i].buffer.text.slice(replay.results[i].buffer.cursor),contextAfter:replay.results[i].context}));
  const tracker=track(guide);
  const snippetIndex=replay.results.findIndex(state=>state.buffer.cursor<state.buffer.text.length&&state.context.snippets.length);
  assert.ok(snippetIndex>=0,'real C++ plan should use a snippet');
  const state=replay.results[snippetIndex];const p=tracker.update({text:state.buffer.text,cursor:state.buffer.cursor,context:state.context});assert.equal(p.correct,true);assert.equal(p.nextStep,snippetIndex+1);
  const exitIndex=guide.steps.findIndex(step=>step.kind==='command'&&step.note.includes('jump out'));
  assert.ok(exitIndex>0);const before=replay.results[exitIndex-1],after=replay.results[exitIndex];assert.equal(before.buffer.text,after.buffer.text);assert.notEqual(before.buffer.cursor,after.buffer.cursor);
  assert.equal(tracker.update({text:before.buffer.text,cursor:before.buffer.cursor,context:before.context}).nextStep,exitIndex);
  assert.equal(tracker.update({text:after.buffer.text,cursor:after.buffer.cursor,context:after.context}).nextStep,exitIndex+1);
});
test('a real alternate snippet recipe is valid while the ordinary parentheses guide stays useful',()=>{
  const guide=planText('if (sat)',{data,mode:'cpp'}),tracker=track(guide),engine=new ChordEngine(data,'cpp');let buffer=createBuffer();
  buffer=applyActions(buffer,engine.translate(['I','F','Quote']).actions);
  const p=tracker.update({...buffer,context:engine.currentContext});assert.equal(buffer.text,'if ()');assert.equal(p.correct,true);assert.equal(p.complete,false);assert.equal(guide.steps[p.nextStep].kind,'syllable');
});
test('a mode-switch chord is restored to the fields declared mode before resuming',()=>{
  const engine=new ChordEngine(data,'english');engine.translate(keyMeanings(data).modeSwitchKeys);assert.equal(engine.subMode,'cpp');
  assert.equal(restoreDeclaredMode(engine,'english'),true);assert.equal(engine.subMode,'english');assert.equal(engine.chordInProgress,false);assert.equal(engine.undoDepth,0);assert.equal(restoreDeclaredMode(engine,'english'),false);
});
test('actual Undo returns the tracked guide to the previous real output state',()=>{
  const guide=planText('sat hat',{data,mode:'english',profile:'generic'}),tracker=track(guide),engine=new ChordEngine(data);let buffer=createBuffer();
  for(const step of guide.steps)buffer=applyActions(buffer,engine.translate(step.action.keys,{join:step.action.shift}).actions);
  assert.equal(tracker.update({...buffer,context:engine.currentContext}).complete,true);
  buffer=applyActions(buffer,engine.translate(keyMeanings(data).undoKeys).actions);
  const p=tracker.update({...buffer,context:engine.currentContext});assert.equal(buffer.text,'sat');assert.equal(p.correct,true);assert.equal(p.nextStep,1);assert.equal(p.complete,false);
});
