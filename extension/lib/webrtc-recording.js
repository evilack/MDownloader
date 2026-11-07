/** 녹화 조각을 확장 OPFS에 순서대로 기록합니다. 수신 승인 전에 디스크 쓰기를 완료합니다. */
export function IsRecordingMessage(Message, Sender, Session, ExtensionId, TabId)
{
	return !!(Message.type === 'webrtcRecordingData' && Session && !Session.finishing && Sender.id === ExtensionId &&
		Sender.tab?.id === TabId && Sender.documentId === Session.documentId && Sender.frameId === 0 && Sender.url === Session.page &&
		Message.requestId === Session.requestId && Message.token === Session.token);
}

/** 조각별 close가 성공한 뒤에만 승인합니다. 이후 쓰기가 실패해도 이미 커밋한 파일은 남습니다. */
export function CreateRecordingStore(Directory)
{
	const Handles = [];
	let Bytes = 0;
	function Snapshot(MimeType)
	{
		// 클릭 시점에 이미 close된 핸들만 고정합니다. getFile을 기다리는 동안
		// 수신한 새 조각은 이 읽기 경계나 별도 저장 파일에 들어가지 않습니다.
		const Frozen = Handles.slice();
		return async () =>
		{
			const Files = [];
			for (const Handle of Frozen) Files.push(await Handle.getFile());
			return new Blob(Files, {type: MimeType});
		};
	}
	return {
		get bytes() { return Bytes; },
		async write(Data)
		{
			const Name = 'chunk-' + String(Handles.length).padStart(8, '0');
			const Handle = await Directory.getFileHandle(Name, {create: true});
			const Writer = await Handle.createWritable();
			try { await Writer.write(Data); await Writer.close(); }
			catch (ErrorValue)
			{
				await Writer.abort().catch(() => {});
				await Directory.removeEntry(Name).catch(() => {});
				throw ErrorValue;
			}
			Handles.push(Handle);
			Bytes += Data.byteLength;
		},
		async close() {},
		async abort() {},
		snapshot: Snapshot,
		file: MimeType => Snapshot(MimeType)(),
	};
}

export function CreateRecordingSink(Writer, {maxBytes, maxChunkBytes})
{
	let Tail = Promise.resolve(), Bytes = 0, Count = 0, Closed = false, Failure;
	function Queue(Run)
	{
		const Pending = Tail.then(Run);
		Tail = Pending.catch(() => {});
		return Pending;
	}
	function Check()
	{
		if (Failure) throw Failure;
		if (Closed) throw new Error('recording_closed');
	}
	async function Write(Sequence, Chunk)
	{
		Check();
		if (Sequence !== Count || !(Chunk instanceof Uint8Array) || !Chunk.length || Chunk.length > maxChunkBytes || Bytes + Chunk.length > maxBytes)
			throw new Error('recording_size_limit');
		try { await Writer.write(Chunk); }
		catch (ErrorValue) { Failure = ErrorValue; throw ErrorValue; }
		Bytes += Chunk.length; Count++;
		return {bytes: Bytes, count: Count};
	}
	return {
		append(Sequence, Data)
		{
			return Queue(async () =>
			{
				Check();
				if (Sequence !== Count || typeof Data !== 'string' || !Data.length || Data.length % 4 ||
				Data.length > Math.ceil(maxChunkBytes / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(Data))
					throw new Error('recording_invalid_chunk');
				const Decoded = atob(Data);
				if (btoa(Decoded) !== Data || Decoded.length > maxChunkBytes || Bytes + Decoded.length > maxBytes)
					throw new Error('recording_size_limit');
				return Write(Sequence, Uint8Array.from(Decoded, Value => Value.charCodeAt(0)));
			});
		},
		appendBytes(Sequence, Chunk) { return Queue(() => Write(Sequence, Chunk)); },
		finish(ExpectedCount)
		{
			return Queue(async () =>
			{
				Check();
				if (ExpectedCount !== undefined && ExpectedCount !== Count) throw new Error('recording_incomplete');
				try { await Writer.close(); }
				catch (ErrorValue) { Failure = ErrorValue; throw ErrorValue; }
				Closed = true;
				return {bytes: Bytes, count: Count};
			});
		},
	};
}
