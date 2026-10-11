import test from 'node:test';
import assert from 'node:assert/strict';
import {LearningStore, STORAGE_KEY, blankProgress, recordResult, isRetained, isDue, localDay, migrateCompletedIDs} from '../learning-store.js';
const memoryStorage = () => {const items=new Map();return {getItem:key=>items.get(key)??null,setItem:(key,value)=>items.set(key,value),items};};
test('retention requires three later due checks; same-day repeats and early practice do not count',()=>{
  let p=recordResult(blankProgress(),{clean:true,fresh:true,day:100});
  assert.equal(p.firstPassDay,100);assert.equal(p.successfulDelayedChecks,0);assert.equal(p.nextCheckDay,101);
  p=recordResult(p,{clean:true,fresh:true,day:100});assert.equal(p.successfulDelayedChecks,0);
  p=recordResult(p,{clean:true,fresh:true,day:101});assert.equal(p.successfulDelayedChecks,1);assert.equal(p.nextCheckDay,104);
  p=recordResult(p,{clean:true,fresh:true,day:101});assert.equal(p.successfulDelayedChecks,1);
  p=recordResult(p,{clean:true,fresh:true,day:103});assert.equal(p.successfulDelayedChecks,1);
  p=recordResult(p,{clean:true,fresh:true,day:104});assert.equal(p.successfulDelayedChecks,2);assert.equal(p.nextCheckDay,111);
  assert.equal(isRetained(p),false);assert.equal(isDue(p,110),false);
  p=recordResult(p,{clean:true,fresh:true,day:111});assert.equal(p.successfulDelayedChecks,3);assert.equal(isRetained(p),true);
  assert.equal(isRetained({...p,firstDelayedCheckDay:109}),false);
});
test('assistance, errorful completion and repeated text reset streak without deleting earlier practice',()=>{
  let p=recordResult(blankProgress(),{clean:true,fresh:true,day:10});
  p=recordResult(p,{clean:true,fresh:true,day:11});p=recordResult(p,{clean:true,fresh:true,day:14});
  const passes=p.passes;p=recordResult(p,{clean:false,fresh:true,day:15,guided:true});
  assert.equal(p.successfulDelayedChecks,0);assert.equal(p.firstPassDay,10);assert.equal(p.passes,passes);assert.equal(p.guidedPasses,1);assert.equal(p.nextCheckDay,16);
  p=recordResult(p,{clean:true,fresh:false,day:16});assert.equal(p.successfulDelayedChecks,0);assert.equal(p.passes,passes);
});
test('clock rollback adds no practice or delayed evidence',()=>{
  const p=recordResult(blankProgress(),{clean:true,fresh:true,day:200});
  assert.deepEqual(recordResult(p,{clean:true,fresh:true,day:199}),p);
  assert.deepEqual(recordResult(p,{clean:false,fresh:true,day:199}),p);
});
test('local-day grouping uses the users calendar date rather than UTC time-of-day',()=>{
  const date=new Date(2026,9,7,23,59,59);
  assert.equal(localDay(date),Math.floor(Date.UTC(2026,9,7)/86400000));
});
test('mapping versions keep progress and assistance independent',()=>{
  const storage=memoryStorage(),store=new LearningStore(storage);
  store.record('mapping-A','first-chord',{clean:true,fresh:true,day:100});
  store.mark('mapping-A','first-chord',{assisted:true,day:101});
  assert.equal(store.progress('mapping-A','first-chord').pendingAssisted,true);
  assert.equal(store.progress('mapping-A','first-chord').nextCheckDay,102);
  assert.equal(store.progress('mapping-B','first-chord').firstPassDay,null);
  assert.equal(store.progress('mapping-B','first-chord').pendingAssisted,false);
  const restarted=new LearningStore(storage);assert.equal(restarted.progress('mapping-A','first-chord').pendingAssisted,true);
  restarted.mark('mapping-A','first-chord',{fresh:true,day:102});assert.equal(restarted.progress('mapping-A','first-chord').pendingAssisted,false);
});
test('storage is an aggregate allowlist and never saves passage text or raw key events',()=>{
  const storage=memoryStorage(),store=new LearningStore(storage);
  store.update('map','lesson',{...blankProgress(),attempts:2,passage:'private draft',keystrokes:['KeyA'],cursor:123});
  store.prefs({theme:'dark',draft:'private draft',rawEvents:[{code:'KeyA'}],textSize:500});
  const encoded=storage.getItem(STORAGE_KEY);assert.equal(encoded.includes('private draft'),false);assert.equal(encoded.includes('KeyA'),false);assert.equal(encoded.includes('cursor'),false);assert.equal(store.preferences.textSize,30);
});
test('disabled, throwing and malformed storage preserve a usable in-memory session and surface notice',()=>{
  for(const storage of [undefined,{getItem(){throw new Error('disabled');}},{getItem(){return '{broken';}}]){
    const warnings=[];const store=new LearningStore(storage,{onWarning:message=>warnings.push(message)});
    assert.equal(store.available,false);assert.equal(warnings.length,1);store.record('map','lesson',{clean:true,fresh:true,day:100});assert.equal(store.progress('map','lesson').passes,1);
  }
  const store=new LearningStore({getItem(){return null;},setItem(){throw new Error('full');}});
  assert.equal(store.save(),false);assert.equal(store.available,false);
});
test('legacy curriculum completion expands smaller lessons without inventing delayed evidence',()=>{
  const expansions={'first-chord':['first-ends'],'vowels':['right-thumb-vowels']};
  assert.deepEqual(migrateCompletedIDs(['first-chord','vowels'],1,expansions),['first-chord','vowels','first-ends','right-thumb-vowels']);
  assert.deepEqual(migrateCompletedIDs(['first-chord'],2,expansions),['first-chord']);
  const storage=memoryStorage();storage.setItem('keychord.learning.v1',JSON.stringify({completedIDs:['first-chord'],curriculumVersion:1}));
  const store=new LearningStore(storage,{expansions});assert.equal(store.progress('legacy','first-ends').guidedPasses,1);assert.equal(store.progress('legacy','first-ends').firstPassDay,null);assert.equal(isRetained(store.progress('legacy','first-ends')),false);
});
