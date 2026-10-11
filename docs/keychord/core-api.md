# KeyChord browser core

`core/index.js` is a dependency-free ES-module facade. It is also usable from Node 24 or newer for regression checks. `data.json` is generated from a freshly compiled `KeyChordCore` Swift module. It includes bundled data only; no Application Support settings, passages, keyboard observations or user documents are read.

```js
import * as Core from './core/index.js';
const data = Core.createRuntimeData(await fetch('./data.json').then(r => r.json()));
const profile = Core.getProfile(data, 'macbook-ansi');
const engine = new Core.ChordEngine(data, 'english');
const guide = Core.planText('The window is open.', {data, mode: 'english', profile});
let buffer = Core.createBuffer();
for (const step of guide.steps) {
  // Use replayGuide for a whole demonstration; physical practice calls keyDown/keyUp.
  if (step.action.type === 'chord') {
    const result = engine.translate(step.action.keys, {join: step.action.shift});
    buffer = Core.applyActions(buffer, result.actions);
  }
}
```

## Data and keys

`data.layout.keys` contains `{index,name,code,role,digit,browserCode,legends:{ansi,iso}}`. `code` is the native Mac virtual key code; `browserCode` is `KeyboardEvent.code`, independent of the selected input source. Native names such as `Quote` and `LBracket` remain stable even when an ISO printed legend differs. `keyIndexForEvent(data,event)` returns an index or `null`. `keyIndices(data,namesOrIndices)` validates and sorts a chord; `keyNames` returns layout order.

`layout.clusters.onset/vowel/coda` and `layout.fingerspelling` are arrays of `{keys:[names],text}`. Runtime `clusterMaps` and `fingerspellingMap` are Maps indexed by sorted indices joined with commas. `data.dictionaries.shared/english/cpp` retain rows `{keys:[names],entry}`; `data.dictionaryMaps` expose the same mappings as Maps. A text entry has `{type:'text',text,cursorFromEnd:null|number,kind:'word'|'symbol'|'suffix',attachLeft,attachRight,wordAttach,glue,capitalizeNext}`. A command entry has `{type:'command',command,description}`. Commands are `undo`, `modeSwitch`, `capitalizeNext`, `snippetExit`, `endIdentifier`, and `casing:snake/camel/pascal/screamingSnake`.

`data.course` contains `curriculumVersion`, `units:[{title,stepIDs}]`, all 52 `steps`, and native progress migration expansions. Each course step has `{id,index,unitIndex,unitStepIndex,title,intro,new:[skillStrings],mode,text,introductions,taught,guides,variants}`. An introduction is `{skill,chords:[{label,keys,shift,role,note}]}`. Guides and four distinct native-generated variants are keyed by `generic`, `macbook-ansi`, or `macbook-iso`. `data.topics` contains all eight topic lessons with `{index,title,summary,text,mode,guides,variants}`. `data.listeningVocabulary` is the real native vocabulary; `listening[profile]` contains Swift-validated words, guides, and skill sets. `reference.text` and `reference.manualHTML` contain the complete native reference and manual. Native desktop instructions inside that manual need to be labeled as such in the browser UI.

`keyMeanings(data,mode)` recomputes the current mapping's key labels and alone behavior, plus `capitalKey`, `spellKey`, and named `undoKeys`, `capitalizeNextKeys`, `modeSwitchKeys`. `recipeForChord(data,keys,{mode,shift})` explains each actual bank, dictionary, digit, or fingerspelling part and returns `{parts,outcome:{type:'text'|'command'|'nothing',text?},joins}` in native precedence order. It never guesses a mapping.

## Engine and buffers

