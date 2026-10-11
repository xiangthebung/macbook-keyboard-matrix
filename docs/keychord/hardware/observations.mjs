// Aggregate physical evidence only: never a hardware diagnosis.
export class ChordObservationSession {
  constructor(targets = []) {
    this.targets = targets.filter(t => t.keys?.length).map(t => ({ ...t, keys: [...new Set(t.keys)] }));
    this.index = 0;
    this.results = [];
    this.cancelled = false;
    this.clear();
  }
  get current() { return this.cancelled ? null : this.targets[this.index] ?? null; }
  clear() { this.down = new Set(); this.seen = new Set(); this.peak = new Set(); this.peakHeld = new Set(); this.shifts = new Set(); this.sawShiftWithAll = false; this.shiftSeen = false; }
  keyDown(name, {shift = false, repeat = false, timestamp = Date.now()} = {}) {
    if (!this.current) return null;
    if (repeat) { this.interrupt(); return null; }
    if (this.down.has(name)) return null;
    this.down.add(name);
    if (name === 'ShiftLeft' || name === 'ShiftRight') { this.shifts.add(name); this.shiftSeen = true; }
    else this.seen.add(name);
    this.updatePeak(shift);
    this.lastTime = timestamp;
    return null;
  }
  updatePeak(shift = false) {
    const keys = new Set(this.current?.keys ?? []);
    const held = new Set([...this.down].filter(n => keys.has(n)));
    if (held.size > this.peak.size) this.peak = held;
    if (this.down.size > this.peakHeld.size) this.peakHeld = new Set(this.down);
    if (keys.size && held.size === keys.size && (shift || this.shifts.size)) this.sawShiftWithAll = true;
  }
  keyUp(name, {timestamp = Date.now()} = {}) {
    if (!this.current || !this.down.delete(name)) return null;
    this.shifts.delete(name);
    if (this.down.size || !this.seen.size) return null;
    const target = this.current;
    const missing = target.keys.filter(k => !this.peak.has(k));
    if (target.shift && !this.sawShiftWithAll) missing.push('Shift');
    const extra = [...this.seen].filter(k => !target.keys.includes(k));
    const unexpectedShift = !target.shift && this.shiftSeen;
    if (unexpectedShift) extra.push('Shift');
    const result = {target: {...target, keys: [...target.keys]}, timestamp, missing, extra,
      peak: [...this.peak], peakHeld: [...this.peakHeld], allRegistered: !missing.length && !extra.length};
    this.results.push(result);
    this.index += 1;
    this.clear();
    return result;
  }
  interrupt() { this.clear(); }
  retryLast() { this.cancelled = false; this.clear(); this.index = Math.max(0, this.index - 1); }
  skip() { this.clear(); if (this.current) this.index += 1; }
  cancel() { this.clear(); this.cancelled = true; }
}

export class RawProbeSession {
  constructor() { this.observations = []; this.clear(); }
  clear() { this.down = new Set(); this.peak = new Set(); this.seen = new Set(); }
  keyDown(name, {repeat = false} = {}) {
    if (repeat) { this.clear(); return; }
    this.down.add(name); this.seen.add(name);
    if (this.down.size > this.peak.size) this.peak = new Set(this.down);
  }
  keyUp(name, {timestamp = Date.now()} = {}) {
    if (!this.down.delete(name) || this.down.size || !this.seen.size) return null;
    const result = {timestamp, seen: [...this.seen], peakHeld: [...this.peak], count: this.peak.size};
    this.observations.push(result); this.clear(); return result;
  }
  interrupt() { this.clear(); }
}

export function physicalEventDecision(event, {active = true, focused = true} = {}) {
  if (event.isTrusted !== true) return {kind: 'interrupt', reason: 'Only trusted physical key events can earn evidence.'};
  if (!active || !focused) return {kind: 'interrupt', reason: 'The test surface must be focused in the active tab.'};
  if (event.isComposing || event.keyCode === 229) return {kind: 'interrupt', reason: 'Composition interrupted the attempt.'};
  if (event.ctrlKey || event.metaKey || event.altKey || event.getModifierState?.('CapsLock') ||
      /^(Control|Meta|Alt|CapsLock)/.test(event.code ?? '')) return {kind: 'interrupt', reason: 'Modifier or shortcut interrupted the attempt.'};
  if (event.code === 'Tab') return {kind: 'interrupt', reason: 'Tab navigation paused the test.'};
  if (event.code === 'Escape') return {kind: 'cancel', reason: 'Test cancelled.'};
  if (event.repeat) return {kind: 'interrupt', reason: 'Key repeat interrupted the attempt. Release all keys and start again.'};
  return {kind: 'capture'};
}

const line = text => String(text ?? '').replace(/[\r\n]/g, ' ');
export function observationReport(session, identity = {}) {
  let out = '# KeyChord short chord check\nversion 1\n';
  out += `keyboard ${line(identity.keyboard || 'unknown')}\nprofile ${line(identity.profile || 'unchecked')}\n`;
  out += '# Aggregate local physical observations; no typed passage or raw event trace. Each result covers one attempt.\n';
  out += '# Missing refers to keys absent from the largest simultaneous target set; a key may have appeared in another subset.\n';
  for (const r of session.results) {
    out += `observed ${r.timestamp} ${r.target.keys.join('+')} shift=${!!r.target.shift} ${r.allRegistered ? 'all-registered' : 'incomplete'} missing=${r.missing.join('+') || '-'} extra=${r.extra.join('+') || '-'} peak=${r.peak.join('+') || '-'} peak-held=${r.peakHeld.join('+') || '-'}\n`;
  }
  return out + '# Missing or extra keys can reflect timing or a missed press. Repeat before investigating hardware; this report does not diagnose the matrix.\n';
}
export function rawReport(session, identity = {}) {
  return '# KeyChord raw rollover observations\nversion 1\n' + `keyboard ${line(identity.keyboard || 'unknown')}\n` +
    '# Only completed physical chords are listed. The largest observed count is a lower bound, not the keyboard maximum.\n' +
    session.observations.map(r => `observed ${r.timestamp} peak-held=${r.peakHeld.join('+')} count=${r.count} seen=${r.seen.join('+')}\n`).join('');
}
