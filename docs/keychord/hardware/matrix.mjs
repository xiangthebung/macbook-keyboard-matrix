// Original buildless Matrix Probe engine, adapted from KeyChord native web probe.
"use strict";
// Port of KeyChordCore's MatrixModel, MatrixPlanner, MatrixScanSession and MatrixScanReport (Swift), for a
// browser. Keys are identified by their index in the KeyChord Layout; the report uses Layout key names, so it
// loads straight into the app (MatrixScanReport.parse).

// [Layout name, macOS virtual keycode, KeyboardEvent.code, printed US legend], in Layout order.
const KEYS = [
  ["Grave", 50, "Backquote", "`"], ["1", 18, "Digit1", "1"], ["2", 19, "Digit2", "2"], ["3", 20, "Digit3", "3"],
  ["4", 21, "Digit4", "4"], ["5", 23, "Digit5", "5"], ["6", 22, "Digit6", "6"], ["7", 26, "Digit7", "7"],
  ["8", 28, "Digit8", "8"], ["9", 25, "Digit9", "9"], ["0", 29, "Digit0", "0"], ["Minus", 27, "Minus", "-"],
  ["Equal", 24, "Equal", "="],
  ["Q", 12, "KeyQ", "Q"], ["W", 13, "KeyW", "W"], ["E", 14, "KeyE", "E"], ["R", 15, "KeyR", "R"], ["T", 17, "KeyT", "T"],
  ["Y", 16, "KeyY", "Y"], ["U", 32, "KeyU", "U"], ["I", 34, "KeyI", "I"], ["O", 31, "KeyO", "O"], ["P", 35, "KeyP", "P"],
  ["LBracket", 33, "BracketLeft", "["], ["RBracket", 30, "BracketRight", "]"], ["Backslash", 42, "Backslash", "\\"],
  ["A", 0, "KeyA", "A"], ["S", 1, "KeyS", "S"], ["D", 2, "KeyD", "D"], ["F", 3, "KeyF", "F"], ["G", 5, "KeyG", "G"],
  ["H", 4, "KeyH", "H"], ["J", 38, "KeyJ", "J"], ["K", 40, "KeyK", "K"], ["L", 37, "KeyL", "L"],
  ["Semicolon", 41, "Semicolon", ";"], ["Quote", 39, "Quote", "'"],
  ["Z", 6, "KeyZ", "Z"], ["X", 7, "KeyX", "X"], ["C", 8, "KeyC", "C"], ["V", 9, "KeyV", "V"], ["B", 11, "KeyB", "B"],
  ["N", 45, "KeyN", "N"], ["M", 46, "KeyM", "M"], ["Comma", 43, "Comma", ","], ["Period", 47, "Period", "."],
  ["Slash", 44, "Slash", "/"],
  ["Space", 49, "Space", "Space"],
];
const N = KEYS.length;
const NAME = KEYS.map(k => k[0]);
const CODE = KEYS.map(k => k[1]);
const LABEL = KEYS.map(k => k[3]);
const INDEX_BY_NAME = new Map(NAME.map((n, i) => [n, i]));
const INDEX_BY_DOM_CODE = new Map(KEYS.map((k, i) => [k[2], i]));
const DIGITS = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKL";

// US ANSI geometry (MacBook style) in key units, origin top left, like KeyboardGeometry.swift.
const GEOMETRY = (() => {
  const g = new Array(N);
  const rows = [[0, 12, 0, 0.7], [13, 25, 1.5, 1.7], [26, 36, 1.75, 2.7], [37, 46, 2.25, 3.7]];
  for (const [from, to, x0, y] of rows) for (let i = from; i <= to; i++) g[i] = { x: x0 + (i - from), y, w: 1, h: 1 };
  g[INDEX_BY_NAME.get("Space")] = { x: 4.25, y: 4.7, w: 5, h: 1 };
  return g;
})();
// Keys that are drawn but are not chord keys.
const INERT_KEYS = [
  ["esc", 0, 0, 1.5, 0.6], ...Array.from({ length: 12 }, (_, i) => ["F" + (i + 1), 1.5 + i, 0, 1, 0.6]), ["", 13.5, 0, 1, 0.6],
  ["delete", 13, 0.7, 1.5, 1], ["tab", 0, 1.7, 1.5, 1], ["caps", 0, 2.7, 1.75, 1], ["return", 12.75, 2.7, 1.75, 1],
  ["shift", 0, 3.7, 2.25, 1], ["shift", 12.25, 3.7, 2.25, 1], ["fn", 0, 4.7, 1, 1], ["ctrl", 1, 4.7, 1, 1],
  ["opt", 2, 4.7, 1, 1], ["cmd", 3, 4.7, 1.25, 1], ["cmd", 9.25, 4.7, 1.25, 1], ["opt", 10.5, 4.7, 1, 1],
  ["◀", 11.5, 4.7, 1, 1], ["▲", 12.5, 4.7, 1, 0.5], ["▼", 12.5, 5.2, 1, 0.5], ["▶", 13.5, 4.7, 1, 1],
];

/** One hand can hold two keys whose edges are at most three key widths apart. */
function canHoldUS(a, b) {
  const r = GEOMETRY[a], s = GEOMETRY[b];
  const dx = Math.max(0, Math.max(r.x, s.x) - Math.min(r.x + r.w, s.x + s.w));
  const dy = Math.max(0, Math.max(r.y, s.y) - Math.min(r.y + r.h, s.y + s.h));
  return Math.sqrt(dx * dx + dy * dy) <= 3.0;
}

/** Keyboard order: row by row, left to right, so the next key is always next to the last one. */
function tapOrderUS() {
  return [...Array(N).keys()].sort((a, b) => (GEOMETRY[a].y - GEOMETRY[b].y) || (GEOMETRY[a].x - GEOMETRY[b].x));
}

function decodeCandidates(text) {
  return text.split(" ").filter(s => s.length > 0).map(s => [...s].map(c => DIGITS.indexOf(c)));
}

