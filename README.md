# 8-bit computational substrates

This repository contains the code that supplements the article https://arxiv.org/abs/2406.19108

It implements a variant of the z80 2D grid experiment (Figure 12).

## Usage
Run a local web server (e.g. `python3 -m http.server 8000`) and navigate the browser to `localhost:8000`

## Dependencies
* a modified version of z80 emulator is located in the `external` folder
* [zig](https://ziglang.org/) compiler is used to build the WASM code (`./build.sh`)
