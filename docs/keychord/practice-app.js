import {KeyChordApp, ChordField} from './app.js?v=96c282d34c00';
import * as Core from './core/index.js?v=96c282d34c00';
import {AttemptEvidence, escapeHTML as h, validPhysicalEvent} from './learning.js?v=96c282d34c00';

const sections = [['words', 'Words'], ['learn', 'Lessons'], ['listen', 'Voice Practice']];
const utilities = [['custom', 'Custom Chords'], ['reference', 'Reference'], ['editor', 'Editor'], ['settings', 'Settings']];
const customStorageKey = 'keychord.custom-chords.v2';
const now = () => performance.now() / 1000;
const seed = () => BigInt(Date.now());
const options = (items, selected) => items.map(([value, title]) => `<option value="${h(value)}" ${String(value) === String(selected) ? 'selected' : ''}>${h(title)}</option>`).join('');
const same = (a, b) => a.length === b.length && a.every((value, index) => value === b[index]);

export function textEdit(before, after) {
  const left = Core.graphemes(before), right = Core.graphemes(after);
  let start = 0, endLeft = left.length, endRight = right.length;
  while (start < endLeft && start < endRight && left[start] === right[start]) start++;
  while (endLeft > start && endRight > start && left[endLeft - 1] === right[endRight - 1]) { endLeft--; endRight--; }
  return {range: [start, endLeft], text: right.slice(start, endRight).join('')};
}

