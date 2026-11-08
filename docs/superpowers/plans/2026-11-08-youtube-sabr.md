# Authorized SABR/UMP expansion — 2026-11-08

The user authorized extending the existing browser-only YouTube plan to SABR/UMP, investigating HTTP 403 further, testing only the development build with video `-XHx839rSc8`, updating documentation and committing locally. Computer Use remains prohibited. The development build **is** the manual/unpacked build; only `development` and `chrome-store` remain. No proxy, external downloader, token forgery/generation, CAPTCHA automation or restricted-video bypass is added.

The chosen implementation reuses the official `googlevideo` SABR/UMP implementation pinned at 5.0.1, with local bundling and the existing Mediabunny 1.65.2 for independent H.264/AAC inputs. Observed HTTP 200 normal playback requests in the isolated test tab supply the source URL/config/client context and naturally issued token in memory. The test closes that tab before independent offscreen reception. API source diagnosis compares the same body from the page, offscreen and offscreen with the page's Origin/Referer pair. It does not conclude which individual header is decisive.

- [x] Remove the duplicate manual flavor; development/store policy and package tests.
- [x] Pin/bundle googlevideo with license/hash provenance; store excludes the entire provider/vendor tree.
- [x] Validate video identity, public VOD status, source host and Ustreamer config.
- [x] Receive separate SABR/UMP streams into OPFS with bounded memory/chunks/combined bytes; no transport retry or mint callback.
- [x] Treat pending attestation separately from rejection; stop at rejection and preserve complete chunks only when explicitly requested.
- [x] Remux separate fMP4 inputs without encoding; retain a decodable video keyframe and the audio timestamp offset.
- [x] Verify actual Chrome partial reception after source-tab closure, file save, video playback and AAC decode.
- [ ] Verify complete 623-second reception. Native protocol protection rejected the session after a prefix; only a 60.533-second partial output passed save/decode.
- [ ] Enable product discovery/quality/job/partial-save UI integration. Remains gated on complete accepted reception and production session/permission relay.

The native diagnostic uses CDP observation and ephemeral exact-source POST header rules only in its own test profile. It is not a production source-session capture implementation. Its browser automation produces a UUID-named download despite the requested title/date filename; the original is preserved and an identical artifact is copied to the intended name. Production browser filename acceptance remains unverified.

Read-only review identified two defects and both received RED→GREEN regression coverage: (1) slightly later audio could drop the leading video keyframe; (2) writers committed before joint completion validation. Both were fixed before final checks. Concurrent unrelated HLS/naming/subtitle work is excluded from this commit and its isolated-index verification.

See [native verification](../../verification.md#sabrump-expansion--2026-11-08) and [retained evidence](../../evidence/2026-11-08-youtube-sabr-development.json).

Subsequent user steering authorized comparing yt-dlp. That separate experiment received the complete same-video file in real development Chrome once; other fresh sources still failed with 403. It does not close the SABR attestation item above or unlock product integration. The [yt-dlp decision and follow-up plan](2026-11-08-youtube-ytdlp.md) records the observed YTVD server architecture, whole-file proof and optional native-helper work required.
