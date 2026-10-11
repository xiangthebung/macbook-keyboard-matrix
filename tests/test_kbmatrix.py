import itertools
import json
import os
import random
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import kbmatrix  # noqa: E402


class Observations(unittest.TestCase):
    kb = kbmatrix.load()

    def test_fitted_observations(self):
        explained, total, bad = kbmatrix.validate(self.kb, kbmatrix.FITTED)
        self.assertEqual(total, 999)
        self.assertEqual(explained, 998)
        # The one result the wiring does not explain (` is on the far-left column, nowhere near H and J).
        self.assertEqual([(o.source, o.label, o.blocked) for o in bad],
                         [("1-matrix-scan.txt", "hold H+J, tap `", True)])

    def test_predicted_observations(self):
        explained, total, bad = kbmatrix.validate(self.kb, kbmatrix.PREDICTED)
        self.assertEqual(total, 56)
        self.assertEqual(bad, [])

    def test_every_deciding_spot_was_observed(self):
        obs = kbmatrix.all_observations(self.kb)
        self.assertEqual(self.kb.open_spots(obs), [])


class Rule(unittest.TestCase):
    kb = kbmatrix.load()

    def test_examples(self):
        kb = self.kb
        self.assertFalse(kb.registers(["J", "H", "M"]))                 # L at J, N at the fourth corner
        self.assertFalse(kb.registers(["U", "H", "N", "A", "C"]))
        self.assertTrue(kb.registers(["J", "M", "X"]))                  # L at M, empty fourth corner
        self.assertTrue(kb.registers(["Q", "I", "O"]))                  # one wire
        self.assertFalse(kb.registers(["Q", "I", "A"]))
        self.assertEqual(kb.never_blocking(), ["E"])
        self.assertEqual(kb.dropped_when_holding("J", "M"), ["A", "H", "K", "L", "Semicolon", "Z", "N", "Comma", "Period", "Slash"])

    def test_six_key_rollover(self):
        kb = self.kb
        wasd = ["W", "A", "S", "D", "Q", "E", "R", "F", "Space"]
        self.assertEqual(kb.blocked_triples(wasd), [])                  # no three of these block each other,
        self.assertTrue(all(kb.registers(c) for c in itertools.combinations(wasd, 6)))
        self.assertFalse(kb.registers(wasd))                            # but at most 6 keys register at once
        row = list("1234567890") + ["Equal"]
        self.assertEqual(kb.blocked_triples(row), [])                   # the number row is one wire
        self.assertTrue(kb.registers(row[:6]))
        self.assertFalse(kb.registers(row[:7]))
        self.assertIn("at most 6 keys", kb.explain(row[:7]))

    def test_pairs_always_register(self):
        for a, b in itertools.combinations(self.kb.order, 2):
            self.assertTrue(self.kb.registers([a, b]))

    def test_larger_chords_follow_their_triples(self):
        kb = self.kb
        for t in itertools.islice(itertools.combinations(kb.order, 4), 0, None, 97):
            self.assertEqual(kb.registers(t), all(kb.registers(x) for x in itertools.combinations(t, 3)))

    def test_names(self):
        kb = self.kb
        self.assertEqual(kb.key("5"), "5")                    # a digit is the digit key...
        self.assertEqual(kb.key("code:5"), "G")               # ...key code 5 is G
        for name in (";", "semicolon", "Semicolon", "kVK_ANSI_Semicolon", "code:41"):
            self.assertEqual(kb.key(name), "Semicolon")
        self.assertEqual(kb.key("KeyJ"), "J")
        self.assertEqual(kb.key("`"), "Grave")
        self.assertEqual(kb.key("space"), "Space")
        with self.assertRaises(KeyError):
            kb.key("F1")
        self.assertEqual(kb.keys_of(["J H M"]), ["J", "H", "M"])
        self.assertEqual(kb.keys_of(["J+H+M", "space"]), ["J", "H", "M", "Space"])
        self.assertEqual(kb.keys_of([" "]), ["Space"])

    def test_data(self):
        with open(kbmatrix.DEFAULT_DATA, encoding="utf-8") as f:
            data = json.load(f)
        self.assertEqual(len(data["keys"]), 48)
        self.assertEqual(len({k["keycode"] for k in data["keys"]}), 48)
        self.assertEqual(len({(k["row"], k["column"]) for k in data["keys"]}), 48)
        geometry = [g[5] for g in kbmatrix.iso_keyboard() if g[5]]
        self.assertEqual(sorted(geometry), sorted(k["id"] for k in data["keys"]))