// MARK: Pairs and sets

/** An unordered pair, normalised like Swift's KeyPair (lower macOS keycode first). */
function makePair(x, y) { return CODE[x] <= CODE[y] ? { a: x, b: y } : { a: y, b: x }; }
function pairKey(p) { return p.a * 64 + p.b; }
function setKey(s) { return [...s].sort((x, y) => x - y).join(","); }
function isSubset(a, b) { for (const x of a) if (!b.has(x)) return false; return true; }
function isStrictSubset(a, b) { return a.size < b.size && isSubset(a, b); }
function byIndex(s) { return [...s].sort((x, y) => x - y); }
function byCode(s) { return [...s].sort((x, y) => CODE[x] - CODE[y]); }

// MARK: Model

/** Pairwise "shares a line" knowledge: -1 unknown, 0 no, 1 yes. */
class EdgeState {
  constructor(n, e) {
    this.n = n;
    this.e = e || new Int8Array(n * n).fill(-1);
    this.changed = false;
    this.failed = false;
  }
  get(i, j) { return this.e[i * this.n + j]; }
  set(i, j, v) {
    const k = i * this.n + j;
    const cur = this.e[k];
    if (cur === v) return;
    if (cur !== -1) { this.failed = true; return; }
    this.e[k] = v;
    this.e[j * this.n + i] = v;
    this.changed = true;
  }
  copy() {
    const s = new EdgeState(this.n, this.e.slice());
    s.changed = this.changed;
    s.failed = this.failed;
    return s;
  }
}

/** A sweep: `pair` held while `tapped` (null: every other key) was tapped once each; `blocked` never registered. */
function makeSweep(pair, blocked, tapped) { return { pair, blocked, tapped }; }

class MatrixModel {
  constructor(n, sweeps = []) {
    this.n = n;
    this.state = new EdgeState(n);
    this.observations = [];
    this.heldCount = new Array(n).fill(0);
    this.sweeps = [];
    this.inconsistent = [];
    for (const s of sweeps) this.add(s);
  }

  /** Adds a sweep. Returns false (and leaves it out) if it contradicts earlier sweeps. */
  add(sweep) {
    this.sweeps.push(sweep);
    const a = sweep.pair.a, b = sweep.pair.b;
    if (a === b) { this.inconsistent.push(this.sweeps.length - 1); return false; }
    const backup = this.state.copy(), obsCount = this.observations.length;
    for (let x = 0; x < this.n; x++) {
      if (x === a || x === b || (sweep.tapped && !sweep.tapped.has(x))) continue;
      this.observations.push({ a, b, x, blocked: sweep.blocked.has(x) });
    }
    // A pair on different lines has at most two keys forming an L with it, so three or more blocked keys
    // prove the pair shares a line.
    if (sweep.blocked.size >= 3) this.state.set(a, b, 1);
    this.heldCount[a] += 1;
    this.heldCount[b] += 1;
    this.propagate(this.state);
    if (!this.state.failed) this.probe();
    if (this.state.failed) {
      this.state = backup;
      this.observations.length = obsCount;
      this.heldCount[a] -= 1;
      this.heldCount[b] -= 1;
      this.inconsistent.push(this.sweeps.length - 1);
      return false;
    }
    return true;
  }

  dropLastSweep() {
    const i = this.inconsistent[this.inconsistent.length - 1];
    if (i === undefined || i !== this.sweeps.length - 1) return;
    this.inconsistent.pop();
    this.sweeps.pop();
  }

  edge(i, j) { return this.state.get(i, j); }

  shares(x, y) {
    if (x === y) return null;
    const v = this.state.get(x, y);
    return v === 1 ? true : v === 0 ? false : null;
  }

  usefulTaps(p) {
    const out = new Set();
    const s = this.state;
    for (let x = 0; x < this.n; x++) {
      if (x !== p.a && x !== p.b && MatrixModel.tripleBlockedState(s.get(p.a, p.b), s.get(p.a, x), s.get(p.b, x)) === null) out.add(x);
    }
    return out;
  }

  unknownCount(i) {
    let c = 0;
    for (let j = 0; j < this.n; j++) if (j !== i && this.state.get(i, j) === -1) c++;
    return c;
  }

  get totalPairs() { return this.n * (this.n - 1) / 2; }

  get unknownPairs() {
    let c = 0;
    for (let i = 0; i < this.n; i++) for (let j = i + 1; j < this.n; j++) if (this.state.get(i, j) === -1) c++;
    return c;
  }

  tripleBlocked(x, y, z) {
    const s = this.state;
    return MatrixModel.tripleBlockedState(s.get(x, y), s.get(x, z), s.get(y, z));
  }

  /** Blocked exactly when two of the three pairs share a line; null when it depends on unknown pairs. */
  static tripleBlockedState(u, v, w) {
    let yes = false, no = false;
    for (const cu of (u === -1 ? [0, 1] : [u]))
      for (const cv of (v === -1 ? [0, 1] : [v]))
        for (const cw of (w === -1 ? [0, 1] : [w])) { if (cu + cv + cw === 2) yes = true; else no = true; }
    return yes && no ? null : yes;
  }

  /** true if some triple is known blocked, false if every triple is known safe, null otherwise. */
  chordBlocked(chord) {
    const c = chord, s = this.state;
    let unknown = false;
    for (let i = 0; i < c.length; i++)
      for (let j = i + 1; j < c.length; j++)
        for (let k = j + 1; k < c.length; k++) {
          const r = MatrixModel.tripleBlockedState(s.get(c[i], c[j]), s.get(c[i], c[k]), s.get(c[j], c[k]));
          if (r === true) return true;
          if (r === null) unknown = true;
        }
    return unknown ? null : false;
  }

