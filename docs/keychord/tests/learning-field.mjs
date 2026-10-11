import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {ChordField,KeyChordApp} from '../app.js';
import {AttemptEvidence} from '../learning.js';
import * as Core from '../core/index.js';
const data=Core.createRuntimeData(JSON.parse(await readFile(new URL('../data.json',import.meta.url),'utf8')));
// A minimal EventTarget field tests the real owned-field adapter without a browser,
// injected scripts, a framework or attributing synthetic events to real hardware.
class Field extends EventTarget {
  constructor(text='',id='scratch'){super();this.value=text;this.id=id;this.selectionStart=text.length;this.selectionEnd=text.length;this.classList={toggle(){},remove(){}};}
  setSelectionRange(start,end){this.selectionStart=start;this.selectionEnd=end;}
  focus(){globalThis.document.activeElement=this;this.dispatchEvent(new Event('focus'));}
}
function environment(text='',id='scratch'){
  globalThis.window=new EventTarget();globalThis.document=new EventTarget();document.hidden=false;
  const field=new Field(text,id),notices=[],evidence=new AttemptEvidence({fresh:true});
  const app={data,target:'',nextStep:()=>undefined,plan:(text,mode)=>Core.planText(text,{data,mode,profile:'generic'}),notice:message=>notices.push(message)};
  const adapter=new ChordField(app,field,{mode:'english',evidence});adapter.setEnabled(true,false);
  return{field,adapter,app,evidence,notices};
}
function event(code){return{code,isTrusted:true,ctrlKey:false,metaKey:false,altKey:false,shiftKey:false,isComposing:false,repeat:false,preventDefault(){this.prevented=true;},getModifierState(){return false;}};}
function chord(adapter,keys){for(const name of keys)adapter.down(event(data.layout.keys.find(key=>key.name===name).browserCode));for(const name of keys)adapter.up(event(data.layout.keys.find(key=>key.name===name).browserCode));}
test('a multi-key chord replaces selected editor text once, preserving all captured keys',()=>{
  const{field,adapter,evidence}=environment('hello');field.setSelectionRange(0,5);adapter.selection=[0,5];
  chord(adapter,['S','C','J']);assert.equal(field.value,'sat');assert.equal(adapter.engine.undoDepth,1);assert.equal(evidence.physicalChords,1);assert.equal(evidence.ordinaryCharacters,1);
  adapter.destroy();
});
test('zero-output command keeps selected editor text and range intact',()=>{
  const{field,adapter}=environment('hello');field.setSelectionRange(0,5);adapter.selection=[0,5];
  chord(adapter,Core.keyMeanings(data).capitalizeNextKeys);assert.equal(field.value,'hello');assert.equal(field.selectionStart,0);assert.equal(field.selectionEnd,5);assert.equal(adapter.engine.currentContext.pendingCap,true);
  adapter.destroy();
});
test('programmatic caret events preserve actual Undo history; chord Undo reverses the output',()=>{
  const{field,adapter}=environment();chord(adapter,['S','C','J']);field.dispatchEvent(new Event('select'));
  assert.equal(adapter.engine.undoDepth,1);chord(adapter,Core.keyMeanings(data).undoKeys);assert.equal(field.value,'');assert.equal(adapter.engine.undoDepth,0);
  adapter.destroy();
});
test('blur abandons partial chords and late releases cannot emit text',()=>{
  const{field,adapter}=environment();adapter.down(event('KeyS'));adapter.down(event('KeyC'));adapter.down(event('KeyJ'));
  field.dispatchEvent(new Event('blur'));adapter.up(event('KeyS'));adapter.up(event('KeyC'));adapter.up(event('KeyJ'));assert.equal(field.value,'');assert.equal(adapter.engine.chordInProgress,false);
  adapter.destroy();
});
test('scratch Tab is focus navigation despite a stale practice guide',()=>{
  const{field,adapter,app}=environment();app.nextStep=()=>({action:{type:'key',key:'Tab'}});const e=event('Tab');adapter.down(e);
  assert.equal(e.prevented,undefined);assert.equal(field.value,'');adapter.destroy();
});
test('mode-switch pauses, restores the declared mapping, then resumes English correctly',()=>{
  const{field,adapter,notices}=environment();chord(adapter,Core.keyMeanings(data).modeSwitchKeys);
  assert.equal(adapter.enabled,false);assert.equal(adapter.engine.subMode,'english');assert.ok(notices[0].includes('English'));
  adapter.setEnabled(true,false);chord(adapter,['S','C','J']);assert.equal(field.value,'sat');adapter.destroy();
});
test('key demos perform Delete/Return/Tab actions and remain assisted',()=>{
  const{field,adapter,evidence}=environment('ab');adapter.demo({action:{type:'key',key:'Delete'}});assert.equal(field.value,'a');
  adapter.demo({action:{type:'key',key:'Return'}});adapter.demo({action:{type:'key',key:'Tab'}});assert.equal(field.value,'a\n\t');assert.equal(evidence.assisted,true);assert.equal(evidence.physicalChords,0);
  adapter.destroy();
});
test('the active reference includes every bank cluster and every spelling combination',()=>{
  const view=Object.create(KeyChordApp.prototype);view.data=data;view.profile={modelID:'generic'};
  const html=view.referenceRows('');
  for(const bank of ['onset','vowel','coda'])for(const [,text]of data.layout.clusterMaps[bank])assert.ok(html.includes(`<strong>${text}</strong>`),`${bank}: ${text}`);
  for(const [,text]of data.layout.fingerspellingMap)assert.ok(html.includes(`<strong>Spell ${text}</strong>`),`spell ${text}`);
});
test('a valid layout without a spell key keeps the reference usable',()=>{
  const sources=Core.exportSources(data);
  sources.layout=sources.layout.replace(/\bQuote\s+39\s+spell\b/,'Quote 39 coda');
  const active=Core.importSources(data,sources);
  assert.ok(active.data,JSON.stringify(active.problems));
  assert.equal(active.data.layout.spellIndex,null);
  const view=Object.create(KeyChordApp.prototype);view.data=active.data;view.profile={modelID:'generic'};
  const html=view.referenceRows('');
  assert.ok(html.includes('<strong>s</strong>'));
  assert.ok(!html.includes('<strong>Spell a</strong>'));
});

test('Shift guidance stays held until both modifiers release and clears on blur',()=>{
  const {field,adapter}=environment();const states=[];adapter.onModifier=held=>states.push(held);
  adapter.down(event('ShiftLeft'));adapter.down(event('ShiftRight'));
  adapter.up(event('ShiftLeft'));assert.equal(states.at(-1),true);
  adapter.up(event('ShiftRight'));assert.equal(states.at(-1),false);
  adapter.down(event('ShiftLeft'));field.dispatchEvent(new Event('blur'));
  assert.equal(states.at(-1),false);assert.equal(adapter.shiftHeld.size,0);assert.equal(field.value,'');
  adapter.destroy();
});

test('finishing Practice does not trigger an unfinished lesson introduction',()=>{
  environment();document.getElementById=()=>null;
  const app=Object.assign(Object.create(KeyChordApp.prototype),{
    tab:'practice',onboarding:true,target:'sat',completed:false,guideProgress:{complete:true},
    evidence:new AttemptEvidence(),updateHint(){},
    onboardingComplete(){assert.fail('Practice must not enter onboarding completion');},
    completeExercise(){this.practiceFinished=true;}
  });
  app.updateInput('sat');assert.equal(app.practiceFinished,true);assert.equal(app.completed,true);
});
