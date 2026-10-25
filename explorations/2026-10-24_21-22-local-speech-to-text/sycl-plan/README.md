# Pinned SYCL setup: plan and execution

Prepared on 2026-10-24 for whisper.cpp v1.9.5, Intel Core Ultra 7 155H / Meteor Lake 8086:7d55, Ubuntu 24.04.5, i915, kernel 7.0.0-38-generic.

## Status and authorization boundary

**The approved packages are installed, and a subsequently approved process-isolated Level Zero 1.24.1 loader now passes Intel GPU enumeration.** The original default-loader check failed with SIGSEGV; the system loader remains unchanged. The original planning phase changed no system state. The requester separately authorized the global Intel APT repository and later the isolated-loader experiment. Actual system changes, the initial failure, and the successful isolated workaround are recorded below. Whisper SYCL compilation and medium inference subsequently succeeded with the isolated loader and optional persistent SYCL cache disabled; see [whisper-sycl-test.md](whisper-sycl-test.md).

The following plan is a historical dependency-resolved, source-checked proposal, not an Intel certification of this complete stack/kernel. All 45 planned package versions are now installed, but successful package resolution did not establish runtime interoperability. No SYCL whisper.cpp build or transcription has been attempted.

## Selected versions

| Component | Selection | Package/source |
| --- | --- | --- |
| DPC++/C++ compiler | 2025.3.2-832 | intel-oneapi-compiler-dpcpp-cpp-2025.3 and matching implementation/runtime packages |
| oneMKL SYCL development | 2025.3.1-8 | intel-oneapi-mkl-sycl-devel-2025.3, not the entire Base Toolkit |
| oneTBB | 2022.3.1-400 | intel-oneapi-tbb-devel-2022.3 and matching runtime |
| Intel GPU Compute Runtime | 25.35.35096.9-0 | Intel release intel-opencl-icd and libze-intel-gpu1 packages |
| Intel Graphics Compiler | 2.18.5 | Intel release intel-igc-core-2 and intel-igc-opencl-2; artifact filenames include build +19820 |
| Graphics Memory Management Library | 22.8.1 | Intel release libigdgmm12; this is an upgrade of an existing shared system library |
| Level Zero loader/development headers | 1.16.1-1build1 | Ubuntu libze1 and libze-dev |
| OpenCL diagnostics | 3.0.23.01.25-1build1 | Ubuntu clinfo |
| oneDNN | Omitted initially | Optional in the actual pinned whisper.cpp CMake configuration |

The complete 45-package version closure is in `package-lock.txt`; machine-readable sizes, origins and versions are in `package-plan.json`. A component name or metapackage pin alone is insufficient: its dependencies use minimum-version constraints and otherwise selected newer 2025.3.3 implementations and 2026.2 common helpers. The local `preferences` file prevents that drift, and the final simulation was checked against all 45 locked versions.

## Compatibility evidence and limits