class USKeyboard(unittest.TestCase):
    """The US (ANSI) data: derived from the ISO measurement, not measured."""
    iso = kbmatrix.load()
    us = kbmatrix.load(kbmatrix.ANSI_DATA)
    moved = ["Grave", "Backslash"]

    def test_derived_from_iso(self):
        iso, us = self.iso, self.us
        self.assertEqual(us.layout, "ansi")
        self.assertEqual(iso.layout, "iso")
        self.assertEqual(us.data["derived_from"], os.path.basename(kbmatrix.DEFAULT_DATA))
        self.assertEqual(len(us.order), 46)
        self.assertEqual(sorted(us.unplaced), sorted(self.moved))
        # Every key that is in the same place on both keyboards keeps its wires...
        self.assertEqual(us.order, [k for k in iso.order if k not in self.moved])
        for k in us.order:
            self.assertEqual(us.pos[k], iso.pos[k], k)
        # ...and the spots of the ISO ` and \ keys still count as keys.
        self.assertEqual(us.occupied, iso.occupied)
        self.assertEqual(set(us.spot_notes), {iso.pos[k] for k in self.moved})

    def test_same_results_as_iso_without_the_moved_keys(self):
        iso, us = self.iso, self.us
        blocked = [t for t, _, _ in us.all_blocked_triples()]
        self.assertEqual(blocked, [t for t, _, _ in iso.all_blocked_triples() if not set(t) & set(self.moved)])
        self.assertEqual(len(blocked), 607)
        # 12 of them only because the fourth corner is where ISO keyboards have ` or \.
        unsure = [t for t, _, spot in us.all_blocked_triples() if spot in us.spot_notes]
        self.assertEqual(len(unsure), 12)
        self.assertIn(("Q", "Y", "Space"), unsure)
        self.assertFalse(us.registers(["J", "H", "M"]))
        self.assertTrue(us.registers(["J", "M", "X"]))
        self.assertIn("ISO keyboards have ` here", us.explain(["Q", "Y", "space"]))

    def test_moved_keys_are_named_but_not_placed(self):
        for name in ("`", "grave", "Backquote", "code:50", "\\", "backslash", "kVK_ANSI_Backslash"):
            with self.assertRaises(KeyError) as e:
                self.us.key(name)
            self.assertIn("not placed", e.exception.args[0])
        with self.assertRaises(KeyError) as e:
            self.us.key("F1")
        self.assertIn("unknown key", e.exception.args[0])

    def test_geometry(self):
        geometry = {g[5]: g for g in kbmatrix.ansi_keyboard() if g[5]}
        self.assertEqual(sorted(geometry), sorted(self.us.order + list(self.us.unplaced)))
        self.assertEqual(geometry["Grave"][1:3], (0, 0.7))           # left of 1
        self.assertEqual(geometry["Backslash"][1:3], (13.5, 1.7))    # end of the Q row, above Return
        self.assertEqual(geometry["Z"][1:3], (2.25, 3.7))            # same place as on ISO
        self.assertIsNone(kbmatrix.return_path("ansi"))
        for layout in ("iso", "ansi"):                               # nothing overlaps or sticks out
            keys = kbmatrix.keyboard_geometry(layout)
            for (a, b) in itertools.combinations(keys, 2):
                overlap = a[1] < b[1] + b[3] - 1e-9 and b[1] < a[1] + a[3] - 1e-9 and \
                    a[2] < b[2] + b[4] - 1e-9 and b[2] < a[2] + a[4] - 1e-9
                self.assertFalse(overlap, f"{layout}: {a[0]} and {b[0]}")
            for g in keys:
                self.assertLessEqual(g[1] + g[3], kbmatrix.KB_W + 1e-9, g[0])

    def test_command_line(self):
        def run(*args):
            return subprocess.run([sys.executable, os.path.join(ROOT, "kbmatrix.py"), *args], capture_output=True, text=True)
        r = run("--layout", "us", "check", "J", "H", "M")
        self.assertEqual(r.returncode, 1)
        self.assertIn("holds N", r.stdout)
        r = run("--layout", "us", "check", "`", "J")
        self.assertEqual(r.returncode, 2)
        self.assertIn("not placed", r.stderr)
        r = run("--layout", "us", "validate")
        self.assertEqual(r.returncode, 0)
        self.assertIn("not measured", r.stdout)


