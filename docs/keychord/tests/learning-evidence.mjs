import test from 'node:test';
import assert from 'node:assert/strict';
import {AttemptEvidence, inferLanguage, validPhysicalEvent, capturePlannedTab, draftPracticeWindow, normalizeBrowserText} from '../learning.js';
test('ordinary, mixed and pasted input cannot earn chord WPM or clean unaided credit',()=>{
  for(const kind of ['ordinary','paste','composition','selection replacement']){
    const a=new AttemptEvidence({fresh:true});a.input('physical-chord',3,0);a.input(kind,3,10);a.complete(60000);
    assert.equal(a.clean,false);assert.equal(a.eligible,false);assert.equal(a.chordWPM,null);
  }
});
test('a physical chord attempt can earn unaided credit; guided/demo assistance persists when restarted',()=>{
  const a=new AttemptEvidence({fresh:true});a.input('physical-chord',5,0);a.complete(60000);assert.equal(a.eligible,true);assert.equal(a.chordWPM,1);
  a.assist('Visible keyboard');const restart=new AttemptEvidence({assisted:a.assisted,errors:a.errors,fresh:true});restart.input('physical-chord',5,0);restart.complete(60000);assert.equal(restart.eligible,false);assert.equal(restart.chordWPM,null);
  const demo=new AttemptEvidence({fresh:true});demo.input('demo',5,0);demo.input('physical-chord',5,10);demo.complete(60000);assert.equal(demo.clean,false);assert.equal(demo.label,'Assisted chord practice');
});
test('errors remain in the attempt even after an actual chord Undo recovery',()=>{
  const a=new AttemptEvidence({fresh:true});a.input('physical-chord',3,0);a.error();a.input('physical-chord',0,10);a.input('physical-chord',3,20);a.complete(60000);
  assert.equal(a.chordOnly,true);assert.equal(a.clean,false);assert.equal(a.eligible,false);assert.equal(a.label,'Chord practice with recovery');
});
test('synthetic or composing/shortcut events are not physical learning evidence',()=>{
  assert.equal(validPhysicalEvent({isTrusted:false}),false);
  assert.equal(validPhysicalEvent({isTrusted:true,isComposing:true}),false);
  assert.equal(validPhysicalEvent({isTrusted:true,ctrlKey:true}),false);
  assert.equal(validPhysicalEvent({isTrusted:true,metaKey:true}),false);
  assert.equal(validPhysicalEvent({isTrusted:true,ctrlKey:false,metaKey:false,isComposing:false}),true);
});
test('language override is stable while Auto uses filename and code content',()=>{
  assert.equal(inferLanguage('hello','example.cpp','auto'),'cpp');assert.equal(inferLanguage('#include <iostream>','note.txt','auto'),'cpp');
  assert.equal(inferLanguage('std::cout << value;','','auto'),'cpp');assert.equal(inferLanguage('int main() {}','','auto'),'cpp');
  assert.equal(inferLanguage('A short note.','note.txt','auto'),'english');assert.equal(inferLanguage('hello','file.cpp','english'),'english');assert.equal(inferLanguage('hello','note.txt','cpp'),'cpp');
});
test('a stale practice Tab plan never captures keyboard navigation in the local editor',()=>{
  const planned={action:{type:'key',key:'Tab'}};
  assert.equal(capturePlannedTab('chord-input',planned),true);assert.equal(capturePlannedTab('scratch',planned),false);
  assert.equal(capturePlannedTab('chord-input',{action:{type:'chord',keys:['C']}}),false);assert.equal(capturePlannedTab('chord-input',undefined),false);
});
test('large imported drafts use a bounded window and preserve their complete text and selected origin range',()=>{
  const draft='A long note about a cat. '.repeat(6000),selection=[2450,9000],copy=[...selection];
  const window=draftPracticeWindow(draft,selection,1200);
  assert.equal(window.text.length,1200);assert.equal(window.selected,true);assert.equal(window.limited,true);assert.deepEqual(selection,copy);assert.equal(draft.length,150000);
  assert.equal(window.text,draft.slice(selection[0],selection[0]+1200));
  assert.deepEqual(draftPracticeWindow('a😀b',[0,0],2).text,'a😀');
});
test('browser practice normalizes CRLF and CR while preserving leading and repeated blank lines',()=>{
  assert.equal(normalizeBrowserText('\r\nhello\r\n\r\nworld\r'),'\nhello\n\nworld\n');
  assert.equal(normalizeBrowserText('\nhello'),'\nhello');
});
