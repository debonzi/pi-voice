# E1 — Fake-recorder lifecycle checks

## Objective and scope

Exercise proposed capture ownership/race semantics using disposable Node children
and small synthetic silent WAV fixtures. This is isolated exploration code, not a
Pi extension, an adapter for pw-record, or authorization for microphone capture.
No audio API/device/server, playback, inference, network, installation, private
Herdr runtime or main Pi/Herdr process is involved. SIGKILL targets only explicitly
owned fake/test processes created by this suite.

## Reproduce

From the repository root, with existing Node (tested on v24.16.0):

```sh
node --test --test-reporter=tap explorations/2026-10-25_15-32-pi-voice-extension/assets/phase-2-audio-capture/e1/lifecycle/lifecycle-checks.mjs
```

The script exclusively allocates a private `run-<random>/` next to itself. Generated
WAV/evidence files use mode 0600 and run directories 0700. Operation WAVs are
removed after child completion/consumption and by the final cleanup hook. JSON
reports preserve traces, signals, owned PIDs, exit tuples and final outcomes.
No old recordings/evidence are read or deleted. Reruns preserve prior evidence.

`lifecycle-checks.mjs` contains three explicit child-only roles (`fake`,
`supervisor`, `owner`) and the experimental test controller. Do not substitute a
real recorder: the fake protocol, fixture validator, signal handling, deadlines
and test kill permissions are deliberately specific to synthetic children.

## Executed results

- `first-run.tap`: preliminary version, 14/14 scenarios passed.
- `repeat-1.tap`, `repeat-2.tap`, `repeat-3.tap`: final version, **14/14 each**,
  42 scenario executions with zero failures, cancellations or skips.
- The final version clears its settlement-deadline timer and waits for supervisor
  exit after the completion report, avoiding an unnecessary timer delay and an
  emergency-cleanup race. These were inspection improvements, not failed trials.
- Each `run-*/evidence.json` records the associated 14 scenarios and 14 controller
  operations (the sequential stale-callback case creates two operations; the
  owner-death case uses a separate disposable owner/helper instead).
- Every directly owned fake was reaped; all operation WAVs were deleted. The
  owner-death helper also reported a reaped fake and deleted its WAV; the suite
  checked helper exit without needing emergency cleanup.

### Scenarios

1. Stop before deferred spawn: no child/file created.
2. Repeated starts/stops: one recorder, one SIGINT, one settlement; accepted
   synthetic bytes remain until explicit consumption, then are removed.
3. Stop after fake boot but before readiness: no RECORDING transition;
   zero-frame final fixture discarded.
4. Cancel while starting; late readiness cannot resurrect the operation.
5. Cancel while recording; finalized synthetic bytes discarded.
6. Cancel during delayed finalization wins; new starts are not queued.
7. Unexpected exit 1 with valid synthetic bytes is still failure.
8. ENOENT spawn failure settles once with no file.
9. Startup deadline cancels/discards rather than synthesizing speech end.
10. Ignored SIGINT escalates to SIGTERM; even valid bytes are discarded.
11. Ignored SIGINT/SIGTERM escalates to SIGKILL; partial file removed.
12. Callback from a prior operation cannot mutate the new operation.
13. Both diagnostic pipes are drained; retained tails are bounded at 4096
    characters each despite 100,000-character bursts on each stream.
14. Kill only a disposable owner with SIGKILL: kernel closure of its private
    control-pipe writer reaches the helper as EOF; helper signals/reaps its fake,
    deletes its WAV and exits. An outer test authority retains emergency cleanup
    capability for this test's reported/identity-checked PIDs only.

## What this demonstrates and does not

The fake deliberately exits **1** after graceful SIGINT, while another fake
exits 1 unexpectedly with valid bytes. The controller distinguishes those cases
using intent/error/escalation evidence rather than treating code 1 as universally
successful. **This is simulation, not measurement of installed pw-record.**

The fake writes one known canonical WAV layout; lifecycle validation compares
bytes against that exact fixture. It is not a general WAV parser. The separate
`../formats/format-checks.py` covers chunk-aware parsing and ffprobe comparison.
These two suites are independent, not an integrated recorder-to-validator test.

Deadlines are accelerated fake-process test parameters (150/300-ms termination
escalation; 200-ms startup timeout in the dedicated test), not product defaults
or performance measurements. Diagnostic READY/BOOT messages are a fake protocol,
not PipeWire readiness. Stop before a deferred launch suppresses launch entirely;
stop after process boot tests an installed fake handler, not every kernel/exec
signal-delivery race. Tests inject selected late readiness callbacks, not all
possible OS schedules. There is no silence-triggered stop.

The control-pipe helper validates one owner-death mechanism for a local fake
under this harness. It does not establish safety if the helper itself dies, if
Pi's event loop hangs, across all parent/exec races, or for a production recorder.
No native parent-death signaling, system service, or persistent supervisor was
installed. Direct-child spawn alone remains insufficient for parent-crash safety.

Untested reduced-controller areas include real disk-full/unlink failures,
blocked CLEANING recovery, READY-without-consumer expiry/cancel, integration
between this controller and the general format validator, actual device loss,
real recorder readiness/tails/exit codes, Pi lifecycle hooks, and Herdr physical
interaction. Experimental controller errors must not be read as a complete
implementation of the proposed phase-2 contract. E2 and all actual audio access
remain pending separate approval.
