/** ISOLATED 월드에 주입합니다. 원본 트랙 대신 복제본만 소유하고, 녹화 데이터는 승인된 확장 화면으로 보냅니다. */
export async function WebRtcPageTask(Options)
{
	const Existing = globalThis.MDownloaderWebRtcRecording;
	if (Options.action === 'status' || Options.action === 'stop')
	{
		if (!Existing || Existing.requestId !== Options.requestId || Existing.token !== Options.token)
			return null;
		if (Options.action === 'stop') Existing.stop(Options.reason === 'canceled' ? 'canceled' : 'requested');
		return {state: Existing.state, reason: Existing.reason, count: Existing.count};
	}
	if (location.href !== Options.page) return {error: 'webrtc_source_changed'};
	const Players = [...document.querySelectorAll('video')].filter(Player =>
	{
		const Bounds = Player.getBoundingClientRect();
		return Player.srcObject instanceof MediaStream && !Player.paused && !Player.ended && Player.videoWidth &&
		Player.readyState >= 2 && Bounds.width > 0 && Bounds.height > 0 &&
		!Player.closest(Options.excludedSelector || 'a[href], article, [data-card]') &&
		Player.srcObject.getVideoTracks().some(Track => Track.readyState === 'live');
	});
	if (Options.action === 'probe')
	{
		const Mime = typeof MediaRecorder === 'function' && ['video/mp4;codecs=avc1.42001f,mp4a.40.2', 'video/webm;codecs=vp8,opus', 'video/webm']
			.find(Value => MediaRecorder.isTypeSupported(Value));
		return {page: location.href, title: document.title, mimeType: Mime || null, busy: Existing && Existing.state !== 'ended',
			streams: Players.map(Player => ({trackId: Player.srcObject.getVideoTracks().find(Track => Track.readyState === 'live').id,
				width: Player.videoWidth, height: Player.videoHeight}))};
	}
	if (Options.action !== 'start') return null;
	if (Existing && Existing.state !== 'ended') return {error: 'webrtc_busy'};
	const Matches = Players.filter(Player => Player.srcObject.getVideoTracks().some(Track => Track.id === Options.trackId && Track.readyState === 'live'));
	if (Matches.length !== 1) return {error: 'webrtc_source_changed'};
	const Player = Matches[0], Original = Player.srcObject;
	const Mime = ['video/mp4;codecs=avc1.42001f,mp4a.40.2', 'video/webm;codecs=vp8,opus', 'video/webm']
		.find(Value => MediaRecorder.isTypeSupported(Value));
	if (!Mime) return {error: 'webrtc_unsupported'};
	const Clones = Original.getTracks().filter(Track => Track.readyState === 'live').map(Track => Track.clone());
	const Stream = new MediaStream(Clones);
	let Recorder;
	try { Recorder = new MediaRecorder(Stream, {mimeType: Mime, videoBitsPerSecond: 6000000, audioBitsPerSecond: 128000}); }
	catch { Clones.forEach(Track => Track.stop()); return {error: 'webrtc_unsupported'}; }
	let Tail = Promise.resolve(), PendingBytes = 0, Timer;
	const Session = {requestId: Options.requestId, token: Options.token, state: 'recording', count: 0, reason: '',
		stop(Reason)
		{
			if (!Session.reason) Session.reason = Reason;
			if (Recorder.state !== 'inactive') { Session.state = 'stopping'; Recorder.stop(); }
		}};
	async function Send(Fields)
	{
		const Reply = await chrome.runtime.sendMessage({type: 'webrtcRecordingData', requestId: Options.requestId, token: Options.token, ...Fields});
		if (!Reply?.ok) throw new Error('webrtc_receiver_lost');
	}
	function SourceAlive()
	{
		return location.href === Options.page && Player.isConnected && Player.srcObject === Original &&
		Original.getVideoTracks().some(Track => Track.id === Options.trackId && Track.readyState === 'live');
	}
	Recorder.ondataavailable = Event =>
	{
		const Data = Event.data;
		if (!Data?.size) return;
		if (PendingBytes + Data.size > Options.maxQueuedBytes)
		{
			Session.stop('webrtc_buffer_limit');
			return;
		}
		PendingBytes += Data.size;
		Tail = Tail.then(async () =>
		{
			if (Session.reason === 'webrtc_receiver_lost') return;
			for (let Offset = 0; Offset < Data.size; Offset += Options.maxChunkBytes)
			{
				const Part = Data.slice(Offset, Offset + Options.maxChunkBytes);
				const Encoded = await new Promise((Resolve, Reject) =>
				{
					const Reader = new FileReader();
					Reader.onload = () => Resolve(Reader.result.slice(Reader.result.indexOf(',') + 1));
					Reader.onerror = () => Reject(Reader.error);
					Reader.readAsDataURL(Part);
				});
				await Send({sequence: Session.count, data: Encoded});
				Session.count++;
			}
		}).catch(() => { Session.reason = 'webrtc_receiver_lost'; Session.stop(Session.reason); })
			.finally(() => { PendingBytes -= Data.size; });
	};
	const Leaving = () => Session.stop('webrtc_source_changed');
	Recorder.onerror = () => Session.stop('webrtc_recording_failed');
	Recorder.onstop = async () =>
	{
		clearInterval(Timer);
		removeEventListener('pagehide', Leaving);
		Clones.forEach(Track => Track.stop());
		await Tail;
		try { await Send({end: true, count: Session.count, reason: Session.reason || 'ended'}); }
		catch { Session.reason = 'webrtc_receiver_lost'; }
		Session.state = 'ended';
	};
	try
	{
		Recorder.start(1000);
		globalThis.MDownloaderWebRtcRecording = Session;
		addEventListener('pagehide', Leaving, {once: true});
		let Checking = false;
		Timer = setInterval(async () =>
		{
			if (!SourceAlive()) return Session.stop('webrtc_source_changed');
			if (Checking) return;
			Checking = true;
			try { await Send({heartbeat: true}); }
			catch { Session.reason = 'webrtc_receiver_lost'; Session.stop(Session.reason); }
			finally { Checking = false; }
		}, 1500);
		return {mimeType: Recorder.mimeType, width: Player.videoWidth, height: Player.videoHeight};
	}
	catch
	{
		Clones.forEach(Track => Track.stop());
		return {error: 'webrtc_recording_failed'};
	}
}
