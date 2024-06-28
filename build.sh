clear
FLAGS="-target wasm32-freestanding-musl -DWASM -lc -fno-entry -O ReleaseSmall"
cd wasm
zig build-exe main.c $FLAGS
zig build-exe z80worker.c ../external/z80.c $FLAGS
ls -lh *.wasm