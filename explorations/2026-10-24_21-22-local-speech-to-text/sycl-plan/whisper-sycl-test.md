# Whisper medium on SYCL / Intel Arc

Executed on 2026-10-25 after the requester authorized the next stage: compile whisper.cpp with SYCL using the isolated loader and transcribe the existing prompt-002 recording.

## Scope and outcome

**The build and transcription succeeded**, with a process-local workaround disabling the optional persistent SYCL device-code cache. The default-loader ABI problem remains avoided through the isolated Level Zero prefix.

Only `recordings/prompt-002.wav` was used. No new system package, repository change, system library update, global environment setting, source patch, microphone capture, or cloud inference was performed. CPU and Vulkan executables were preserved. The oneAPI environment and cache/library overrides apply only to experimental subprocesses.

## Build

- Source: existing pinned whisper.cpp v1.9.5 / ggml 0.26.0 archive.
- Build directory: `build-sycl/`, separate from CPU/Vulkan.
- Compiler: Intel icx/icpx 2025.3.2.
- GPU numerical library: installed oneMKL SYCL BLAS, package version 2025.3.1-8; selected path `/opt/intel/oneapi/mkl/2025.3`.
- Loader and headers: isolated Level Zero 1.24.1 prefix, not the system 1.16.1 package.
- Release build, native CPU optimization, static project libraries, two compilation workers.
- Enabled: SYCL Intel backend, direct Level Zero API.
- Disabled: optional FP16 GEMM (`GGML_SYCL_F16=OFF`), oneDNN, SYCL graphs, CUDA, Vulkan, SDL2, tests, server, ccache, model downloads.
- Flash attention was left at the same CLI default as prior tests; FP16 OFF does not make every model operation/storage uniformly FP32.

Configure/build completed successfully. Warnings include an unused upstream parameter, deprecated SYCL parallel_for interfaces, and conflicting/ignored kernel properties. No warning was patched or suppressed. Optional MKL MPI/distributed targets were unavailable but not needed by the BLAS target. The MKL CMake metadata prints 2025.3.0 despite the installed package being 2025.3.1-8; the actual package/path selection was retained, not changed to address this metadata difference.

Important diagnostic quirk: the executable prints `GGML_SYCL_DNNL: yes` because the upstream diagnostic tests whether the macro is defined rather than whether its value is nonzero. Actual build flags are `GGML_SYCL_DNNL=0`, CMake reports oneDNN disabled, and the relevant operation code uses value-based checks. Do not interpret that log line as an unapproved oneDNN installation.

### Configure/build reproduction

From the pi-voice repository root:

```bash
EXP="$PWD/explorations/2026-10-24_21-22-local-speech-to-text"
L0="$EXP/sycl-plan/level-zero-1.24.1/prefix"
source /opt/intel/oneapi/setvars.sh
export LD_LIBRARY_PATH="$L0/lib:${LD_LIBRARY_PATH:-}"
export ONEAPI_DEVICE_SELECTOR=level_zero:gpu
export TMPDIR="$EXP/tmp/sycl"
export XDG_CACHE_HOME="$EXP/cache/sycl"
export SYCL_CACHE_DIR="$EXP/cache/sycl"
export SYCL_CACHE_PERSISTENT=0
cmake -S "$EXP/source/whisper.cpp" -B "$EXP/build-sycl" \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_C_COMPILER=/opt/intel/oneapi/compiler/2025.3/bin/icx \
  -DCMAKE_CXX_COMPILER=/opt/intel/oneapi/compiler/2025.3/bin/icpx \
  -DCMAKE_PREFIX_PATH="$L0;$MKLROOT;$CMPLR_ROOT;$TBBROOT" \
  -DCMAKE_BUILD_RPATH="$L0/lib" \
  -DWHISPER_BUILD_IS_DEV=OFF -DBUILD_SHARED_LIBS=OFF \
  -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_EXAMPLES=ON \
  -DWHISPER_BUILD_SERVER=OFF -DWHISPER_CURL=OFF -DWHISPER_SDL2=OFF \
  -DGGML_NATIVE=ON -DGGML_CCACHE=OFF \
  -DGGML_CUDA=OFF -DGGML_VULKAN=OFF \
  -DGGML_SYCL=ON -DGGML_SYCL_TARGET=INTEL \
  -DGGML_SYCL_F16=OFF -DGGML_SYCL_DNN=OFF -DGGML_SYCL_GRAPH=OFF \
  -DGGML_SYCL_SUPPORT_LEVEL_ZERO_API=ON \
  -DLEVEL_ZERO_DEV_INCLUDE_DIR="$L0/include" \
  -DZE_LOADER_LIB="$L0/lib/libze_loader.so" \
  -DGGML_OPENMP_FETCH=OFF
cmake --build "$EXP/build-sycl" --parallel 2 --target whisper-cli
```

