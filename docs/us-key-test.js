// Temporary observation tool. It records browser events; it makes no wiring predictions.
(function (root) {
  "use strict";
  var VERSION = "us-unknown-keys-1";
  // These pairs distinguish all 76 observable single-key profiles among the existing wire positions
  // plus a new row/column, assuming the shared keys and occupied corners keep the ISO wiring.
  // The first 28 pairs fit within three key widths; the last three separate the remaining profiles.
  var PAIRS = [
    ["3", "E"], ["9", "Minus"], ["C", "D"], ["4", "R"], ["5", "G"], ["0", "Quote"],
    ["8", "LBracket"], ["C", "M"], ["0", "Equal"], ["Z", "X"], ["V", "B"], ["3", "D"],
    ["X", "C"], ["T", "O"], ["C", "E"], ["X", "N"], ["Z", "C"], ["F", "K"],
    ["O", "Minus"], ["T", "U"], ["C", "N"], ["F", "R"], ["D", "E"], ["X", "S"],
    ["7", "R"], ["4", "E"], ["0", "Semicolon"], ["8", "G"],
    ["8", "E"], ["9", "R"], ["9", "E"]
  ];

  function plan() {
    var steps = [{ pair: [], tap: "Grave" }, { pair: [], tap: "Backslash" }];
    PAIRS.forEach(function (p, i) {
      ["Grave", "Backslash"].forEach(function (tap) {
        steps.push({ pair: p.slice(), tap: tap, stretch: i >= 28 });
      });
    });
    // Check interaction between the two unknown keys as well. Hold each unknown key with a nearby key,
    // and tap the other one; there is no need to span the whole keyboard with one hand.
    ["1", "Q", "A", "Z"].forEach(function (k) { steps.push({ pair: ["Grave", k], tap: "Backslash" }); });
    ["RBracket", "Quote", "Equal", "Slash"].forEach(function (k) {
      steps.push({ pair: ["Backslash", k], tap: "Grave" });
    });
    return steps;
  }

  function Session(saved) {
    this.steps = plan();
    this.results = this.steps.map(function () { return null; });
    this.started = new Date().toISOString();
    if (saved && saved.version === VERSION && Array.isArray(saved.results) && saved.results.length === this.steps.length) {
      this.results = saved.results.map(function (r, i) {
        return r === "registered" || (i >= 2 && (r === "blocked" || r === "skipped")) ? r : null;
      });
      this.started = saved.started || this.started;
    }
    this.down = new Set();
    this.pending = false;
    this.index = this.results.indexOf(null);
    if (this.index < 0) this.index = this.steps.length;
  }
  Session.prototype.step = function () { return this.steps[this.index] || null; };
  Session.prototype.validHold = function () {
    var s = this.step(), down = this.down;
    return !!s && down.size === s.pair.length && s.pair.every(function (k) { return down.has(k); });
  };
  Session.prototype.keyDown = function (key, repeat) {
    if (repeat) return;
    var s = this.step(), valid = this.validHold();
    this.down.add(key);
    if (s && key === s.tap && valid) this.pending = true;
    else if (s && key !== s.tap && s.pair.indexOf(key) < 0) this.pending = false;
  };
  Session.prototype.keyUp = function (key) {
    var s = this.step(), pending = this.pending;
    this.down.delete(key);
    if (!s) return false;
    if (key === s.tap) {
      this.pending = false;
      if (pending && this.validHold()) return this.record("registered");
    } else if (s.pair.indexOf(key) >= 0) {
      this.pending = false;
    }
    return false;
  };
  Session.prototype.record = function (result) {
    var s = this.step();
    if (!s) return false;
    if (result === "blocked" && (!s.pair.length || !this.validHold())) return false;
    if (result !== "registered" && result !== "blocked" && result !== "skipped") return false;
    if (result === "skipped" && !s.pair.length) return false;
    this.results[this.index] = result;
    this.pending = false;
    this.index = this.results.indexOf(null);
    if (this.index < 0) this.index = this.steps.length;
    return true;
  };
  Session.prototype.back = function () {
    var i = this.index - 1;
    while (i >= 0 && this.results[i] === null) i--;
    if (i < 0) return false;
    this.results[i] = null;
    this.index = i;
    this.pending = false;
    return true;
  };
  Session.prototype.interrupt = function () { this.down.clear(); this.pending = false; };
  Session.prototype.snapshot = function () {
    return { version: VERSION, started: this.started, results: this.results.slice() };
  };
  Session.prototype.report = function (device, keys) {
    var lines = ["# KeyChord US unknown-key test", "version 1",
      "hardware " + (device || "model not supplied").replace(/[\r\n]/g, " ") + ", built-in US ANSI keyboard",
      "keys " + keys.join(" "), "# plan " + VERSION, "# started " + this.started];
    var groups = {}, order = [], done = 0, skipped = 0;
    this.steps.forEach(function (s, i) {
      var r = this.results[i];
      if (!r) return;
      done++;
      if (!s.pair.length) { lines.push("# calibration " + s.tap + " " + r); return; }
      if (r === "skipped") { lines.push("# skipped " + s.pair.join("+") + " tap " + s.tap); skipped++; return; }
      var p = s.pair.join("+");
      if (!groups[p]) { groups[p] = { taps: [], blocked: [] }; order.push(p); }
      groups[p].taps.push(s.tap);
      if (r === "blocked") groups[p].blocked.push(s.tap);
    }, this);
    order.forEach(function (p) {
      var g = groups[p];
      lines.push("sweep " + p + " blocked " + (g.blocked.length ? g.blocked.join(" ") : "-")
        + " tapped " + g.taps.join(" "));
    });
    lines.push("# completed " + done + " of " + this.steps.length + "; skipped " + skipped);
    lines.push("# registered: target key-down and key-up arrived while the pair stayed held");
    lines.push("# blocked: tester explicitly reported two taps with no response while the pair stayed held");
    lines.push("# No wiring positions are inferred by this report.");
    return lines.join("\n") + "\n";
  };
  // Matrix Scan reports use physical keyboard order, which includes the two unplaced keys.
  function reportKeys(bundle) { return bundle.geometry.filter(function (g) { return !!g.id; }).map(function (g) { return g.id; }); }
  var api = { Session: Session, plan: plan, pairs: PAIRS, reportKeys: reportKeys, version: VERSION };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.USKeyTest = api;
})(this);
