// Only preferences and lesson aggregates belong in persistent storage. Exercise text,
// editor contents, imported passages and key events are deliberately session-only.
export const STORAGE_KEY = 'keychord.learning.v2';
export const CURRENT_SCHEMA = 2;
const DAY = 86400000;
const safeNumber = (value, fallback = 0) => Number.isSafeInteger(value) && value >= 0 ? value : fallback;
const safeDay = value => Number.isSafeInteger(value) ? value : null;
export function localDay(date = new Date()) {
  return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY);
}
export function dayLabel(day) {
  if (!Number.isSafeInteger(day)) return 'Not scheduled';
  return new Date(day * DAY).toLocaleDateString(undefined, {timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric'});
}
export function blankProgress() {
  return {attempts: 0, passes: 0, guidedPasses: 0, useReports: 0, firstPassDay: null, lastActivityDay: null, lastCheckDay: null, firstDelayedCheckDay: null, nextCheckDay: null, successfulDelayedChecks: 0, pendingAssisted: false, pendingErrors: false};
}
export function sanitizeProgress(raw = {}) {
  const p = blankProgress();
  for (const key of ['attempts', 'passes', 'guidedPasses', 'useReports', 'successfulDelayedChecks']) p[key] = safeNumber(raw[key]);
  p.successfulDelayedChecks = Math.min(5, p.successfulDelayedChecks);
  for (const key of ['firstPassDay', 'lastActivityDay', 'lastCheckDay', 'firstDelayedCheckDay', 'nextCheckDay']) p[key] = safeDay(raw[key]);
  p.pendingAssisted = raw.pendingAssisted === true;
  p.pendingErrors = raw.pendingErrors === true;
  return p;
}
export function isRetained(p) {
  return p.successfulDelayedChecks >= 3 && Number.isSafeInteger(p.firstDelayedCheckDay) && Number.isSafeInteger(p.lastCheckDay) && p.lastCheckDay - p.firstDelayedCheckDay >= 4;
}
export function isDue(p, day = localDay()) { return Number.isSafeInteger(p.nextCheckDay) && day >= p.nextCheckDay; }
export function resetDelayed(p, day) {
  p.lastCheckDay = null;
  p.firstDelayedCheckDay = null;
  p.successfulDelayedChecks = 0;
  p.nextCheckDay = p.firstPassDay === null ? null : day + 1;
}
export function recordResult(previous, {clean = false, fresh = false, day = localDay(), guided = false} = {}) {
  const p = sanitizeProgress(previous);
  if (p.lastActivityDay !== null && day < p.lastActivityDay) return p;
  p.attempts += 1;
  p.lastActivityDay = day;
  if (guided) p.guidedPasses += 1;
  if (!(clean && fresh)) { resetDelayed(p, day); return p; }
  p.passes += 1;
  p.pendingAssisted = false;
  p.pendingErrors = false;
  if (p.firstPassDay === null) {
    p.firstPassDay = day;
    p.nextCheckDay = day + 1;
    return p;
  }
  if (!isDue(p, day) || day <= p.firstPassDay || p.lastCheckDay === day) return p;
  p.firstDelayedCheckDay ??= day;
  p.lastCheckDay = day;
  p.successfulDelayedChecks = Math.min(5, p.successfulDelayedChecks + 1);
  p.nextCheckDay = day + [3, 7, 14, 30, 30][p.successfulDelayedChecks - 1];
  return p;
}
export function migrateCompletedIDs(ids, fromVersion, expansions = {}) {
  const migrated = new Set(Array.isArray(ids) ? ids.filter(id => typeof id === 'string') : []);
  if (fromVersion < 2) for (const [original, additions] of Object.entries(expansions)) if (migrated.has(original)) for (const id of additions) migrated.add(id);
  return [...migrated];
}
const DEFAULT_PREFS = {theme: 'system', textSize: 18, mode: 'auto', profile: 'generic', rolloverLimit: 6, selectedLesson: 'first-chord', optionalCPP: false, onboardingDone: false,
  practiceSection: 'words', practiceHints: true, chordEnabled: true, wordVocabulary: 'english', wordGoal: 'words', wordLength: 10, keyLabels: 'both', keyboardGeometry: 'ansi'};
function sanitizePreferences(raw = {}) {
  const out = {...DEFAULT_PREFS};
  if (['system', 'light', 'dark'].includes(raw.theme)) out.theme = raw.theme;
  out.textSize = Math.max(16, Math.min(30, safeNumber(raw.textSize, 18)));
  if (['auto', 'english', 'cpp'].includes(raw.mode)) out.mode = raw.mode;
  if (['generic', 'macbook-ansi', 'macbook-iso'].includes(raw.profile)) out.profile = raw.profile;
  out.rolloverLimit = Math.max(2, Math.min(48, safeNumber(raw.rolloverLimit, 6)));
  if (typeof raw.selectedLesson === 'string' && raw.selectedLesson.length < 100) out.selectedLesson = raw.selectedLesson;
  for (const key of ['optionalCPP', 'onboardingDone']) out[key] = raw[key] === true;
  for (const key of ['practiceHints', 'chordEnabled']) if (typeof raw[key] === 'boolean') out[key] = raw[key];
  if (['words', 'learn', 'listen'].includes(raw.practiceSection)) out.practiceSection = raw.practiceSection;
  if (['english', 'english5k', 'english25k'].includes(raw.wordVocabulary)) out.wordVocabulary = raw.wordVocabulary;
  if (['words', 'time'].includes(raw.wordGoal)) out.wordGoal = raw.wordGoal;
  const lengths = out.wordGoal === 'time' ? [15, 30, 60, 120] : [10, 25, 50, 100];
  out.wordLength = lengths.includes(raw.wordLength) ? raw.wordLength : lengths[0];
  if (['printed', 'meaning', 'both'].includes(raw.keyLabels)) out.keyLabels = raw.keyLabels;
  if (['ansi', 'iso'].includes(raw.keyboardGeometry)) out.keyboardGeometry = raw.keyboardGeometry;
  // A user's own mapping is a preference. It contains no practice text or key history.
  if (raw.mappingSources && typeof raw.mappingSources === 'object') {
    const allowed = ['layout', 'shared', 'english', 'cpp', 'orthography'];
    const entries = Object.entries(raw.mappingSources).filter(([key,value]) => allowed.includes(key) && typeof value === 'string' && value.length < 1000000);
    if (entries.length) out.mappingSources = Object.fromEntries(entries);
  }
  return out;
}
export function sanitizeState(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Progress format is invalid.');
  const out = {schema: CURRENT_SCHEMA, curriculumVersion: 2, preferences: sanitizePreferences(raw.preferences), mappings: {}};
  if (raw.mappings && typeof raw.mappings === 'object') for (const [version, lessons] of Object.entries(raw.mappings).slice(0, 20)) {
    if (version.length > 160 || !lessons || typeof lessons !== 'object') continue;
    out.mappings[version] = {};
    for (const [id, p] of Object.entries(lessons).slice(0, 1000)) if (id.length < 100 && p && typeof p === 'object') out.mappings[version][id] = sanitizeProgress(p);
  }
  return out;
}
export class LearningStore {
  constructor(storage, {onWarning = () => {}, expansions = {}} = {}) {
    this.storage = storage; this.onWarning = onWarning; this.expansions = expansions;
    this.state = sanitizeState({}); this.available = Boolean(storage);
    if (!storage) onWarning('Local progress storage is disabled. This session still works; progress will stay in memory.');
    try {
      const text = storage?.getItem(STORAGE_KEY);
      if (text) this.state = sanitizeState(JSON.parse(text));
      // Legacy completion means practiced, never retrospective delayed evidence.
      const old = !text && storage?.getItem('keychord.learning.v1');
      if (old) {
        const raw = JSON.parse(old);
        const ids = migrateCompletedIDs(raw.completedIDs, raw.curriculumVersion ?? 1, expansions);
        this.state.mappings.legacy = Object.fromEntries(ids.map(id => [id, {...blankProgress(), guidedPasses: 1}]));
        this.save();
      }
    } catch {
      this.available = false;
      onWarning('Local progress storage is unavailable or malformed. This session still works; progress will stay in memory.');
    }
  }
  get preferences() { return this.state.preferences; }
  prefs(update) { this.state.preferences = sanitizePreferences({...this.preferences, ...update}); this.save(); return this.preferences; }
  progress(version, id) { return sanitizeProgress(this.state.mappings[version]?.[id]); }
  allProgress(version) { return this.state.mappings[version] ?? {}; }
  update(version, id, progress) {
    this.state.mappings[version] ??= {};
    this.state.mappings[version][id] = sanitizeProgress(progress); this.save();
    return this.progress(version, id);
  }
  mark(version, id, {assisted = false, error = false, fresh = false, day = localDay()} = {}) {
    const p = this.progress(version, id);
    if (p.lastActivityDay !== null && day < p.lastActivityDay) return p;
    if (fresh) { p.pendingAssisted = false; p.pendingErrors = false; }
    p.pendingAssisted ||= assisted; p.pendingErrors ||= error;
    if (assisted || error) { p.lastActivityDay = day; resetDelayed(p, day); }
    return this.update(version, id, p);
  }
  record(version, id, result) { return this.update(version, id, recordResult(this.progress(version, id), result)); }
  reportUse(version, id) { const p = this.progress(version, id); p.useReports += 1; return this.update(version, id, p); }
  save() {
    if (!this.available) return false;
    try { this.storage.setItem(STORAGE_KEY, JSON.stringify(this.state)); return true; }
    catch { this.available = false; this.onWarning('Local storage is disabled or full. Progress will stay in memory for this session.'); return false; }
  }
  export() { return JSON.stringify(this.state, null, 2); }
  import(text) { this.state = sanitizeState(JSON.parse(text)); this.save(); }
  clear() { this.state = sanitizeState({preferences: this.preferences}); this.save(); }
}