## First attempt: optional persistent-cache failure

The first inference attempt enabled `SYCL_CACHE_PERSISTENT=1` to prepare later cache-reusing measurements. This was an experiment-selected option, not a required model/backend setting. Enumeration, model allocation and backend selection succeeded, then the process crashed before generating text.

A local, network-disabled GDB reproduction with the same parameters failed in:

```text
strcmp
sycl::_V1::detail::getSortedImages(...)
sycl::_V1::detail::PersistentDeviceCodeCache::getItemFromDisc(...)
sycl::_V1::detail::ProgramManager::getOrCreateURProgram(...)
...
convert_unary_sycl<half, float>(...)
ggml_sycl_op_mul_mat_sycl(...)
```

This is a separate failure from the earlier loader tracing ABI crash. The runtime had already enumerated the Intel GPU, allocated approximately 1533.14 MB on SYCL0, selected the correct isolated loader/layer, and read the target audio.

The first process terminated with signal 11 / shell exit 139 after 2.58 seconds, with an empty transcript. The raw GNU time report misleadingly includes `exit_status=0` as well as `Command terminated by signal 11`; the actual shell status and signal take precedence. `results/prompt-002-medium-sycl-first-status.json` explicitly records failure. **That duration is excluded from performance comparisons.**

## Process-local workaround and successful execution