  /** Groups of keys known to share one line, split into the two line directions A and B. */
  lines() {
    const n = this.n, s = this.state;
    const found = [], seen = new Set();
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++) {
        if (s.get(i, j) !== 1) continue;
        const line = [i, j];
        for (let c = 0; c < n; c++) if (c !== i && c !== j && s.get(i, c) === 1 && s.get(j, c) === 1) line.push(c);
        line.sort((x, y) => x - y);
        const k = line.join(",");
        if (!seen.has(k)) { seen.add(k); found.push(line); }
      }
    const sets = found.map(l => new Set(l));
    const lines = found.filter((l, i) => !sets.some((o, j) => j !== i && o.size > sets[i].size && isSubset(sets[i], o)));
    const lineSets = lines.map(l => new Set(l));
    const color = new Array(lines.length).fill(-1);
    let conflict = false;
    const disjoint = (p, q) => { for (const x of p) if (q.has(x)) return false; return true; };
    for (let start = 0; start < lines.length; start++) {
      if (color[start] !== -1) continue;
      color[start] = 0;
      const queue = [start];
      while (queue.length) {
        const cur = queue.pop();
        for (let other = 0; other < lines.length; other++) {
          if (other === cur || disjoint(lineSets[cur], lineSets[other])) continue;
          if (color[other] === -1) { color[other] = 1 - color[cur]; queue.push(other); }
          else if (color[other] === color[cur]) conflict = true;
        }
      }
    }
    const lex = (p, q) => {
      for (let i = 0; i < Math.min(p.length, q.length); i++) if (p[i] !== q[i]) return p[i] - q[i];
      return p.length - q.length;
    };
    const ordered = ls => ls.slice().sort((p, q) => p.length !== q.length ? q.length - p.length : lex(p, q));
    return {
      a: ordered(lines.filter((_, i) => color[i] === 0)),
      b: ordered(lines.filter((_, i) => color[i] === 1)),
      conflict,
    };
  }

  // MARK: Inference

  propagate(s) {
    do {
      s.changed = false;
      this.applyObservations(s);
      if (s.failed) return;
      MatrixModel.applyPairRules(s);
      if (s.failed) return;
      MatrixModel.applyTwoLineRule(s);
      if (s.failed) return;
    } while (s.changed);
  }

  /** Blocked means exactly two of the three pairs share a line; not blocked means 0, 1 or 3. */
  applyObservations(s) {
    for (const o of this.observations) {
      const u = s.get(o.a, o.b), v = s.get(o.a, o.x), w = s.get(o.b, o.x);
      const ones = (u === 1 ? 1 : 0) + (v === 1 ? 1 : 0) + (w === 1 ? 1 : 0);
      const unknown = (u === -1 ? 1 : 0) + (v === -1 ? 1 : 0) + (w === -1 ? 1 : 0);
      let fill = -1;
      if (o.blocked) {
        if (ones > 2 || ones + unknown < 2) { s.failed = true; return; }
        if (unknown > 0) {
          if (ones === 2) fill = 0; else if (ones + unknown === 2) fill = 1;
        }
      } else if (unknown === 0) {
        if (ones === 2) { s.failed = true; return; }
      } else if (unknown === 1) {
        if (ones === 2) fill = 1; else if (ones === 1) fill = 0;
      }
      if (fill !== -1) {
        if (u === -1) s.set(o.a, o.b, fill);
        if (v === -1) s.set(o.a, o.x, fill);
        if (w === -1) s.set(o.b, o.x, fill);
        if (s.failed) return;
      }
    }
  }

  /** Rules about a pair and its common neighbours (keys sharing a line with both). */
  static applyPairRules(s) {
    const n = s.n;
    const common = [];
    for (let a = 0; a < n; a++) {
      for (let b = a + 1; b < n; b++) {
        common.length = 0;
        for (let c = 0; c < n; c++) if (c !== a && c !== b && s.get(a, c) === 1 && s.get(b, c) === 1) common.push(c);
        const ab = s.get(a, b);
        if (ab === 1) {
          if (common.length === 0) continue;
          for (let i = 0; i < common.length; i++) for (let j = i + 1; j < common.length; j++) s.set(common[i], common[j], 1);
          for (let d = 0; d < n; d++) {
            if (d === a || d === b) continue;
            const da = s.get(a, d), db = s.get(b, d);
            if (da === 1 && db === -1 && common.some(c => c !== d && s.get(c, d) === 0)) s.set(b, d, 0);
            if (db === 1 && da === -1 && common.some(c => c !== d && s.get(c, d) === 0)) s.set(a, d, 0);
          }
        } else if (ab === 0) {
          if (common.length > 2) { s.failed = true; return; }
          if (common.length === 2) {
            s.set(common[0], common[1], 0);
            for (let d = 0; d < n; d++) {
              if (d === a || d === b || d === common[0] || d === common[1]) continue;
              if (s.get(a, d) === 1 && s.get(b, d) === -1) s.set(b, d, 0);
              if (s.get(b, d) === 1 && s.get(a, d) === -1) s.set(a, d, 0);
            }
          }
        } else {
          if (common.length >= 3) {
            s.set(a, b, 1);
          } else if (common.length === 2) {
            const v = s.get(common[0], common[1]);
            if (v !== -1) s.set(a, b, v);
          }
        }
        if (s.failed) return;
      }
    }
  }

  /** Every key is on exactly two lines (see MatrixModel.swift). */
  static applyTwoLineRule(s) {
    const n = s.n;
    const nb = [];
    for (let a = 0; a < n; a++) {
      nb.length = 0;
      for (let c = 0; c < n; c++) if (c !== a && s.get(a, c) === 1) nb.push(c);
      if (nb.length < 2) continue;
      for (let i = 0; i < nb.length; i++) {
        for (let j = i + 1; j < nb.length; j++) {
          const b = nb[i], c = nb[j];
          if (s.get(b, c) !== 0) continue;
          for (const d of nb) {
            if (d === b || d === c) continue;
            const db = s.get(d, b), dc = s.get(d, c);
            if (db !== -1) s.set(d, c, 1 - db);
            if (dc !== -1) s.set(d, b, 1 - dc);
            if (s.failed) return;
          }
          for (let d = 0; d < n; d++) {
            if (d !== a && s.get(a, d) === -1 && s.get(d, b) === 0 && s.get(d, c) === 0) s.set(a, d, 0);
          }
        }
      }
    }
  }

  /** Failed-literal probing on pairs involving keys held in two or more sweeps. */
  probe() {
    const n = this.n;
    const hubs = [];
    for (let i = 0; i < n; i++) if (this.heldCount[i] >= 2) hubs.push(i);
    if (hubs.length === 0) return;
    for (let round = 0; round < 4; round++) {
      let progress = false;
      for (const h of hubs) {
        for (let x = 0; x < n; x++) {
          if (x === h || this.state.get(h, x) !== -1) continue;
          const t0 = this.state.copy();
          t0.set(h, x, 0);
          this.propagate(t0);
          if (t0.failed) {
            this.state.set(h, x, 1);
            this.propagate(this.state);
            if (this.state.failed) return;
            progress = true;
            continue;
          }
          const t1 = this.state.copy();
          t1.set(h, x, 1);
          this.propagate(t1);
          if (t1.failed) {
            t0.changed = false;
            t0.failed = false;
            this.state = t0;
            progress = true;
            continue;
          }
          const se = this.state.e, e0 = t0.e, e1 = t1.e;
          for (let k = 0; k < n * n; k++) {
            if (se[k] === -1 && e0[k] !== -1 && e0[k] === e1[k]) { se[k] = e0[k]; progress = true; }
          }
        }
      }
      if (!progress) return;
      this.propagate(this.state);
      if (this.state.failed) return;
    }
  }
}

