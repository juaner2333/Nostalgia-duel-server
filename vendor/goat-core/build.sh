#!/usr/bin/env bash
set -euo pipefail

core_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
build_dir="$(mktemp -d)"
trap 'rm -rf -- "$build_dir"' EXIT

tar -xzf "$core_dir/ocgcore-source.tar.gz" -C "$build_dir"
cd "$build_dir"
git apply "$core_dir/rulings.patch"
cp premake/lua.lua lua/premake5.lua
cp premake/dll.lua dll.lua
premake5 gmake --file=dll.lua --os=emscripten
make -C build config=release_wasm_cjs -j "${JOBS:-4}"
install -m 644 build/bin/wasm_cjs/Release/libocgcore.{cjs,wasm} "$core_dir/"