`ChordEngine(data,mode)` exposes `translate(keys,{join=false,capsLock=false})`, `keyDown(index,{shift=false,repeat=false})`, `keyUp(index,{capsLock=false})`, `joinPressed()`, `discardChord()`, `syncPhysical(indices)`, `contextReset()`, `restore(context)`, `replaceData(data)`, and `setSubMode(mode)`. A release returns `null` while any captured chord key remains held. The final release returns `{actions,signal:null|'untranslatable'|'undoEmpty',modeSwitched}`. Shift pressed during a chord stays latched as a join. Repeated keydown events must be ignored; use the `repeat` option or filter events in the input handler. `heldChordKeys` is a defensive Set; `chordInProgress`, `undoDepth`, and `currentContext` are readable.

Mode dictionary entries override shared entries, then fingerspelling, number-row digits, then bank composition. Space alone inserts a literal space; Space held with other keys joins. English spelling corrections, sentence capitals, 100 real chord undo records, C++ casing, nested snippet cursor frames, snippet exit, and Caps Lock use the native rules. `contextReset` preserves pending capitalization and clears Undo, like ordinary native editing. Instantiate a fresh engine for a completely fresh context.

Actions are `{type:'insert',text}` or `{type:'deleteBackward'|'deleteForward'|'moveLeft'|'moveRight',count}`. All counts and `{text,cursor}` buffer cursors use extended grapheme clusters. `graphemes`, `graphemeCount`, `toGraphemeOffset`, and `toUTF16Offset` bridge DOM textarea offsets. `applyActions(buffer,actions)` is pure. `bufferFromTextarea` and `applyActionsToTextarea` are optional adapters that preserve the cursor and account for a selected range. Normal typing, selection, paste, IME composition, shortcuts, blur and interrupted capture should discard a held chord and reset stale context in the caller's local input controller.

## Planning and recovery

`planText(text,{data,mode='english',profile='generic',rolloverLimit?,usable?})` returns `{text,mode,steps,chordCount,normalCount,validated,profileID}`. A profile can be a bundled ID or an object `{id,rolloverLimit,usable(indices),explain(indices)}` from the hardware module. Profile callbacks and limits apply to every chosen chord, including Space joins. A blocked Space join can fall back to either Shift; blocked syllables can choose other clusters, briefs, suffix routes, digits or letters. Unrepresentable text is explicitly marked for ordinary typing.

Step actions are `{type:'chord',keys:[names],shift}`, `{type:'key',key:'Return'|'Tab'|'Delete'}`, or `{type:'normal',text}`. Each step contains `kind,output,note,source:[graphemeStart,graphemeEnd],group,textEnd,tail,parts,contextAfter`. Output includes automatic spaces. `tail` records a temporary suffix base or throwaway letter that a later action repairs, such as `make` before `making`. A text guide's recipes are simulated in the actual engine and then replayed as a whole; `validated:true` is assigned only to an exact source roundtrip. Snippets themselves are excluded from linear passage planning because they move the cursor; the engine supports them in local editor practice. CRLF and CR source endings are explicitly preserved through ordinary input.

`replayGuide(data,guide,{buffer?,context?})` returns `{buffer,engine,results:[{step,result,buffer,context}]}` for precise demonstration or execution checks. `matchGuideProgress(guide,typed,{context?,appliedStep?,cursor?})` returns `{matched,correct,tailStep,completedStep,complete,nextStep}`. Text alone never proves that a zero-output command ran: supply the engine's current context or explicit completed step evidence for those. `guideStepIndex` and `guideIsPlanned` locate source groups and intermediate boundaries. `planContinuation(text,offset,{data,mode,profile},previousContext?,maxLength=2000)` produces `{guide,start,end,startContext}` from a corrected prefix; restore `startContext` before using that continuation. Its offsets remain in the whole source passage.

## Fresh practice and listening