export class PracticeApp extends KeyChordApp {
  constructor(exported) {
    super(exported);
    this.baseData = this.data;
    this.customLibrary = []; this.customUnreadable = false;
    try {
      const raw = window.localStorage.getItem(customStorageKey);
      if (raw) {
        const saved = JSON.parse(raw);
        if (![1, 2].includes(saved.version) || !Array.isArray(saved.chords) || saved.chords.length > 2000 || saved.chords.some(c => !c || typeof c !== 'object')) throw new Error('Invalid custom chord library');
        this.customLibrary = saved.chords.map(c => ({...c, isEnabled: c.isEnabled !== false}));
      }
    } catch { this.customUnreadable = true; this.warnings.push('Saved custom chords could not be read. They have been preserved; saving is disabled until the library is repaired.'); }
    this.applyLibrary();
    this.onboarding = false; this.courseOverview = false; this.stage = 'try';
    this.listenScope = 'all'; this.wordPlans = new Map(); this.wordSelection = [0, 0];
    this.modernReady = true;
    const requested = location.hash.slice(1);
    this.tab = [...sections, ...utilities].some(([id]) => id === requested) ? requested : requested === 'practice' ? 'words' : this.store.preferences.practiceSection;
    this.newWords(); this.prepareLesson(); this.resetCustomDraft();
    this.render(); this.applyPrefs();
    window.addEventListener('hashchange', () => { const tab = location.hash.slice(1); if ([...sections, ...utilities].some(([id]) => id === tab) && tab !== this.tab) this.switchTab(tab, false); });
    document.addEventListener('keydown', event => this.shortcut(event));
    window.addEventListener('blur', () => this.stopSpeech());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.stopSpeech(); else this.tickWords(); });
    window.matchMedia('(min-width: 980px)').addEventListener('change', event => { const browser = document.getElementById('lesson-browser'); if (browser) browser.open = event.matches; });
    window.addEventListener('beforeunload', event => { if (this.customDirty) { event.preventDefault(); event.returnValue = ''; } });
    this.wordTimer = window.setInterval(() => this.tickWords(), 100);
    if (this.warnings.length) this.notice(this.warnings.join(' '));
  }
  get isIntroducing() { return false; }
  get customOptions() { return {rolloverLimit: this.profile.rolloverLimit, usable: this.profile.usable, geometry: this.store.preferences.keyboardGeometry}; }
  makeExercise(args) { if (!this.modernReady) return super.makeExercise(args); this.prepareLesson(); }
  destroyView() { this.stopSpeech(); super.destroyView(); }
  cancelAdvance() { if (this.voiceAdvance) clearTimeout(this.voiceAdvance); this.voiceAdvance = null; }
  stopSpeech() { this.speechEpoch = (this.speechEpoch ?? 0) + 1; this.cancelAdvance(); if ('speechSynthesis' in window) window.speechSynthesis.cancel(); }
  switchTab(tab, hash = true) {
    if (this.tab === 'custom' && this.customDirty && tab !== 'custom' && !window.confirm('Discard the unsaved custom chord changes?')) return;
    this.saveDrafts(); this.stopSpeech(); this.tab = tab;
    if (sections.some(([id]) => id === tab)) this.store.prefs({practiceSection: tab});
    if (hash) history.replaceState(null, '', `#${tab}`);
    if (tab === 'learn') this.restoreLesson();
    if (tab === 'listen') this.restoreListening();
    this.render(); document.getElementById('workspace')?.focus({preventScroll: true}); window.scrollTo(0, 0);
  }
  saveDrafts() {
    super.saveDrafts();
    const input = this.field?.field;
    if (this.tab === 'words' && input) this.wordSelection = [input.selectionStart, input.selectionEnd];
    if (this.tab === 'learn') this.lessonState = {target: this.target, guide: this.guide, mode: this.mode, inputText: this.inputText, evidence: this.evidence, completed: this.completed, guideProgress: this.guideProgress};
    if (this.tab === 'listen' && this.listenState) this.listenState.completed = this.completed;
  }
  restoreLesson() { if (this.lessonState) Object.assign(this, this.lessonState); else this.prepareLesson(); }
  prepareLesson() {
    this.field?.destroy(); this.field = null;
    this.target = this.lesson.text; this.mode = this.lesson.mode; this.inputText = ''; this.completed = false;
    this.guide = this.plan(this.target, this.mode); this.evidence = new AttemptEvidence(); this.resetGuideProgress();
    this.lessonState = {target: this.target, guide: this.guide, mode: this.mode, inputText: '', completed: false, evidence: this.evidence, guideProgress: this.guideProgress};
  }
  render() {
    if (!this.modernReady) return;
    this.destroyView();
    document.getElementById('app').innerHTML = `<nav class="site-nav" aria-label="KeyChord">
      <a class="brand" href="#words" data-tab="words">KeyChord</a>
      <div class="links primary-navigation">${sections.map(([id, title]) => `<a href="#${id}" data-tab="${id}" ${this.tab === id ? 'aria-current="page"' : ''}>${title}</a>`).join('')}</div>
      <details class="nav-more"><summary>Tools</summary><div class="nav-more-links">${utilities.map(([id, title]) => `<a href="#${id}" data-tab="${id}" ${this.tab === id ? 'aria-current="page"' : ''}>${title}</a>`).join('')}<a href="../">Keyboard matrix</a><a href="./downloads/KeyChord.zip">Download Mac app</a></div></details>
    </nav><div class="notice" id="notice" role="status" ${this.noticeText ? '' : 'hidden'}><p>${h(this.noticeText ?? '')}</p><button class="quiet small" id="dismiss-notice" aria-label="Dismiss notification">×</button></div>
    <div class="layout single-layout"><main id="workspace" class="workspace focused-workspace labels-${this.store.preferences.keyLabels}" tabindex="-1">${this.viewHTML()}</main></div>`;
    document.querySelectorAll('[data-tab]').forEach(link => link.onclick = event => { event.preventDefault(); this.switchTab(link.dataset.tab); });
    document.getElementById('dismiss-notice').onclick = () => { this.noticeText = ''; document.getElementById('notice').hidden = true; };
    this.bindModernView();
  }
  viewHTML() {
    if (this.tab === 'words') { this.mode = 'english'; return this.wordsHTML(); }
    if (this.tab === 'learn') return this.lessonsHTML();
    if (this.tab === 'listen') { this.mode = 'english'; return this.voiceHTML(); }
    if (this.tab === 'custom') return this.customHTML();
    if (this.tab === 'settings') return this.modernSettingsHTML();
    if (this.tab === 'editor') { this.mode = this.editorMode; return this.editorHTML(); }
    return this.referenceHTML();
  }
  keyboardHTML() {
    const original = this.profile;
    this.profile = {...original, modelID: this.store.preferences.keyboardGeometry === 'iso' ? 'macbook-iso' : 'macbook-ansi'};
    const html = super.keyboardHTML(); this.profile = original; return html;
  }
  keysHTML(keys = [], shift = false) {
    const geometry = this.store.preferences.keyboardGeometry;
    return `${shift ? '<kbd>Shift</kbd> + ' : ''}${keys.map(name => `<kbd>${h(this.data.layout.keys.find(k => k.name === name)?.legends?.[geometry] ?? name)}</kbd>`).join(' + ')}`;
  }
  bindModernView() {
    if (this.tab === 'words') this.bindWords();
    else if (this.tab === 'learn') this.bindLessons();
    else if (this.tab === 'listen') this.bindVoice();
    else if (this.tab === 'custom') this.bindCustom();
    else if (this.tab === 'settings') this.bindModernSettings();
    else if (this.tab === 'editor') this.bindEditor();
    else this.bindReference();
  }
  hintsHTML() { return `<label class="inline-check"><input type="checkbox" id="practice-hints" ${this.store.preferences.practiceHints ? 'checked' : ''}> Hints <kbd>⇧⌘H</kbd></label>`; }
  modeHTML() { return `<button class="small" id="input-mode">${this.store.preferences.chordEnabled ? 'Chord typing' : 'Ordinary typing'} · Right ⌥</button>`; }
  guideHTML() { return `<div class="keyboard-guide" id="exercise-keyboard"><div id="hint-strip" class="hint-strip"></div>${this.keyboardHTML()}</div>`; }
  typingHTML(value = '', label = 'Your typing') { return `<label class="field-label" for="chord-input">${label}</label><textarea id="chord-input" class="chord-input" rows="3" spellcheck="false" autocapitalize="off" autocomplete="off" autocorrect="off" aria-label="Chord typing input" aria-describedby="input-status">${h(value)}</textarea><div class="input-bar">${this.modeHTML()}<span id="input-status" class="status-text" role="status"></span></div><div id="practice-result"></div>`; }
  bindOwnedField({value, onChange, onChord, evidence, mode = 'english'}) {
    const input = document.getElementById('chord-input'); input.value = value;
    for (const type of ['paste', 'drop']) input.addEventListener(type, event => { event.preventDefault(); this.notice('Type the passage to practice; paste is disabled.'); });
    input.addEventListener('beforeinput', event => { if (event.inputType?.includes('Paste') || event.inputType?.includes('Drop')) event.preventDefault(); });
    this.field = new ChordField(this, input, {mode, evidence, onChange, onChord,
      onOrdinary: () => { if (this.tab === 'words') { this.wordUsedKeyboard = true; this.wordIntermediate = null; this.wordVerified = false; this.wordHintKey = null; } },
      onHeld: keys => this.updateHeld(keys), onModifier: held => this.updateShift(held), onState: (enabled, focused) => this.updateState(enabled, focused)});
    this.field.setEnabled(this.store.preferences.chordEnabled, false);
    document.getElementById('input-mode').onclick = () => this.field.setEnabled(!this.field.enabled);
    return input;
  }
  updateState(enabled, focused) {
    if (!this.modernReady) return;
    this.store.prefs({chordEnabled: enabled});
    const button = document.getElementById('input-mode'); if (button) button.textContent = `${enabled ? 'Chord typing' : 'Ordinary typing'} · Right ⌥`;
    const status = document.getElementById('input-status'); if (status && this.tab !== 'words') status.textContent = enabled ? focused ? 'Hold the keys together, then release.' : 'Click the typing field to begin.' : 'Ordinary typing';
    const start = document.getElementById('start-chords'); if (start) start.textContent = enabled ? 'Pause chords' : 'Start chords';
    this.updateHint();
  }
  shouldShowHints() { return this.modernReady ? this.tab === 'listen' ? Boolean(this.listenReveal) : this.store.preferences.practiceHints && this.field?.enabled !== false : super.shouldShowHints(); }
  bindHints() { const control = document.getElementById('practice-hints'); if (control) control.onchange = () => { this.store.prefs({practiceHints: control.checked}); this.updateHint(); this.field?.field.focus(); }; }
  toggleHints() {
    if (this.tab === 'listen') { this.revealVoice(); return; }
    if (!['words', 'learn'].includes(this.tab)) return;
    const visible = !this.store.preferences.practiceHints; this.store.prefs({practiceHints: visible});
    const control = document.getElementById('practice-hints'); if (control) control.checked = visible;
    this.updateHint(); this.field?.field.focus();
  }
  shortcut(event) {
    if (!event.metaKey || event.altKey || event.ctrlKey || !['words', 'learn', 'listen'].includes(this.tab) || !document.getElementById('app')?.contains(document.activeElement)) return;
    const key = event.key.toLowerCase(); let action;
    if (event.shiftKey && key === 'h') action = () => this.toggleHints();
    else if (event.shiftKey && key === 'r' && this.tab === 'listen') action = () => this.speakWord();
    else if (!event.shiftKey && key === 'r') action = () => this.retry();
    else if (!event.shiftKey && key === 'enter') action = () => this.newAction();
    if (action) { event.preventDefault(); if (!event.repeat) action(); }
  }
  newAction() { if (this.tab === 'words') { this.newWords(); this.render(); } else if (this.tab === 'learn') this.nextLesson(); else this.startVoice(); }
  retry() { if (this.tab === 'words') { this.wordSession = this.wordSession.restarted(); this.resetWordFlags(); this.render(); } else if (this.tab === 'learn') { this.prepareLesson(); this.render(); } else this.startVoice(); this.field?.field.focus(); }
  newWords() {
    if (!this.exported.wordPractice) return;
    const p = this.store.preferences, vocabulary = this.exported.wordPractice.vocabularies.find(v => v.id === p.wordVocabulary);
    this.wordSession = new Core.WordPracticeSession({vocabulary: vocabulary.id, words: vocabulary.words, seed: seed(), goal: {type: p.wordGoal, count: p.wordLength}});
    this.resetWordFlags();
  }
  resetWordFlags() { this.wordIntermediate = null; this.wordHintKey = null; this.wordHintMessage = ''; this.wordSelection = [0, 0]; this.wordUsedChords = false; this.wordUsedKeyboard = false; this.wordUsedHints = false; this.wordFinishedAnnounced = false; this.wordPlans?.clear(); }
  wordsHTML() {
    if (!this.wordSession) return '<p>The current word practice data is unavailable.</p>';
    const p = this.store.preferences, lengths = this.exported.wordPractice[p.wordGoal === 'time' ? 'times' : 'counts'];
    return `<div class="workspace-heading"><h2>Words</h2>${this.hintsHTML()}</div><div class="word-options"><label>Vocabulary<select id="word-vocabulary">${options(this.exported.wordPractice.vocabularies.map(v => [v.id, v.title]), p.wordVocabulary)}</select></label><label>Session<select id="word-goal">${options([['time', 'Time'], ['words', 'Words']], p.wordGoal)}</select></label><label>Length<select id="word-length">${options(lengths.map(n => [n, p.wordGoal === 'time' ? `${n} seconds` : `${n} words`]), p.wordLength)}</select></label></div>
      <div class="practice-metrics">${['WPM', 'Accuracy', 'Remaining'].map((label, i) => `<div><span>${label}</span><strong id="metric-${i}">—</strong></div>`).join('')}</div>
      <div id="word-target" class="target word-target" aria-label="Words to type"></div>
      ${this.typingHTML(this.wordSession.typedText)}<div class="practice-actions"><button id="new-words">New words <kbd>⌘↵</kbd></button><button id="retry">Retry <kbd>⌘R</kbd></button></div>${this.guideHTML()}`;
  }
  bindWords() {
    if (!this.wordSession) return;
    this.mode = 'english'; this.guideProgress = null;
    const input = this.bindOwnedField({value: this.wordSession.typedText, onChange: text => this.editWords(text), onChord: info => this.verifyWordChord(info)});
    input.readOnly = this.wordSession.isFinished; input.setSelectionRange(...this.wordSelection);
    this.field.restorePrefix = () => {
      this.field.engine.discardChord();
      const prefix = input.value.slice(0, input.selectionStart), index = prefix.split(' ').length - 1, token = prefix.split(' ').at(-1);
      const intermediate = this.wordIntermediate;
      if (input.selectionStart === input.value.length && intermediate?.index === index && intermediate.text === token) this.field.engine.restore(intermediate.context);
      else if (this.wordSession.targetWords[index] === token && token) this.field.engine.restore(this.wordPlan(token).steps.at(-1)?.contextAfter ?? Core.initialContext());
      else this.field.engine.restore(Core.initialContext());
    };
    this.field.restorePrefix();
    for (const [id, preference] of [['word-vocabulary', 'wordVocabulary'], ['word-goal', 'wordGoal'], ['word-length', 'wordLength']]) document.getElementById(id).onchange = event => {
      const update = {[preference]: preference === 'wordLength' ? Number(event.target.value) : event.target.value};
      if (preference === 'wordGoal') update.wordLength = event.target.value === 'time' ? 30 : 10;
      this.store.prefs(update); this.newWords(); this.render();
    };
    document.getElementById('new-words').onclick = () => this.newAction(); document.getElementById('retry').onclick = () => this.retry();
    this.bindHints(); this.bindKeyboard(); this.drawWords();
  }
  wordPlan(word) { if (!this.wordPlans.has(word)) this.wordPlans.set(word, this.plan(word, 'english')); return this.wordPlans.get(word); }
  verifyWordChord({physical, result, keys, text, before}) {
    this.wordVerified = false;
    if (!physical || result.signal) { this.wordIntermediate = null; return; }
    this.wordUsedChords = true; this.wordUsedHints ||= this.shouldShowHints();
    if (this.field.field.selectionStart !== text.length || text === before) return;
    const index = text.split(' ').length - 1, token = text.split(' ').at(-1), word = this.wordSession.targetWords[index];
    if (!word) return;
    const plan = this.wordPlan(word), chars = Core.graphemes(word);
    for (const [i, step] of plan.steps.entries()) {
      if (step.action.type !== 'chord' || !same(Core.keyIndices(this.data, keys), Core.keyIndices(this.data, step.action.keys))) continue;
      if (chars.slice(0, step.textEnd - Core.graphemes(step.tail).length).join('') + step.tail !== token) continue;
      this.wordVerified = true; this.wordIntermediate = {index, text: token, context: step.contextAfter, next: plan.steps[i + 1]}; return;
    }
    this.wordIntermediate = null;
  }
  editWords(text) {
    const change = textEdit(this.wordSession.typedText, text);
    if (!this.wordSession.edit(change.range, change.text, now(), this.wordVerified === true)) this.field.field.value = this.wordSession.typedText;
    this.wordVerified = false;
    this.wordSelection = [this.field.field.selectionStart, this.field.field.selectionEnd]; this.drawWords();
  }
  tickWords() { this.wordSession?.advance(now()); if (this.tab === 'words' && this.field) this.drawWords(); }
  drawWords() {
    const session = this.wordSession, m = session.metrics(now()), index = session.currentWordIndex, typed = session.typedWords;
    const values = [session.startedAt === null ? '—' : Math.round(m.wpm), `${Math.round(m.accuracy)}%`, session.goal.type === 'time' ? `${Math.max(0, Math.ceil(session.goal.count - m.elapsed))}s` : Math.max(0, session.goal.count - m.completedWords)];
    values.forEach((value, i) => { const element = document.getElementById(`metric-${i}`); if (element) element.textContent = value; });
    const target = document.getElementById('word-target');
    target.innerHTML = session.targetWords.slice(Math.max(0, index - 12), index + 40).map((word, offset) => {
      const wordIndex = offset + Math.max(0, index - 12), actual = Core.graphemes(typed[wordIndex] ?? ''), expected = Core.graphemes(word);
      const preview = this.wordIntermediate?.index === wordIndex && this.wordIntermediate.text === typed[wordIndex];
      return `<span class="word ${wordIndex === index ? 'current-word' : ''}">${expected.map((c, i) => `<span class="${i < actual.length ? preview || c === actual[i] ? 'matched' : 'mistyped' : wordIndex < index ? 'mistyped' : 'remaining'}">${h(c)}</span>`).join('')}${actual.length > expected.length ? `<span class="mistyped">${h(actual.slice(expected.length).join(''))}</span>` : ''}</span>`;
    }).join(' ');
    const active = target.querySelector('.current-word') ?? target.lastElementChild;
    if (active) {
      if (active.offsetTop < target.scrollTop) target.scrollTop = active.offsetTop;
      else if (active.offsetTop + active.offsetHeight > target.scrollTop + target.clientHeight) target.scrollTop = active.offsetTop + active.offsetHeight - target.clientHeight;
    }
    const input = this.field.field; input.readOnly = session.isFinished;
    document.getElementById('input-status').textContent = session.isFinished ? 'Practice complete. Try new words or retry.' : session.startedAt !== null ? `${m.completedWords} words complete · Space moves on · Backspace corrects mistakes` : 'Hold the chord keys together, then release. Right Option switches to ordinary typing.';
    if (session.isFinished) {
      document.getElementById('practice-result').innerHTML = `<section class="result"><h3>Practice complete</h3><p>${this.wordUsedChords && this.wordUsedKeyboard ? 'Chords + keyboard' : this.wordUsedChords ? 'Chords' : 'Keyboard'}${this.wordUsedHints ? ' · guided' : ''} · ${m.elapsed.toFixed(1)}s</p><p>${m.correctWords} correct words · ${m.mistakes} mistakes · ${Math.round(m.rawWPM)} raw WPM · ${Math.round(m.consistency)}% consistency</p>${this.speedChart(session.samples)}</section>`;
      if (!this.wordFinishedAnnounced) { this.wordFinishedAnnounced = true; this.announce(`Practice complete. ${Math.round(m.wpm)} words per minute. ${Math.round(m.accuracy)} percent accuracy.`); this.field.discard(true); }
    }
    this.updateHint();
  }
  speedChart(samples) {
    if (!samples.length) return '';
    const duration = Math.max(1, samples.at(-1).seconds), top = Math.max(1, ...samples.map(s => s.rawWPM));
    const points = property => samples.map(s => `${20 + s.seconds / duration * 600},${140 - s[property] / top * 115}`).join(' ');
    return `<svg class="speed-chart" viewBox="0 0 640 170" role="img" aria-label="Typing speed over time. Blue: WPM. Gray: raw WPM. Red: errors."><title>Correct WPM in blue, raw WPM in gray and errors in red</title><path d="M20 15V140H620" fill="none" stroke="var(--line)"/><polyline points="${points('rawWPM')}" fill="none" stroke="var(--muted)" stroke-width="2"/><polyline points="${points('wpm')}" fill="none" stroke="var(--on-edge)" stroke-width="3"/>${samples.filter(s => s.errors > 0).map(s => `<circle cx="${20 + s.seconds / duration * 600}" cy="140" r="3" fill="var(--bad-text)"/>`).join('')}<text x="20" y="162">0s</text><text x="570" y="162">${duration.toFixed(1)}s</text></svg>`;
  }
  nextStep() {
    if (this.tab !== 'words') return super.nextStep();
    const index = this.wordSession.currentWordIndex, word = this.wordSession.targetWords[index];
    if (!word) return null;
    const token = this.wordSession.typedWords[index] ?? '';
    this.wordHintMessage = '';
    if (this.wordIntermediate?.index === index && this.wordIntermediate.text === token && this.wordIntermediate.next) return this.wordIntermediate.next;
    const input = this.field?.field;
    if (input && input.selectionStart !== input.value.length) { this.wordHintMessage = 'Move to the end of your input to see the next chord.'; return null; }
    if (!word.startsWith(token)) { this.wordHintMessage = 'Correct the red letters, or press Space to move on.'; return null; }
    const typed = this.wordSession.typedText, key = `${this.mappingVersion}:${typed}`;
    if (key !== this.wordHintKey) {
      const suffix = word.slice(token.length) + (index + 1 < this.wordSession.targetWords.length ? ` ${this.wordSession.targetWords[index + 1]}` : '');
      this.wordHintStep = Core.planContinuation(typed + suffix, Core.graphemeCount(typed), {data: this.data, mode: 'english', profile: this.profile}).guide.steps[0];
      this.wordHintKey = key;
    }
    return this.wordHintStep;
  }
  updateHint() {
    if (!this.modernReady) return;
    const strip = document.getElementById('hint-strip'), keyboard = document.getElementById('exercise-keyboard');
    if (!strip || !keyboard) return;
    const show = this.shouldShowHints() && !(this.tab === 'words' ? this.wordSession?.isFinished : this.completed);
    keyboard.hidden = !show; strip.hidden = !show;
    const step = show ? this.nextStep() : null;
    strip.innerHTML = step?.action.type === 'chord' ? step.parts?.length ? step.parts.map(part => `<span class="chord-part">${this.keysHTML(part.keys)}<span class="part-arrow">→</span><span>${h(part.text)}</span></span>`).join('') : this.keysHTML(step.action.keys, step.action.shift) : step ? `<span>${step.action.type === 'normal' ? 'Use ordinary typing' : `Press ${h(step.action.key)}`}</span>` : this.tab === 'words' ? h(this.wordHintMessage) : '';
    document.querySelectorAll('[data-key]').forEach(button => button.classList.toggle('is-next', step?.action.keys?.includes(button.dataset.key) ?? false));
    document.querySelectorAll('[data-modifier=shift]').forEach(button => button.classList.toggle('is-next', Boolean(step?.action.shift)));
  }
  lessonPracticed(lesson) {
    return Object.values(this.store.state.mappings).some(progress => progress[lesson.id]?.guidedPasses || progress[lesson.id]?.firstPassDay != null);
  }
  lessonBrowserHTML() {
    const all = this.lessons.filter(l => l.mode === this.lesson.mode), query = (this.lessonQuery ?? '').trim().toLocaleLowerCase();
    const units = this.exported.course.units.map((unit, index) => {
      const lessons = all.filter(l => l.unitIndex === index && (!query || `${unit.title} ${l.title}`.toLocaleLowerCase().includes(query)));
      return lessons.length ? `<section class="course-unit"><h4>${h(unit.title)}</h4>${lessons.map(l => `<button class="course-lesson ${l.index === this.selected ? 'selected' : ''}" data-lesson-index="${l.index}" aria-label="${h(l.title)}${this.lessonPracticed(l) ? ', practiced' : ''}${l.index === this.selected ? ', current lesson' : ''}" ${l.index === this.selected ? 'aria-current="step"' : ''}><span class="course-number">${this.lessonPracticed(l) ? '✓' : l.unitStepIndex + 1}</span><span>${h(l.title)}</span></button>`).join('')}</section>` : '';
    }).join('');
    return `<h3>Course</h3><label class="field-label" for="lesson-language">Language</label><select id="lesson-language">${options([['english', 'English'], ['cpp', 'C++']], this.lesson.mode)}</select><label class="sr-only" for="lesson-search">Find a lesson</label><input id="lesson-search" type="search" placeholder="Find a lesson" value="${h(this.lessonQuery ?? '')}"><p class="micro course-progress">${all.filter(l => this.lessonPracticed(l)).length} of ${all.length} lessons practiced</p><div id="course-rows" class="course-rows">${units || '<p class="empty-state">No matching lessons. Try another search.</p>'}</div>`;
  }
  lessonsHTML() {
    const introductions = Core.courseIntroductionChords(this.data, this.selected).flatMap(intro => intro.chords);
    const placement = `${this.exported.course.units[this.lesson.unitIndex].title} · ${this.lesson.unitStepIndex + 1}`;
    return `<div class="workspace-heading"><h2>Lessons</h2>${this.hintsHTML()}</div><div class="lesson-layout"><details id="lesson-browser" class="course-browser" ${window.innerWidth >= 980 ? 'open' : ''}><summary>Browse lessons</summary><div class="course-browser-body">${this.lessonBrowserHTML()}</div></details><div class="lesson-workspace">
      <section class="lesson-introduction"><h3>${h(this.lesson.title)}${this.lessonPracticed(this.lesson) ? ' <span class="practiced">Practiced</span>' : ''}</h3><p class="micro">${h(placement)}</p><p>${h(this.browserIntro(this.lesson.intro))}</p>${introductions.length ? `<div class="new-combinations">${introductions.map(chord => `<span>${this.keysHTML(chord.keys, chord.shift)} → ${h(chord.label)}</span>`).join('')}</div>` : ''}</section>
      <div class="passage-label">TYPE THIS PASSAGE</div><div id="target" class="target" aria-label="Passage to type">${h(this.target)}</div>${this.typingHTML(this.inputText)}<div class="practice-actions"><button id="next-lesson">Next lesson <kbd>⌘↵</kbd></button><button id="retry">Retry <kbd>⌘R</kbd></button></div>${this.guideHTML()}</div></div>`;
  }
  browserIntro(text) { return text.replace('Tap the right ⌥ Option key to turn chord typing on: the menu bar shows English.', 'Click the typing field to begin. Right Option switches between chords and ordinary typing.').replace(/the menu bar/g, 'the typing mode'); }
  selectLesson(index) { if (this.lessons[index].mode !== this.lesson.mode) this.lessonQuery = ''; this.selected = index; this.store.prefs({selectedLesson: this.lesson.id}); this.prepareLesson(); this.render(); }
  nextLesson() { const next = this.lessons.find(l => l.index > this.selected && l.mode === this.lesson.mode); if (next) this.selectLesson(next.index); }
  bindLessons() {
    this.bindOwnedField({value: this.inputText, mode: this.mode, evidence: this.evidence, onChange: text => this.updateInput(text), onChord: info => this.onChord(info)});
    document.getElementById('lesson-language').onchange = event => this.selectLesson(this.lessons.find(l => l.mode === event.target.value).index);
    document.getElementById('lesson-search').oninput = event => {
      this.lessonQuery = event.target.value;
      const template = document.createElement('template'); template.innerHTML = this.lessonBrowserHTML();
      document.getElementById('course-rows').innerHTML = template.content.querySelector('#course-rows').innerHTML;
      this.bindLessonRows();
    };
    this.bindLessonRows();
    document.getElementById('next-lesson').onclick = () => this.nextLesson(); document.getElementById('retry').onclick = () => this.retry();
    document.getElementById('next-lesson').disabled = !this.lessons.some(l => l.index > this.selected && l.mode === this.lesson.mode);
    this.bindHints(); this.bindKeyboard(); this.updateHint();
    if (this.completed) this.showLessonResult();
  }
  bindLessonRows() { document.querySelectorAll('[data-lesson-index]').forEach(button => button.onclick = () => { this.selectLesson(Number(button.dataset.lessonIndex)); this.field?.field.focus(); }); }
  markAssistance(reason, error = false) { if (!this.evidence) return; if (error) this.evidence.error(reason); else this.evidence.assist(reason); }
  onChord(info) { super.onChord(info); if (this.tab === 'listen' && !this.listenResult && info.physical && !this.guideProgress?.correct && info.text) this.speak('Try again. Use Undo to correct the word.'); }
  updateInput(text) {
    this.inputText = text;
    this.guideProgress?.update({text, cursor: Core.toGraphemeOffset(text, this.field.field.selectionStart), context: this.field.engine.currentContext});
    const target = document.getElementById('target'); if (target) { let matched = 0; while (matched < text.length && text[matched] === this.target[matched]) matched++; target.innerHTML = `<span class="matched">${h(this.target.slice(0, matched))}</span><span class="remaining">${h(this.target.slice(matched))}</span>`; }
    this.updateHint();
    if (this.tab === 'listen') { this.checkListening(text); return; }
    if (text === this.target && this.target && this.guideProgress?.complete && this.evidence.chordOnly && !this.completed) {
      this.completed = true; this.evidence.complete(); this.store.record('practice-lessons-v1', this.lesson.id, {guided: true}); this.showLessonResult();
    }
    this.lessonState = {target: this.target, guide: this.guide, mode: this.mode, inputText: text, evidence: this.evidence, completed: this.completed, guideProgress: this.guideProgress};
  }
  showLessonResult() {
    document.getElementById('practice-result').innerHTML = '<div class="result"><strong>Lesson practiced</strong><p>Choose Next lesson to continue, or retry.</p></div>';
    const all = this.lessons.filter(l => l.mode === this.lesson.mode);
    document.querySelector('.course-progress').textContent = `${all.filter(l => this.lessonPracticed(l)).length} of ${all.length} lessons practiced`;
    const row = document.querySelector(`[data-lesson-index="${this.selected}"]`);
    if (row) { row.querySelector('.course-number').textContent = '✓'; row.setAttribute('aria-label', `${this.lesson.title}, practiced, current lesson`); }
    this.updateHint(); this.announce('Lesson practiced.');
  }
  voiceHTML() {
    const session = this.listenSession, prompt = session?.prompt, complete = session?.isSessionComplete;
    return `<div class="workspace-heading"><h2>Voice Practice</h2><span class="session-count">${session ? `${session.completedWords} / 10` : ''}</span></div><div class="practice-actions"><button id="voice-start">${session ? 'New session' : 'Start voice practice'}</button>${prompt && !complete ? '<button id="voice-replay">Hear again <kbd>⇧⌘R</kbd></button><button id="voice-hint">Hints <kbd>⇧⌘H</kbd></button>' : ''}</div>
      ${complete ? `<div class="result"><h3>Practice complete</h3><p>10 words · ${session.assistedWords} assisted</p><button id="retry">Retry <kbd>⌘R</kbd></button></div>` : prompt ? `<div id="listening-word" class="listening-word">${this.listenReveal ? h(this.target) : 'Listen, then type the word.'}</div>${this.typingHTML(this.inputText, 'Your answer')}<button id="voice-next" class="small" ${this.listenResult ? '' : 'hidden'}>Next word</button>${this.guideHTML()}` : '<p class="empty-state">Practice ten spoken words with your eyes closed. No microphone is needed.</p>'}`;
  }
  startVoice() {
    this.stopSpeech(); this.listenSession = new Core.ListeningPractice({data: this.data, profile: this.profile, completedIDs: this.lessons.filter(l => l.mode === 'english').map(l => l.id), sessionLength: 10});
    this.listenState = null;
    if (!this.listenSession.isAvailable) { this.listenSession = null; this.notice('No words can be planned with the current mapping and keyboard.'); return; }
    this.nextListening();
  }
  nextListening() { super.nextListening(); if (this.listenSession.isSessionComplete) this.speak(`Practice complete. Ten words. ${this.listenSession.assistedWords} assisted.`); }
  bindVoice() {
    document.getElementById('voice-start').onclick = () => this.startVoice();
    document.getElementById('retry')?.addEventListener('click', () => this.retry());
    if (!this.listenSession?.prompt || this.listenSession.isSessionComplete) return;
    const input = this.bindOwnedField({value: this.inputText, mode: 'english', evidence: this.evidence, onChange: text => this.updateInput(text), onChord: info => this.onChord(info)});
    input.readOnly = this.listenResult === true;
    document.getElementById('voice-replay').onclick = () => this.speakWord(); document.getElementById('voice-hint').onclick = () => this.revealVoice();
    document.getElementById('voice-next').onclick = () => this.nextListening();
    this.bindKeyboard(); this.updateHint();
  }
  speak(text, onEnd) {
    if (this.tab !== 'listen' || document.hidden) return false;
    if (!('speechSynthesis' in window)) { this.speechUnavailable(); return false; }
    const epoch = this.speechEpoch = (this.speechEpoch ?? 0) + 1;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text); utterance.lang = 'en-US'; utterance.rate = .88;
    const voice = window.speechSynthesis.getVoices().find(v => v.lang.startsWith('en')); if (voice) utterance.voice = voice;
    utterance.onend = () => { if (this.speechEpoch === epoch && this.tab === 'listen' && !document.hidden) onEnd?.(); };
    utterance.onerror = event => { if (this.speechEpoch === epoch && !['canceled', 'interrupted'].includes(event.error)) this.speechUnavailable(); };
    window.speechSynthesis.speak(utterance); return true;
  }
  speakWord() { this.cancelAdvance(); this.speak(this.target); }
  speechUnavailable() { this.revealVoice(false); this.notice('Speech could not play. The answer is shown for assisted practice; choose Hear again to retry speech.'); }
  revealVoice(speak = true) {
    if (!this.listenSession?.prompt || this.listenSession.isSessionComplete) return;
    this.listenReveal = true; this.listenSession.revealHint(); this.evidence?.assist('Voice hint');
    const word = document.getElementById('listening-word'); if (word) word.textContent = this.target;
    this.updateHint();
    if (speak) this.speak(this.guide.steps.filter(s => s.action.type === 'chord').map(s => s.action.keys.join('. ')).join('. Next chord. '));
    this.field?.field.focus();
  }
  checkListening(text) {
    if (this.listenResult || !this.listenSession || text !== this.target || !this.guideProgress?.complete || !this.evidence.chordOnly) return;
    if (this.listenReveal || this.evidence.assisted) this.listenSession.revealHint();
    if (!this.listenSession.check(text)) return;
    this.listenResult = true; this.completed = true; this.evidence.complete();
    document.querySelector('.session-count').textContent = `${this.listenSession.completedWords} / 10`;
    document.getElementById('practice-result').innerHTML = '<div class="result"><strong>Correct</strong></div>';
    document.getElementById('voice-next').hidden = false;
    this.field.discard(true); this.field.field.readOnly = true; this.updateHint();
    this.speak('Correct.', () => { this.voiceAdvance = setTimeout(() => this.nextListening(), 200); });
  }
  applyLibrary() {
    if (!this.customLibrary?.length) this.data = this.baseData;
    else this.data = Core.applyCustomChords(this.customLibrary, this.baseData, this.customOptions);
    this.mappingVersion = this.data.mappingVersion; this.wordPlans?.clear(); this.generators.clear();
  }
  resetCustomDraft(chord) { this.customDraft = chord ? structuredClone(chord) : {id: crypto.randomUUID(), keyCodes: [], text: '', scope: 'english', spacing: 'words', isEnabled: true}; this.customOriginal = chord ? structuredClone(chord) : null; this.customDirty = false; this.suggested = []; }
  customOthers() { return this.customLibrary.filter(c => c.id !== this.customDraft.id); }
  customNames(chord = this.customDraft) { const keys = Core.customKeys(chord, this.baseData); return keys ? keys.map(i => this.baseData.layout.keys[i].name).join(' + ') : 'Unknown keys'; }
  customIssue(chord = this.customDraft) { return Core.customChordIssue(chord, this.customOthers(), this.baseData, this.customOptions); }
  customHTML() {
    const c = this.customDraft;
    return `<div class="workspace-heading"><h2>Custom Chords</h2><button id="custom-new">New chord</button></div><div class="custom-layout"><aside class="custom-library"><label class="field-label" for="custom-search">Search your chords</label><input type="search" id="custom-search" placeholder="Text, keys, or language"><div id="custom-library"></div><button id="custom-undo" ${this.removedCustom ? '' : 'hidden'}>Undo remove</button></aside><section class="custom-form"><button id="custom-record" class="record-chord">${c.keyCodes.length ? h(this.customNames()) : 'Record chord'}</button><p class="micro" id="record-status">Click the recorder, hold the keys together, then release all keys.</p><button class="small" id="custom-suggest">Find unused chord</button><label class="field-label" for="custom-text">Text to type</label><textarea id="custom-text" rows="3" spellcheck="false">${h(c.text)}</textarea><div class="form-row"><label>Language<select id="custom-scope">${options([['english', 'English'], ['cpp', 'C++'], ['both', 'Both']], c.scope)}</select></label><label>Spacing<select id="custom-spacing">${options([['words', 'Words & phrases'], ['exact', 'No added spaces']], c.spacing)}</select></label></div><label class="inline-check"><input type="checkbox" id="custom-enabled" ${c.isEnabled ? 'checked' : ''}> Enabled when saved</label><div id="custom-impact" class="custom-impact" aria-live="polite"></div><p id="custom-problem" class="error" role="status"></p><div class="actions"><button id="custom-save" class="primary">Save chord</button><button id="custom-try">Try chord</button><button id="custom-remove" class="danger" ${this.customOriginal ? '' : 'hidden'}>Remove chord</button></div><section id="custom-test" hidden><div class="form-row"><label>Test language<select id="custom-test-mode">${options([['english', 'English'], ['cpp', 'C++']], c.scope === 'cpp' ? 'cpp' : 'english')}</select></label><button id="custom-test-clear">Clear</button></div><label class="field-label" for="custom-test-input">Try the unsaved chord</label><textarea id="custom-test-input" class="chord-input" rows="3" spellcheck="false"></textarea><p class="micro">Test text stays here. Saving applies the chord to Practice and Reference.</p></section></section></div>`;
  }
  libraryHTML(query = '') {
    return this.customLibrary.filter(c => `${c.text} ${this.customNames(c)} ${c.scope}`.toLowerCase().includes(query.toLowerCase())).map(c => {
      const issue = Core.customChordIssue(c, this.customLibrary.filter(other => other !== c), this.baseData, this.customOptions);
      return `<button class="custom-row ${c.id === this.customDraft.id ? 'selected' : ''}" data-custom-id="${h(c.id)}"><strong>${h(c.text)}</strong><span>${h(this.customNames(c))} · ${h(c.scope)} · ${issue ? 'Needs repair' : c.isEnabled ? 'On' : 'Off'}</span></button>`;
    }).join('') || '<p class="micro empty-state">No custom chords.</p>';
  }
  bindLibrary() {
    const query = document.getElementById('custom-search').value; document.getElementById('custom-library').innerHTML = this.libraryHTML(query);
    document.querySelectorAll('[data-custom-id]').forEach(button => button.onclick = () => {
      if (this.customDirty && !window.confirm('Discard the unsaved custom chord changes?')) return;
      this.resetCustomDraft(this.customLibrary.find(c => c.id === button.dataset.customId)); this.render();
    });
  }
  bindCustom() {
    this.bindLibrary(); document.getElementById('custom-search').oninput = () => this.bindLibrary();
    document.getElementById('custom-new').onclick = () => { if (this.customDirty && !window.confirm('Discard the unsaved custom chord changes?')) return; this.resetCustomDraft(); this.render(); };
    for (const [id, property] of [['custom-text', 'text'], ['custom-scope', 'scope'], ['custom-spacing', 'spacing'], ['custom-enabled', 'isEnabled']]) document.getElementById(id).addEventListener(property === 'text' ? 'input' : 'change', event => {
      this.customDraft[property] = property === 'isEnabled' ? event.target.checked : event.target.value; this.customDirty = true; this.clearTrial(); this.updateCustomImpact();
    });
    const record = document.getElementById('custom-record'); let recording = false, held = new Set(), captured = new Set();
    record.onclick = () => { recording = true; held.clear(); captured.clear(); record.textContent = 'Press chord keys…'; record.focus(); };
    record.onkeydown = event => {
      if (!recording || event.repeat) return;
      const index = Core.keyIndexForEvent(this.baseData, event);
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || index === null) { event.preventDefault(); document.getElementById('record-status').textContent = 'Use chord keys without Shift, Option, Command, or Control.'; return; }
      event.preventDefault(); if (!validPhysicalEvent(event)) return; held.add(index); captured.add(index);
      record.textContent = [...captured].map(i => this.baseData.layout.keys[i].name).join(' + ');
    };
    record.onkeyup = event => { const index = Core.keyIndexForEvent(this.baseData, event); if (!recording || !held.has(index)) return; event.preventDefault(); held.delete(index); if (!held.size) { this.customDraft.keyCodes = [...captured].map(i => this.baseData.layout.keys[i].code).sort((a, b) => a - b); recording = false; this.customDirty = true; this.clearTrial(); this.updateCustomImpact(); } };
    record.onblur = () => { recording = false; held.clear(); captured.clear(); record.textContent = this.customDraft.keyCodes.length ? this.customNames() : 'Record chord'; };
    document.getElementById('custom-suggest').onclick = () => {
      const keys = Core.customChordSuggestions(this.customDraft.scope, this.customOthers(), this.baseData, {...this.customOptions, excluding: this.suggested, limit: 1})[0];
      if (!keys) { this.notice('No unused chord is available with these language and keyboard settings.'); return; }
      this.suggested.push(keys); this.customDraft.keyCodes = keys.map(i => this.baseData.layout.keys[i].code).sort((a, b) => a - b); this.customDirty = true;
      record.textContent = this.customNames(); document.getElementById('record-status').textContent = 'Unused in this language. Try it to check comfort and key registration.'; this.clearTrial(); this.updateCustomImpact();
    };
    document.getElementById('custom-save').onclick = () => this.saveCustom(); document.getElementById('custom-remove').onclick = () => this.removeCustom();
    document.getElementById('custom-undo').onclick = () => this.undoRemove(); document.getElementById('custom-try').onclick = () => this.tryCustom();
    document.getElementById('custom-test-mode').onchange = () => this.tryCustom(); document.getElementById('custom-test-clear').onclick = () => this.tryCustom();
    this.updateCustomImpact();
  }
  updateCustomImpact() {
    const issue = this.customIssue(), keys = Core.customKeys(this.customDraft, this.baseData);
    const before = this.data, after = issue ? before : Core.applyCustomChords([...this.customOthers(), this.customDraft], this.baseData, this.customOptions);
    const outcome = (data, keys, mode) => { const value = Core.recipeForChord(data, keys, {mode}).outcome; return value.type === 'nothing' ? 'No output' : value.type === 'command' ? value.command : value.text; };
    const changes = [];
    if (keys?.length && ['english', 'cpp', 'both'].includes(this.customDraft.scope)) for (const mode of Core.customModes(this.customDraft.scope)) changes.push({keys, mode});
    if (this.customOriginal) for (const mode of Core.customModes(this.customOriginal.scope)) { const old = Core.customKeys(this.customOriginal, this.baseData); if (old?.length && !changes.some(c => c.mode === mode && same(c.keys, old))) changes.push({keys: old, mode}); }
    const replacing = keys?.length && ['english', 'cpp', 'both'].includes(this.customDraft.scope) && Core.customModes(this.customDraft.scope).some(mode => Core.recipeForChord(this.baseData, keys, {mode}).outcome.type !== 'nothing');
    document.getElementById('custom-impact').innerHTML = changes.map(change => `<div><strong>${change.mode === 'cpp' ? 'C++' : 'English'} · ${h(change.keys.map(i => this.baseData.layout.keys[i].name).join(' + '))}</strong><p>${h(outcome(before, change.keys, change.mode))} <span aria-label="becomes">→</span> ${h(outcome(after, change.keys, change.mode))}</p></div>`).join('') + (replacing && !issue ? '<p class="micro">This replaces an existing meaning. Disable or remove this chord to restore it.</p>' : '');
    document.getElementById('custom-problem').textContent = issue ?? (this.customUnreadable ? 'The saved library could not be read and will not be overwritten.' : '');
    document.getElementById('custom-save').textContent = replacing ? 'Replace chord' : 'Save chord';
    document.getElementById('custom-save').disabled = Boolean(issue || this.customUnreadable);
    document.getElementById('custom-try').disabled = Boolean(issue);
  }
  clearTrial() { this.field?.destroy(); this.field = null; const test = document.getElementById('custom-test'); if (test) test.hidden = true; const input = document.getElementById('custom-test-input'); if (input) input.value = ''; }
  tryCustom() {
    const trial = {...this.customDraft, isEnabled: true}; const issue = this.customIssue(trial);
    if (issue) { this.notice(issue); return; }
    this.field?.destroy(); const data = Core.applyCustomChords([...this.customOthers(), trial], this.baseData, this.customOptions);
    const select = document.getElementById('custom-test-mode'); select.disabled = trial.scope !== 'both';
    if (trial.scope !== 'both') select.value = trial.scope;
    const mode = select.value, input = document.getElementById('custom-test-input'); input.value = ''; document.getElementById('custom-test').hidden = false;
    const app = {data, plan: text => Core.planText(text, {data, mode, profile: this.profile}), notice: text => this.notice(text)};
    this.field = new ChordField(app, input, {mode}); this.field.setEnabled(true);
  }
  persistLibrary(chords) {
    if (this.customUnreadable) return false;
    try { window.localStorage.setItem(customStorageKey, JSON.stringify({version: 2, chords})); }
    catch { this.notice('Custom chords could not be saved. Your draft is still here; free storage or enable local storage and retry.'); return false; }
    this.customLibrary = chords; this.applyLibrary(); this.invalidateListening('The active mapping changed'); this.wordIntermediate = null;
    if (this.lessonState) { this.lessonState.guide = this.plan(this.lessonState.target, this.lessonState.mode); this.lessonState.guideProgress = new (this.lessonState.guideProgress.constructor)(this.lessonState.guide, Core.replayGuide(this.data, this.lessonState.guide), Core.initialContext(), Core.matchGuideProgress); }
    return true;
  }
  saveCustom() { if (this.customIssue()) return; const chord = structuredClone(this.customDraft); if (!this.persistLibrary([...this.customOthers(), chord])) return; this.resetCustomDraft(chord); this.render(); this.notice('Chord saved. Practice and Reference use the new mapping.'); }
  removeCustom() { if (!this.customOriginal) return; const index = this.customLibrary.findIndex(c => c.id === this.customOriginal.id), chord = this.customLibrary[index]; if (!this.persistLibrary(this.customLibrary.filter((_, i) => i !== index))) return; this.removedCustom = {chord, index}; this.resetCustomDraft(); this.render(); this.notice('Chord removed. Its installed meaning is restored.'); }
  undoRemove() { if (!this.removedCustom) return; const {chord, index} = this.removedCustom, library = [...this.customLibrary]; library.splice(index, 0, chord); if (!this.persistLibrary(library)) return; this.removedCustom = null; this.resetCustomDraft(chord); this.render(); }
  modernSettingsHTML() { const p = this.store.preferences; return `<div class="workspace-heading"><h2>Settings</h2></div><section class="card"><div class="form-row"><label>Appearance<select id="theme">${options([['system', 'System'], ['light', 'Light'], ['dark', 'Dark']], p.theme)}</select></label><label>Keyboard layout<select id="geometry">${options([['ansi', 'US ANSI'], ['iso', 'Canadian French ISO']], p.keyboardGeometry)}</select></label><label>Key labels<select id="key-labels">${options([['printed', 'Printed keys'], ['meaning', 'Chord meanings'], ['both', 'Both']], p.keyLabels)}</select></label></div><label class="field-label" for="text-size">Practice text size</label><input type="range" id="text-size" min="16" max="30" value="${p.textSize}"><p class="micro">Preferences, practiced lessons, and custom chords are saved in this browser. Practice text and results stay in memory.</p></section><section class="card"><h3>KeyChord for Mac</h3><p>Use chords in other apps with the Mac app.</p><a class="button primary" href="./downloads/KeyChord.zip">Download Mac app</a></section>`; }
  bindModernSettings() {
    for (const [id, preference] of [['theme', 'theme'], ['geometry', 'keyboardGeometry'], ['key-labels', 'keyLabels']]) document.getElementById(id).onchange = event => { this.store.prefs({[preference]: event.target.value}); this.applyPrefs(); };
    document.getElementById('text-size').oninput = event => { this.store.prefs({textSize: Number(event.target.value)}); this.applyPrefs(); };
  }
}
