import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as Core from '../core/index.js';

const exported=JSON.parse(readFileSync(new URL('../data.json',import.meta.url),'utf8'));
const data=Core.createRuntimeData(exported);
const profileIDs=['generic','macbook-ansi','macbook-iso'];
const clone=()=>structuredClone(exported);

test('bundled export contains the full real curriculum, sources, reference and keyboard models',()=>{
  assert.equal(data.course.steps.length,52);assert.equal(data.course.steps.filter(s=>s.mode==='english').length,45);assert.equal(data.course.steps.filter(s=>s.mode==='cpp').length,7);
  assert.equal(data.topics.length,8);assert.equal(data.course.units.flatMap(u=>u.stepIDs).length,52);
  assert.equal(data.layout.keys.length,48);assert.equal(data.layout.fingerspelling.length,52);
  assert.deepEqual(Object.keys(data.sources).sort(),['cpp','english','layout','orthography','shared']);
  assert.ok(data.reference.manualHTML.includes('KeyChord'));assert.ok(data.reference.text.includes('Onset'));
  assert.ok(data.profiles.find(p=>p.id==='macbook-ansi').wiring.positions.length>30);
  assert.ok(data.profiles.find(p=>p.id==='macbook-iso').wiring.positions.length>30);
  assert.ok(data.listeningVocabulary.length>200);
  assert.equal(Core.keyIndexForEvent(data,{code:'Quote'}),data.layout.spellIndex);
  assert.equal(Core.keyIndexForEvent(data,{code:'KeyUnmapped'}),null);
});

test('JavaScript translation, Undo, snippets, casing, Caps Lock, Unicode and exact contexts match exported Swift fixtures',()=>{
  assert.ok(data.parityFixtures.length>=8);
  for(const fixture of data.parityFixtures){
    let runtime=data;
    if(fixture.extraEntries?.length){const raw=clone();raw.dictionaries[fixture.mode].push(...fixture.extraEntries);runtime=Core.createRuntimeData(raw);}
    const engine=new Core.ChordEngine(runtime,fixture.mode);let buffer=Core.createBuffer();
    for(const stroke of fixture.strokes){
      const result=engine.translate(stroke.keys,{join:stroke.join,capsLock:stroke.capsLock});
      assert.deepEqual(result.actions,stroke.actions,`${fixture.name}: ${stroke.keys.join('+')}`);
      assert.equal(result.signal,stroke.signal);assert.equal(result.modeSwitched,stroke.modeSwitched);assert.equal(engine.subMode,stroke.subMode);
      assert.equal(engine.undoDepth,stroke.undoDepth);assert.deepEqual(engine.currentContext,stroke.context);
      buffer=Core.applyActions(buffer,result.actions);assert.equal(buffer.text,stroke.text);assert.equal(buffer.cursor,stroke.cursor);
    }
  }
});

test('a chord commits exactly once when every key is up; Shift joins stay latched; interrupted chords clear',()=>{
  const engine=new Core.ChordEngine(data),index=name=>data.layout.indexByName.get(name);
  engine.keyDown(index('S'));engine.keyDown(index('C'));assert.equal(engine.keyUp(index('S')),null);engine.keyDown(index('J'));
  assert.equal(engine.keyUp(index('C')),null);const sat=engine.keyUp(index('J'));assert.equal(sat.actions[0].text,'sat');assert.equal(engine.keyUp(index('J')),null);
  engine.keyDown(index('E'));engine.joinPressed();engine.keyDown(index('C'));engine.keyDown(index('J'));
  assert.equal(engine.keyUp(index('E')),null);assert.equal(engine.keyUp(index('J')),null);assert.equal(engine.keyUp(index('C')).actions[0].text,'hat');
  engine.keyDown(index('S'));engine.keyDown(index('C'),{repeat:true});engine.syncPhysical([]);assert.equal(engine.chordInProgress,false);assert.equal(engine.keyUp(index('S')),null);
  assert.equal(engine.translate(['Grave','1']).signal,'untranslatable');
});

