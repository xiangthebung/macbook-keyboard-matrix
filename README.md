# KeyChord website and MacBook keyboard matrix

[KeyChord practice](https://xiangthebung.github.io/macbook-keyboard-matrix/keychord/) and the [keyboard matrix explorer](https://xiangthebung.github.io/macbook-keyboard-matrix/) share this static website. GitHub Actions tests the browser app and matrix before publishing `docs/` to GitHub Pages.

KeyChord includes the current native English/C++ course, word and timed practice, voice practice, a custom chord editor, reference, and a local text editor. The [Mac app download](https://xiangthebung.github.io/macbook-keyboard-matrix/keychord/downloads/KeyChord.zip) is built from the same native source snapshot as the exported browser data. Its source is in [key-chord](https://github.com/xiangthebung/key-chord).

## Preview and checks

```sh
python3 -m http.server 8767 --bind 127.0.0.1 --directory docs
# Open http://127.0.0.1:8767/keychord/
node --test docs/keychord/tests/*.mjs
python3 -m unittest discover -s tests
node tests/test_us_key_test.js
```

## Sync the native app

Keep the native repository beside this checkout as `../key-chord`. On macOS with Swift available:

```sh
sh docs/keychord/scripts/export-native.sh ../key-chord
python3 scripts/stamp-assets.py
node --test docs/keychord/tests/*.mjs
```

The exporter compiles the current Swift Core sources and exports bundled mappings, courses, geometry, vocabularies, reference content, and native behavior fixtures. It reads no user settings or practice text. Browser runtime changes and the Mac download must also be reviewed when native behavior changes. `docs/keychord/sync.json` records the published source and download fingerprints.

See [browser documentation](docs/keychord/README.md) and [validation](docs/keychord/validation.md). Word list attribution and license are included in [licenses/WordLists](docs/keychord/licenses/WordLists).
