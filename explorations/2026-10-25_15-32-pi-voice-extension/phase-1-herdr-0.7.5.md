# Phase 1 — Herdr 0.7.5 release-routing limitation (historical)

**Superseded environment:** the requester subsequently updated/restarted Herdr. The [0.9.5 physical report](phase-1-herdr-0.9.5.md) now includes a Q release through Herdr. The findings below remain valid for the previously installed official 0.7.5 release; they are not a limitation to attribute to the updated tested environment.

## Conclusion and applicability

**Herdr 0.7.5's normal application/pane routing consumes key-release events instead of forwarding them to the pane.** Enabling Kitty in the outer terminal is necessary for receiving physical releases but cannot, by itself, overcome this additional routing limitation. A Pi extension cannot recover a physical release that is discarded upstream.

This exact-version finding supersedes applying the earlier [current-master source trace](phase-1-herdr-input.md) to the installed executable. The current public source can forward releases; the installed 0.7.5 release has different routing.

No Herdr/Pi patch, installation/update, server restart, or private runtime inspection was performed. The running daemon's own version was not queried; the version and official-release identity of the installed executable were verified. Physical test observations are consistent with the 0.7.5 limitation, but no claim about all live process versions is made.

## Verified installed executable and public provenance

Read-only local commands:

```bash
herdr --version
sha256sum /home/debonzi/.local/bin/herdr
```

Results:

