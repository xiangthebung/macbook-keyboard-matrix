export class AttemptEvidence {
  constructor({assisted = false, errors = false, fresh = false} = {}) {
    this.assisted = assisted; this.errors = errors; this.fresh = fresh;
    this.chordCharacters = 0; this.ordinaryCharacters = 0; this.pasted = false;
    this.startedAt = null; this.finishedAt = null; this.physicalChords = 0; this.reasons = new Set();
    if (assisted) this.reasons.add('Earlier assistance in this exercise');
    if (errors) this.reasons.add('Earlier error in this exercise');
  }
  assist(reason = 'Visible reference') { this.assisted = true; this.reasons.add(reason); }
  error(reason = 'A chord did not match the passage') { this.errors = true; this.reasons.add(reason); }
  input(kind, count = 1, now = performance.now()) {
    this.startedAt ??= now;
    if (kind === 'physical-chord') { this.physicalChords += 1; this.chordCharacters += Math.max(0, count); }
    else if (kind === 'demo') { this.assist('On-screen simulation'); }
    else { this.ordinaryCharacters += Math.max(1, count); this.reasons.add(kind === 'paste' ? 'Pasted text' : 'Ordinary or edited text'); if (kind === 'paste') this.pasted = true; }
  }
  complete(now = performance.now()) { this.finishedAt = now; }
  get chordOnly() { return this.physicalChords > 0 && this.ordinaryCharacters === 0 && !this.pasted; }
  get clean() { return this.chordOnly && !this.assisted && !this.errors; }
  get eligible() { return this.clean && this.fresh; }
  get chordWPM() {
    if (!this.chordOnly || this.assisted || this.startedAt === null || this.finishedAt === null) return null;
    const minutes = (this.finishedAt - this.startedAt) / 60000;
    return minutes > 0 ? Math.round(this.chordCharacters / 5 / minutes) : null;
  }
  get label() {
    if (this.pasted || this.ordinaryCharacters) return 'Mixed or ordinary input · practice only';
    if (this.assisted) return 'Assisted chord practice';
    if (this.errors) return 'Chord practice with recovery';
    if (!this.physicalChords) return 'Ready for physical chord input';
    return this.fresh ? 'Fresh, unaided chord practice' : 'Physical chord practice';
  }
}

export function inferLanguage(text, origin = '', override = 'auto') {
  if (override === 'english' || override === 'cpp') return override;
  if (/\.(cpp|cc|cxx|hpp|hh|hxx|c|h)$/i.test(origin)) return 'cpp';
  if (/\b(?:#include|std::|int main\s*\(|constexpr|template\s*<|nullptr)\b/.test(text) || /(?:#include\s*[<"]|std::|int\s+main\s*\()/.test(text)) return 'cpp';
  return 'english';
}
export function chooseDifferent(items, previous, random = Math.random) {
  const usable = items.filter(x => (typeof x === 'string' ? x : x.text) !== previous);
  const pool = usable.length ? usable : items;
  return pool.length ? pool[Math.floor(random() * pool.length)] : null;
}
const equivalentContext = (left, right) => {
  if (!left || !right) return false;
  // Engine contexts contain only JSON values. Property order is not significant.
  const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key,canonical(value[key])])) : value;
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
};
/** Tracks replayed output states, including temporary suffix bases and snippet cursors.
 * A same-text command advances only when the real engine context matches its result. */
export class PracticeProgress {
  constructor(guide, replay, initialContext, matchText = () => ({correct: false})) {
    this.guide = guide;
    this.states = [{index:-1,buffer:{text:'',cursor:0},context:initialContext}, ...replay.results.map((state,index)=>({...state,index}))];
    this.matchText = matchText; this.completedStep = -1; this.correct = true; this.complete = false;
  }
  update({text, cursor, context}) {
    const sameBuffer = state => state.buffer.text === text && state.buffer.cursor === cursor;
    const exact = this.states.filter(state => sameBuffer(state) && equivalentContext(state.context, context));
    const textMatch = this.matchText(this.guide,text,{context,cursor});
    const textChars = [...new Intl.Segmenter('en',{granularity:'grapheme'}).segment(text)].map(part=>part.segment);
    const targetChars = [...new Intl.Segmenter('en',{granularity:'grapheme'}).segment(this.guide.text)].map(part=>part.segment);
    const prefix = textChars.slice(0,cursor).join(''), suffix = textChars.slice(cursor).join('');
    const snippetAlternative = Boolean(context?.snippets?.length && suffix && targetChars.slice(0,cursor).join('') === prefix && targetChars.slice(cursor).join('').includes(suffix));
    if (exact.length) this.completedStep = exact.at(-1).index;
    else {
      // Different valid chord recipes may share output but have different spacing
      // context. Output-producing steps are inferred; zero-output commands are not.
      const outputStates = this.states.filter(state => state.index >= 0 && sameBuffer(state) && this.guide.steps[state.index].output !== '');
      if (outputStates.length) this.completedStep = outputStates.at(-1).index;
      else if (snippetAlternative) {
        const prefixMatch=this.matchText(this.guide,prefix,{context,cursor});
        this.completedStep=prefixMatch.completedStep??this.completedStep;
      } else if (!text) this.completedStep = -1;
    }
    this.correct = Boolean(exact.length || textMatch.correct || snippetAlternative);
    const final = this.states.at(-1);
    this.complete = text === this.guide.text && cursor === final.buffer.cursor && this.completedStep === this.guide.steps.length - 1;
    return {correct:this.correct,complete:this.complete,completedStep:this.completedStep,nextStep:this.nextStep};
  }
  get nextStep() { return Math.min(this.completedStep+1,this.guide.steps.length); }
  contextFor(text,cursor) {
    // Choose the first equal-text state after a real cursor/edit reset; restoring
    // a later zero-output command would invent execution evidence.
    return this.states.find(state => state.buffer.text === text && state.buffer.cursor === cursor)?.context ?? null;
  }
}
export function restoreDeclaredMode(engine, mode) {
  if (engine.subMode === mode) return false;
  engine.setSubMode(mode); return true;
}
export function capturePlannedTab(fieldID, nextStep) {
  return fieldID === 'chord-input' && nextStep?.action?.type === 'key' && nextStep.action.key === 'Tab';
}
export function draftPracticeWindow(text, selection = [0,0], limit = 1200) {
  const start=Math.max(0,Math.min(text.length,selection[0]??0));
  const end=Math.max(start,Math.min(text.length,selection[1]??start));
  const chosen=end>start?text.slice(start,end):text;
  const segments=[...new Intl.Segmenter('en',{granularity:'grapheme'}).segment(chosen)].map(part=>part.segment);
  return {text:segments.slice(0,limit).join(''),selected:end>start,limited:segments.length>limit,selection:[start,end]};
}
export function normalizeBrowserText(text) { return String(text).replace(/\r\n?/g,'\n'); }
export function loadSavedMapping(data, sources, getProfile, importSources) {
  return importSources(data,sources,{rolloverLimit:getProfile(data).rolloverLimit});
}
export function validPhysicalEvent(event) { return event.isTrusted === true && !event.isComposing && !event.ctrlKey && !event.metaKey; }
export function contextForPrefix(prefix, mode = 'english') {
  // A cursor move must not carry a stale engine undo history. The engine's restore
  // accepts a context snapshot; the adapter supplies one based on the actual prefix.
  return {mode, prefix};
}
export function escapeHTML(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
