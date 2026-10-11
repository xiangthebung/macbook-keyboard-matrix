import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {loadSavedMapping} from '../learning.js';
import {createRuntimeData,exportSources,importSources,courseIntroductionChords,ChordEngine} from '../core/index.js';
const data=createRuntimeData(JSON.parse(await readFile(new URL('../data.json',import.meta.url),'utf8')));
test('saved seven-key mapping reloads using persisted keyboard settings rather than a stale default six',()=>{
  const sources=exportSources(data);sources.english+='\nQ+W+E+R+T+Y+U = "seven" word\n';
  const applied=importSources(data,sources,{rolloverLimit:7});assert.ok(applied.data,JSON.stringify(applied.problems));
  const encoded=JSON.stringify(sources),reloaded=loadSavedMapping(data,JSON.parse(encoded),()=>({rolloverLimit:7}),importSources);
  assert.ok(reloaded.data,JSON.stringify(reloaded.problems));assert.equal(reloaded.data.mappingVersion,applied.data.mappingVersion);
  assert.equal(importSources(data,sources,{rolloverLimit:6}).data,null);
  const output=new ChordEngine(reloaded.data).translate(['Q','W','E','R','T','Y','U']);assert.equal(output.actions[0].text,'seven');
});
test('changed mapping lessons teach the active sound keys and keep a distinct version',()=>{
  const sources=exportSources(data);sources.layout=sources.layout.replace('S = "s"','S = "z"').replace('Z = "z"','Z = "s"');
  const active=importSources(data,sources,{rolloverLimit:6});assert.ok(active.data,JSON.stringify(active.problems));assert.notEqual(active.data.mappingVersion,data.mappingVersion);
  const introductions=courseIntroductionChords(active.data,0),s=introductions.find(item=>item.skill==='sound:onset:s');
  assert.deepEqual(s.chords[0].keys,['Z']);assert.deepEqual(active.data.course.steps[0].introductions.find(item=>item.skill==='sound:onset:s').chords[0].keys,['Z']);
  assert.equal(new ChordEngine(active.data).translate(['Z','C','J']).actions[0].text,'sat');
  const again=loadSavedMapping(data,JSON.parse(JSON.stringify(sources)),()=>({rolloverLimit:6}),importSources);assert.equal(again.data.mappingVersion,active.data.mappingVersion);
});
