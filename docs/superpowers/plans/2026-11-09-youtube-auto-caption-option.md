# Optional automatic YouTube captions

User approved: confirm automatic caption download and add include/exclude option affecting automatic captions only. Continue development/manual-only native validation, no Computer Use, fixed Store exclusion and local commit workflow.

1. Add a default-true includeYoutubeAutoCaptions boolean to shared settings. Reuse a native labeled checkbox/help/status in download settings, visible only when YouTube is available. Persist via existing toggle binder and show failures using existing status.
2. Snapshot the setting when registering each YouTube job. Filter exact upstream kind=asr before caption URL expiry/permission checks and HTTP receive. Preserve manual/forced/unknown kinds, and keep existing jobs/defaults included. Changes apply to newly queued jobs.
3. RED→GREEN tests for default/persistence/type validation, manual+ASR filtering, expired excluded ASR, all-ASR exclusion with zero caption HTTP and no subtitle mux. Native development Chrome uses actual options UI, reload persistence, same-video complete ON/OFF saves and MP4 track inspection. Fixture covers manual preservation because this video offers only ASR.
4. Fresh read-only review, final checks, docs/upstream record/evidence, scoped local commit. Preserve unrelated translation/UI working changes. Store option remains hidden and provider implementation excluded.