test('mode dictionaries override shared commands before letters, digits and composition',()=>{
  const altered=Core.editMapping(data,{mode:'english',keys:['Backslash'],entry:{type:'text',text:'override',kind:'word'}}).data;
  assert.ok(altered);assert.equal(new Core.ChordEngine(altered).translate(['Backslash']).actions[0].text,'override');
  assert.equal(new Core.ChordEngine(altered,'cpp').translate(['Backslash']).signal,'undoEmpty');
  const spelled=Core.editMapping(data,{mode:'english',keys:['Quote','C'],entry:{type:'text',text:'custom',kind:'word'}}).data;
  assert.equal(new Core.ChordEngine(spelled).translate(['Quote','C']).actions[0].text,'custom');
  assert.equal(Core.recipeForChord(spelled,['Quote','C']).parts[0].role,'word');
});

test('ordinary-edit resets preserve pending capitals and remove stale chord Undo; restored contexts resume the real plan',()=>{
  const engine=new Core.ChordEngine(data);engine.translate(['N','M']);engine.contextReset();assert.equal(engine.currentContext.pendingCap,true);assert.equal(engine.undoDepth,0);
  assert.equal(engine.translate(['S','C','J']).actions[0].text,'Sat');
  const context=engine.currentContext;engine.contextReset();assert.equal(engine.translate(['Backslash']).signal,'undoEmpty');engine.restore(context);
  assert.equal(engine.translate(['E','C','J']).actions[0].text,' hat');
  const snapshot=engine.currentContext;snapshot.prevWord='tampered';assert.notEqual(engine.currentContext.prevWord,'tampered');
});

test('all 52 native course passages and all 624 fresh native variants replay with exact Swift contexts on supported profiles',()=>{
  let variants=0;
  for(const id of profileIDs){const profile=Core.getProfile(data,id);
    for(const lesson of data.course.steps){
      const guides=[lesson.guides[id],...lesson.variants[id].map(v=>v.guide)];variants+=lesson.variants[id].length;
      const taught=Core.taughtSkills(data,lesson.index);
      for(const guide of guides){
        const replay=Core.replayGuide(data,guide);assert.equal(replay.buffer.text,guide.text,`${id} ${lesson.id}`);
        for(const {step,context,buffer} of replay.results){
          assert.deepEqual(context,step.contextAfter,`${id} ${lesson.id} ${step.note}`);
          assert.ok(Core.courseIsAllowed(step));if(step.action.type==='chord')assert.ok(profile.usable(step.action.keys));
          assert.ok([...Core.skillsOfStep(data,step,guide.mode)].every(skill=>taught.has(skill)));
          const expected=Core.graphemes(guide.text).slice(0,step.textEnd-Core.graphemeCount(step.tail)).join('')+step.tail;assert.equal(buffer.text,expected);
        }
      }
    }
  }
  assert.equal(variants,624);
});

test('dynamic browser planner types all 52 course originals without fallback for generic, ANSI and ISO keyboards',()=>{
  for(const profile of profileIDs)for(const lesson of data.course.steps){
    const guide=Core.planText(lesson.text,{data,mode:lesson.mode,profile});
    assert.equal(guide.normalCount,0,`${profile}: ${lesson.id}`);assert.ok(guide.validated);
    assert.equal(Core.replayGuide(data,guide).buffer.text,lesson.text);
    assert.ok(guide.steps.every(Core.courseIsAllowed));
    const taught=Core.taughtSkills(data,lesson.index);assert.ok([...Core.guideSkills(data,guide)].every(s=>taught.has(s)),`${profile}: untaught skill in ${lesson.id}`);
  }
});

test('all eight full topics and their native variants are usable exact passages',()=>{
  for(const topic of data.topics)for(const id of profileIDs)for(const guide of [topic.guides[id],...topic.variants[id].map(v=>v.guide)]){
    assert.equal(Core.replayGuide(data,guide).buffer.text,guide.text);assert.equal(guide.normalCount,0);
  }
});

