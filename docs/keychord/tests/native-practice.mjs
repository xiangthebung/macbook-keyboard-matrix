import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as Core from '../core/index.js';
import {textEdit, PracticeApp} from '../practice-app.js';
import {sanitizeState} from '../learning-store.js';

const exported = JSON.parse(await readFile(new URL('../data.json', import.meta.url), 'utf8'));
const data = Core.createRuntimeData(exported);
function close(actual, expected, path = '') {
  if (typeof expected === 'number') assert.ok(Math.abs(actual - expected) <= 1e-8 * Math.max(1, Math.abs(expected)), `${path}: ${actual} != ${expected}`);
  else if (Array.isArray(expected)) { assert.equal(actual.length, expected.length, path); expected.forEach((value, i) => close(actual[i], value, `${path}[${i}]`)); }
  else if (expected && typeof expected === 'object') { assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort(), path); for (const key of Object.keys(expected)) close(actual[key], expected[key], `${path}.${key}`); }
  else assert.equal(actual, expected, path);
}
for (const fixture of exported.wordPracticeFixtures) test(`native word session: ${fixture.name}`, () => {
  const session = new Core.WordPracticeSession({words: fixture.words, seed: fixture.seed, goal: fixture.goal});
  assert.deepEqual(session.targetWords, fixture.targetWords);
  for (const [i, operation] of fixture.operations.entries()) {
    let accepted = null;
    if (operation.range) accepted = session.edit(operation.range, operation.text, operation.at, operation.verified ?? false);
    else session.advance(operation.at);
    close({accepted, typedText: session.typedText, startedAt: session.startedAt, finishedAt: session.finishedAt,
      metrics: session.metrics(operation.at), samples: session.samples}, fixture.snapshots[i]);
  }
  assert.deepEqual(session.restarted().targetWords, fixture.targetWords);
  assert.equal(session.restarted().startedAt, null);
});
test('all current native vocabularies are present with their exact word counts', () => {
  assert.deepEqual(exported.wordPractice.vocabularies.map(v => [v.id, v.words.length]), [['english', 200], ['english5k', 5000], ['english25k', 24141]]);
  for (const vocabulary of exported.wordPractice.vocabularies) {
    assert.equal(new Set(vocabulary.words).size, vocabulary.words.length);
    const stream = new Core.WordPracticeWordStream(vocabulary.words, 42);
    let previous; for (let i = 0; i < 500; i++) { const word = stream.next(); assert.notEqual(word, previous); previous = word; }
  }
});
test('custom chord validation agrees with current Swift rules', () => {
  for (const fixture of exported.customChordFixtures.issues) assert.equal(Core.customChordIssue(fixture.chord, fixture.others, data, {usable: () => !fixture.blocked}), fixture.message);
});
test('custom phrase and attached-symbol output, Caps Lock and Undo match Swift in both languages', () => {
  const active = Core.applyCustomChords(exported.customChordFixtures.chords, data);
  for (const fixture of exported.customChordFixtures.replays) {
    const engine = new Core.ChordEngine(active, fixture.mode); let buffer = Core.createBuffer();
    for (const stroke of fixture.strokes) {
      const result = engine.translate(stroke.keys, {join: stroke.join, capsLock: stroke.capsLock});
      assert.deepEqual(result.actions, stroke.actions); buffer = Core.applyActions(buffer, result.actions);
      assert.equal(buffer.text, stroke.text); assert.equal(buffer.cursor, stroke.cursor);
      assert.deepEqual(engine.currentContext, stroke.context); assert.equal(engine.undoDepth, stroke.undoDepth);
    }
  }
});
test('unused short-chord suggestions agree with Swift geometry and collision checks', () => {
  for (const fixture of exported.customChordFixtures.suggestions) assert.deepEqual(Core.customChordSuggestions(fixture.scope, [], data).map(keys => Core.keyNames(data, keys)), fixture.keys);
});
test('disabling or removing a custom chord restores the bundled meaning without modifying base data', () => {
  const chord = exported.customChordFixtures.chords[0], original = structuredClone(exported.dictionaries);
  const active = Core.applyCustomChords([chord], data);
  assert.equal(new Core.ChordEngine(active).translate(['S', 'C', 'J']).actions[0].text, 'hello world');
  for (const library of [[], [{...chord, isEnabled: false}]]) assert.equal(new Core.ChordEngine(Core.applyCustomChords(library, data)).translate(['S', 'C', 'J']).actions[0].text, 'sat');
  assert.deepEqual(exported.dictionaries, original);
});
test('invalid and duplicate saved chords cannot shadow a working mapping', () => {
  const chord = exported.customChordFixtures.chords[0];
  const duplicate = {...chord, id: 'duplicate', text: 'bad'};
  const active = Core.applyCustomChords([chord, duplicate, {...chord, id: 'unknown', keyCodes: [65535]}], data);
  assert.equal(new Core.ChordEngine(active).translate(['S', 'C', 'J']).actions[0].text, 'sat');
  assert.ok(Core.customChordIssue({...chord, keyCodes: [chord.keyCodes[0], chord.keyCodes[0]]}, [], data));
});
test('editing differences preserve grapheme offsets and count corrected mistakes', () => {
  assert.deepEqual(textEdit('a👩🏽‍💻c', 'a👩🏽‍💻bc'), {range: [2, 2], text: 'b'});
  assert.deepEqual(textEdit('make', 'making'), {range: [3, 4], text: 'ing'});
});
test('only a physically captured, matching planner step can receive intermediate-word credit', () => {
  const app = Object.assign(Object.create(PracticeApp.prototype), {data, wordPlans: new Map(), wordSession: {targetWords: ['making']}, tab: 'words',
    profile: Core.getProfile(data, 'generic'), store: {preferences: {practiceHints: true}}, modernReady: true});
  const guide = app.wordPlan('making'), replay = Core.replayGuide(data, guide);
  const intermediate = replay.results.find(state => state.buffer.text !== 'making');
  assert.ok(intermediate);
  app.field = {enabled: true, field: {selectionStart: intermediate.buffer.text.length}};
  const info = {physical: true, result: intermediate.result, keys: intermediate.step.action.keys, text: intermediate.buffer.text, before: ''};
  app.verifyWordChord(info); assert.equal(app.wordVerified, true);
  app.verifyWordChord({...info, physical: false}); assert.equal(app.wordVerified, false);
  app.verifyWordChord({...info, keys: ['1']}); assert.equal(app.wordVerified, false);
});
test('practice preferences migrate without losing old learning and mapping preferences', () => {
  const state = sanitizeState({preferences: {theme: 'dark', selectedLesson: 'cpp-program', wordGoal: 'time', wordLength: 120, practiceHints: false}, mappings: {old: {'first-chord': {guidedPasses: 2}}}});
  assert.equal(state.preferences.theme, 'dark'); assert.equal(state.preferences.selectedLesson, 'cpp-program');
  assert.equal(state.preferences.wordLength, 120); assert.equal(state.preferences.practiceHints, false);
  assert.equal(state.mappings.old['first-chord'].guidedPasses, 2);
  assert.equal(sanitizeState({}).preferences.practiceSection, 'words');
});
test('word hints continue to the next word using automatic spacing', () => {
  const app = Object.assign(Object.create(PracticeApp.prototype), {data, wordPlans: new Map(), mappingVersion: data.mappingVersion,
    wordSession: {targetWords: ['sat', 'hat'], typedText: 'sat', typedWords: ['sat'], currentWordIndex: 0}, tab: 'words', profile: Core.getProfile(data, 'generic'), field: {field: {value: 'sat', selectionStart: 3}}});
  const step = app.nextStep(); assert.equal(step.action.type, 'chord');
  const engine = new Core.ChordEngine(data); engine.translate(['S', 'C', 'J']);
  const result = engine.translate(step.action.keys, {join: step.action.shift});
  assert.equal(Core.applyActions(Core.createBuffer('sat'), result.actions).text, 'sat hat');
});
test('the lesson browser covers both native languages and searches unit names and titles', () => {
  const app = Object.assign(Object.create(PracticeApp.prototype), {exported, lessons: data.course.steps, selected: 0,
    store: {state: {mappings: {old: {[data.course.steps[0].id]: {guidedPasses: 1}}}}}});
  let html = app.lessonBrowserHTML();
  assert.equal((html.match(/data-lesson-index=/g) ?? []).length, 45);
  assert.ok(html.includes('1 of 45 lessons practiced'));
  assert.ok(html.includes('practiced, current lesson'));
  app.lessonQuery = exported.course.units[0].title;
  html = app.lessonBrowserHTML();
  assert.equal((html.match(/data-lesson-index=/g) ?? []).length, data.course.steps.filter(l => l.unitIndex === 0).length);
  app.selected = data.course.steps.findIndex(l => l.mode === 'cpp'); app.lessonQuery = '';
  assert.equal((app.lessonBrowserHTML().match(/data-lesson-index=/g) ?? []).length, 7);
  app.lessonQuery = 'no such lesson'; assert.ok(app.lessonBrowserHTML().includes('No matching lessons'));
});
test('speech completion advances only the current prompt and stops on focus loss', () => {
  const originals = {window: globalThis.window, document: globalThis.document, SpeechSynthesisUtterance: globalThis.SpeechSynthesisUtterance};
  const spoken = []; let completed = 0;
  globalThis.window = {speechSynthesis: {cancel() {}, getVoices: () => [], speak: utterance => spoken.push(utterance)}};
  globalThis.document = {hidden: false};
  globalThis.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
  try {
    const app = Object.assign(Object.create(PracticeApp.prototype), {tab: 'listen'});
    app.speak('Correct.', () => completed++); app.stopSpeech(); spoken[0].onend(); assert.equal(completed, 0);
    app.speak('Old prompt', () => completed++); app.speak('Current prompt', () => completed++);
    spoken[1].onend(); assert.equal(completed, 0); spoken[2].onend(); assert.equal(completed, 1);
    app.tab = 'words'; spoken[2].onend(); assert.equal(completed, 1);
  } finally { for (const [key, value] of Object.entries(originals)) if (value === undefined) delete globalThis[key]; else globalThis[key] = value; }
});
test('word and voice keyboard meanings switch back to English after a C++ lesson', () => {
  const app = Object.assign(Object.create(PracticeApp.prototype), {mode: 'cpp', tab: 'words', wordsHTML() { return this.mode; }, voiceHTML() { return this.mode; }});
  assert.equal(app.viewHTML(), 'english'); app.mode = 'cpp'; app.tab = 'listen'; assert.equal(app.viewHTML(), 'english');
});
