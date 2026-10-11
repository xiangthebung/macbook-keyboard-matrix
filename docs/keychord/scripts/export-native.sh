#!/bin/sh
# Compile current Core sources directly; this does not run SwiftPM or launch the app.
set -eu
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
native_dir=${1:-"$script_dir/../../../../key-chord"}
output=${2:-"$script_dir/../data.json"}
python3 "$native_dir/scripts/export-design.py" --web-dir "$script_dir/../.."
temp_dir=$(mktemp -d -t keychord-browser-export)
trap 'rm -rf "$temp_dir"' EXIT INT TERM
build_dir=${KEYCHORD_CORE_MODULE_DIR:-"$temp_dir"}
if [ -z "${KEYCHORD_CORE_MODULE_DIR:-}" ]; then
  swiftc -O -parse-as-library -whole-module-optimization -module-name KeyChordCore \
    -emit-object -emit-module -emit-module-path "$build_dir/KeyChordCore.swiftmodule" \
    "$native_dir"/Sources/KeyChordCore/*.swift -o "$build_dir/KeyChordCore.o"
fi
export_bin="$temp_dir/export"
swiftc -O -I "$build_dir" "$script_dir/export-native.swift" "$build_dir/KeyChordCore.o" -o "$export_bin"
"$export_bin" "$native_dir" "$output"