- Version output: `herdr 0.7.5`.
- SHA-256: `3dc83288073e4c2d3c679a30e7be97bcca9141c6fd17dbbb9219142e95c59253`.
- That digest exactly matches the public [v0.7.5 release](https://github.com/herdrdev/herdr/releases/tag/v0.7.5) asset `herdr-linux-x86_64` (GitHub release asset metadata). No release binary was downloaded.
- Annotated [tag ref](https://api.github.com/repos/herdrdev/herdr/git/ref/tags/v0.7.5): `99df3ac37be6bd7be2fd2023f0d88a7a0e7a7101`.
- [Tag object](https://api.github.com/repos/herdrdev/herdr/git/tags/99df3ac37be6bd7be2fd2023f0d88a7a0e7a7101) resolves to commit **`ef4c23f5775bb8cfec05f05d0844226ff959a07a`**.

Public GitHub research used `gh-axi`; critical source excerpts were independently fetched at that exact commit. No local checkout, build, remote host, or private service was needed.

## Exact-version source evidence

### 1. The normal client requests host event reporting

The [0.7.5 host flag definition](https://github.com/herdrdev/herdr/blob/ef4c23f5775bb8cfec05f05d0844226ff959a07a/src/input/model.rs#L46-L51) includes disambiguation, event types, and alternate keys (flags 7). Normal [client setup](https://github.com/herdrdev/herdr/blob/ef4c23f5775bb8cfec05f05d0844226ff959a07a/src/client/mod.rs#L356-L366) invokes the [mode push](https://github.com/herdrdev/herdr/blob/ef4c23f5775bb8cfec05f05d0844226ff959a07a/src/client/mod.rs#L602-L608).

Direct attach has a different setup with `enable_client_protocols=false` ([lines 338–350](https://github.com/herdrdev/herdr/blob/ef4c23f5775bb8cfec05f05d0844226ff959a07a/src/client/mod.rs#L338-L350)). Do not generalize this finding to every alternate route.

### 2. The decoder can recognize release events

- [Unix client input, lines 59–86](https://github.com/herdrdev/herdr/blob/ef4c23f5775bb8cfec05f05d0844226ff959a07a/src/client/input.rs#L59-L86) forwards framed raw bytes without a key-kind filter.
- [Input parser, lines 243–250](https://github.com/herdrdev/herdr/blob/ef4c23f5775bb8cfec05f05d0844226ff959a07a/src/input/parse.rs#L243-L250) maps Kitty event type `3` to `Release`.
- [Raw decoder, lines 703–705](https://github.com/herdrdev/herdr/blob/ef4c23f5775bb8cfec05f05d0844226ff959a07a/src/raw_input.rs#L703-L705) invokes the parser; the source includes a [parsed-release test](https://github.com/herdrdev/herdr/blob/ef4c23f5775bb8cfec05f05d0844226ff959a07a/src/raw_input.rs#L1128-L1138). Tests were read, not executed.

### 3. Application routing drops the release

The normal server decodes client input and calls application routing ([decode lines 2762–2772](https://github.com/herdrdev/herdr/blob/ef4c23f5775bb8cfec05f05d0844226ff959a07a/src/server/headless.rs#L2762-L2772), [route call lines 2609–2611](https://github.com/herdrdev/herdr/blob/ef4c23f5775bb8cfec05f05d0844226ff959a07a/src/server/headless.rs#L2609-L2611)).

In [application event routing, lines 1569–1603](https://github.com/herdrdev/herdr/blob/ef4c23f5775bb8cfec05f05d0844226ff959a07a/src/app/mod.rs#L1569-L1603), press and eligible repeat events call `handle_terminal_key_headless(key)`. The release branch does only:

```rust
crossterm::event::KeyEventKind::Release => {
    self.suppressed_repeat_keys.remove(&key_id);
}
```

There is no pane-forwarding call and no exception based on the pane's requested Kitty event flags.

The [monolithic runtime, lines 135–166](https://github.com/herdrdev/herdr/blob/ef4c23f5775bb8cfec05f05d0844226ff959a07a/src/app/runtime.rs#L135-L166) similarly handles release by clearing repeat suppression and returning `false`, without forwarding the key.

### 4. The child encoder is capable, but never receives that routed release

- [Terminal key forwarding, lines 168–170](https://github.com/herdrdev/herdr/blob/ef4c23f5775bb8cfec05f05d0844226ff959a07a/src/app/input/terminal.rs#L168-L170) reaches `rt.encode_terminal_key(key)`.
- [Pane encoding, lines 1588–1611](https://github.com/herdrdev/herdr/blob/ef4c23f5775bb8cfec05f05d0844226ff959a07a/src/pane/terminal.rs#L1588-L1611) can preserve event kind in the Ghostty wrapper or use the fallback encoder.
- [Event suffix encoding, lines 442–451](https://github.com/herdrdev/herdr/blob/ef4c23f5775bb8cfec05f05d0844226ff959a07a/src/input/encode.rs#L442-L451) maps press/repeat/release to 1/2/3 when bit 2 is requested.

Thus Ctrl+Q release is representable for the pane, but the application-routing branch prevents it from reaching the encoder. An inner flags-7 response does not demonstrate that this route forwards releases.

## Latest physical retry after the authorized WezTerm setting change

The requester said the Python test was executed after the assistant applied the explicitly requested `config.enable_kitty_keyboard = true` line. Report: [assets/ctrl-q-protocol-2026-10-25_18-30-05-930968.json](assets/ctrl-q-protocol-2026-10-25_18-30-05-930968.json).

Observed:

- Flags 7 acknowledged; one device-attributes reply.
- 59 copies of `ESC[113;5:1u`, all press events.
- No recognized Q release or repeat; not interrupted.

The assistant asked whether this retry occurred inside Herdr after client restart/reattach; that exact execution context has not yet been separately confirmed. The report does not identify the client/pane itself. This limits attribution of the retry but **does not remove the verified 0.7.5 code-level routing blocker**.

The earlier native Kitty-enabled control did deliver a Q release. Both observations are consistent with 0.7.5 consuming releases in the middle. Explicit `:1` press encoding is also consistent with the exact-version encoder, unlike assuming the current-master source was identical to the installed version.

## Alternatives and next decision

1. **Support the current environment with separate explicit start/stop shortcuts.** Idempotent actions tolerate repeated press events without needing key-up. Exact fallback bindings and final UX are not yet selected.
2. **Investigate a newer Herdr release** whose normal pane route forwards releases. Current public master provides evidence of a forwarding implementation, but no specific compatible released version or upgrade plan is established by this finding. Research does not authorize an upgrade, installation, restart, or daemon migration.
3. **Propose a narrowly scoped Herdr patch** only if the requester explicitly wants that separate work. No patch/local checkout/build is authorized or prepared here.

A timeout between repeated presses is not genuine release detection and is not recommended. Further repeated Ctrl+Q tests cannot bypass the verified routing branch. No new physical test is needed merely to establish that code limitation; a corrected-version end-to-end test would be relevant only after a separately agreed plan.

## Handoff

Report the installed-version limitation and ask the requester to choose current-environment fallback versus investigation of a release that fixes forwarding. Keep the existing WezTerm change as the explicitly requested setting; do not silently revert it or upgrade Herdr. Phase 2 remains not started, and Pi Voice implementation is not authorized by this exploration.
