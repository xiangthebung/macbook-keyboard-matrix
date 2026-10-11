import test from 'node:test';
import assert from 'node:assert/strict';
import {ChordObservationSession,RawProbeSession,physicalEventDecision,observationReport} from '../hardware/observations.mjs';
const target={label:'three physical keys',keys:['S','C','J'],shift:false};
const press=(s,keys,time=100)=>{for(const k of keys)s.keyDown(k,{timestamp:time});let r;for(const k of keys)r=s.keyUp(k,{timestamp:time+10});return r;};
test('completion waits for every captured key release; extra keys remain aggregate evidence',()=>{
 const s=new ChordObservationSession([target]);
 for(const k of ['S','C','J','H'])s.keyDown(k);
 for(const k of ['S','C','J'])assert.equal(s.keyUp(k),null);
 assert.equal(s.results.length,0);
 const r=s.keyUp('H');assert.deepEqual(r.missing,[]);assert.deepEqual(r.extra,['H']);assert.equal(r.allRegistered,false);assert.equal(r.peakHeld.length,4);
});
test('sequentially seen target keys never satisfy simultaneous-held requirement',()=>{
 const s=new ChordObservationSession([target]);s.keyDown('S');s.keyDown('C');s.keyUp('S');s.keyDown('J');s.keyUp('C');const r=s.keyUp('J');
 assert.deepEqual(r.peak,['S','C']);assert.deepEqual(r.missing,['J']);assert.equal(r.allRegistered,false);
});
test('late Shift with all targets held works on either side and release is required',()=>{
 for(const side of ['ShiftLeft','ShiftRight']){
 const s=new ChordObservationSession([{...target,shift:true}]);s.keyDown('S');s.keyDown('C');s.keyDown('J');s.keyDown(side);
 for(const k of target.keys)assert.equal(s.keyUp(k),null);
 assert.equal(s.results.length,0);assert.equal(s.keyUp(side).allRegistered,true);
 }
});
test('Shift pressed only after targets are no longer all held is missing evidence',()=>{
 const s=new ChordObservationSession([{...target,shift:true}]);s.keyDown('S');s.keyDown('C');s.keyDown('J');s.keyUp('S');s.keyDown('ShiftRight');s.keyUp('C');s.keyUp('J');const r=s.keyUp('ShiftRight');assert.deepEqual(r.missing,['Shift']);
});
test('retry preserves earlier incomplete evidence; skip/cancel/interruption produce none',()=>{
 const s=new ChordObservationSession([target,target]);press(s,['S']);assert.equal(s.results.length,1);s.retryLast();assert.equal(s.index,0);press(s,target.keys);assert.equal(s.results.length,2);assert.equal(s.results[0].allRegistered,false);
 s.keyDown('S');s.interrupt();for(const k of target.keys)s.keyUp(k);assert.equal(s.results.length,2);
 s.skip();assert.equal(s.index,2);assert.equal(s.results.length,2);s.cancel();assert.equal(s.current,null);assert.match(observationReport(s),/does not diagnose/);
});
test('repeat discards an in-flight chord; raw peak is a lower bound on received events',()=>{
 const s=new ChordObservationSession([target]);s.keyDown('S');s.keyDown('C',{repeat:true});s.keyUp('S');assert.equal(s.results.length,0);
 const raw=new RawProbeSession();raw.keyDown('S');raw.keyDown('C');raw.keyUp('S');raw.keyDown('J');raw.keyUp('C');const r=raw.keyUp('J');assert.equal(r.count,2);assert.deepEqual(r.peakHeld,['S','C']);
 raw.keyDown('S');raw.interrupt();raw.keyUp('S');assert.equal(raw.observations.length,1);
});
test('trusted, focused, active input boundary rejects shortcuts, IME, repeat, Caps and Tab',()=>{
 const event={code:'KeyS',isTrusted:true,getModifierState:()=>false};assert.equal(physicalEventDecision(event).kind,'capture');
 for(const extra of [{isTrusted:false},{ctrlKey:true},{metaKey:true},{altKey:true},{isComposing:true},{keyCode:229},{repeat:true},{code:'Tab'},{code:'CapsLock'},{getModifierState:()=>true}])assert.equal(physicalEventDecision({...event,...extra}).kind,'interrupt');
 assert.equal(physicalEventDecision(event,{active:false}).kind,'interrupt');assert.equal(physicalEventDecision(event,{focused:false}).kind,'interrupt');assert.equal(physicalEventDecision({...event,code:'Escape'}).kind,'cancel');
});