// MARK: Planner

/** The next pair to hold, or null when no holdable pair can teach anything new. */
function nextPair(model, skipped, preferred, canHold) {
  const done = new Set(model.sweeps.map(s => pairKey(s.pair)));
  const n = model.n;
  if (model.sweeps.length === 0 || model.inconsistent.length === model.sweeps.length) {
    for (const p of preferred) if (!done.has(pairKey(p)) && !skipped.has(pairKey(p)) && canHold(p.a, p.b)) return p;
  }
  if (model.unknownPairs === 0) return null;
  const unknown = [];
  for (let i = 0; i < n; i++) unknown.push(model.unknownCount(i));
  // How often each key was blocked while the other was held: a hint that the pair shares a line.
  const evidence = new Map();
  const left = new Set(model.inconsistent);
  model.sweeps.forEach((s, i) => {
    if (left.has(i)) return;
    for (const x of s.blocked) {
      for (const k of [pairKey(makePair(s.pair.a, x)), pairKey(makePair(s.pair.b, x))]) evidence.set(k, (evidence.get(k) || 0) + 1);
    }
  });
  let best = null;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const p = makePair(i, j);
      const pk = pairKey(p);
      if (done.has(pk) || skipped.has(pk) || !canHold(p.a, p.b)) continue;
      const ui = unknown[i], uj = unknown[j];
      if (ui + uj <= 0 || model.usefulTaps(p).size === 0) continue;
      let score = 0;
      const e = model.edge(i, j);
      if (e === 1) {
        score = (ui === 0 || uj === 0) ? 3000 + ui + uj : 2000 + Math.min(ui, uj);
      } else if (e === 0) {
        let gain = 0;
        if (ui === 0 || uj === 0) {
          const [g, x] = ui === 0 ? [i, j] : [j, i];
          for (let y = 0; y < n; y++) if (y !== g && y !== x && model.edge(g, y) === 1 && model.edge(x, y) === -1) gain++;
        }
        score = gain > 0 ? 1000 + gain : 0;
      } else {
        const ev = evidence.get(pk) || 0;
        if (ev > 0) score = 500 + 50 * Math.min(ev, 5) + Math.floor((ui + uj) / 4);
        else if (ui === n - 1 || uj === n - 1) score = 100 + Math.floor((ui + uj) / 8);
      }
      if (score > 0 && (best === null || score > best.score)) best = { score, pair: p };
    }
  }
  return best ? best.pair : null;
}

/** Greedy choice of combinations the model does not rule out, covering as many key pairs as possible. */
function pickCombos(model, candidates, existing, failed, perSize) {
  const covered = new Set();
  const pairs = s => {
    const a = byCode(s), out = [];
    for (let i = 0; i < a.length; i++) for (let j = i + 1; j < a.length; j++) out.push(pairKey(makePair(a[i], a[j])));
    return out;
  };
  for (const e of existing) for (const p of pairs(e)) covered.add(p);
  const taken = new Set(existing.map(setKey));
  const picks = [];
  for (let size = 4; size <= 6; size++) {
    let need = perSize - existing.filter(e => e.size === size).length;
    const pool = [];
    for (const c of candidates) {
      if (c.size !== size || taken.has(setKey(c)) || failed.some(f => isSubset(f, c))) continue;
      if (model.chordBlocked([...c]) === true) continue;
      pool.push([c, pairs(c)]);
    }
    while (need > 0 && pool.length > 0) {
      let best = 0, bestGain = -1;
      pool.forEach((c, i) => {
        let gain = 0;
        for (const p of c[1]) if (!covered.has(p)) gain++;
        if (gain > bestGain) { best = i; bestGain = gain; }
      });
      const [c, ps] = pool.splice(best, 1)[0];
      picks.push(c);
      for (const p of ps) covered.add(p);
      need--;
    }
  }
  return picks;
}

// MARK: Session

class MatrixScanSession {
  static combosPerSize = 8;
  static skipWindow = 3;

