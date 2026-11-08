# Selected download folder save repair

User clarified: options folder selection works, then Save location resets it to browser default. Base df1099d. No Computer Use; preserve unrelated working files and Store exclusion. The file writer itself is not the reported failure.

Root cause: picker automatically stores a directory key and clears the relative-path input. Form submit unconditionally calls SetDownloadLocation(Input.value), which defaults pickedDownloadFolder to empty. Choosing then confirming a folder therefore clears it. Relevant persisted setting transitions also showed selected key followed by empty key; no raw browser paths/history are retained in committed evidence.

1. RED UI event tests for select→save→reload preserving the same handle key. Cover restored handle, denied/missing access, explicit relative path/default reset, rejected writes and canceled picker.
2. Keep selected folder when Save is pressed with empty relative input. Give default reset an explicit native button (type=button), localized in all10 locales; preserve atomic location settings and async disabled/status behavior. Nonempty relative path deliberately switches to browser subfolder mode. No file writer or YouTube extractor changes.
3. Native development Chrome options select/save/reload/switch checks. Automation supplies a real OPFS directory to the picker callback because OS chooser automation is excluded; validate real IndexedDB handle persistence and writes in offscreen. This does not claim native OS chooser interaction or arbitrary external-folder permission acceptance.
4. Full scoped/root tests, localization/project/package checks, fresh read-only review; document exact verification boundary and local scoped commit.

Ruling: scope follows user's clarification; repair options selection persistence instead of changing the already-working save transport. New explicit default reset avoids interpreting an empty text field as permission to discard a selected directory.
