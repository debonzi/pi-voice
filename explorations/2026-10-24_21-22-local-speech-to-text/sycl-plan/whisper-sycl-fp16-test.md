# Controlled optional-FP16 SYCL comparison

Executed on 2026-10-25 after the requester explicitly asked to test FP16.

## Scope

A separate `build-sycl-fp16/` was configured from the same pinned whisper.cpp v1.9.5 source, enabling `GGML_SYCL_F16=ON`. The existing `build-sycl/` optional-FP16-OFF executable was preserved and reused as the current control.

No system package, source patch, library version, repository/global setting, model download, microphone capture, cloud inference, oneDNN, command-graph or other-model test was involved. Only the existing `medium` model and `recordings/prompt-002.wav` were used.

## Configuration and build checks

The configure command matches the full baseline recipe in [whisper-sycl-test.md](whisper-sycl-test.md), except:

- Build directory: `build-sycl-fp16/` instead of `build-sycl/`.
- `GGML_SYCL_F16=ON` instead of OFF.

The build used four workers rather than the baseline build's two; this changes compilation scheduling, not an inference configuration option. Compilation succeeded with the same types of upstream warnings and no compiler errors. The baseline executable remained at its original path/modification time.

A programmatic CMakeCache check verified equal compiler, build type, native/OpenMP settings, library mode, Intel SYCL target, oneDNN/graph/AOT/memory options, and isolated Level Zero headers/loader paths. Actual target definitions include `GGML_SYCL_F16`, while oneDNN remains `GGML_SYCL_DNNL=0`.

The runtime remained:

- oneAPI compiler/runtime 2025.3.2 and installed oneMKL SYCL BLAS.
- Isolated Level Zero 1.24.1 loader/layers; system libze1 unchanged.
- Intel Arc selected through `ONEAPI_DEVICE_SELECTOR=level_zero:gpu`, device 0.
- `SYCL_CACHE_PERSISTENT=0` to retain the previously validated workaround.
- Same language pt, 8 threads, default beam size 5/temperature 0, no prompt, no timestamps and default flash-attention request.
- Same XDG/SYCL cache directory; caches were not cleared and every measurement launched a separate process including model loading.

FP16 here means the backend's optional half-precision GEMM path, not a declaration that all model storage/arithmetic is uniformly FP16 or that the baseline was uniformly FP32.

## Execution

First FP16 invocation succeeded in **58.52 seconds**, with no generated-output differences from the earlier SYCL baseline. It was retained separately, not pooled with repeat medians. This is not a rigorously controlled cold-start comparison; initialization/JIT time was not measured separately.

Then three new controls and three FP16 runs were alternated in order OFF/ON, ON/OFF, OFF/ON. All seven processes exited with shell status 0 and completed transcription.

Runtime diagnostics confirm `GGML_SYCL_F16: yes` for ON and `no` for OFF, `using SYCL0 backend`, Intel Arc Level Zero, and approximately 1533.14 MB model allocation on SYCL0. The first FP16 process's dynamic-linker trace confirms the actual isolated loader and tracing layer were initialized.

## Timing results

All values include process startup/model loading.

| Configuration | Run 1 | Run 2 | Run 3 | Median wall |
| --- | ---: | ---: | ---: | ---: |
| Optional FP16 OFF, fresh controls | 31.99 s | 32.33 s | 32.11 s | **32.11 s** |
| Optional FP16 ON | 31.12 s | 29.80 s | 29.66 s | **29.80 s** |

Observed median elapsed reduction: **7.19%** (2.31 seconds), equivalent to approximately **1.078x** throughput for these full invocations.

| Median engine component | OFF | ON |
| --- | ---: | ---: |
| Encoder | 17.527 s | 18.471 s |
| Batch decoding | 12.063 s | 8.319 s |

The encoder did not accelerate in these measurements; reduced batch-decoding time outweighed its higher measured duration. Do not describe optional FP16 as uniformly accelerating every stage.

No fresh CPU/Vulkan runs were executed in this comparison. Background load, power and thermals were not strictly controlled, and only one audio sample with three comparison trials per setting was used. This is a modest observed improvement, not proof of a universal or maximum-performance configuration. Peak process RSS in raw metrics is not complete integrated-GPU memory consumption.

## Transcript and fidelity

All seven transcripts, including the first FP16 invocation and current OFF controls, are byte-identical. They also match the earlier successful SYCL transcript:

> neste projeto eu pretendo criar uma extensão para pi.dev que vai escutar tudo o que eu estou falando e transcrever para o prompt do pai. O enter não deve ser pressionado automaticamente, o texto deve ficar disponível para que eu possa editar e no momento que eu achar que está bom o suficiente pode sim submeter o modelo. Você consegue entender tudo isso que eu estou falando?

The optional-FP16 change did not introduce an observed word/punctuation change on this sample. It preserves the sentence punctuation and submission clause, but does **not** fix the “prompt do pai” substitution. There is no claim of numerical equivalence or unchanged transcription accuracy on other audio, and no WER was computed against an independently established full reference.

## Reproduction

Use the baseline configure/build environment and flags from [whisper-sycl-test.md](whisper-sycl-test.md), substituting the build directory and FP16 option above. Keep the isolated loader selected and persistent SYCL cache disabled.

After activating that environment, a new output stem can be used:

```bash
STEM=prompt-002-medium-sycl-fp16-manual-new
GGML_SYCL_DEVICE=0 SYCL_CACHE_PERSISTENT=0 \
  /usr/bin/time -f 'wall_seconds=%e\nmax_rss_kib=%M\nexit_status=%x' \
    -o "$EXP/results/$STEM-metrics.txt" \
    "$EXP/build-sycl-fp16/bin/whisper-cli" \
      --model "$EXP/models/ggml-medium.bin" \
      --file "$EXP/recordings/prompt-002.wav" \
      --language pt --threads 8 --device 0 --no-timestamps \
      > "$EXP/results/$STEM.txt" \
      2> "$EXP/sycl-plan/logs/$STEM.stderr.log"
```

## Evidence

Paths are relative to the exploration root:

- `sycl-plan/logs/whisper-sycl-fp16-configure.log`, `whisper-sycl-fp16-build.log`, `whisper-sycl-fp16-oneapi-env.txt`.
- `build-sycl-fp16/CMakeCache.txt` and actual `ggml-sycl.dir/flags.make`.
- `results/prompt-002-medium-sycl-fp16-first.txt`, matching metrics/status files and stderr log.
- `sycl-plan/logs/whisper-sycl-fp16-first-linker.1130617`.
- `results/prompt-002-medium-sycl-fp16-run-N.txt`, matching metrics/status files and stderr logs, N=1/2/3.
- `results/prompt-002-medium-sycl-fp16-off-control-run-N.txt`, matching metrics/status files and stderr logs, N=1/2/3.
- `results/prompt-002-medium-sycl-fp16-comparison.json`: all timings, settings, text, repeatability checks, input checksum, calculations and limitations.

## Conclusion

Optional FP16 provides a **small speed improvement without changing this sample's transcript**. It is a reasonable candidate for subsequent controlled experiments, not an automatically selected permanent default. oneDNN, graphs, AOT, decoder changes, quantization and further variants remain unexecuted and are not authorized by this result.