  constructor({ sweeps = [], combos = [], candidates = [], preferred = [], tapOrder = [], canHold }) {
    this.canHold = canHold;
    this.preferred = preferred;
    this.candidates = candidates;
    this.rank = new Array(N).fill(Infinity);
    [...tapOrder, ...Array(N).keys()].forEach((k, i) => { if (this.rank[k] === Infinity) this.rank[k] = i; });
    const usable = sweeps.filter(s => !MatrixScanSession.nothingRegistered(s));
    this.droppedOnLoad = sweeps.length - usable.length;
    this.model = new MatrixModel(N, usable);
    this.stage = "sweeps";
    this.phase = "idle";
    this.pair = null;
    this.order = [];
    this.status = new Map();
    this.rechecking = null;
    this.down = new Set();
    this.skipped = new Set();
    this.message = "";
    this.redo = [];
    this.comboTargets = combos.map(c => c.keys);
    this.comboSlots = combos.slice();
    this.comboIndex = 0;
    this.comboPeak = new Set();
    this.comboExtra = false;
    this.comboTouched = false;
    this.suggestNext();
  }

  /** A sweep in which no tapped key registered: the keys were not tapped, so it says nothing. */
  static nothingRegistered(s) {
    const tapped = s.tapped ? s.tapped.size : N - 2;
    return tapped > 0 && s.blocked.size >= tapped;
  }

  get sweeps() { return this.model.sweeps; }
  get combos() { return this.comboSlots.filter(c => c); }

  // Current sweep.
  get unresolved() { return this.order.filter(k => !this.status.has(k)); }
  get endsOnKnownKey() {
    const p = this.pair, last = this.order[this.order.length - 1];
    if (!p || last === undefined) return false;
    return this.rechecking !== null || this.model.tripleBlocked(p.a, p.b, last) === false;
  }
  get current() { const k = this.order.find(k => !this.status.has(k)); return k === undefined ? null : k; }
  get registeredKeys() { return new Set([...this.status].filter(([, v]) => v === "registered").map(([k]) => k)); }
  get missedKeys() { return new Set([...this.status].filter(([, v]) => v === "missed").map(([k]) => k)); }
  get finishKey() { const k = this.order.find(k => this.status.get(k) === "registered"); return k === undefined ? null : k; }
  get canFinishWithKey() {
    const u = this.unresolved.length;
    return u > 0 && u <= MatrixScanSession.skipWindow && this.finishKey !== null;
  }
  get sweepComplete() { return this.order.length > 0 && this.unresolved.length === 0; }
  /** The round can't end on its own: every remaining key is dark and none registered to tap again. */
  get stuckOnDark() {
    return this.phase === "tapping" && this.downIs(this.pair) && this.unresolved.length > 0 && this.finishKey === null;
  }
  get tripleTests() { return this.model.sweeps.reduce((t, s) => t + (s.tapped ? s.tapped.size : N - 2), 0); }

  downIs(p) { return this.down.size === 2 && this.down.has(p.a) && this.down.has(p.b); }
  sorted(s) { return [...s].sort((x, y) => (this.rank[x] - this.rank[y]) || (CODE[x] - CODE[y])); }
  allKeysExcept(...ex) { const s = new Set(Array(N).keys()); for (const e of ex) s.delete(e); return s; }

  // Pair selection.
  suggestNext() {
    const p = nextPair(this.model, this.skipped, this.preferred, this.canHold);
    this.select(p);
    if (p === null) this.message = this.model.unknownPairs === 0 ? "The 3-key map is complete." : "No holdable pair can teach anything new.";
  }

  choose(a, b) {
    if (a === b) return;
    this.stage = "sweeps";
    this.select(makePair(a, b));
  }

  skipPair() {
    if (this.pair) this.skipped.add(pairKey(this.pair));
    this.suggestNext();
  }

  restartSweep() {
    this.status.clear();
    if (this.phase === "tapping") this.phase = "hold";
    if (this.pair && this.downIs(this.pair)) this.phase = "tapping";
  }

  resetAll() {
    this.model = new MatrixModel(N);
    this.skipped.clear();
    this.redo = [];
    this.comboTargets = [];
    this.comboSlots = [];
    this.comboIndex = 0;
    this.stage = "sweeps";
    this.suggestNext();
  }

  select(p) {
    this.pair = p;
    this.status.clear();
    this.rechecking = null;
    if (!p) { this.phase = "idle"; this.order = []; return; }
    // Only keys whose result is not predictable yet; all of them if the pair teaches nothing new.
    const useful = this.model.usefulTaps(p);
    this.order = this.sorted(useful.size ? useful : this.allKeysExcept(p.a, p.b));
    // End on a key known to register with this pair, so the round finishes even if the last keys are dark.
    const rest = this.allKeysExcept(p.a, p.b);
    for (const k of this.order) rest.delete(k);
    const ends = this.sorted([...rest].filter(k => this.model.tripleBlocked(p.a, p.b, k) === false));
    if (ends.length) this.order.push(ends[ends.length - 1]);
    this.phase = this.downIs(p) ? "tapping" : "hold";
    this.message = "";
  }

  startRecheck(sweep) {
    const tapped = sweep.tapped || this.allKeysExcept(sweep.pair.a, sweep.pair.b);
    const ok = [...tapped].filter(k => !sweep.blocked.has(k));
    const anchor = this.sorted(ok)[0];
    if (anchor === undefined) return;
    this.pair = sweep.pair;
    this.rechecking = sweep;
    this.status.clear();
    this.order = [...this.sorted(sweep.blocked), anchor];
    this.phase = this.downIs(sweep.pair) ? "tapping" : "hold";
  }

  get sweepInProgress() { return this.status.size > 0 || this.rechecking !== null; }

  // Back and forward.
  get canGoBack() { return this.stage === "sweeps" ? (this.sweepInProgress || this.model.sweeps.length > 0) : true; }
  get canGoForward() {
    return this.stage === "sweeps" ? (this.redo.length > 0 && !this.sweepInProgress) : this.comboIndex < this.comboTargets.length;
  }

