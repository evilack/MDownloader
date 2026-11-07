/** MAIN/document_start: 기존 Ristretto 수신 세션만 관측합니다.
 * 인증은 페이지 메모리에 두고 다운로드 시작 때만 확장 수신기로 전달합니다. 목록/로그에는 내보내지 않습니다.
 * 서버 화질 고정은 녹화 임대 기간에만 적용하며 원래 소켓/PeerConnection의 동작을 전달합니다.
 */
(() =>
{
	if (globalThis.MDownloaderWebRtcQuality || typeof WebSocket !== 'function' || typeof RTCPeerConnection !== 'function') return;
	const Send = WebSocket.prototype.send, Remote = RTCPeerConnection.prototype.setRemoteDescription;
	const Sockets = new Map(), Peers = new Map(), Revoked = new Map();
	const SdpKey = Sdp => typeof Sdp === 'string' ? (Sdp.match(/^a=(?:ice-ufrag|fingerprint):[^\r\n]+/gm) || []).sort().join('\n') : '';
	function Profiles(Session)
	{
		const Source = Session.profiles?.source;
		return Object.entries(Session.profiles || {}).filter(([Name, Value]) =>
			!Name.toLowerCase().includes('blurred') && Name.length <= 100 && Value &&
			Number.isInteger(Value.width) && Value.width > 0 && Value.width <= 16384 &&
			Number.isInteger(Value.height) && Value.height > 0 && Value.height <= 16384 &&
			Number.isFinite(Value.bitrate) && Value.bitrate > 0)
			.map(([Name, Value]) =>
			{
				// 중간 프로필의 width/height는 인코더의 최대 상자입니다. 세로 방송은
				// 원본 비율로 이 안에 들어오며, 426×240 프로필의 실제 수신은 180×240입니다.
				const Scale = Source?.width > 0 && Source?.height > 0 ? Math.min(Value.width / Source.width, Value.height / Source.height) : null;
				const Width = Scale ? Math.max(2, Math.round(Source.width * Scale / 2) * 2) : Value.width;
				const Height = Scale ? Math.max(2, Math.round(Source.height * Scale / 2) * 2) : Value.height;
				return {name: Name, session: Session.key, resolution: `${Width}x${Height}`,
					width: Width, height: Height, bandwidth: Value.bitrate, fps: Value.fps};
			})
			.sort((A, B) => B.bandwidth - A.bandwidth);
	}
	function Release(Session)
	{
		const Lease = Session.lease;
		Session.lease = null;
		if (Lease && Session.socket.readyState === 1 && Lease.restore && Lease.restore !== Lease.name)
		{
			try { Send.call(Session.socket, JSON.stringify({message: 'changeQuality', data: {mediaSessionId: Session.id, quality: Lease.restore}})); }
			catch { /* 닫힌 연결은 재생성하지 않습니다. */ }
		}
	}
	function AllSessions() { return [...Sockets.values()].map(State => State.session).filter(Boolean); }
	function Find(TrackId)
	{
		for (const [Peer] of Peers) if (Peer.connectionState === 'closed') Peers.delete(Peer);
		const Matches = AllSessions().filter(Session => Session.socket.readyState === 1 && Session.sdpKey &&
			[...Peers].some(([Peer, Key]) => Key === Session.sdpKey && Peer.getReceivers().some(Receiver =>
				Receiver.track?.id === TrackId && Receiver.track.kind === 'video' && Receiver.track.readyState === 'live')));
		return Matches.length === 1 ? Matches[0] : null;
	}
	function Player(TrackId)
	{
		const Matches = [...document.querySelectorAll('video')].filter(Video =>
			Video.srcObject?.getVideoTracks?.().some(Track => Track.id === TrackId && Track.readyState === 'live'));
		return Matches.length === 1 ? Matches[0] : null;
	}
	function Parse(Data)
	{
		if (typeof Data !== 'string' || Data.length > 1048576) return null;
		try { const Value = JSON.parse(Data); return Value && typeof Value === 'object' ? Value : null; }
		catch { return null; }
	}
	function Observe(Socket)
	{
		if (Sockets.has(Socket)) return Sockets.get(Socket);
		// 닫힌 소켓을 정리하여 관측 상태가 페이지 수명 동안 무제한 늘지 않게 합니다.
		for (const [Old] of Sockets) if (Old.readyState > 1) Sockets.delete(Old);
		if (Sockets.size >= 32) return null;
		const State = {session: null}; Sockets.set(Socket, State);
		Socket.addEventListener('message', Event =>
		{
			const Message = Parse(Event.data), Session = State.session;
			if (!Message || !Session) return;
			if (Message.message === 'getStreamInfoReply' && Message.data?.mediaSessionId === Session.id)
				Session.profiles = Message.data.status === true ? Message.data.profiles : null;
			if (Message.message === 'changeQualityStatus' && Message.data?.status === 'success')
				Session.currentQuality = Message.data.currentQuality;
			if (Message.message === 'setRemoteSDP' && Message.data?.[0] === Session.id)
				Session.sdpKey = SdpKey(Message.data[1]);
			if (Message.message === 'changeQualityStatus' && Session.lease)
			{
				const Data = Message.data;
				if (Data?.status === 'failed') Session.lease.failed = true;
				if (Data?.status === 'success' && Data.currentQuality === Session.lease.name) Session.lease.confirmed = true;
			}
		});
		Socket.addEventListener('close', () => { if (State.session) State.session.lease = null; Sockets.delete(Socket); });
		return State;
	}
	WebSocket.prototype.send = function(Data)
	{
		try
		{
			const Message = Parse(Data);
			if (['connection', 'getStreamInfo', 'playStream', 'changeQuality', 'stopStream'].includes(Message?.message))
			{
				const State = Observe(this), Fields = Array.isArray(Message.data) ? Message.data[0] : Message.data;
				if (State && Message.message === 'connection' && typeof Fields?.appKey === 'string' &&
					typeof Fields.custom?.name === 'string' && typeof Fields.custom.aclAuth === 'string')
					State.connection = {appKey: Fields.appKey, custom: {name: Fields.custom.name, aclAuth: Fields.custom.aclAuth}};
				if (State && typeof Fields?.mediaSessionId === 'string')
				{
					if (State.session?.id !== Fields.mediaSessionId)
					{
						if (State.session) State.session.lease = null;
						State.session = {id: Fields.mediaSessionId, key: crypto.randomUUID(), socket: this};
					}
					const Session = State.session;
					if (Message.message === 'playStream' && typeof Fields.name === 'string') Session.streamId = Fields.name;
					if (Message.message === 'getStreamInfo' && typeof Fields.modelName === 'string') Session.streamId = Fields.modelName;
					if (Session.lease && Session.lease.expires < Date.now()) Release(Session);
					if (Message.message === 'stopStream') Session.lease = null;
					if (typeof Fields.quality === 'string')
					{
						Session.lastQuality = Fields.quality;
						if (Session.lease && Message.message === 'changeQuality')
						{
							Session.lease.restore = Fields.quality;
							Data = JSON.stringify({...Message, data: {...Fields, quality: Session.lease.name}});
						}
					}
				}
			}
		}
		catch { /* 관측 오류가 사이트의 원래 전송을 막으면 안 됩니다. */ }
		return Send.call(this, Data);
	};
	RTCPeerConnection.prototype.setRemoteDescription = function(Description)
	{
		const Result = Remote.apply(this, arguments), Peer = this, Key = SdpKey(Description?.sdp);
		// 사이트의 Promise와 예외 계약을 그대로 반환합니다.
		Promise.resolve(Result).then(() =>
		{
			for (const [Old] of Peers) if (Old.connectionState === 'closed') Peers.delete(Old);
			if (Key && Peers.size < 32) Peers.set(Peer, Key);
		}, () => {});
		return Result;
	};
	const Api = {
		list(TrackId) { const Session = Find(TrackId); return Session ? Profiles(Session) : []; },
		connection(TrackId, Choice)
		{
			const Session = Find(TrackId), State = Session && Sockets.get(Session.socket);
			if (!Session || !State?.connection || !Session.streamId) throw new Error('webrtc_background_unavailable');
			const Qualities = Profiles(Session);
			const Quality = Choice ? Qualities.find(Item => Item.name === Choice.name && Item.session === Choice.session)
				: Qualities.find(Item => Item.name === (Session.currentQuality || Session.lastQuality));
			if (!Quality) throw new Error('webrtc_quality_unavailable');
			return {protocol: 'ristretto-v1', url: Session.socket.url, connection: {appKey: State.connection.appKey,
				custom: {...State.connection.custom}}, streamId: Session.streamId, quality: Quality.name,
				profiles: Object.fromEntries(Qualities.map(Item => [Item.name,
					{width: Item.width, height: Item.height, bitrate: Item.bandwidth, fps: Item.fps}]))};
		},
		async select(TrackId, Choice, LeaseId)
		{
			if (Revoked.has(LeaseId)) throw new Error('webrtc_quality_failed');
			const Session = Find(TrackId), Video = Player(TrackId);
			const Quality = Session && Profiles(Session).find(Item => Item.name === Choice?.name && Item.session === Choice.session);
			if (!Quality || !Video || typeof LeaseId !== 'string') throw new Error('webrtc_quality_unavailable');
			if (Session.lease) throw new Error('webrtc_busy');
			const Lease = {id: LeaseId, name: Quality.name, restore: Session.lastQuality, expires: Date.now() + 30000};
			Session.lease = Lease;
			try
			{
				Send.call(Session.socket, JSON.stringify({message: 'changeQuality', data: {mediaSessionId: Session.id, quality: Quality.name}}));
				const Deadline = Date.now() + 12000;
				while (Date.now() < Deadline)
				{
					if (Session.lease !== Lease || Find(TrackId) !== Session || Player(TrackId) !== Video || Lease.failed)
						throw new Error('webrtc_quality_failed');
					if (Lease.confirmed && Video.videoWidth === Quality.width && Video.videoHeight === Quality.height)
						return Quality;
					await new Promise(Resolve => setTimeout(Resolve, 100));
				}
				throw new Error('webrtc_quality_failed');
			}
			catch (ErrorValue) { if (Session.lease === Lease) Release(Session); throw ErrorValue; }
		},
		release(LeaseId)
		{
			// 취소가 select 주입보다 먼저 도착해도 나중에 같은 임대를 시작하지 않습니다.
			if (typeof LeaseId !== 'string' || LeaseId.length > 128) return;
			for (const [Id, Expires] of Revoked) if (Expires < Date.now()) Revoked.delete(Id);
			Revoked.set(LeaseId, Date.now() + 60000);
			if (Revoked.size > 128) Revoked.delete(Revoked.keys().next().value);
			for (const Session of AllSessions()) if (Session.lease?.id === LeaseId) Release(Session);
		},
	};
	Object.defineProperty(globalThis, 'MDownloaderWebRtcQuality', {value: Object.freeze(Api)});
	addEventListener('mdownloader-webrtc-quality-renew', Event =>
	{
		for (const Session of AllSessions()) if (Session.lease?.id === Event.detail) Session.lease.expires = Date.now() + 15000;
	});
	addEventListener('mdownloader-webrtc-quality-release', Event => Api.release(Event.detail));
	addEventListener('pagehide', () => { for (const Session of AllSessions()) Release(Session); });
	setInterval(() => { for (const Session of AllSessions()) if (Session.lease?.expires < Date.now()) Release(Session); }, 2000);
})();
