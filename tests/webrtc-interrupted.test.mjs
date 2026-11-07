import Assert from 'node:assert/strict';
import {test as Test} from 'node:test';
import {SummarizeJob, JobGroup} from '../extension/lib/browser-job-state.js';
import {GetDownloadMetrics, ProgressMax} from '../extension/lib/metrics.js';

Test('a WebRTC partial file saved after source or connection loss is interrupted rather than normal completion', () =>
{
	const Job = {requestId: 'recording', created: 1, recording: true, partial: true, filename: 'partial.mp4', bytesReceived: 4000};
	const Download = {filename: 'partial.mp4', state: 'complete', exists: true, bytesReceived: 4000, totalBytes: 4000};
	const Summary = SummarizeJob(Job, Download);
	Assert.equal(Summary.state, 'interrupted');
	Assert.equal(Summary.exists, true);
	Assert.equal(Summary.error.key, 'webrtc_interrupted_saved');
	Assert.equal(JobGroup(Summary.state), 'attention');
	Assert.notEqual(GetDownloadMetrics(Summary).percent, ProgressMax);
});

Test('picked-folder interruption retains its saved file without entering the complete group', () =>
{
	const Summary = SummarizeJob({recording: true, partial: true, state: 'complete', pickedDownloadFolder: 'folder', exists: true});
	Assert.equal(Summary.state, 'interrupted');
	Assert.equal(Summary.exists, true);
});

Test('explicit stop/save and intentional current-save exports remain normal completed files', () =>
{
	const Item = {filename: 'video.mp4', state: 'complete', exists: true};
	Assert.equal(SummarizeJob({recording: true, partial: false, created: 1}, Item).state, 'complete');
	Assert.equal(SummarizeJob({hls: true, snapshot: true, partial: true, created: 1}, Item).state, 'complete');
});