  back() {
    if (this.stage === "sweeps") {
      if (this.sweepInProgress) {
        if (this.rechecking !== null) this.select(this.pair); else this.restartSweep();
        this.message = "Sweep restarted.";
        return;
      }
      const last = this.model.sweeps[this.model.sweeps.length - 1];
      if (!last) return;
      this.redo.push(last);
      this.model = new MatrixModel(N, this.model.sweeps.slice(0, -1));
      this.select(last.pair);
      this.message = `Back to ${this.name(last.pair.a)} + ${this.name(last.pair.b)}. Redo it, or press Forward to keep the old result.`;
    } else {
      if (this.comboTouched) { this.resetAttempt(); this.message = "Attempt discarded."; return; }
      let i = -1;
      for (let j = this.comboIndex - 1; j >= 0; j--) if (!this.isPruned(j)) { i = j; break; }
      if (i >= 0) {
        this.comboIndex = i;
        this.message = this.comboSlots[i] ? "Press it again to replace the earlier result, or Forward to keep it." : "";
      } else {
        this.returnToSweeps();
      }
    }
  }

  forward() {
    if (this.stage === "sweeps") {
      if (this.sweepInProgress || this.redo.length === 0) return;
      const s = this.redo.pop();
      this.model.add(s);
      this.suggestNext();
      this.message = `Kept ${this.name(s.pair.a)} + ${this.name(s.pair.b)}.`;
    } else {
      if (this.comboIndex >= this.comboTargets.length) return;
      this.resetAttempt();
      this.advance();
    }
  }

  // Stages.
  enterCombos() {
    this.stage = "combos";
    this.resetAttempt();
    const failed = this.combos.filter(c => c.outcome === "fail").map(c => c.keys);
    const picks = pickCombos(this.model, this.candidates, this.comboTargets, failed, MatrixScanSession.combosPerSize);
    this.comboTargets.push(...picks);
    this.comboSlots.push(...picks.map(() => null));
    const free = this.comboSlots.findIndex(c => c === null);
    this.comboIndex = free === -1 ? this.comboTargets.length : free;
    while (this.comboIndex < this.comboTargets.length && this.isPruned(this.comboIndex)) this.comboIndex++;
    this.message = this.comboTargets.length === 0 ? "No 4-6 key layout chords to check." : "";
  }

  returnToSweeps() {
    this.stage = "sweeps";
    this.resetAttempt();
    if (!this.pair || this.order.length === 0) this.suggestNext();
  }

  get currentCombo() {
    return this.stage === "combos" && this.comboIndex < this.comboTargets.length ? this.comboTargets[this.comboIndex] : null;
  }

  isPruned(i) {
    if (this.comboSlots[i]) return false;
    const t = this.comboTargets[i];
    return this.comboSlots.some(c => c && c.outcome === "fail" && isStrictSubset(c.keys, t))
      || this.model.chordBlocked([...t]) === true;
  }

  get remainingCombos() {
    let c = 0;
    for (let i = this.comboIndex; i < this.comboTargets.length; i++) if (!this.comboSlots[i] && !this.isPruned(i)) c++;
    return c;
  }

  advance() {
    this.comboIndex++;
    while (this.comboIndex < this.comboTargets.length && this.isPruned(this.comboIndex)) this.comboIndex++;
  }

  resetAttempt() {
    this.comboPeak = new Set();
    this.comboExtra = false;
    this.comboTouched = false;
  }

  /** Key events stopped arriving (focus lost): forget held keys; the sweep continues when the pair is held again. */
  interrupt() {
    this.down.clear();
    this.resetAttempt();
    if (this.phase === "tapping") this.phase = "hold";
  }

  name(k) { return NAME[k]; }

  // Raw events.
  keyDown(code) {
    this.down.add(code);
    if (this.stage === "combos") {
      const t = this.currentCombo;
      if (!t) return;
      this.comboTouched = true;
      if (!t.has(code)) this.comboExtra = true;
      const now = new Set([...this.down].filter(k => t.has(k)));
      if (now.size > this.comboPeak.size) this.comboPeak = now;
      return;
    }
    const p = this.pair;
    if (!p) return;
    if (this.phase === "hold") {
      if (this.downIs(p)) this.phase = "tapping";
    } else if (this.phase === "tapping") {
      // A tap only counts while both keys of the pair are held.
      if (code !== p.a && code !== p.b && this.down.has(p.a) && this.down.has(p.b)) this.tap(code);
    }
  }

  tap(code) {
    if (!this.order.includes(code)) return;
    const st = this.status.get(code);
    if (st === "missed") {
      this.status.set(code, "registered");
      this.message = `${this.name(code)} registered after all.`;
    } else if (st === "registered") {
      if (this.canFinishWithKey) for (const k of this.unresolved) this.status.set(k, "missed");
    } else {
      const u = this.unresolved;
      const i = u.indexOf(code);
      // Keys passed over were tapped and stayed dark. A red key tapped again turns green.
      if (i >= 0) for (const k of u.slice(0, i)) this.status.set(k, "missed");
      this.status.set(code, "registered");
      this.message = "";
    }
  }

  /** End the round while the pair is held: every key still dark is blocked. Used when nothing is left to tap
   *  (for example the round ends on Space and the pair blocks it, so there is no key that would register). */
  forceFinish() {
    if (this.stage !== "sweeps" || !this.pair || this.phase !== "tapping" || !this.downIs(this.pair)) return;
    if (this.unresolved.length === 0) return;
    for (const k of this.unresolved) this.status.set(k, "missed");
    // The forced finish marks missing evidence; commit only after every captured layout key is released.
  }

  keyUp(code) {
    if (!this.down.delete(code)) return;
    if (this.stage === "combos") {
      if (this.down.size === 0 && this.comboTouched) this.endCombo();
      return;
    }
    const p = this.pair;
    if (!p) return;
    if (this.phase === "hold") {
      if (this.downIs(p)) this.phase = "tapping";
    } else if (this.phase === "tapping") {
      if (this.down.size === 0) this.released(p);
    }
  }

  released(p) {
    this.phase = "hold";
    const pairText = `${this.name(p.a)} + ${this.name(p.b)}`;
    if (this.registeredKeys.size === 0) {
      this.status.clear();
      this.message = `Nothing registered. Hold ${pairText} and, while holding, tap the highlighted key with your other hand.`;
      return;
    }
    if (!this.sweepComplete) {
      this.message = `Paused: ${this.unresolved.length} keys to go. Hold ${pairText} again to carry on.`;
      return;
    }
    this.finish(p);
  }