1. Intel's [2025 Base Toolkit component table](https://www.intel.com/content/www/us/en/developer/articles/release-notes/oneapi-base-toolkit/2025.html) explicitly pairs compiler **2025.3.2**, oneMKL **2025.3.1**, and oneTBB **2022.3.1** in Toolkit 2025.3.1. Their version numbers intentionally do not all match.
2. [oneMKL 2025.3 system requirements](https://www.intel.com/content/www/us/en/developer/articles/system-requirements/oneapi-math-kernel-library-system-requirements-2025.html) identify compiler 2025.3 and oneTBB 2022.0+ and list Ubuntu 24.04 and Intel client graphics support.
3. [Compute Runtime 25.35.35096.9](https://github.com/intel/compute-runtime/releases/tag/25.35.35096.9) explicitly provides Ubuntu 24.04 packages, lists Meteor Lake as production quality, and pairs IGC 2.18.5 with GMM 22.8.1. The actual downloaded packages enforce IGC >=2.18 and <2.21 and GMM >=22.8.1; these constraints are satisfied by the selected versions. Their libc/libstdc++ dependencies resolve against this machine without core-library upgrades.
4. The release used Level Zero 1.24.1 as a **build component**. That is not documented as a required loader package minimum, nor should the library version be confused with the Level Zero specification version. The GPU runtime Debian packages do not impose a newer loader dependency. Ubuntu's loader/headers 1.16.1 resolve in this plan, but their actual interoperability with the SYCL runtime still needs the device smoke test; do not claim that an APT solution proves runtime interoperability.
5. To check a concrete source/header compatibility risk, compiler 2025.3.2's actual `device_architecture.def` was extracted from its verified common package. It contains the Meteor Lake H, Battlemage G31, Panther Lake H/U, and Wildcat Lake architecture enums unconditionally referenced by the pinned backend. See `compiler-2025.3.2-device-architecture.def`. No compiler was installed or run to perform this check.
6. Intel's [i915 hardware table](https://dgpu-docs.intel.com/overview/supported-hardware/i915-driver-gpus.html) includes PCI 7D55/Meteor Lake. No switch to xe, DKMS package, or kernel replacement is proposed.
7. The selected compute release was validated on Ubuntu 24.04 with kernel **6.8.0-48**, not this machine's **7.0.0-38**. No authoritative full-stack validation matrix was found covering all selected components and this exact kernel. The compiler/oneMKL pairing is documented; the complete compiler/GPU-driver/kernel combination remains an experimental candidate.

The selected GPU release is a reproducible Ubuntu-24/Meteor-Lake baseline, not a claim that it is the newest or currently security-maintained release. The current 26.35 release's published installation packages target Ubuntu 26.04, so blindly choosing latest was rejected. This proposal is for a bounded exploration rather than a production update policy.

## Resolved system impact

The final **simulation** reports:

- **44 new packages**.
- **1 upgrade**: libigdgmm12, from **22.3.17+ds1-1ubuntu1** to **22.8.1**.
- **0 removals**.
- Total package payload: **1,505,452,792 bytes**, approximately **1.40 GiB** (1.51 GB); some selected artifacts have already been downloaded for inspection.
- Additional installed-size estimate: **6,618,361,856 bytes**, approximately **6.16 GiB**, excluding future build outputs/caches and package-manager overhead.

The GMM upgrade is material: it is a shared graphics memory-management library and can affect consumers beyond this experiment. The plan does not update Mesa, the Vulkan loader, i915, the kernel, or media/debug packages from a general graphics PPA. Some compiler debugger and Eclipse-configuration packages are hard dependencies of Intel's chosen compiler packaging; using --no-install-recommends does not remove hard dependencies.

This is larger than the previous Vulkan setup and is not a zero-impact system change. Approval must explicitly cover the shared-library upgrade as well as the new packages. A final simulation must be checked again immediately before any installation.

## Installation distribution proposal

Use the already prepared exploration-local APT configuration and signed indexes to avoid adding an Intel graphics PPA or permanently editing `/etc/apt/sources.list.d` or system trust keyrings. The oneAPI packages would still be installed system-wide under their normal package paths (principally `/opt/intel/oneapi`), and GPU runtimes under the normal system library paths.

Only these explicit public index sources are configured in `sources.list`: Ubuntu noble, noble-updates, noble-security and Intel oneAPI. The keyring is local. Global APT hooks, source fragments and preferences were excluded from planning; the installed dpkg status was read only. Local pins select the intended family; no apt-mark hold or global preference was applied.

The active Intel repository signing key fingerprint is `E9BF 0AFC 46D6 E8B7 DA58 82F1 BAC6 F0C3 53D0 4109` (expiration shown as 2027-08-21). Index signatures were accepted by APT without allowing unauthenticated repositories. Intel GPU/IGC release artifacts were checked against the published SHA-256 values in `driver-artifacts.tsv`. Staged compiler-package SHA-256 values were checked against the signed Intel index.

Because Intel is not added to the system's normal source list in this approach, installed Intel packages would not automatically receive updates through the system's ordinary configured repositories. These pins are experiment-specific, not a long-term maintenance setup.

## Reproduce the simulation, not installation

From the repository root:

```bash
PLAN="$PWD/explorations/2026-10-24_21-22-local-speech-to-text/sycl-plan"
APT_CONFIG="$PLAN/apt.conf" apt-get --simulate --no-install-recommends --no-remove install \
  intel-oneapi-compiler-dpcpp-cpp-2025.3=2025.3.2-832 \
  intel-oneapi-mkl-sycl-devel-2025.3=2025.3.1-8 \
  intel-oneapi-tbb-devel-2022.3=2022.3.1-400 \
  libze1=1.16.1-1build1 libze-dev=1.16.1-1build1 clinfo=3.0.23.01.25-1build1 \
  "$PLAN/downloads/intel-igc-core-2_2.18.5+19820_amd64.deb" \
  "$PLAN/downloads/intel-igc-opencl-2_2.18.5+19820_amd64.deb" \
  "$PLAN/downloads/intel-opencl-icd_25.35.35096.9-0_amd64.deb" \
  "$PLAN/downloads/libigdgmm12_22.8.1_amd64.deb" \
  "$PLAN/downloads/libze-intel-gpu1_25.35.35096.9-0_amd64.deb"
```

This command has been run only with `--simulate` and without sudo. It must not be converted to an installation without approval. The ordinary `--no-upgrade` safeguard from the Vulkan plan is not appropriate for the proposed transaction: this plan intentionally requires the one disclosed GMM upgrade, and any other unexpected upgrade/removal would require review.

## Validation after approval

1. Recheck the exact transaction against `package-lock.txt`; stop if its scope changes.
2. Install only the approved closure; do not add a broad graphics PPA, change the kernel, or fix a new incompatibility through unapproved updates.
3. Activate the selected oneAPI components only in the experimental process environment. Do not modify shell startup files or global defaults.
4. Confirm `icpx` version and `sycl-ls` enumeration of Intel Arc MTL through Level Zero. Use the Level Zero GPU selector; do not mistake CPU/OpenCL fallback for the intended device.
5. Build separately in `build-sycl/` using the existing source and medium model. Initially disable optional FP16 GEMM, oneDNN, SYCL command graphs, and AOT; keep their choices explicit. This is a correctness-oriented baseline, not a fully tuned performance claim. FP16 OFF does not prove all arithmetic matches CPU.
6. Transcribe only the existing prompt-002 recording for the initial comparison, verify device/backend in logs, and inspect words/punctuation as well as total time. Initial JIT costs must be separated from later measurements. Stop and report compilation/runtime errors instead of silently swapping versions or modifying source/system configuration.

No promise is made that SYCL will correct the Vulkan punctuation/name differences or outperform it.

## Authorized installation and verification — 2026-10-24

### Approval and system changes

The requester explicitly approved the installation, including the libigdgmm12 upgrade, and additionally authorized adding Intel's oneAPI repository to the global APT configuration. Before making changes, the exact transaction was re-simulated and compared against all 45 package-lock entries. The five staged GPU/IGC packages were reverified against their published SHA-256 hashes.

New global files, root-owned and mode 0644:

- `/etc/apt/sources.list.d/intel-oneapi.list`
- `/usr/share/keyrings/intel-oneapi.gpg`

The source line is preserved in `intel-oneapi-global.list`. Only the Intel oneAPI index was refreshed globally. Other configured repositories were not contacted, and cached list cleanup was disabled to preserve their indexes. No general graphics PPA was added.

The approved package installation used the experiment-local signed source indexes and version preferences so no component family drifted during the transaction. Three verified staged compiler packages were reused from the local cache. Apt reports:

- **44 newly installed, one upgraded, zero removed**.
- **1150 MB fetched** after reusing existing artifacts, out of 1505 MB total package payload.
- Approximately **6618 MB** additional installed space.
- libigdgmm12 upgraded to **22.8.1** as approved.

No global version preferences or apt-mark holds were created. With the newly enabled global repository, normal future upgrades can select newer patches/common components; for example the default compiler package candidate is now 2025.3.3-30, while the installed package is exactly 2025.3.2-832. The original plan's no-global-repository maintenance limitation no longer applies.

All 45 installed versions/statuses match `package-lock.txt`, verified with dpkg-query; see `installed-package-verification.json`. `dpkg --audit` found no pending/broken packages. The installation log contains no reported errors/warnings. Mesa 25.2.8, Vulkan loader 1.3.275, i915 and the kernel were not replaced. No shell startup file or group membership was manually changed.

### Passed checks

The selected oneAPI environment was sourced only within the verification subprocess, with XDG/SYCL cache paths directed into this exploration.

- `icpx --version`: **Intel DPC++/C++ Compiler 2025.3.2 (2025.3.2.20260112)**.
- Selected compiler root: `/opt/intel/oneapi/compiler/2025.3`.
- MKLROOT: `/opt/intel/oneapi/mkl/2025.3`; TBB root: `/opt/intel/oneapi/tbb/2022.3`.
- `clinfo --list` succeeds and lists the Intel Arc GPU through OpenCL, as well as a CPU OpenCL platform. Stderr is empty.
- `vulkaninfo --summary` still succeeds, identifying the Intel Arc (MTL) GPU on the unchanged Mesa version; the software llvmpipe device also remains listed. Stderr is empty.

These checks establish compiler availability and OpenCL/Vulkan enumeration, not a successful SYCL model inference or oneMKL GPU computation.

### Initial blocking check: Level Zero SYCL enumeration

Command attempted:

```bash
source /opt/intel/oneapi/setvars.sh
ONEAPI_DEVICE_SELECTOR=level_zero:gpu sycl-ls
```

It terminates with **SIGSEGV / exit status 139**, before listing a device. Stderr contains only the selector-information message. The system's configured Apport handler processed the initial crash; no manual core dump was created in the repository.

A local GDB diagnostic reran only the enumerator, with user initialization files, auto-loading, debuginfod/network symbol lookup, and ASLR changes disabled. Its leading stack frames are:

```text
#0 zelLoaderTracingLayerInit() from /lib/x86_64-linux-gnu/libze_loader.so.1
#1 ze_lib::context_t::Init(...) from /opt/intel/oneapi/compiler/2025.3/lib/libur_adapter_level_zero.so.0
#4 zeInit() from /opt/intel/oneapi/compiler/2025.3/lib/libur_adapter_level_zero.so.0
#9 sycl::_V1::detail::ur::initializeUr(...) from /opt/intel/oneapi/compiler/2025.3/lib/libsycl.so.8
```

The fault is localized to initialization through the **Level Zero loader 1.16.1** and the selected oneAPI adapter. Subsequent upstream/static analysis found a strong internal ABI-mismatch explanation: loader 1.16.1's tracing-init function accepts/writes through three parameters, whereas newer embedded callers use a one-parameter signature, and the actual fault instruction is the old loader's third-parameter store. This is documented with sources, confidence limits, and proposed isolated-loader/OpenCL alternatives in [loader-diagnosis.md](loader-diagnosis.md). The dependency solver's success did not validate this execution path, as cautioned during planning. A later explicitly approved process-isolated loader test successfully resolves enumeration; see the follow-up below.

During the initial installation/failure-diagnosis phase, no extra package, loader update, workaround, source patch, or alternative toolchain was applied. No whisper.cpp SYCL build or transcription was run. System package changes beyond the approved set still require a new proposal/approval.

### Approved isolated-loader follow-up — 2026-10-25

The requester authorized option 1. Level Zero **v1.24.1**, commit `a81800177d8bea09bbd03d36d1ba066d7e844204`, was downloaded, built with the existing GCC/CMake, and installed without privileges under `level-zero-1.24.1/prefix/`. All 22 installation-manifest entries were verified inside that prefix. No dependencies were installed, no source patch applied, and no tests/examples executed.

A single enumeration process, after activating oneAPI, used that prefix through process-local LD_LIBRARY_PATH. `sycl-ls` exited **0** and reported:

```text
[level_zero:gpu] Intel(R) oneAPI Unified Runtime over Level-Zero, Intel(R) Arc(TM) Graphics 12.71.4 [1.6.35096+9]
```

The dynamic-linker trace confirms initialization of both the isolated `libze_loader.so.1` and its matching `libze_tracing_layer.so.1`. System libze1/libze-dev remain **1.16.1-1build1**; the default loader path still resolves to the Ubuntu-provided library. No global environment, ldconfig registration, system library replacement, APT operation, or repository change occurred in this follow-up.

This establishes successful Level Zero enumeration with the isolated loader, not successful oneMKL GPU computation or Whisper inference. No whisper.cpp SYCL build/transcription was performed in this loader experiment. Full provenance, checksums, reproducible commands, and evidence are in [level-zero-1.24.1/README.md](level-zero-1.24.1/README.md).

### Subsequent Whisper SYCL build and transcription — 2026-10-25

The requester authorized compiling whisper.cpp and transcribing the existing medium/prompt-002 case. A separate `build-sycl/` successfully built with icx/icpx 2025.3.2, oneMKL SYCL BLAS and the isolated loader/headers. Optional FP16 GEMM, oneDNN and SYCL graphs were disabled; existing CPU/Vulkan builds and system packages were preserved.

An initial attempt with optional persistent SYCL cache enabled crashed in `PersistentDeviceCodeCache::getItemFromDisc` / `getSortedImages` / strcmp after successful GPU/model initialization. A diagnostic reproduction confirmed that different failure location. Disabling only that optional cache (`SYCL_CACHE_PERSISTENT=0`, documented default) allowed inference to complete, without deleting caches, rebuilding or changing versions.

Four successful processes returned identical text. First successful wall time: **61.17 seconds**; subsequent runs **31.29 / 33.32 / 34.78 seconds**, median **33.32 seconds**. All use the Intel Arc via SYCL Level Zero and the isolated loader, with the same medium model, audio, Portuguese and decoder settings. The failed attempt is explicitly excluded from timing comparisons.

The successful transcript preserves the CPU-like punctuation and differs from the historical medium CPU output only in “prompt do pi” becoming “prompt do pai”. Historical CPU/Vulkan medians (36.33/9.77 seconds) were not rerun in this round and are not controlled contemporaneous benchmarks. This is not a fully optimized SYCL configuration or a demonstrated robust speedup.

Detailed commands, warning/diagnostic quirks, failed-attempt evidence, successful text/timings and limitations: [whisper-sycl-test.md](whisper-sycl-test.md). No additional system package, global configuration, source patch, microphone capture or cloud call occurred.

### Authorized optional-FP16 follow-up — 2026-10-25

The requester approved FP16. A separate `build-sycl-fp16/` enables only the optional FP16 GEMM setting relative to the preserved SYCL baseline. Matching configuration invariants were checked, and runtime logs confirm the ON/OFF precision option and Intel Arc Level Zero execution.

After a first ON invocation of 58.52 s, three new controls and three ON runs were alternated. Median full times were **32.11 s OFF versus 29.80 s ON** (approximately **7.19% shorter**). All seven transcripts were byte-identical, with no correction of the existing “prompt do pai” name substitution. No new package, source patch, global setting, oneDNN/graph option or other model was involved.

See [whisper-sycl-fp16-test.md](whisper-sycl-fp16-test.md) for full evidence and limitations; no universal maximum-performance or accuracy claim follows from this one-sample comparison.

### Installation and initial-failure evidence

- `logs/preinstall-driver-sha256.log`: reverified driver artifacts.
- `logs/apt-simulation-preinstall.log`: exact approved transaction before system changes.
- `logs/apt-update-global-intel.log`: global refresh of only the Intel index.
- `logs/apt-install-sycl.log`: actual installation.
- `logs/installed-package-versions.txt`, `installed-package-verification.json`: all 45 exact installed versions.
- `logs/dpkg-audit-after-install.txt`: empty audit findings.
- `logs/graphics-packages-after-install.txt`: preserved Mesa/Vulkan and updated GMM versions.
- `logs/oneapi-setvars-check.txt`, `logs/oneapi-component-paths.txt`, `logs/icpx-version.txt`: selected environment/compiler.
- `logs/sycl-ls-level-zero.txt`, `logs/sycl-ls-level-zero.stderr.log`: failed enumeration output.
- `logs/sycl-ls-level-zero-gdb.txt`: local failure backtrace.
- `logs/clinfo-list.txt`, `logs/clinfo-list.stderr.log`: successful OpenCL enumeration.
- `logs/vulkaninfo-after-sycl-install.txt`, matching stderr log: successful Vulkan enumeration.

## Supporting assets

- `apt.conf`, `sources.list`, `preferences`, `keys/`: isolated planning configuration and public verification material.
- `logs/apt-update-isolated.log`: signed index refresh inside this directory only.
- `logs/apt-simulation-initial.log`: illustrates unwanted transitive version drift.
- `logs/apt-simulation-pinned.log`, `logs/apt-simulation-final.log`: resolved controlled transaction; final has no warnings/errors.
- `package-lock.txt`, `package-plan.json`: exact 45-package closure and size calculations.
- `driver-artifacts.tsv`: five official GPU/IGC package URLs and published hashes.
- `downloads/`: staged packages for dependency/header inspection only, not installed.
- `compiler-2025.3.2-device-architecture.def`: extracted header evidence.
