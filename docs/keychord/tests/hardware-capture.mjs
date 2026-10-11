import test from 'node:test';
import assert from 'node:assert/strict';
import {attachPhysicalCapture} from '../hardware/capture.mjs';
import {ChordObservationSession} from '../hardware/observations.mjs';
class SurfaceEvents {
 constructor(){this.listeners=new Map();}
 addEventListener(type,listener,{signal}={}){const rows=this.listeners.get(type)||[];rows.push(listener);this.listeners.set(type,rows);signal?.addEventListener('abort',()=>this.listeners.set(type,(this.listeners.get(type)||[]).filter(x=>x!==listener)));}
 emit(type,extra={}){const event={type,target:this,isTrusted:true,code:'KeyS',getModifierState:()=>false,preventDefault(){this.prevented=true;},stopPropagation(){this.stopped=true;},...extra};for(const f of this.listeners.get(type)||[])f(event);return event;}
}
function fixture(){const doc=new SurfaceEvents(),win=new SurfaceEvents(),surface=new SurfaceEvents();doc.defaultView=win;doc.hidden=false;doc.hasFocus=()=>true;doc.activeElement=null;surface.ownerDocument=doc;surface.focus=()=>{doc.activeElement=surface;};const session=new ChordObservationSession([{keys:['S','C']}]);const capture=attachPhysicalCapture(surface,{getSession:()=>session,mapEvent:e=>e.code==='KeyS'?'S':e.code==='KeyC'?'C':e.code});return {doc,win,surface,session,capture};}
test('keyboard capture is explicit, surface-owned and absent from document/window',()=>{
 const f=fixture();assert.equal(f.doc.listeners.has('keydown'),false);assert.equal(f.win.listeners.has('keydown'),false);f.surface.emit('keydown');f.surface.emit('keyup');assert.equal(f.session.results.length,0);
 f.capture.focus();const event=f.surface.emit('keydown');assert.equal(event.prevented,true);f.surface.emit('keydown',{code:'KeyC'});f.surface.emit('keyup');f.surface.emit('keyup',{code:'KeyC'});assert.equal(f.session.results.length,1);f.capture.cleanup();
});
test('blur, inactive tab, pointer, paste, composition and Tab latch paused without stale keyup credit',()=>{
 for(const interrupt of ['blur','visibilitychange','pointerdown','paste','compositionstart','Tab']){
 const f=fixture();f.capture.focus();f.surface.emit('keydown');
 if(interrupt==='blur')f.win.emit('blur');else if(interrupt==='visibilitychange'){f.doc.hidden=true;f.doc.emit(interrupt);}else if(interrupt==='pointerdown')f.doc.emit(interrupt);else if(interrupt==='Tab'){const event=f.surface.emit('keydown',{code:'Tab'});assert.notEqual(event.prevented,true);}else f.surface.emit(interrupt);
 assert.equal(f.capture.active,false);f.surface.emit('keyup');f.surface.emit('keydown',{code:'KeyC'});f.surface.emit('keyup',{code:'KeyC'});assert.equal(f.session.results.length,0);f.capture.cleanup();
 }
});
test('completion can suspend capture for comfort rating without clearing the completed measurement',()=>{
 const f=fixture();let interrupted=0;const session={interrupt(){interrupted++;},pendingMilliseconds:123};const capture=attachPhysicalCapture(f.surface,{getSession:()=>session,mapEvent:()=> 'S'});capture.focus();assert.equal(interrupted,1);capture.suspend();f.surface.emit('focusout');f.doc.emit('pointerdown');assert.equal(interrupted,1);assert.equal(session.pendingMilliseconds,123);capture.cleanup();
});