  finish(p) {
    const pairText = `${this.name(p.a)} + ${this.name(p.b)}`;
    const dark = this.missedKeys;
    if (this.rechecking) {
      const old = this.rechecking;
      // Keys that registered now were missed taps the first time.
      const blocked = new Set([...old.blocked].filter(k => dark.has(k)));
      const sweep = makeSweep(p, blocked, old.tapped);
      const ok = this.model.add(sweep);
      this.redo = [];
      this.suggestNext();
      this.message = ok ? `${pairText}: fixed, ${blocked.size} blocked.`
        : `${pairText} still doesn't fit the other results, so it's left out of the map. Back takes it away.`;
      this.afterSweep();
      return;
    }
    const all = this.order.length === N - 2;
    const sweep = makeSweep(p, dark, all ? null : new Set(this.order));
    if (this.model.add(sweep)) {
      this.redo = [];
      this.suggestNext();
      this.message = `${pairText}: ${this.order.length} tested, ` + (dark.size === 0 ? "nothing blocked." : `${dark.size} blocked.`);
      this.afterSweep();
    } else if (dark.size > 0) {
      // Most likely a key was passed over by accident: ask for just the dark ones again.
      this.model.dropLastSweep();
      this.startRecheck(sweep);
      this.message = `That doesn't fit the other results. Hold ${pairText} again and tap just the ${dark.size} keys that stayed dark.`;
    } else {
      this.redo = [];
      this.suggestNext();
      this.message = `${pairText} doesn't fit the other results, so it's left out of the map. Back takes it away.`;
      this.afterSweep();
    }
  }

  afterSweep() {
    if (this.pair === null && this.model.unknownPairs === 0) {
      this.enterCombos();
      this.message += " The 3-key map is complete; now a few 4-6 key chords.";
    }
  }

  endCombo() {
    const t = this.currentCombo;
    if (!t) return;
    try {
      if (this.comboExtra) { this.message = "Other keys were pressed too. Press only the outlined keys."; return; }
      const missing = new Set([...t].filter(k => !this.comboPeak.has(k)));
      const result = { keys: t, outcome: missing.size === 0 ? "pass" : "fail", missing };
      const predicted = this.model.chordBlocked([...t]);
      this.comboSlots[this.comboIndex] = result;
      const label = byIndex(t).map(k => this.name(k)).join("+");
      if (result.outcome === "pass") {
        this.message = `✓ ${label} registered.`;
      } else {
        this.message = `✗ ${label}: ` + byCode(missing).map(k => this.name(k)).join(", ") + " did not register.";
        if (predicted !== true && t.size > 3) {
          // Unexpected: narrow it down with the sub-combinations that still contain a missing key.
          const subs = [];
          const targets = new Set(this.comboTargets.map(setKey));
          for (const k of byCode(t)) {
            if (missing.size === 1 && missing.has(k)) continue;
            const sub = new Set(t); sub.delete(k);
            if (!targets.has(setKey(sub))) subs.push(sub);
          }
          this.comboTargets.splice(this.comboIndex + 1, 0, ...subs);
          this.comboSlots.splice(this.comboIndex + 1, 0, ...subs.map(() => null));
          if (subs.length) this.message += ` The grid model expected it to work; ${subs.length} smaller combinations follow to narrow it down.`;
        }
      }
      this.advance();
      if (this.comboIndex >= this.comboTargets.length) this.message += " Combination check finished: copy the report.";
    } finally {
      this.resetAttempt();
    }
  }
}

// MARK: Report (same text format as MatrixScanReport.swift)

