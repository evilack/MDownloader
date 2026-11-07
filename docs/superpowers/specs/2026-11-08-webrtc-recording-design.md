# WebRTC recording

The user authorized making the currently received 720×960 WebRTC stream downloadable. Record the actual video element's MediaStream, not the unrelated blurred HLS. Existing MP4/HLS/DASH downloading remains separate.

## Approach

Add a WebRTC recording button to the shared detected-media component, opening an extension recording tab for the source tab. That tab lists visible, active MediaStream video tracks and owns a sequential OPFS store that closes each chunk before acknowledgement. An isolated-world page task clones the chosen stream's tracks and uses MediaRecorder (MP4 with H.264/AAC when supported, WebM fallback), transmitting bounded, acknowledged base64 chunks through extension messaging. Do not stop or modify the original stream. The recording tab must remain open; the original connection must continue.

Direct HTTP download does not apply to RTP. A second WebRTC receiver would require unsupported signaling/session reproduction, so use the existing authorized connection. Screen capture adds unrelated UI and permission prompts and is unnecessary here.

## Boundaries

- Bind every chunk to extension ID, source tab, document ID, page URL, random recording ID and secret token; enforce ordered chunks, size/storage limits and backpressure.
- Write incrementally in the extension origin, not website storage; do not buffer the whole recording in JS memory.
- Detect ended/replaced tracks, page navigation, closed source tab and disconnected recording controller; preserve received data and distinguish interrupted output.
- Stop-and-save finalizes the recorder and writer. Keep the file and object URL until browser saving completes; use current naming/folder settings and register the saved browser download in the existing manager. Save retries must retain the captured file.
- This records future received media in real time; no past recovery, tab-close continuation, bitstream-copy or lossless-quality claim.
- Verify on current live stream, inspect saved file's dimensions/audio/duration and replay it. Do not treat unit tests as actual-site acceptance.
