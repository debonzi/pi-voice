# Process-isolated Level Zero 1.24.1 experiment

## Objective and authorization

The requester explicitly authorized option 1: build a newer Level Zero loader inside the exploration and use it only for a subprocess to test whether it resolves SYCL device enumeration. This did not authorize replacing the system loader or changing other package versions.

## Outcome

**Passed:** `sycl-ls`, using this loader and the already installed oneAPI 2025.3.2 environment, exited with status 0 and enumerated the Intel GPU through Level Zero:

```text
[level_zero:gpu] Intel(R) oneAPI Unified Runtime over Level-Zero, Intel(R) Arc(TM) Graphics 12.71.4 [1.6.35096+9]
```

The previous default-loader invocation had crashed in tracing initialization. The new successful invocation changes the loader/layers only for the experimental process. This strongly supports the loader/runtime incompatibility diagnosis and demonstrates a working enumeration workaround. It does **not** yet prove oneMKL GPU computation or Whisper transcription works or meets latency/fidelity requirements.

## Source provenance

- Upstream tag: `v1.24.1` (the upstream release is marked prerelease).
- Exact commit: `a81800177d8bea09bbd03d36d1ba066d7e844204`.
- Archive URL: `https://codeload.github.com/oneapi-src/level-zero/tar.gz/a81800177d8bea09bbd03d36d1ba066d7e844204`.
- Archive SHA-256: `87e9d40f282926fb3c6abca98b73c5725796e9e44e9009bdd5d03e94426d2af7`.
- Built loader SHA-256: `b3f806cea94e122c9c0a8cd616b05bc2302d425b3f3a03ee19576615a1078600`.

Revision 1.24.1 is also the Level Zero build component named in the already selected Intel GPU Compute Runtime 25.35.35096.9 release. This is provenance, not an end-to-end vendor certification of this machine/kernel.

## Build and installation scope

Source, build tree, temporary files and non-system installation prefix are all under this directory:

- `source/`
- `build/`
- `tmp/`
- `prefix/`

CMake 3.28.3 and the existing GCC/G++ 13.3.0 built the dynamic loader and matching tracing/validation layers, using bundled spdlog headers. Tests were disabled, so no googletest fetch/test run occurred. The example binary was compiled by the default build but not executed. No upstream source edits were made. Optional Git discovery was disabled to avoid embedding the enclosing pi-voice repository's revision into an archive build.

No compiler warnings/errors were found in the captured configure/build logs. Non-privileged `cmake --install` installed **22 manifest entries**, all verified to be inside `prefix/`. No sudo, ldconfig, APT operation, package update, or write into `/usr`/`etc` was performed in this step.

Reproduce the build from the pi-voice repository root:

```bash
EXP="$PWD/explorations/2026-10-24_21-22-local-speech-to-text"
ROOT="$EXP/sycl-plan/level-zero-1.24.1"
TMPDIR="$ROOT/tmp" XDG_CACHE_HOME="$EXP/cache/sycl" \
  cmake -S "$ROOT/source" -B "$ROOT/build" \
    -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_C_COMPILER=/usr/bin/gcc -DCMAKE_CXX_COMPILER=/usr/bin/g++ \
    -DCMAKE_INSTALL_PREFIX="$ROOT/prefix" -DCMAKE_INSTALL_LIBDIR=lib \
    -DBUILD_L0_LOADER_TESTS=OFF -DBUILD_STATIC=OFF -DSYSTEM_SPDLOG=OFF \
    -DCMAKE_DISABLE_FIND_PACKAGE_Git=TRUE
TMPDIR="$ROOT/tmp" cmake --build "$ROOT/build" --parallel 4
cmake --install "$ROOT/build"
```

## Process-local selection and verification

The oneAPI setup script was sourced only in the verification shell. The isolated prefix was then prepended to LD_LIBRARY_PATH **after** oneAPI setup. XDG/SYCL cache paths were directed into the exploration.

A basic reproduction command is:

```bash
EXP="$PWD/explorations/2026-10-24_21-22-local-speech-to-text"
ROOT="$EXP/sycl-plan/level-zero-1.24.1"
source /opt/intel/oneapi/setvars.sh
LD_LIBRARY_PATH="$ROOT/prefix/lib:${LD_LIBRARY_PATH:-}" \
  XDG_CACHE_HOME="$EXP/cache/sycl" SYCL_CACHE_DIR="$EXP/cache/sycl" \
  ONEAPI_DEVICE_SELECTOR=level_zero:gpu sycl-ls
```

Actual verification additionally enabled process-local `LD_DEBUG=libs` with output inside the exploration. The captured dynamic-linker log confirms initialization of both:

- `prefix/lib/libze_loader.so.1`
- `prefix/lib/libze_tracing_layer.so.1`

Thus success was not inferred merely from an environment variable or from OpenCL/CPU fallback. The output specifically reports Level Zero and Intel Arc graphics. Stderr contains only the expected note about the ONEAPI_DEVICE_SELECTOR filter.

## System state preserved

Post-test package checks still report:

- `libze1` / `libze-dev`: **1.16.1-1build1**.
- `libze-intel-gpu1`: **25.35.35096.9-0**, unchanged from the approved installation.
- The default `/lib/x86_64-linux-gnu/libze_loader.so.1` still resolves to `/usr/lib/x86_64-linux-gnu/libze_loader.so.1.16.0` (the library filename shipped in the Ubuntu package).

No persistent LD_LIBRARY_PATH, shell startup setting, or global loader registration was changed. The original default-loader failure was not deliberately reproduced again; the successful workaround requires selecting the isolated prefix in each relevant experimental process.

## Evidence

Paths below are relative to the parent `sycl-plan/` directory:

- `logs/isolated-loader-configure.log`
- `logs/isolated-loader-build.log`
- `logs/isolated-loader-install.log`
- `level-zero-1.24.1/build/install_manifest.txt`
- `level-zero-1.24.1/source-archive-sha256.txt`
- `level-zero-1.24.1/loader-library-sha256.txt`
- `logs/isolated-loader-oneapi-env.txt`
- `logs/isolated-loader-sycl-ls.txt`
- `logs/isolated-loader-sycl-ls.stderr.log`
- `logs/isolated-loader-sycl-ls-status.txt`
- `logs/isolated-loader-linker.1111596`

## Remaining validation

No whisper.cpp SYCL build, GPU computation smoke program, audio recording, or transcription was executed in this loader experiment. The next stage is to build whisper.cpp separately with the selected SYCL compiler/MKL and use this same isolated loader for its build/runtime checks, then compare the existing medium/prompt-002 case. Any additional dependency or system change requires consultation rather than an automatic upgrade.