class USKeyProbe(unittest.TestCase):
    @unittest.skipUnless(shutil.which("node"), "node is not installed")
    def test_events_and_report(self):
        subprocess.run(["node", os.path.join(ROOT, "tests", "test_us_key_test.js")], check=True, capture_output=True, text=True)

    @unittest.skipUnless(shutil.which("node"), "node is not installed")
    def test_pair_plan_distinguishes_every_observable_single_key_profile(self):
        script = "console.log(JSON.stringify(require(process.argv[1]).pairs))"
        pairs = json.loads(subprocess.run(["node", "-e", script, os.path.join(ROOT, "docs", "us-key-test.js")],
                                           check=True, capture_output=True, text=True).stdout)
        kb = kbmatrix.load(kbmatrix.ANSI_DATA)
        spots = [(r, c) for r in kb.rows + ["new-row"] for c in kb.columns + ["new-column"] if (r, c) not in kb.at]

        def profile(spot, held_pairs):
            probe = kbmatrix.Matrix(kb.data)
            probe.pos["test-key"] = spot
            return tuple(probe.triple_blocked(a, b, "test-key") for a, b in held_pairs)

        all_pairs = list(itertools.combinations(kb.order, 2))
        full_profiles = [profile(p, all_pairs) for p in spots]
        test_profiles = [profile(p, pairs) for p in spots]
        for i, j in itertools.combinations(range(len(spots)), 2):
            if full_profiles[i] != full_profiles[j]:
                self.assertNotEqual(test_profiles[i], test_profiles[j], f"test cannot distinguish {spots[i]} and {spots[j]}")


class Generated(unittest.TestCase):
    def test_docs_are_current(self):
        kb = kbmatrix.load()
        with tempfile.TemporaryDirectory() as docs, tempfile.TemporaryDirectory() as data:
            fresh_dirs = {"docs": docs, "data": data}
            committed_dirs = {"docs": kbmatrix.DOCS, "data": kbmatrix.DATA}
            for where, name in kbmatrix.build(kb, docs, data):
                with open(os.path.join(fresh_dirs[where], name), encoding="utf-8") as fresh, \
                        open(os.path.join(committed_dirs[where], name), encoding="utf-8") as committed:
                    self.assertEqual(fresh.read(), committed.read(), f"{where}/{name} is out of date: run kbmatrix.py build")

    @unittest.skipUnless(shutil.which("node"), "node is not installed")
    def test_javascript_matches_python(self):
        for layout in ("iso", "ansi"):
            with self.subTest(layout=layout):
                self.check_javascript(layout)

    def check_javascript(self, layout):
        kb = kbmatrix.load(kbmatrix.LAYOUT_DATA[layout])
        script = """
            global.window = global;
            require(process.argv[1] + "/docs/kb-data.js");
            const { Matrix } = require(process.argv[1] + "/docs/kbmatrix.js");
            const kb = new Matrix(KB[process.argv[2]].data);
            const out = [];
            const k = kb.order;
            for (let i = 0; i < k.length; i++) for (let j = i + 1; j < k.length; j++) for (let l = j + 1; l < k.length; l++)
                if (kb.tripleBlocked(k[i], k[j], k[l])) out.push([k[i], k[j], k[l]].join("+"));
            const combos = JSON.parse(require("fs").readFileSync(0, "utf8")).map(function (c) { return kb.registers(c); });
            console.log(JSON.stringify({ blocked: out, drop: kb.wouldDrop(["J", "M"]), combos: combos,
                                         six: kb.wouldDrop(["1", "2", "3", "4", "5", "6"]).length }));
        """
        rng = random.Random(7)
        combos = [rng.sample(kb.order, rng.randint(3, 8)) for _ in range(400)]
        res = json.loads(subprocess.run(["node", "-e", script, ROOT, layout], input=json.dumps(combos),
                                        capture_output=True, text=True, check=True).stdout)
        py = ["+".join(t) for t, _, _ in kb.all_blocked_triples()]
        self.assertEqual(sorted(res["blocked"]), sorted(py))
        self.assertEqual(res["drop"], kb.dropped_when_holding("J", "M"))
        self.assertEqual(res["combos"], [kb.registers(c) for c in combos])
        self.assertEqual(res["six"], len(kb.order) - 6)                # with 6 held, nothing else registers


if __name__ == "__main__":
    unittest.main()
