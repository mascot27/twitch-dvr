# Changelog

## [1.1.1](https://github.com/mascot27/twitch-dvr/compare/twitch-dvr-v1.1.0...twitch-dvr-v1.1.1) (2026-06-13)


### Bug Fixes

* harden path handling and config-file creation (CodeQL) ([f9a6fc6](https://github.com/mascot27/twitch-dvr/commit/f9a6fc6415b78b2ee20dd9a021982d11a810ad35))

## [1.1.0](https://github.com/mascot27/twitch-dvr/compare/twitch-dvr-v1.0.0...twitch-dvr-v1.1.0) (2026-06-13)


### Features

* anonymous irc chat logger and chat window reader ([03c3676](https://github.com/mascot27/twitch-dvr/commit/03c3676a7e8f5d861782899e865f79d9cc239270))
* capture message id and parse CLEARMSG/CLEARCHAT deletions ([9d6926d](https://github.com/mascot27/twitch-dvr/commit/9d6926d2818b07fd0e0c64ffcf4134fbf6322ea4))
* config loader with defaults ([764229e](https://github.com/mascot27/twitch-dvr/commit/764229e723af8acac05c68da064c6ed123add875))
* dashboard view with streamer cards and add form ([30befcf](https://github.com/mascot27/twitch-dvr/commit/30befcffd71ab6e0e388839ffb62b5fb2db3cb56))
* deletions.jsonl reader ([1e2c9b4](https://github.com/mascot27/twitch-dvr/commit/1e2c9b4f52c01a536814ff5fe4e0fe1b7ee8b932))
* disk-cap cleanup policy and free-space helper ([b19fe5a](https://github.com/mascot27/twitch-dvr/commit/b19fe5a82492bb0e50cda4d550afda6924c0df5c))
* entrypoint wiring with salvage, cleanup schedule, graceful shutdown ([e5a5c76](https://github.com/mascot27/twitch-dvr/commit/e5a5c76a1be1542c072b68e8451e8e6ebaff3ecb))
* event bus and status watcher with offline debounce + stale detection ([a0b7f7a](https://github.com/mascot27/twitch-dvr/commit/a0b7f7a4ed3a9e5652a478685c99639e0a9247e5))
* fastify api with rest, sse, range media serving ([a7c1a23](https://github.com/mascot27/twitch-dvr/commit/a7c1a2309eb925fe9cc66017b54e89899483a976))
* ffmpeg finalize pipeline with thumbnail and startup salvage ([0c7ead3](https://github.com/mascot27/twitch-dvr/commit/0c7ead3186652de19157f561b57286f425a93eb7))
* GET /api/recordings/:id/deletions endpoint ([15071c0](https://github.com/mascot27/twitch-dvr/commit/15071c01b029340dde064898baf616c8e80dee89))
* highlight mod-deleted messages in the chat replay ([cb52ca1](https://github.com/mascot27/twitch-dvr/commit/cb52ca1e84e67cd578e4b1778bb609066865cc9c))
* launchd service scripts and readme ([1d2d25c](https://github.com/mascot27/twitch-dvr/commit/1d2d25c3be19284cc950ada0a701f787ab1164fd))
* library view with disk bar, pin and delete ([0ffbaaa](https://github.com/mascot27/twitch-dvr/commit/0ffbaaae90a10754eae09d9a7ccad2caf9dffe24))
* log mod deletions to a per-recording deletions.jsonl sidecar ([e3f1e45](https://github.com/mascot27/twitch-dvr/commit/e3f1e45aa08e322a740047aeb80db3063ca38982))
* macos + bus notifier ([9fa8e6a](https://github.com/mascot27/twitch-dvr/commit/9fa8e6a26800b08151ae4dad6514b92086470012))
* per-streamer recording-quality dropdown on the dashboard ([1a51e9b](https://github.com/mascot27/twitch-dvr/commit/1a51e9b6b61a27e13d90f7d8bbbcf5f3baaf8ec7))
* player with synced chat replay, emotes, offset nudge, resume ([13b65eb](https://github.com/mascot27/twitch-dvr/commit/13b65eb9202aa415895c8e35c2db010a54595c7c))
* pure quality-preset mapping helper ([eb2bc1a](https://github.com/mascot27/twitch-dvr/commit/eb2bc1aa6a68d75451afd179ac9b2d5d78c4ad4f))
* recorder with part-file supervision, caffeinate, disk guard ([b01b015](https://github.com/mascot27/twitch-dvr/commit/b01b0157a61e4a35663e9f04cedf6624d034d32e))
* scaffolding, shared types, util helpers ([b6275e8](https://github.com/mascot27/twitch-dvr/commit/b6275e8ae438c69d95b5f6616e4f0b53611d5703))
* settings view ([a10f3a6](https://github.com/mascot27/twitch-dvr/commit/a10f3a611c45580f01e71a758b626de5dbb447bc))
* smoke script; end-to-end verified against live twitch ([47d2ef9](https://github.com/mascot27/twitch-dvr/commit/47d2ef9203116d8619000256c48df8a0d33a24ad))
* sqlite layer with schema and typed helpers ([eaa3831](https://github.com/mascot27/twitch-dvr/commit/eaa3831b03fb80df04a2602294c6ebac7ba375dd))
* twitch irc line/tag/emote parsing ([33a1f24](https://github.com/mascot27/twitch-dvr/commit/33a1f2445dcd801486d220ddece34c372f270985))
* unofficial twitch gql client (status batch + user resolve) ([5b7fc4d](https://github.com/mascot27/twitch-dvr/commit/5b7fc4dfc66a00844262044ff5188d23dc0b68b1))
* web deletions client type and pure classifier ([49af90d](https://github.com/mascot27/twitch-dvr/commit/49af90d17b5ba13ea8844b31ca4ec6d9f04a5aba))
* web scaffold with api client, sse context, dark theme ([6921ab6](https://github.com/mascot27/twitch-dvr/commit/6921ab6351f9aff9a6e8c2e425f5805c6909615f))


### Bug Fixes

* api hardening — rm containment, body schemas, sse hijack, spa prefix ([695359c](https://github.com/mascot27/twitch-dvr/commit/695359cf406b03a0e134e5eda23d8e036a3cc312))
* cleanup survives undeletable dirs, deterministic victim order ([23998f4](https://github.com/mascot27/twitch-dvr/commit/23998f4a25893c3b102b91af43a30011a904e9b6))
* entrypoint hardening — tick rejection guard, shutdown race gate, chat flush ([cbc39a2](https://github.com/mascot27/twitch-dvr/commit/cbc39a2221e14181fe1f03d99399b88e0097f826))
* flush chat tail on stop; cleanup path-containment guard ([3211fb7](https://github.com/mascot27/twitch-dvr/commit/3211fb793e56ae8ab1730bf350519633faa7ac41))
* gql timeout, shared user extraction, gql-error propagation, reserved path denylist ([a0121f3](https://github.com/mascot27/twitch-dvr/commit/a0121f3185cd6ffb5ea23c6909e3463e38c955a4))
* guard malformed ban-duration; document CLEARMSG login fallback ([74881d8](https://github.com/mascot27/twitch-dvr/commit/74881d8b6e2ef9ec6b9386290ab5d2b722b68412))
* harden watcher loop (safeTick + stopped flag), prune removed-streamer state, avatar/stale edge cases ([979c647](https://github.com/mascot27/twitch-dvr/commit/979c647e0e157564a654bab5a45950175ca3cd7d))
* log chat write-stream errors instead of swallowing them ([809d28a](https://github.com/mascot27/twitch-dvr/commit/809d28a6eb1996bb394a25e3246c211325711627))
* log osascript failures for diagnosability ([8596084](https://github.com/mascot27/twitch-dvr/commit/85960845c508038e102ebdc0b6d27360f3c40b71))
* per-generation stop tracking and fast-fail spawn latency ([fc55039](https://github.com/mascot27/twitch-dvr/commit/fc550390bbdaf5c5fa8cad8c1fcc218b8ae2ad32))
* push SSE status refresh after streamer mutations ([ebca20b](https://github.com/mascot27/twitch-dvr/commit/ebca20b59a1dda1b4c8bdb0bc89b14ec4f038d5d))
* recorder hardening — spawn-error handling, stop deadline, dir collision, fail-streak cap, job-lifetime caffeinate ([421ae39](https://github.com/mascot27/twitch-dvr/commit/421ae397ab4ac45e3d61386cbe7811cc9fc0e597))
* reset chat replay cache across recordings, honest retry comment ([aceedfc](https://github.com/mascot27/twitch-dvr/commit/aceedfcb59ba18d0c422f1d55aa5a0f06aaec80f))
* review fixes — server-only typecheck, node 22 types pin, contract docs ([226e34a](https://github.com/mascot27/twitch-dvr/commit/226e34a6918138f6797ff589c1dfb2fb5e64eac6))
* runtime whitelist for updateRecording patch keys ([94f2f53](https://github.com/mascot27/twitch-dvr/commit/94f2f530117e1cfaa8db7124d0084c8e8151a7f6))
* salvage crash-window recovery, numeric part sort, salvage diagnostics ([d7a29b0](https://github.com/mascot27/twitch-dvr/commit/d7a29b0c1f30257bfd0bc06fa8c1c4eebdc9a797))
* service script xml escaping + guarded load; README stray fence ([16c0708](https://github.com/mascot27/twitch-dvr/commit/16c0708e05877f721fb67b82c609191167171375))
* sse-safe shutdown, restart backoff per spec, settings schema + NaN cap guard ([3aeaaf2](https://github.com/mascot27/twitch-dvr/commit/3aeaaf254693fb91ddb32de4e2e47c7694ee7686))
* window fd leak, reconnect backoff on healthy-signal, connect guards, login normalization ([54f6012](https://github.com/mascot27/twitch-dvr/commit/54f601231b3aefb576e4016f86cd1bc61f3d4f53))
