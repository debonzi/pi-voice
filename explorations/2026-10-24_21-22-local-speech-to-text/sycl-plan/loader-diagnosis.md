# Level Zero loader failure: diagnosis and proposed remedies

## Scope

This records research requested after the installed SYCL stack failed device enumeration. Only public-source research and static inspection were performed during that diagnostic phase; no remedy was executed then. A separately authorized follow-up on 2026-10-25 subsequently built an isolated loader and passed enumeration, as summarized at the end and in the linked execution record.

## Stronger diagnosis: internal tracing ABI mismatch

Observed failure from the previous verification: SIGSEGV inside `zelLoaderTracingLayerInit()` in Ubuntu libze1 1.16.1, called by the oneAPI 2025.3.2 Level Zero adapter.

Verified upstream source:

- [Loader v1.16.1](https://github.com/oneapi-src/level-zero/blob/v1.16.1/source/loader/ze_loader_api.cpp) exports `zelLoaderTracingLayerInit` with **three atomic-reference parameters**, for ze, zet and zes tables, and writes through all three.
- [PR #172](https://github.com/oneapi-src/level-zero/pull/172/files) changes this internal function to **one parameter**. The stated reason concerns tracing tables for zet/zes not being set up but used as though they were.
- The [v1.17.25 implementation](https://github.com/oneapi-src/level-zero/blob/v1.17.25/source/loader/ze_loader_api.cpp) already has the one-parameter form. This establishes that the change exists in that version, not a universal minimum for every other requirement of the installed stack.
- A [newer embedded caller](https://github.com/oneapi-src/level-zero/blob/35c037cdf4aa9a2e6df34b6f1ce1bdc86ac5422f/source/lib/ze_lib.cpp), pinned by the Intel LLVM v6.3.0 open-source dependency configuration, resolves this function by name and calls it with one argument. The source illustrates the incompatible calling convention; commercial-version mapping is not assumed solely from the tag name.

Static inspection of the actual installed binaries adds supporting evidence:

- Ubuntu's function at ELF address `0x269d0` stores through RDI, RSI, then RDX. The previously captured crash is at the instruction corresponding to offset **+0x2a**, `0x269fa: xchg %rax,(%rdx)`, the third-parameter store.
- The installed oneAPI adapter contains and dynamically resolves the string `zelLoaderTracingLayerInit` inside `ze_lib::context_t::Init`.
- No tracing/legacy-adapter override variables were set in the parent environment inspected.

**Assessment:** a high-confidence internal ABI-mismatch explanation is substantially stronger than the earlier generic initialization-order hypothesis. Resolving a function name successfully does not establish compatible argument signatures. This explains why package dependency resolution and symbol presence were insufficient checks.

The actual installed caller's complete argument setup was not conclusively reconstructed in this static investigation. A compatible-loader device test remains necessary before declaring the issue fixed or asserting that no other runtime problem exists.

## Recommended first remedy: process-isolated newer loader

Build a newer Level Zero loader inside this exploration and select it only for the experimental subprocess through its library search path. **v1.24.1** is a concrete candidate because the already selected [Compute Runtime 25.35.35096.9](https://github.com/intel/compute-runtime/releases/tag/25.35.35096.9) lists that revision among its build components. That is not an end-to-end validation guarantee; its GitHub release is marked prerelease and has no binary assets. Any selected revision and checksums should be fixed before building.

This would preserve system libze1/libze-dev, the kernel, i915, Mesa, GPU compute runtime, compiler, oneMKL, and GMM. Use a non-system build/prefix or the built library directly; do not run sudo or ldconfig or overwrite `/usr/lib`. Verify which loader is actually loaded, then require successful `sycl-ls` enumeration of the Intel GPU through Level Zero before compiling Whisper.

The loader project can use existing CMake/GCC. Its source includes spdlog headers by default; optional tests fetch googletest, so disable tests for a bounded initial build. This is a proposal only: no source was downloaded/built for this remedy and no success is claimed.

## Alternative: process-local SYCL OpenCL adapter

OpenCL currently enumerates the GPU, so the SYCL OpenCL path is a reasonable diagnostic alternative using installed components. [Unified Runtime adapter discovery](https://oneapi-src.github.io/unified-runtime/core/INTRO.html#adapter-discovery) documents `UR_ADAPTERS_FORCE_LOAD`: explicit adapter library paths disable other discovery methods. The installed runtime recognizes this variable and supplies `libur_adapter_opencl.so.0`.

A proposed debug invocation would select that installed OpenCL adapter explicitly together with `ONEAPI_DEVICE_SELECTOR=opencl:gpu`, scoped to one process. This avoids assuming that selecting OpenCL alone necessarily prevents initialization of every problematic adapter. The documentation labels force-loading as development/debug functionality.

This remains SYCL on the GPU, but not the originally intended Level Zero path. Successful clinfo is not proof that SYCL/oneMKL inference through OpenCL works, and neither speed nor correctness is guaranteed. No such invocation was executed in this research phase.

## Alternative: system loader update after separate approval

If an isolated loader resolves the fault, a small, separately proposed libze1/libze-dev update could replace the experiment-local search-path override. It would require a concrete version, verified packages/dependency simulation, and explicit approval because it changes a component shared by other Level Zero applications. No newer system-loader package was installed or proposed as already validated.

## Options not recommended as blind fixes

- Do not upgrade/reinstall the entire oneAPI toolkit or graphics stack before testing the narrower loader hypothesis.
- Do not change kernel/i915/Mesa when OpenCL/Vulkan enumeration already succeeds and the trace localizes the failure above those layers.
- Do not patch the loader function or interpose a fake ABI shim as the first remedy.
- Do not present `ZE_ENABLE_TRACING_LAYER=0` as an established bypass: v1.16.1 loads/initializes the relevant tracing machinery outside that user flag's enable condition; no documented switch was found that skips the incompatible call.
- The documented `SYCL_UR_USE_LEVEL_ZERO_V2=0` selector is not a demonstrated fix: initialization common to the adapter happens before that choice, and Meteor Lake already favors the legacy path in the referenced source. Do not invent `UR_USE_LEVEL_ZERO_V2` as a supported spelling.

**Initial recommendation:** try the isolated compatible-loader hypothesis first, only after authorization to build and run that experiment. Keep all original package versions unchanged until evidence supports a narrowly scoped change.

## Subsequently authorized result — 2026-10-25

The requester approved option 1. An isolated v1.24.1 loader and matching tracing/validation layers were successfully built and placed under the exploration prefix, without system installation or package changes. A process-local library-path override allowed `sycl-ls` to enumerate Intel Arc through Level Zero and exit 0. Dynamic-linker logs verify that the isolated loader and tracing layer were actually initialized. This is direct experimental support for the loader incompatibility diagnosis and a working enumeration workaround, not validation of model inference or a guarantee that every future SYCL operation succeeds.

See [the execution record](level-zero-1.24.1/README.md) for revision/checksums, commands, logs, and preserved system state. Whisper SYCL compilation and transcription were not performed in this loader experiment.