const Report = {
  serialize(model, combos, hardware, comments = []) {
    const name = k => NAME[k];
    const ordered = s => byIndex(s);
    let s = "# KeyChord Matrix Scan\n";
    s += "# sweep A+B blocked <keys> [untested <keys> | tapped <keys>]: A and B held; every other key was tapped,\n";
    s += "# except the untested ones (or only the tapped ones). Blocked means not registered in the recorded scan attempts; repeat before diagnosing hardware.\n";
    s += "# combo <keys> pass|fail [missing <keys>]: the keys pressed together.\n";
    for (const c of comments) s += "# " + c + "\n";
    s += `version 1\nhardware ${hardware}\n`;
    s += "keys " + NAME.join(" ") + "\n";
    const left = new Set(model.inconsistent);
    model.sweeps.forEach((sw, i) => {
      const blocked = ordered(sw.blocked).map(name);
      s += `sweep ${name(sw.pair.a)}+${name(sw.pair.b)} blocked ` + (blocked.length ? blocked.join(" ") : "-");
      if (sw.tapped) {
        const untested = [];
        for (let k = 0; k < N; k++) if (k !== sw.pair.a && k !== sw.pair.b && !sw.tapped.has(k)) untested.push(name(k));
        const only = ordered(sw.tapped).map(name);
        if (only.length < untested.length) s += " tapped " + only.join(" ");
        else if (untested.length) s += " untested " + untested.join(" ");
      }
      s += left.has(i) ? "   # contradicts earlier sweeps, not used\n" : "\n";
    });
    for (const c of combos) {
      s += "combo " + ordered(c.keys).map(name).join("+") + " " + c.outcome;
      if (c.missing.size) s += " missing " + ordered(c.missing).map(name).join(" ");
      s += "\n";
    }
    s += "# --- analysis ---\n";
    s += `# sweeps ${model.sweeps.length}, left out ${model.inconsistent.length}; `;
    s += `3-key combinations known: ${model.totalPairs - model.unknownPairs} of ${model.totalPairs} key pairs\n`;
    s += Report.wiring(model);
    const partial = [];
    for (let k = 0; k < N; k++) { const u = model.unknownCount(k); if (u > 0) partial.push(`${name(k)}(${u})`); }
    if (partial.length) s += "# not fully known: " + partial.join(" ") + "\n";
    s += Report.comboSummary(model, combos);
    return s;
  },

  /** The inferred wiring as a grid: each key sits where its A line (table row) crosses its B line (column). */
  wiring(model) {
    const lines = model.lines();
    let out = "# wiring: keys in the same table row, or in the same column, share an electrical line.\n";
    out += "# Three keys block when two of them share a row and one of those shares a column with the third (an L).\n";
    out += "# A and B are the two line directions; which one is the physical row can't be observed.\n";
    if (lines.conflict) out += "# WARNING: the known lines do not fit a grid, so the keyboard is not a plain matrix.\n";
    const rowOf = new Map(), colOf = new Map();
    lines.a.forEach((l, i) => { for (const k of l) rowOf.set(k, i); });
    lines.b.forEach((l, j) => { for (const k of l) colOf.set(k, j); });
    let rows = lines.a.length, cols = lines.b.length;
    const known = [];
    for (let k = 0; k < N; k++) if (model.unknownCount(k) === 0 || rowOf.has(k) || colOf.has(k)) known.push(k);
    for (const k of known) if (!rowOf.has(k)) rowOf.set(k, rows++);
    for (const k of known) if (!colOf.has(k)) colOf.set(k, cols++);
    if (rows === 0 || cols === 0) return out;
    const cell = Array.from({ length: rows }, () => new Array(cols).fill(""));
    for (const k of known) {
      const r = rowOf.get(k), c = colOf.get(k);
      cell[r][c] = cell[r][c] ? cell[r][c] + "/" + NAME[k] : NAME[k];
    }
    const width = Math.max(3, ...cell.flat().map(t => t.length));
    const pad = t => t + " ".repeat(width - t.length);
    out += "#      " + Array.from({ length: cols }, (_, j) => pad("B" + (j + 1))).join(" ") + "\n";
    for (let r = 0; r < rows; r++) {
      const label = "A" + (r + 1);
      out += "# " + label + " ".repeat(Math.max(1, 5 - label.length)) + cell[r].map(t => pad(t || ".")).join(" ") + "\n";
    }
    return out;
  },

  comboSummary(model, combos) {
    if (!combos.length) return "# 4-6 key check: not run\n";
    const name = k => NAME[k];
    let out = "";
    for (let size = 3; size <= 6; size++) {
      const c = combos.filter(x => x.keys.size === size);
      if (!c.length) continue;
      out += `# ${size}-key combos: ${c.filter(x => x.outcome === "pass").length} of ${c.length} passed\n`;
    }
    const surprises = combos.filter(c => {
      const p = model.chordBlocked([...c.keys]);
      return p !== null && p !== (c.outcome === "fail");
    });
    if (!surprises.length) {
      out += "# every combo matched the grid model's prediction\n";
    } else {
      out += `# combos the grid model got wrong (${surprises.length}):\n`;
      for (const c of surprises) {
        out += "#   " + byIndex(c.keys).map(name).join("+") + " " + c.outcome
          + (c.missing.size ? ", missing " + byIndex(c.missing).map(name).join(" ") : "") + "\n";
      }
      const fails = combos.filter(c => c.outcome === "fail").map(c => c.keys);
      const minimal = fails.filter(f => !fails.some(o => isStrictSubset(o, f)));
      out += "#   smallest failing combos: " + minimal.map(m => byIndex(m).map(name).join("+")).join("  ") + "\n";
    }
    return out;
  },

  /** Reads a report back. Returns null when it was made with a different key list; throws on bad lines. */
  parse(text) {
    const sweeps = [], combos = [];
    const lines = text.split(/\r\n|\r|\n/);
    for (let n = 0; n < lines.length; n++) {
      const line = lines[n].split("#")[0];
      const f = line.split(/\s+/).filter(x => x.length);
      if (!f.length) continue;
      const code = s => {
        const i = INDEX_BY_NAME.get(s);
        if (i === undefined) throw new Error(`unknown key "${s}" on line ${n + 1}`);
        return i;
      };
      const malformed = () => new Error(`malformed line ${n + 1}`);
      switch (f[0]) {
        case "version":
          if (f.length !== 2 || f[1] !== "1") throw malformed();
          break;
        case "hardware":
          break;
        case "keys":
          if (f.slice(1).join(" ") !== NAME.join(" ")) return null;
          break;
        case "sweep": {
          if (f.length < 4 || f[2] !== "blocked") throw malformed();
          const pn = f[1].split("+");
          if (pn.length !== 2) throw malformed();
          const a = code(pn[0]), b = code(pn[1]);
          const rest = f.slice(3);
          let split = rest.findIndex(x => x === "untested" || x === "tapped");
          if (split === -1) split = rest.length;
          const bn = rest.slice(0, split);
          const blocked = bn.length === 1 && bn[0] === "-" ? new Set() : new Set(bn.map(code));
          let tapped = null;
          if (split < rest.length) {
            const listed = new Set(rest.slice(split + 1).map(code));
            if (rest[split] === "tapped") tapped = listed;
            else { tapped = new Set(Array(N).keys()); for (const k of [...listed, a, b]) tapped.delete(k); }
          }
          sweeps.push(makeSweep(makePair(a, b), blocked, tapped));
          break;
        }
        case "combo": {
          if (f.length < 3 || (f[2] !== "pass" && f[2] !== "fail")) throw malformed();
          const keys = new Set(f[1].split("+").map(code));
          let missing = new Set();
          if (f.length > 3) {
            if (f[3] !== "missing") throw malformed();
            missing = new Set(f.slice(4).map(code));
          }
          combos.push({ keys, outcome: f[2], missing });
          break;
        }
        default:
          throw malformed();
      }
    }
    return { sweeps, combos };
  },
};
export { KEYS, NAME, CODE, LABEL, INDEX_BY_NAME, INDEX_BY_DOM_CODE, MatrixModel, MatrixScanSession, Report, makePair, decodeCandidates, canHoldUS, tapOrderUS };