[The compiler's documented environment controls](https://github.com/intel/llvm/blob/v6.3.0/sycl/doc/EnvironmentVariables.md) say persistent caching is optional, default OFF, and `SYCL_CACHE_PERSISTENT=0` disables it.

Only that variable was changed for the retry. No cache files were deleted, no library/package changed, no source edited, and no rebuild performed. Disabling the optional persistent cache allowed transcription to finish. A first successful invocation plus three subsequent independent processes all succeeded and returned byte-identical text.

The evidence supports a persistent-cache-path workaround on this workload, not a repaired runtime cache implementation. Driver caches were not manually disabled or cleared.

### Verified execution path

- Intel Arc Graphics, architecture version 12.71, Level Zero driver string `1.6.35096+9`.
- `using SYCL0 backend` and approximately 1533.14 MB model allocation on SYCL0.
- `GGML_SYCL_F16: no`; direct Level Zero API enabled.
- ldd resolves libze_loader to the isolated prefix and oneMKL/SYCL/TBB libraries to the selected installed component paths.
- Dynamic-linker traces confirm the isolated loader **and matching tracing layer** for both the failed and successful first invocations. The new failure was not a silent return to the system loader.
- All four successful process statuses are explicitly recorded as 0 in separate status files.

### Successful runtime reproduction

After activating the environment as above, use a new artifact stem to avoid overwriting existing evidence:

```bash
STEM=prompt-002-medium-sycl-manual-new
GGML_SYCL_DEVICE=0 SYCL_CACHE_PERSISTENT=0 \
  /usr/bin/time -f 'wall_seconds=%e\nmax_rss_kib=%M\nexit_status=%x' \
    -o "$EXP/results/$STEM-metrics.txt" \
    "$EXP/build-sycl/bin/whisper-cli" \
      --model "$EXP/models/ggml-medium.bin" \
      --file "$EXP/recordings/prompt-002.wav" \
      --language pt --threads 8 --device 0 --no-timestamps \
      > "$EXP/results/$STEM.txt" \
      2> "$EXP/sycl-plan/logs/$STEM.stderr.log"
```

## Transcript, unedited

> neste projeto eu pretendo criar uma extensão para pi.dev que vai escutar tudo o que eu estou falando e transcrever para o prompt do pai. O enter não deve ser pressionado automaticamente, o texto deve ficar disponível para que eu possa editar e no momento que eu achar que está bom o suficiente pode sim submeter o modelo. Você consegue entender tudo isso que eu estou falando?

All four successful transcripts were byte-identical. Compared with the historical medium CPU output, the only textual difference is **“prompt do pi” → “prompt do pai”**, verified programmatically. This is not an assertion that the CPU reference is perfect or a full verbatim transcription; no WER was computed.

The SYCL result preserves the CPU-like sentence punctuation and submission clause, unlike the tested medium Vulkan output. It nevertheless retains a technical-name substitution. This does not establish a uniformly superior transcript or resolve every dictated-prompt concern.

## Timing

Audio: 38.142125 seconds, mono PCM 16-bit at 16 kHz. All successful timings include process startup/model loading; each invocation is a new process, not a persistent loaded-model service.

| Successful SYCL run | Wall time | Encoder time |
| --- | ---: | ---: |
| First, kept separate | 61.17 s | 30.599 s |
| Subsequent 1 | 31.29 s | 17.824 s |
| Subsequent 2 | 33.32 s | 19.571 s |
| Subsequent 3 | 34.78 s | 19.579 s |
| Subsequent median | **33.32 s** | **19.571 s** |

The first observed successful invocation may include initial JIT/setup costs, but these were not measured independently. Do not attribute the entire difference to JIT or label all later processes fully warm under controlled cache conditions.

Historical reference medians, **not rerun in this round**:

- CPU medium: 36.33 seconds.
- Vulkan medium: 9.77 seconds.

These are not contemporaneous controls, and system runtime preparation has occurred since the earlier measurements. Thermals, load and power were not controlled. Consequently, the small apparent difference versus CPU is not evidence of a robust speedup. This correctness-oriented SYCL configuration is also not a maximum-performance comparison: optional FP16 GEMM, oneDNN and command graphs were disabled.

Peak RSS is retained in raw metrics but is not total integrated-GPU/system memory usage.

## Evidence

Paths are relative to the exploration root:

- `sycl-plan/logs/whisper-sycl-configure.log`, `whisper-sycl-build.log`, `whisper-sycl-oneapi-env.txt`, `whisper-sycl-ldd.txt`.
- `results/prompt-002-medium-sycl-first.txt`: empty failed output; matching metrics and `-status.json` preserve the signal failure.
- `sycl-plan/logs/prompt-002-medium-sycl-first.stderr.log`, `prompt-002-medium-sycl-gdb.txt`.
- `sycl-plan/logs/whisper-sycl-first-linker.1118553` and `whisper-sycl-no-persistent-cache-linker.1119482`: actual loader/layer selections.
- `results/prompt-002-medium-sycl-no-persistent-cache-first.txt`, matching metrics/status files and stderr log.
- `results/prompt-002-medium-sycl-no-persistent-cache-run-N.txt`, matching metrics/status files and stderr logs, N=1/2/3.
- `results/prompt-002-medium-sycl-comparison.json`: configuration, failed attempt exclusion, successful timings/transcripts, repeatability, comparisons and limitations.

## Conclusion and remaining questions

Whisper medium **does execute on this Intel GPU through SYCL** with the isolated Level Zero loader and persistent SYCL cache disabled. It preserves more punctuation than the tested medium Vulkan configuration, but has no convincing latency advantage over the historical CPU baseline and still substitutes “pai” for the intended technical name in one location. At the end of this baseline phase, no optional-FP16, oneDNN, no-flash-attention, graph, compiler-version, or other-model variant had been executed. A subsequently authorized optional-FP16 comparison is recorded separately in [whisper-sycl-fp16-test.md](whisper-sycl-fp16-test.md). No further tuning or system change is authorized merely by this conclusion.

## Maximum-performance investigation: proposed next tests

The requester subsequently asked what is needed to test maximum performance. This follow-up only inspected the current build/source and simulated optional oneDNN dependencies; no variant was compiled/run and no package installed.

There is no proven universal maximum-performance switch for this model/GPU. The relevant objective is the lowest measured usable transcription latency, with first-use cost and fidelity reported, rather than assuming every optional feature helps.

### Prioritized options

1. **Optional FP16 GEMM:** create a separate build with `GGML_SYCL_F16=ON`, leaving the medium model, input, decoder settings, oneDNN/graphs choices and isolated-loader workaround unchanged. No new package is needed. The current OFF path converts certain non-F32 inputs to F32 for GEMM; enabling the option changes available arithmetic paths and may improve speed, but can change words/punctuation. This is the first proposed comparison, not a guaranteed win.
2. **Matched oneDNN:** the controlled APT simulation for `intel-oneapi-dnnl-devel-2025.3=2025.3.0-409`, using the existing local version preferences, selects exactly two new packages (the development package plus `intel-oneapi-dnnl-2025.3` at the same version), zero upgrades and zero removals. Their metadata totals 16,514,190 downloaded bytes and 107,478 KiB installed (approximately 16.5 MB / 105 MiB). Installing these requires separate approval. A new build with `GGML_SYCL_DNN=ON` can test additional optimized kernels, separately and combined with optional FP16. The available package does not establish every operation's device support or a speed benefit on Meteor Lake.
3. **SYCL command graphs:** compile with graph support and then request it at runtime, checking actual graph eligibility/fallback. The backend requires appropriate device/compiler support and can reject graphs containing unsupported operations. No additional package is established as necessary for this build option, but it is experimental and not an assumed improvement.
4. **Cold-start/JIT reduction:** investigate architecture-specific ahead-of-time compilation via `GGML_SYCL_DEVICE_ARCH` later, validating the Meteor Lake target and any additional ocloc tooling before proposing installation. AOT primarily targets initialization/JIT overhead, not guaranteed faster steady-state compute. Do not re-enable the currently crashing persistent SYCL cache merely for a more favorable timing.

Flash attention, native/Release CPU compilation, direct Level Zero access, and several runtime fusion/ESIMD/memory optimizations are already enabled. Listing them as new optimizations or enabling every environment flag would misrepresent the baseline. This Xe-LPG GPU has no dedicated XMX engines, so XMX-based speedups from discrete Arc or newer generations cannot be assumed.

### Measurement plan, not executed

Use separate build/artifact directories and add one feature at a time. Begin with the existing baseline versus FP16 only; then oneDNN only and FP16 plus oneDNN if installation is approved; evaluate graphs/AOT only afterward. Keep the same medium file and prompt-002 audio and unchanged decoding settings. Do not silently lower beam size or quantize/switch models and attribute the difference to a backend optimization.

For each viable variant, inspect output words, punctuation, negation and technical names, then repeat successful processes under comparable load/power/thermal conditions and collect fresh CPU/Vulkan references if ranking backends. Separate first-use and subsequent-process times, distinguish full invocation latency from already-initialized compute, and make all cache settings explicit. Thread counts such as 2/4/8 can be a later controlled axis, not a simultaneous untracked change.

No maximum-performance result or speedup factor is established by this proposal. No power profile, governor, clock, persistent environment setting, compiler/library version, or system cache was changed for this analysis.

### Subsequently authorized FP16 result — 2026-10-25

The requester explicitly authorized the first proposed variant. A separate optional-FP16-ON build succeeded, preserving the baseline. Three fresh OFF controls and three ON trials on the same medium/prompt-002 case produced median full invocation times **32.11 s OFF versus 29.80 s ON**, approximately **7.19% less elapsed time**. The first ON invocation was kept separate at 58.52 s.

All seven output transcripts were byte-identical and match the earlier successful SYCL output, including punctuation and the remaining “prompt do pai” substitution. No package installation, global setting, source patch, oneDNN, graph, AOT or other model was involved. The gain is modest and sample-specific; the encoder itself did not accelerate in the measured component timings.

Full configuration checks, reproduction, timings and limitations: [whisper-sycl-fp16-test.md](whisper-sycl-fp16-test.md).