test('custom passage planning matches native representability and preserves accents, emoji, spacing, tabs and line endings',()=>{
  for(const fixture of data.customPlannerFixtures){
    const guide=Core.planText(fixture.text,{data,mode:fixture.mode,profile:'macbook-ansi'});assert.equal(Core.replayGuide(data,guide).buffer.text,fixture.text);assert.equal(guide.normalCount,fixture.guide.normalCount,fixture.text);
    assert.equal(Core.replayGuide(data,fixture.guide).buffer.text,fixture.text);
  }
  for(const text of ['a\r\nhat\rsat\n','\t  Café e\u0301 👩🏽‍💻 🇨🇦 123321  ', 'ab'.repeat(80)]){
    const guide=Core.planText(text,{data});assert.equal(Core.replayGuide(data,guide).buffer.text,text);assert.ok(guide.normalCount>0);
  }
});

test('suffix routes perform actual spelling edits rather than inventing syllable recipes',()=>{
  for(const word of ['making','tried','running','boxes','cities','dying','said','biggest','happily']){
    const guide=Core.planText(word,{data,profile:'macbook-ansi'});assert.equal(guide.normalCount,0);assert.equal(Core.replayGuide(data,guide).buffer.text,word);
  }
  const guide=Core.planText('making',{data});assert.ok(guide.steps.some(s=>s.kind==='suffix'));assert.ok(guide.steps.some(s=>s.tail));
});

test('profile filtering applies to every chord and the Space join can fall back to either Shift',()=>{
  const profile=Core.getProfile(data,'macbook-ansi'),guide=Core.planText('The window is open. Take the window seat.',{data,profile});
  assert.ok(guide.steps.some(s=>s.action.shift));assert.ok(guide.steps.filter(s=>s.action.type==='chord').every(s=>profile.usable(s.action.keys)));
  const limited=Core.planText('Hello 123 world',{data,rolloverLimit:2,profile:{id:'local',rolloverLimit:2,usable:keys=>keys.length<=2}});
  assert.ok(limited.steps.filter(s=>s.action.type==='chord').every(s=>s.action.keys.length<=2));assert.equal(Core.replayGuide(data,limited).buffer.text,'Hello 123 world');
  const blocked=Core.planText('sat hat',{data,profile:{id:'local',rolloverLimit:6,usable:keys=>!keys.includes(data.layout.indexByName.get('S'))}});
  assert.ok(blocked.steps.filter(s=>s.action.type==='chord').every(s=>!s.action.keys.includes('S')));assert.equal(Core.replayGuide(data,blocked).buffer.text,'sat hat');
  const noChords=Core.planText('sat',{data,profile:{id:'none',rolloverLimit:6,usable:()=>false}});assert.equal(noChords.normalCount,1);
});

test('corrected-prefix continuations start from real engine context and preserve a pending capital only at word boundaries',()=>{
  const text='Anything is possible. Making tea is nice.';
  for(const offset of [1,4,8,9,15,21,24,29]){
    const continuation=Core.planContinuation(text,offset,{data,profile:'macbook-ansi'}, {...Core.initialContext(),pendingCap:true});
    const prefix=Core.graphemes(text).slice(0,offset).join('');const replay=Core.replayGuide(data,continuation.guide,{buffer:Core.createBuffer(prefix),context:continuation.startContext});
    assert.equal(replay.buffer.text,text);assert.ok(continuation.guide.steps.every(s=>s.source[0]>=offset));
  }
});

test('guide progress recognizes temporary spelling tails and requires state evidence for zero-output commands',()=>{
  const guide=Core.planText('Making tea',{data}),replay=Core.replayGuide(data,guide);
  assert.equal(guide.steps[0].kind,'command');assert.equal(Core.matchGuideProgress(guide,'').completedStep,-1);assert.equal(Core.matchGuideProgress(guide,'').nextStep,0);
  const first=replay.results[0];assert.equal(Core.matchGuideProgress(guide,'',{context:first.context}).completedStep,0);
  const base=replay.results.find(row=>row.step.tail);assert.ok(base);const progress=Core.matchGuideProgress(guide,base.buffer.text,{context:base.context});assert.equal(progress.correct,true);assert.notEqual(progress.tailStep,null);
  const endCommandGuide={text:'sat',mode:'english',steps:[{action:{type:'chord',keys:['Grave'],shift:false},kind:'command',textEnd:3,tail:'',source:[0,3],group:1,contextAfter:{...Core.initialContext(),atStart:false}}]};
  assert.equal(Core.matchGuideProgress(endCommandGuide,'sat').complete,false);assert.equal(Core.matchGuideProgress(endCommandGuide,'sat',{appliedStep:0}).complete,true);
});

