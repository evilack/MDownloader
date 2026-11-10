/** ISOLATED 월드에 주입합니다. 원본 트랙 대신 복제본만 소유하고, 녹화 데이터는 승인된 확장 화면으로 보냅니다. */
export async function WebRtcPageTask(Options)
{
	const Existing = globalThis.MDownloaderWebRtcRecording;
	if (Existing?.reserved && Existing.expires < Date.now()) Existing.stop('webrtc_source_changed');
	if (Options.action === 'status' || Options.action === 'stop')
	{
		if (!Existing || Existing.requestId !== Options.requestId || Existing.token !== Options.token)
			return null;
		if (Options.action === 'stop') Existing.stop(Options.reason === 'canceled' ? 'canceled' : 'requested');
		return {state: Existing.state, reason: Existing.reason, count: Existing.count, reserved: Existing.reserved === true};
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
		const Mime = typeof MediaRecorder === 'function' && (Options.mimeTypes||[])
			.find(Value => MediaRecorder.isTypeSupported(Value));
		return {page: location.href, title: document.title, mimeType: Mime || null, busy: Existing && Existing.state !== 'ended',
			streams: Players.map(Player => ({trackId: Player.srcObject.getVideoTracks().find(Track => Track.readyState === 'live').id,
				width: Player.videoWidth, height: Player.videoHeight}))};
	}
	if (Options.action !== 'start' && Options.action !== 'reserve') return null;
	const OwnReservation = Existing?.reserved && Existing.requestId === Options.requestId && Existing.token === Options.token;
	if (Existing && Existing.state !== 'ended' && !(Options.action === 'start' && OwnReservation)) return {error: 'webrtc_busy'};
	if (Options.action === 'start' && OwnReservation && Existing.state !== 'preparing') return {error: 'webrtc_source_changed'};
	const Matches = Players.filter(Player => Player.srcObject.getVideoTracks().some(Track => Track.id === Options.trackId && Track.readyState === 'live'));
	if (Matches.length !== 1) return {error: 'webrtc_source_changed'};
	const Player = Matches[0], Original = Player.srcObject;
	if (Options.action === 'reserve')
	{
		// 화질 변경 전에 문서의 단일 녹화 자리를 확보합니다. 조회와 시작 사이의
		// 동시 요청이 기존 저장의 수신 화질을 바꾸지 않도록 같은 JS 실행에서 예약합니다.
		globalThis.MDownloaderWebRtcRecording = {requestId: Options.requestId, token: Options.token,
			mimeTypes:Options.mimeTypes,
			reserved: true, state: 'preparing', count: 0, expires: Date.now() + 45000,
			stop(Reason) { this.reason = Reason; this.state = 'ended'; }};
		return {reserved: true};
	}
	if (Options.qualityLease && (Player.videoWidth !== Options.qualityWidth || Player.videoHeight !== Options.qualityHeight))
		return {error: 'webrtc_quality_failed'};
	const QualityEvent = Action =>
	{
		if (Options.qualityLease) dispatchEvent(new CustomEvent('mdownloader-webrtc-quality-' + Action, {detail: Options.qualityLease}));
	};
	const Mime = ((OwnReservation?Existing.mimeTypes:undefined)||Options.mimeTypes||[])
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
		const Reply = await chrome.runtime.sendMessage({type: 'webrtcRecordingData', requestId: Options.requestId, token: Options.token, mimeType:Recorder.mimeType||Mime, ...Fields});
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
		QualityEvent('release');
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
		QualityEvent('renew');
		globalThis.MDownloaderWebRtcRecording = Session;
		addEventListener('pagehide', Leaving, {once: true});
		let Checking = false;
		Timer = setInterval(async () =>
		{
			if (!SourceAlive()) return Session.stop('webrtc_source_changed');
			if (Options.qualityLease && (Player.videoWidth !== Options.qualityWidth || Player.videoHeight !== Options.qualityHeight))
				return Session.stop('webrtc_quality_failed');
			QualityEvent('renew');
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
