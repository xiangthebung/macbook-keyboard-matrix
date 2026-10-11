# KeyChord online

[Open KeyChord](https://xiangthebung.github.io/macbook-keyboard-matrix/keychord/). The [keyboard matrix](https://xiangthebung.github.io/macbook-keyboard-matrix/) remains at the site root. GitHub Actions publishes the static `docs` directory after browser and matrix checks pass.

Words offers the native English, English 5k, and English 25k vocabularies; 10/25/50/100-word sessions; 15/30/60/120-second sessions; live WPM, accuracy and remaining counts; and a speed graph. Timing starts with inserted text and continues while another section is open. Corrected errors retain their accuracy cost. Physical suffix previews follow the native planner without being scored as ordinary mistakes.

Lessons contains all 52 native lessons, organized by unit with language filtering, search and practiced badges. Hints show the active mapping and ANSI/ISO keyboard. Completion requires physical chord input. Voice runs ten spoken words, speaks hints and corrections, and advances after a correct answer. It uses browser speech synthesis and needs no microphone.

Custom Chords records physical key identity and supports English, C++, or both languages, words or exact spacing, enable/disable, removal with Undo, unused-chord suggestions, replacement previews, and an unsaved sandbox. Built-in commands and the Space modifier are protected. Removing or disabling an override restores its bundled meaning. Custom chords and preferences stay in this browser's local storage; unfinished practice and editor drafts stay in memory.

Reference searches the active mapping and includes the exported desktop manual. The editor supports English/C++ translation, Unicode selections, casing, snippets, and real chord Undo. Chord input belongs to a focused KeyChord field; typing into other applications requires the Mac app.

## Preview, export, and checks

Run these from the website repository root:

```sh
python3 -m http.server 8767 --bind 127.0.0.1 --directory docs
# http://127.0.0.1:8767/keychord/
sh docs/keychord/scripts/export-native.sh ../key-chord
python3 scripts/stamp-assets.py
node --test docs/keychord/tests/*.mjs
python3 -m unittest discover -s tests
node tests/test_us_key_test.js
```

The exporter builds the current native Core directly, including uncommitted source changes; it does not depend on an old `.build` module or launch the app. Native behavior fixtures verify translation actions, contexts, cursor positions, Undo, word sampling/scoring, custom validation and suggestions. See [core-api.md](core-api.md) and [validation.md](validation.md).

Native `Resources/design-system.json` and `Resources/presentation.json` generate the shared Swift/browser design contracts. The export runs `scripts/export-design.py`. To check without changes, run `python3 ../key-chord/scripts/export-design.py --web-dir docs --check`.

## Mac download

[Download KeyChord.zip](downloads/KeyChord.zip). The archive contains `KeyChord.app`, built from the source snapshot recorded in [sync.json](sync.json). It targets Apple Silicon and macOS 14 or newer, and is ad-hoc signed. Global typing uses macOS Accessibility permission; the browser requires no Accessibility permission. Publication does not install or launch the app.

[Word list attribution and license](licenses/WordLists/README.md) are included in the website and app archive.
