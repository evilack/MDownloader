/** 확장 문서가 자체 연결·트랙·녹화기를 소유합니다. 사이트 코드나 원본 탭을 참조하지 않습니다. */
import {RecordingMimeTypes} from './recording-format.js';
export function StartWebRtcReceiver(Descriptor, {signal, onData, onEnd, onStart, onFormat, mimeTypes=RecordingMimeTypes()}, Dependencies = globalThis)
{
	const D = Dependencies, Later = D.setTimeout.bind(D), Clear = D.clearTimeout.bind(D);
	const Every = D.setInterval.bind(D), ClearEvery = D.clearInterval.bind(D);
	const Now = () => (D.Date || Date).now();
	let ResolveReady, RejectReady, ResolveStopped;
	const Ready = new Promise((Resolve, Reject) => { ResolveReady = Resolve; RejectReady = Reject; });
	// stop만 기다리는 호출자에게도 시작 거절이 처리되지 않은 Promise로 새지 않습니다.
	Ready.catch(() => {});
	const Stopped = new Promise(Resolve => { ResolveStopped = Resolve; });
	let Socket, Peer, Stream, Recorder, AudioSink, AudioStream, SessionId, Mime, Timer, StatsTimer;
	let Reason, Ending = false, Ended = false, IsReady = false, Connected = false, Offered = false;
	let RecorderStarted = false, RecorderStopped = false, RemoteReady = false;
	let Tail = Promise.resolve(), PendingBytes = 0, WriteFailed = false, LastMedia = Now(), LastBytes, StatsBusy = false;
	const ErrorFor = Value => new Error(Value);
	function Cleanup()
	{
		Clear(Timer); ClearEvery(StatsTimer);
		signal?.removeEventListener('abort', Canceled);
		if (AudioSink)
		{
			AudioSink.pause();
			AudioSink.srcObject = null;
			AudioSink.remove();
			AudioSink = AudioStream = undefined;
		}
		try { Peer?.close(); } catch { /* 이 수신기가 소유한 연결만 정리합니다. */ }
		try { Socket?.close(); } catch { /* 이미 닫힌 연결 */ }
		for (const Track of Stream?.getTracks() || [])
		{
			Track.removeEventListener?.('unmute', TryStartRecording);
			try { Track.stop(); } catch { /* 종료된 트랙 */ }
		}
	}
	async function Complete()
	{
		if (Ending) return;
		Ending = true;
		await Tail;
		Ended = true;
		Cleanup();
		try { await onEnd(Reason || 'webrtc_connection_lost'); }
		finally { ResolveStopped(); }
	}
	function Stop(Value = 'requested')
	{
		if (Reason) return Stopped;
		Reason = Value;
		Clear(Timer); ClearEvery(StatsTimer);
		if (!IsReady) RejectReady(ErrorFor(Reason));
		if (Recorder && RecorderStarted && !RecorderStopped)
		{
			// 네이티브 오류는 먼저 inactive로 바뀌고 error→dataavailable→stop을
			// 발행합니다. inactive만 보고 마지막 조각보다 먼저 정리하지 않습니다.
			try { if (Recorder.state !== 'inactive') Recorder.stop(); }
			catch { void Complete().catch(() => {}); }
		}
		else void Complete().catch(() => {});
		return Stopped;
	}
	const Canceled = () => { void Stop('canceled'); };
	function Send(Message)
	{
		if (Reason || Socket?.readyState !== 1) throw ErrorFor('webrtc_connection_lost');
		Socket.send(JSON.stringify(Message));
	}
	function QueueData(Event)
	{
		const Data = Event.data;
		if (!Data?.size || Ended || Ending) return;
		if (PendingBytes + Data.size > 8 * 1048576) { void Stop('webrtc_buffer_limit'); return; }
		PendingBytes += Data.size;
		Tail = Tail.then(async () =>
		{
			if (WriteFailed) return;
			await onData(Data);
			const Video = Stream.getVideoTracks().find(Track => Track.readyState === 'live');
			if (!IsReady && !Reason && Video)
			{
				IsReady = true;
				Clear(Timer);
				const Settings = Video.getSettings?.() || {};
				ResolveReady({mimeType: Recorder.mimeType || Mime, width: Settings.width || 0, height: Settings.height || 0});
			}
		}).catch(() =>
		{
			WriteFailed = true;
			// 디스크 오류는 사용자가 직전에 중지한 경우에도 정상 저장으로 숨기지 않습니다.
			Reason = 'webrtc_recording_failed';
			if (!IsReady) RejectReady(ErrorFor(Reason));
			if (RecorderStarted && !RecorderStopped)
			{
				try { if (Recorder.state !== 'inactive') Recorder.stop(); }
				catch { void Complete().catch(() => {}); }
			}
			else void Complete().catch(() => {});
		}).finally(() => { PendingBytes -= Data.size; });
	}
	function TryStartRecording()
	{
		if (Reason || Recorder || !RemoteReady) return;
		// track 이벤트는 실제 RTP 수신보다 먼저 발생합니다. muted 상태에서 MP4
		// 녹화를 시작하면 Chrome이 짧은 무음 AAC만 저장하므로 첫 미디어를 기다립니다.
		if (!Stream.getVideoTracks().some(Track => Track.readyState === 'live') ||
			Stream.getTracks().some(Track => Track.readyState !== 'live' || Track.muted)) return;
		try { StartRecording(); }
		catch { void Stop('webrtc_recording_failed'); }
	}
	function StartRecording()
	{
		if (Reason || Recorder) return;
		if (!Stream.getVideoTracks().some(Track => Track.readyState === 'live')) throw ErrorFor('webrtc_connection_lost');
		Mime = mimeTypes
			.find(Value => D.MediaRecorder.isTypeSupported(Value));
		if (!Mime) throw ErrorFor('webrtc_unsupported');
		Recorder = new D.MediaRecorder(Stream, {mimeType: Mime, videoBitsPerSecond: 6000000, audioBitsPerSecond: 128000});
		onFormat?.(Recorder.mimeType||Mime);
		Recorder.addEventListener('dataavailable', QueueData);
		Recorder.addEventListener('error', () => { void Stop('webrtc_recording_failed'); });
		Recorder.addEventListener('stop', () =>
		{
			RecorderStopped = true;
			if (!Reason) { Reason = 'webrtc_connection_lost'; if (!IsReady) RejectReady(ErrorFor(Reason)); }
			void Complete().catch(() => {});
		});
		onStart?.(Now());
		Recorder.start(1000);
		RecorderStarted = true;
		LastMedia = Now();
		StatsTimer = Every(async () =>
		{
			if (Reason || StatsBusy) return;
			StatsBusy = true;
			try
			{
				let Bytes = 0;
				for (const Report of (await Peer.getStats()).values())
					if (Report.type === 'inbound-rtp' && (Report.kind === 'video' || Report.mediaType === 'video')) Bytes += Report.bytesReceived || 0;
				if (Bytes > 0 && Bytes !== LastBytes) LastMedia = Now();
				LastBytes = Bytes;
				if (!Reason && Now() - LastMedia >= 30000) void Stop('webrtc_connection_lost');
			}
			catch { if (!Reason) void Stop('webrtc_connection_lost'); }
			finally { StatsBusy = false; }
		}, 1500);
	}
	function ModifySdp(Sdp)
	{
		for (const Match of Sdp.matchAll(/^a=rtpmap:(\d+)\sH264\/90000/gm))
			Sdp = Sdp.replace(new RegExp('a=fmtp:' + Match[1] + ' [^\\r\\n]*'), Value => Value + '; x-google-start-bitrate=100');
		for (const Match of Sdp.matchAll(/^a=rtpmap:(\d+)\sopus\/48000/gm))
			Sdp = Sdp.replace(new RegExp('a=fmtp:' + Match[1] + ' [^\\r\\n]*'), Value => Value + ';stereo=1;sprop-stereo=1');
		return Sdp;
	}
	let PeerConfig;
	async function Offer(Profiles)
	{
		if (Reason || Offered) return;
		if (!Profiles || !Object.hasOwn(Profiles, Descriptor.quality) || !Profiles[Descriptor.quality] ||
			Descriptor.quality.toLowerCase().includes('blurred')) { void Stop('webrtc_quality_unavailable'); return; }
		Offered = true;
		const Config = {bundlePolicy: 'balanced', iceCandidatePoolSize: 0, iceServers: [], iceTransportPolicy: 'relay', rtcpMuxPolicy: 'require', ...PeerConfig};
		if (Config.iceTransportPolicy === 'relay' && !Config.iceServers?.some(Server =>
			(Array.isArray(Server.urls) ? Server.urls : [Server.urls]).some(Url => typeof Url === 'string' && /^turns?:/.test(Url)))) Config.iceTransportPolicy = 'all';
		Peer = new D.RTCPeerConnection(Config);
		Stream = new D.MediaStream();
		Peer.addEventListener('track', Event =>
		{
			if (Reason) { Event.track.stop(); return; }
			Stream.addTrack(Event.track);
			if (Event.track.kind === 'audio')
			{
				try
				{
					if (!AudioSink)
					{
						// 독립 문서는 사이트 플레이어의 오디오 렌더러를 공유하지 못합니다.
						// 요소에 연결해 Chrome의 원격 음성 처리를 초기화해야 녹화기가
						// PCM을 받습니다. play/autoplay 없이 연결만 하며 소리는 내지 않습니다.
						AudioStream = new D.MediaStream();
						AudioSink = D.document.createElement('audio');
						AudioSink.muted = true; AudioSink.volume = 0; AudioSink.hidden = true;
						D.document.body.append(AudioSink);
						AudioStream.addTrack(Event.track);
						AudioSink.srcObject = AudioStream;
					}
					else AudioStream.addTrack(Event.track);
				}
				catch { void Stop('webrtc_recording_failed'); return; }
			}
			Event.track.addEventListener?.('unmute', TryStartRecording);
			TryStartRecording();
		});
		Peer.addEventListener('connectionstatechange', () =>
		{
			if (!Reason && ['failed', 'disconnected', 'closed'].includes(Peer.connectionState)) void Stop('webrtc_connection_lost');
		});
		Peer.addTransceiver('audio', {direction: 'recvonly'});
		Peer.addTransceiver('video', {direction: 'recvonly'});
		const OfferValue = await Peer.createOffer();
		if (Reason) return;
		if (!OfferValue.sdp) throw ErrorFor('webrtc_connection_lost');
		const Sdp = ModifySdp(OfferValue.sdp);
		await Peer.setLocalDescription({type: 'offer', sdp: Sdp});
		if (Reason) return;
		Send({message: 'playStream', data: [{hasAudio: true, hasVideo: true, mediaProvider: 'WebRTC', mediaSessionId: SessionId,
			name: Descriptor.streamId, published: false, quality: Descriptor.quality, record: false, sdp: Sdp,
			transport: 'UDP', status: 'PENDING', width: 0, height: 0, bitrate: 0, minBitrate: 0, maxBitrate: 0, fastStart: true}]});
	}
	async function Message(Event)
	{
		if (Reason || typeof Event.data !== 'string' || Event.data.length > 1048576) return;
		let Value;
		try { Value = JSON.parse(Event.data); } catch { return; }
		switch (Value?.message)
		{
			case 'ping': Send({message: 'pong', data: []}); break;
			case 'connected':
			case 'getUserData':
				if (Connected) break;
				Connected = true; PeerConfig = Value.data?.peerConfig;
				if (Value.data?.features?.getStreamInfo === false) await Offer(Descriptor.profiles);
				else Send({message: 'getStreamInfo', data: {mediaSessionId: SessionId, modelName: Descriptor.streamId}});
				break;
			case 'getStreamInfoReply':
				if (!Connected || Value.data?.mediaSessionId !== SessionId) throw ErrorFor('webrtc_connection_lost');
				if (Value.data.status !== true) throw ErrorFor('webrtc_connection_lost');
				await Offer(Value.data.profiles); break;
			case 'setRemoteSDP':
				if (!Peer || Value.data?.[0] !== SessionId || typeof Value.data[1] !== 'string') throw ErrorFor('webrtc_connection_lost');
				await Peer.setRemoteDescription({type: 'answer', sdp: Value.data[1]});
				RemoteReady = true;
				TryStartRecording();
				break;
			case 'notifyStreamStatusEvent':
				if (['FAILED', 'STOPPED', 'UNPUBLISHED'].includes(Value.data?.[0]?.status)) void Stop('webrtc_connection_lost');
				break;
			case 'fail':
			case 'closeConnection': void Stop('webrtc_connection_lost'); break;
		}
	}
	Promise.resolve().then(() =>
	{
		if (Reason) return;
		if (signal?.aborted) return Canceled();
		if (typeof Descriptor?.url !== 'string' || !/^wss?:\/\//.test(Descriptor.url) ||
			typeof Descriptor.streamId !== 'string' || !Descriptor.streamId || typeof Descriptor.quality !== 'string' || !Descriptor.quality ||
			typeof Descriptor.connection?.appKey !== 'string' || !Descriptor.connection.appKey || Descriptor.connection.custom?.name !== Descriptor.streamId)
			throw ErrorFor('webrtc_quality_unavailable');
		SessionId = D.crypto.randomUUID();
		signal?.addEventListener('abort', Canceled, {once: true});
		Socket = new D.WebSocket(Descriptor.url);
		Socket.addEventListener('open', () =>
		{
			try { Send({message: 'connection', data: [{appKey: Descriptor.connection.appKey,
				clientBrowserVersion: D.navigator?.userAgent || '', clientOSVersion: D.navigator?.appVersion || '',
				mediaProviders: ['WebRTC'], custom: {name: Descriptor.streamId, aclAuth: Descriptor.connection.custom.aclAuth || ''}}]}); }
			catch { void Stop('webrtc_connection_lost'); }
		});
		let Messages = Promise.resolve();
		Socket.addEventListener('message', Event => { Messages = Messages.then(() => Message(Event)).catch(() => { void Stop('webrtc_connection_lost'); }); });
		Socket.addEventListener('close', () => { if (!Reason) void Stop('webrtc_connection_lost'); });
		Socket.addEventListener('error', () => { if (!Reason) void Stop('webrtc_connection_lost'); });
		Timer = Later(() => { void Stop('webrtc_connection_lost'); }, 30000);
	}).catch(() => { void Stop('webrtc_connection_lost'); });
	return {ready: Ready, stop: Stop};
}