`new PracticeGenerator({data,source:{type:'course'|'topic',index},profile,rolloverLimit?,usable?}).next(seed=Date.now(),previousText)` returns `{text,guide,source,variantID,nativeValidated}` or `null` when the active mapping or keyboard cannot meet the lesson's requirements. It constructs fresh shuffled word drills, readable sentence combinations and C++ templates beyond the four exported variants. Every passage is planned again with the actual mapping and profile, uses only taught skills for course practice, and covers every newly introduced practiced skill. It rejects the original lesson text, immediate previous passage, and repeats within its instance. An exhausted or incompatible pool returns `null`; callers must not relabel the introduction as fresh recall.

`learnedSkills(data,completedIDs,mode)`, `taughtSkills(data,index)`, `skillsOfStep`, `guideSkills`, `courseIsAllowed`, `courseIntroductionChords`, and `migrateCompletedIDs` expose the native curriculum boundaries. Skill strings are `sound:BANK:TEXT`, `pairs:BANK`, `word:TEXT`, `ending:TEXT`, `symbol:TEXT`, `abbreviation:TEXT`, `command:COMMAND`, or the simple names `join,shiftJoin,space,spell,capitalLetter,digits,newLine`.

`new ListeningPractice({data,profile,completedIDs?,learnedSkills?,sessionLength?})` builds a bag of representable native vocabulary words filtered by learned skills. `next(seed)`, `revealHint()`, and `check(typed)` control it. Finite sessions require an exact answer before advancing; repeated answer callbacks count once. Read `prompt`, `hintRevealed`, `completedWords`, `assistedWords`, `isComplete`, `isSessionComplete`, `isAvailable`, `canAdvance`. A hint is assistance even when the subsequent answer is correct.

## Safe mapping changes and native export

`importSources(data,{layout?,shared?,english?,cpp?,orthography?},{rolloverLimit=6})` parses the native formats and returns `{data:null|newRuntime,problems,warnings,acceptedSources?}`. It validates duplicate names/codes/chords, unknown keys, reserved modifier codes, bank roles, fingerspelling values, cluster rollover, quoted escapes, cursor markers, suffix conflicts, entry flags and commands. A native virtual key without a browser physical code is rejected with a specific problem. Invalid edits never silently fall back or mutate active data. `exportSources(data)` returns the current five file strings. Custom source versions are deterministic hashes, so progress can be isolated by mapping version; reimporting the same bundled sources preserves the bundled version.

`editMapping(data,{mode,keys,entry,remove?},{rolloverLimit=6})` is the safe programmatic editor. It validates a change through the native dictionary parser. For isolated experiments clone `data.exported`, check collisions including composed/fingerspelled meanings, append experiment rows, and create a separate runtime; do not persist it as the main mapping. The hardware experiment module owns that isolation workflow.

Regenerate bundled data with `sh docs/keychord/scripts/export-native.sh /absolute/path/to/key-chord`. The script links existing `.build/debug/KeyChordCore.build/*.o` and imports `.build/debug/Modules`; it intentionally does not start a native app or SwiftPM build. The exported engine replay fixtures contain native output actions, cursor positions, exact contexts and Undo depths. Run browser-core checks with `node --test docs/keychord/tests/core*.mjs` from the website repository.


## Word practice and custom chords

`WordPracticeWordStream` uses the native SplitMix64 seed and non-repeating sampler. `WordPracticeSession` owns typed text, grapheme edits, timer deadlines, word completion, corrected-error accounting, WPM/accuracy/consistency metrics, and speed samples. `edit(range, text, time, verifiedChordPreview)` accepts a grapheme range; only a physically matching planner step may set the last flag. `advance(time)` ends timed sessions even while input is idle. `restarted()` preserves the word sequence and clears the attempt.

`customChordIssue(chord, library, data, options)` validates the native version-2 library shape: `id`, physical `keyCodes`, `text`, `scope` (`english`, `cpp`, `both`), `spacing` (`words`, `exact`), and `isEnabled`. `applyCustomChords` returns an independent active runtime without mutating bundled data. `customChordSuggestions` excludes commands, existing meanings, blocked combinations, and specified previous suggestions, using the native geometry ranking.