test('grapheme buffer operations and DOM UTF-16 conversions handle combining accents, flags and family emoji',()=>{
  const text='e\u0301👨‍👩‍👧‍👦🇨🇦ß';assert.equal(Core.graphemeCount(text),4);
  for(let i=0;i<=4;i++)assert.equal(Core.toGraphemeOffset(text,Core.toUTF16Offset(text,i)),i);
  const deleted=Core.applyActions(Core.createBuffer(text),[{type:'deleteBackward',count:2}]);assert.equal(deleted.text,'e\u0301👨‍👩‍👧‍👦');assert.equal(deleted.cursor,2);
  const moved=Core.applyActions(Core.createBuffer(text),[{type:'moveLeft',count:3},{type:'deleteForward',count:1},{type:'insert',text:'é'}]);assert.equal(moved.text,'e\u0301é🇨🇦ß');assert.equal(moved.cursor,2);
  const combining=Core.applyActions(Core.createBuffer('e'),[{type:'insert',text:'\u0301'}]);assert.equal(combining.text,'e\u0301');assert.equal(combining.cursor,1);
  const element={value:text,selectionStart:Core.toUTF16Offset(text,1),selectionEnd:Core.toUTF16Offset(text,3),setSelectionRange(start,end){this.selectionStart=start;this.selectionEnd=end;}};
  const replaced=Core.applyActionsToTextarea(element,[{type:'insert',text:'🌈'}]);assert.equal(replaced.text,'e\u0301🌈ß');assert.equal(element.selectionStart,Core.toUTF16Offset(element.value,2));
});

test('source imports reproduce the native parser acceptance fixtures and reject invalid files atomically',()=>{
  assert.ok(data.parserFixtures.length>=15);
  for(const fixture of data.parserFixtures){const loaded=Core.importSources(data,{[fixture.file]:fixture.source},{rolloverLimit:fixture.rolloverLimit});assert.equal(Boolean(loaded.data),fixture.accepted,fixture.name);if(!fixture.accepted)assert.ok(loaded.problems.length);}
  const loaded=Core.importSources(data,Core.exportSources(data));assert.ok(loaded.data);assert.equal(loaded.data.mappingVersion,data.mappingVersion);
  for(const mode of ['shared','english','cpp'])assert.deepEqual(loaded.data.dictionaryMaps[mode],data.dictionaryMaps[mode]);
  const invalid=Core.importSources(data,{english:data.sources.english+'\nNotAKey = "word"'});assert.equal(invalid.data,null);assert.equal(new Core.ChordEngine(data).translate(['S','C','J']).actions[0].text,'sat');
  assert.equal(Core.importSources(data,{layout:data.sources.layout+'\n[keys]\nUnsupported 600 onset'}).data,null);
});

test('the safe mapping editor validates commands and snippet markers, isolates versions and supports removing overrides',()=>{
  const change={mode:'english',keys:['Quote','U'],entry:{type:'text',text:'é',kind:'word'}};
  const first=Core.editMapping(data,change),second=Core.editMapping(data,change);assert.ok(first.data);assert.equal(first.data.mappingVersion,second.data.mappingVersion);assert.notEqual(first.data.mappingVersion,data.mappingVersion);
  assert.equal(new Core.ChordEngine(first.data).translate(change.keys).actions[0].text,'é');assert.equal(new Core.ChordEngine(data).translate(change.keys).actions[0].text,'u');
  const removed=Core.editMapping(first.data,{mode:'english',keys:change.keys,remove:true});assert.equal(new Core.ChordEngine(removed.data).translate(change.keys).actions[0].text,'u');
  assert.equal(Core.editMapping(data,{mode:'english',keys:['S'],entry:{type:'command',command:'invalid'}}).data,null);
  assert.equal(Core.editMapping(data,{mode:'cpp',keys:['Quote','U'],entry:{type:'text',text:'x',kind:'suffix',cursorFromEnd:0}}).data,null);
  const snippet=Core.editMapping(data,{mode:'cpp',keys:['Quote','U'],entry:{type:'text',text:'x|é',kind:'symbol',cursorFromEnd:1}});assert.ok(snippet.data);assert.equal(new Core.ChordEngine(snippet.data,'cpp').translate(['Quote','U']).actions[0].text,'x|é');
  const raw=clone();raw.dictionaries.english.push(raw.dictionaries.english[0]);assert.throws(()=>Core.createRuntimeData(raw),/duplicate/);
});

