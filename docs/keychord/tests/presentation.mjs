import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {PRESENTATION, FIRST_CHORD, firstChordState, firstChordPresentation, nextFirstChordState,
  demoPresentation, lessonPresentation} from '../presentation.js';

const source = JSON.parse(readFileSync(new URL('../presentation.json', import.meta.url), 'utf8'));

test('generated view and flow match the declarative presentation source for every state', () => {
  assert.deepEqual(PRESENTATION, source);
  for (const state of source.firstChord.states) {
    assert.deepEqual(firstChordState(state), state);
    const next = source.firstChord.states.find(s => s.id === state.next) ?? null;
    assert.deepEqual(nextFirstChordState(state), next);
    const base = source.firstChord.stages[state.stage];
    const content = {...base, ...(state.stage === 'undo' ? source.firstChord.recovery[state.recovery] : {})};
    for (const hintRevealed of [false, true]) {
      const view = firstChordPresentation(state.stage, {...state, hintRevealed});
      const phase = source.firstChord.demonstration[0];
      assert.deepEqual(view, {
        stageID: state.stage, label: content.label,
        title: content.title.replaceAll('{word}', state.target ?? ''),
        instruction: state.stage === 'see' ? phase.instruction : content.instruction,
        target: state.target,
        primaryAction: state.stage === 'see' ? phase.primaryAction : content.primaryAction,
        primaryActionID: state.stage === 'see' ? 'demonstrate' : content.primaryActionID,
        placeholder: content.placeholder ?? source.firstChord.placeholder,
        hintsVisible: content.hintsVisible || hintRevealed,
        physicalReleaseRequired: content.physicalReleaseRequired,
        nextStageID: content.nextStageID,
      });
    }
  }
});

test('demonstration waits for every key to be released before showing output', () => {
  const phases = source.firstChord.demonstration;
  for (const [index, expected] of phases.entries()) {
    const phase = demoPresentation(index);
    assert.deepEqual(phase, expected);
    const view = firstChordPresentation('see', {demonstrationIndex: index});
    assert.equal(view.instruction, phase.instruction);
    assert.equal(view.primaryAction, phase.primaryAction);
    assert.equal(view.primaryActionID, index === phases.length - 1 ? 'start' : 'demonstrate');
    assert.equal(view.placeholder, '');
    if (index < phases.length - 1) assert.equal(phase.output, null);
  }
  assert.equal(demoPresentation(phases.length - 1).output, FIRST_CHORD.states[0].target);
});

test('guided words, Undo recovery and recall follow one finite shared chain', () => {
  const visited = [];
  let state = firstChordState({stage: 'see'});
  while (state) {
    assert.ok(!visited.includes(state.id), 'the flow must terminate without a cycle');
    visited.push(state.id);
    state = nextFirstChordState(state);
  }
  assert.deepEqual(visited, source.firstChord.states.map(s => s.id));
  assert.deepEqual(source.firstChord.states.filter(s => s.stage === 'try').map(s => s.target), FIRST_CHORD.guidedWords);
  assert.deepEqual(source.firstChord.states.filter(s => s.stage === 'recall').map(s => s.target), FIRST_CHORD.recallWords);
  assert.deepEqual(source.firstChord.states.filter(s => s.stage === 'undo').map(s => s.target), ['hat', null, 'sat']);
  assert.equal(firstChordState({stage: 'recover', recovery: 'undo'}).completion, 'physicalUndo');
  assert.equal(firstChordState({stage: 'tryIt', wordIndex: 2}).target, 'tan');
});

test('lesson presentation uses the shared source and native stage aliases', () => {
  for (const [stage, expected] of Object.entries(source.lessons)) assert.deepEqual(lessonPresentation(stage), expected);
  assert.deepEqual(lessonPresentation('tryIt'), source.lessons.try);
  assert.throws(() => firstChordPresentation('unknown'), TypeError);
  assert.throws(() => nextFirstChordState({stage: 'undo', recovery: 'unknown'}), TypeError);
});
