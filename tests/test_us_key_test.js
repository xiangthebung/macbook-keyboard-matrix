"use strict";
const assert = require("node:assert/strict");
const { Session, plan, reportKeys } = require("../docs/us-key-test.js");
global.window = global;
require("../docs/kb-data.js");
const expectedKeys = require("node:fs").readFileSync(require("node:path").join(__dirname, "../data/observations/1-matrix-scan.txt"), "utf8")
  .split("\n").find(l => l.startsWith("keys ")).slice(5).split(" ");
assert.deepEqual(reportKeys(KB.ansi), expectedKeys, "the report must be reloadable by KeyChord's Matrix Scan parser");
function tap(s, k) { s.keyDown(k, false); s.keyUp(k); }
function calibrated() { const s = new Session(); tap(s, "Grave"); tap(s, "Backslash"); return s; }
let s = new Session();
tap(s, "Q");
assert.equal(s.index, 0, "the key must register by itself before any measurements");
s.keyDown("Grave", true);
s.keyUp("Grave");
assert.equal(s.index, 0, "autorepeat is not a tap");
assert.equal(s.record("blocked"), false, "a missing calibration is not a blocked chord");
tap(s, "Grave"); tap(s, "Backslash");
assert.equal(s.index, 2);
tap(s, "Grave");
assert.equal(s.index, 2, "the target alone does not pass a held-pair test");
s.keyDown("3"); s.keyDown("E");
s.keyDown("Grave"); s.keyUp("3"); s.keyUp("Grave");
assert.equal(s.index, 2, "releasing the held pair early invalidates the attempt");
s.interrupt();
assert.equal(s.record("blocked"), false, "focus loss cannot be recorded as a hardware block");
s.keyDown("3"); s.keyDown("E"); tap(s, "Grave");
assert.equal(s.index, 3);
assert.equal(s.record("blocked"), true);
assert.equal(s.index, 4);
let report = s.report("MacBookPro18,1", ["3", "E", "Grave", "Backslash"]);
assert.match(report, /sweep 3\+E blocked Backslash tapped Grave Backslash/);
let resumed = new Session(s.snapshot());
assert.equal(resumed.index, 4);
assert.equal(resumed.down.size, 0);
assert.equal(resumed.back(), true);
assert.equal(resumed.index, 3);
assert.equal(resumed.results[3], null);
assert.equal(resumed.record("blocked"), false);
assert.equal(resumed.record("skipped"), true);
assert.match(resumed.report("", []), /# skipped 3\+E tap Backslash/);
s = calibrated();
s.keyDown("3"); s.keyDown("E"); s.keyDown("A"); tap(s, "Grave");
assert.equal(s.index, 2, "extra held keys do not produce a three-key observation");
s = calibrated();
s.keyDown("3"); s.keyDown("E"); s.keyDown("Grave"); s.interrupt(); s.keyUp("Grave");
assert.equal(s.index, 2, "a interrupted tap is not a pass");
for (const step of plan()) {
  assert.equal(new Set(step.pair.concat([step.tap])).size, step.pair.length + 1);
  assert.ok(step.tap === "Grave" || step.tap === "Backslash");
}
console.log("US key-test event, resume, redo and report checks passed");