test('dynamic fresh generation covers all lessons and produces more than four distinct validated drills',()=>{
  for(const profile of profileIDs)for(const lesson of data.course.steps){const generator=new Core.PracticeGenerator({data,source:{type:'course',index:lesson.index},profile});const result=generator.next(12);assert.ok(result,`${profile}: ${lesson.id}`);assert.notEqual(result.text,lesson.text);assert.equal(Core.replayGuide(data,result.guide).buffer.text,result.text);assert.ok(generator.accepts(result.guide));}
  const generator=new Core.PracticeGenerator({data,source:{type:'course',index:0},profile:'generic'}),seen=new Set();let previous=data.course.steps[0].text;
  for(let i=0;i<16;i++){const result=generator.next(i,previous);assert.ok(result);assert.notEqual(result.text,previous);assert.ok(!seen.has(result.text));seen.add(result.text);previous=result.text;}
  assert.equal(seen.size,16);
  const blocked=new Core.PracticeGenerator({data,source:{type:'course',index:0},profile:{id:'none',rolloverLimit:6,usable:()=>false}});assert.equal(blocked.next(1),null);
});

test('fresh generation adapts to a validated custom mapping and respects custom profile filters',()=>{
  const custom=Core.editMapping(data,{mode:'english',keys:['Quote','U'],entry:{type:'text',text:'use',kind:'word'}}).data;
  const profile={id:'local',rolloverLimit:4,usable:keys=>keys.length<=4};
  const generator=new Core.PracticeGenerator({data:custom,source:{type:'course',index:10},profile});const result=generator.next(17);assert.ok(result);assert.equal(Core.replayGuide(custom,result.guide).buffer.text,result.text);assert.ok(result.guide.steps.filter(s=>s.action.type==='chord').every(s=>s.action.keys.length<=4));
});

test('listening is filtered by completed skills, exhausts its bag, records assistance and requires a correct finite-session answer',()=>{
  const listening=new Core.ListeningPractice({data,profile:'macbook-ansi',completedIDs:['first-chord'],sessionLength:3});assert.deepEqual(listening.words.map(word=>word.text).sort(),['at','hat','sat']);
  const first=listening.next(1);assert.ok(first);assert.equal(listening.next(9),first);assert.equal(listening.check(first.text.slice(0,-1)),false);assert.equal(listening.revealHint(),true);assert.equal(listening.check(first.text),true);assert.equal(listening.check(first.text),false);
  const seen=new Set([first.text]);for(let i=0;i<2;i++){const prompt=listening.next(i+2);assert.ok(!seen.has(prompt.text));seen.add(prompt.text);assert.equal(listening.check(prompt.text),true);}
  assert.equal(listening.completedWords,3);assert.equal(listening.assistedWords,1);assert.equal(listening.isSessionComplete,true);assert.equal(listening.next(55),null);
  assert.equal(new Core.ListeningPractice({data,completedIDs:[]}).isAvailable,false);
  const skills=Core.learnedSkills(data,['first-chord'],'english');assert.ok(skills.has('sound:onset:s'));assert.ok(!skills.has('spell'));
});

test('curriculum migration and pair rules only include actually learned components',()=>{
  const migrated=Core.migrateCompletedIDs(data,['first-chord','vowels','end-sounds'],1);assert.ok(migrated.has('first-ends'));assert.ok(migrated.has('right-thumb-vowels'));assert.ok(migrated.has('end-sounds-kl'));
  const limited=Core.learnedSkills(data,['start-pairs'],'english');assert.ok(limited.has('pairs:onset'));assert.ok(!limited.has('sound:onset:th'));
  const full=Core.taughtSkills(data,6);assert.ok(full.has('sound:onset:th'));assert.ok(full.has('sound:onset:sh'));
});
