/** Immutable committed byte ranges, independent of transport/container/clock policy.
 * Producers must close their writer and obtain a Blob/File snapshot before publish.
 * This module retains byte snapshots only; it never deletes files or owns paths.
 * All APIs below use byte offsets, never media timestamps.
 */

function SourceError(Code, Message = Code) {
 const ErrorValue = new Error(Message);
 ErrorValue.code = Code;
 return ErrorValue;
}

function ReaderAbort(Signal) {
 return Signal?.reason instanceof DOMException && Signal.reason.name === 'AbortError'
  ? Signal.reason : new DOMException('Committed media reader canceled', 'AbortError');
}

function ValidateSignal(Signal) {
 if (Signal !== undefined && !(Signal instanceof AbortSignal)) throw SourceError('caption_source_signal');
}

// Clone data descriptors only: metadata must not carry live handles, accessors,
// functions, prototypes, or caller-mutable nested objects. Secrets are the
// producer's responsibility; this is not a remote identity/authentication check.
function FrozenMetadata(Value, Ancestors = new Set()) {
 if (Value === null || Value === undefined || typeof Value === 'string' || typeof Value === 'boolean') return Value;
 if (typeof Value === 'number' && Number.isFinite(Value)) return Value;
 if (typeof Value !== 'object' || Ancestors.has(Value)) throw SourceError('caption_source_identity');
 const ArrayValue = Array.isArray(Value), Prototype = Object.getPrototypeOf(Value);
 if (!ArrayValue && Prototype !== Object.prototype && Prototype !== null) throw SourceError('caption_source_identity');
 const Copy = ArrayValue ? [] : Object.create(null);
 Ancestors.add(Value);
 try {
  for (const Key of Reflect.ownKeys(Value)) {
   if (ArrayValue && Key === 'length') continue;
   const Descriptor = Object.getOwnPropertyDescriptor(Value, Key);
   if (typeof Key !== 'string' || !Descriptor || !('value' in Descriptor)) throw SourceError('caption_source_identity');
   Object.defineProperty(Copy, Key, {
    value: FrozenMetadata(Descriptor.value, Ancestors), enumerable: Descriptor.enumerable,
    configurable: false, writable: false,
   });
  }
  if (ArrayValue) Copy.length = Value.length;
  return Object.freeze(Copy);
 } finally { Ancestors.delete(Value); }
}

const BlobSize = Object.getOwnPropertyDescriptor(Blob.prototype, 'size').get;
const BlobSlice = Blob.prototype.slice;
const BlobArrayBuffer = Blob.prototype.arrayBuffer;

function ImmutableSize(File) {
 try {
  // The native getter performs the Blob brand check (including File). Duck
  // typed writers/buffers are deliberately not accepted as immutable sources.
  const Size = BlobSize.call(File);
  if (Number.isSafeInteger(Size) && Size > 0) return Size;
 } catch { /* Normalize invalid Blob objects to the journal's admission error. */ }
 throw SourceError('caption_source_file');
}

function NonnegativeInteger(Value) { return Number.isSafeInteger(Value) && Value >= 0; }

function EntryAt(Entries, Offset) {
 let Low = 0, High = Entries.length;
 while (Low < High) {
  const Middle = Low + Math.floor((High - Low) / 2);
  if (Entries[Middle].end <= Offset) Low = Middle + 1;
  else High = Middle;
 }
 return Low;
}

/**
 * First sequence may be any nonnegative safe integer; subsequent entries use +1.
 * Owner release closes public reader/retain admission. Already-created readers
 * and frozen views retain their own leases and can drain committed bytes.
 * If released while still open, missing live bytes fail caption_source_released.
 * Workspace storage leases must be connected by the producer before integration.
 */
export function CreateCommittedMediaSource({signal: ParentSignal, resourceIdentity, limits} = {}) {
 ValidateSignal(ParentSignal);
 if (!limits) throw SourceError('caption_source_limits');
 const {maxBytes: MaxBytes, readChunkBytes: ReadChunkBytes, maxEntries: MaxEntries} = limits;
 if (![MaxBytes, ReadChunkBytes, MaxEntries].every(Value => Number.isSafeInteger(Value) && Value > 0)) {
  throw SourceError('caption_source_limits');
 }
 const ResourceIdentity = FrozenMetadata(resourceIdentity);
 let Entries = [], CommittedLength = 0, Revision = 0, Sealed = false, Reason = null;
 let Failed = false, Failure, Owner = true, References = 1, Disposed = false;
 const Waiters = new Set(), LiveReaders = new Set();
 const ReleasedError = () => SourceError('caption_source_released');
 const SealedError = () => SourceError('caption_source_sealed');

 function Metadata(WithEntries = true) {
  return Object.freeze({
   revision: Revision, committedLength: CommittedLength, resourceIdentity: ResourceIdentity,
   sealed: Sealed, reason: Reason, failed: Failed, owned: Owner, disposed: Disposed,
   ...(WithEntries ? {entries: Object.freeze(Entries.map(Entry => Object.freeze({
    sequence: Entry.sequence, offset: Entry.offset, size: Entry.size, end: Entry.end,
   })))} : {}),
  });
 }

 function NextRevision() {
  if (Revision === Number.MAX_SAFE_INTEGER) throw SourceError('caption_source_revision');
  return Revision + 1;
 }

 function Notify() { for (const Waiter of [...Waiters]) Waiter(); }

 function DisposeIfUnreferenced() {
  if (References !== 0 || Disposed) return;
  Disposed = true;
  ParentSignal?.removeEventListener('abort', ParentAbort);
  Notify();
  Waiters.clear();
  Entries = [];
  LiveReaders.clear();
 }

 function AcquireLease(Internal = false) {
  if (Disposed || (!Internal && !Owner)) throw ReleasedError();
  References++;
  let Released = false;
  return () => {
   if (Released) return;
   Released = true;
   References--;
   DisposeIfUnreferenced();
  };
 }

 function AssertAdmission() {
  if (Disposed || !Owner) throw ReleasedError();
  if (Failed) throw Failure;
 }

 function Fail(ErrorValue) {
  if (Failed || Disposed) return Metadata(false);
  Failure = ErrorValue ?? SourceError('caption_source_failed');
  Failed = true;
  // A hard failure must still settle readers even at revision exhaustion.
  if (Revision < Number.MAX_SAFE_INTEGER) Revision++;
  for (const Reader of [...LiveReaders]) Reader.stop(Failure);
  Notify();
  return Metadata(false);
 }

 function ParentAbort() { Fail(ParentSignal.reason ?? new DOMException('Producer aborted', 'AbortError')); }

 // Each context owns one lease, its abort listener, and only its own pending
 // callbacks. Producer failure stops live contexts, never frozen contexts.
 function ReaderContext(Signal, FrozenState = null) {
  ValidateSignal(Signal);
  if (FrozenState) {
   if (FrozenState.released) throw ReleasedError();
  } else AssertAdmission();
  const ReturnLease = AcquireLease(Boolean(FrozenState));
  let Finished = false, Stopped = false, StopError;
  const Stops = new Set();
  const Context = {
   check() {
    if (Stopped) throw StopError;
    if (Finished || Disposed || FrozenState?.released) throw ReleasedError();
    if (!FrozenState && Failed) throw Failure;
   },
   stop(ErrorValue) {
    if (Stopped || Finished) return;
    Stopped = true;
    StopError = ErrorValue;
    for (const Callback of [...Stops]) Callback(ErrorValue);
    Stops.clear();
   },
   onStop(Callback) {
    if (Stopped) { Callback(StopError); return () => {}; }
    if (Finished) { Callback(ReleasedError()); return () => {}; }
    Stops.add(Callback);
    return () => Stops.delete(Callback);
   },
   dispose() {
    if (Finished) return;
    Finished = true;
    Signal?.removeEventListener('abort', Abort);
    Stops.clear();
    if (FrozenState) FrozenState.readers.delete(Context);
    else LiveReaders.delete(Context);
    ReturnLease();
   },
  };
  const Abort = () => Context.stop(ReaderAbort(Signal));
  if (FrozenState) FrozenState.readers.add(Context);
  else LiveReaders.add(Context);
  Signal?.addEventListener('abort', Abort, {once: true});
  if (Signal?.aborted) Abort();
  return Context;
 }

 // A Blob arrayBuffer cannot be canceled in Chrome116. Settle the consumer
 // immediately; keep the native completion observed and recheck the context
 // before its result can escape. No abandoned rejection or late enqueue.
 function AwaitOperation(Context, Operation) {
  Context.check();
  return new Promise((Resolve, Reject) => {
   let Settled = false, Detach = () => {};
   const Settle = (Callback, Value) => {
    if (Settled) return;
    Settled = true;
    Detach();
    Callback(Value);
   };
   Detach = Context.onStop(ErrorValue => Settle(Reject, ErrorValue));
   (async () => {
    try {
     Context.check();
     const Value = await Operation();
     Context.check();
     Settle(Resolve, Value);
    } catch (ErrorValue) { Settle(Reject, ErrorValue); }
   })();
  });
 }

 function ValidateRange(Start, End, BoundedRead) {
  if (!NonnegativeInteger(Start) || !NonnegativeInteger(End) || End < Start || End > MaxBytes ||
   (BoundedRead && End - Start > ReadChunkBytes)) throw SourceError('caption_source_range');
 }

 function CheckBoundary(Start, End, FrozenState) {
  if (FrozenState) {
   if (Start > FrozenState.committedLength || End > FrozenState.committedLength) throw SourceError('caption_source_snapshot_range');
  } else if (Sealed && (Start > CommittedLength || End > CommittedLength)) throw SealedError();
 }

 function Change(ObservedRevision, Context) {
  Context.check();
  return new Promise((Resolve, Reject) => {
   let Settled = false, Detach = () => {};
   const Settle = (Callback, Value) => {
    if (Settled) return;
    Settled = true;
    Waiters.delete(Check);
    Detach();
    Callback(Value);
   };
   const Check = () => {
    try {
     Context.check();
     if (!Owner || Disposed) throw ReleasedError();
     if (Revision !== ObservedRevision || Sealed) Settle(Resolve, Metadata(false));
    } catch (ErrorValue) { Settle(Reject, ErrorValue); }
   };
   Waiters.add(Check);
   Detach = Context.onStop(ErrorValue => Settle(Reject, ErrorValue));
   // No await occurs between registration and this recheck.
   Check();
  });
 }

 async function ReadWithContext(Start, End, Context, FrozenState = null) {
  Context.check();
  CheckBoundary(Start, End, FrozenState);
  if (Start === End) return new Uint8Array(0);
  if (!FrozenState) {
   while (End > CommittedLength) {
    Context.check();
    CheckBoundary(Start, End, null);
    if (!Owner) throw ReleasedError();
    await Change(Revision, Context);
   }
  }
  Context.check();
  const Index = FrozenState ? FrozenState.entries : Entries;
  const Parts = [];
  let Position = Start, EntryIndex = EntryAt(Index, Start);
  while (Position < End) {
   const Entry = Index[EntryIndex++];
   if (!Entry || Position < Entry.offset || Position >= Entry.end) throw SourceError('caption_source_index');
   const PartEnd = Math.min(End, Entry.end);
   Parts.push(BlobSlice.call(Entry.file, Position - Entry.offset, PartEnd - Entry.offset));
   Position = PartEnd;
  }
  // Blob parts are immutable references, not accumulated byte arrays. One
  // bounded arrayBuffer covers even a read crossing many small source files.
  const Slice = Parts.length === 1 ? Parts[0] : new Blob(Parts);
  const Buffer = await AwaitOperation(Context, () => BlobArrayBuffer.call(Slice));
  Context.check();
  if (Buffer.byteLength !== End - Start) throw SourceError('caption_source_short_read');
  return new Uint8Array(Buffer);
 }

 async function Read(Start, End, {signal: Signal} = {}, FrozenState = null) {
  ValidateRange(Start, End, true);
  const Context = ReaderContext(Signal, FrozenState);
  try { return await ReadWithContext(Start, End, Context, FrozenState); }
  finally { Context.dispose(); }
 }

 // Mode is private and independent of the public end value. rangeStream
 // always validates an exact range, including rejection of null/undefined.
 // Only the live stream factory opts out; frozen views cannot use that mode.
 function MakeStream(Start, End, Signal, FrozenState = null, Exact = true) {
  if (Exact) ValidateRange(Start, End, false);
  else if (FrozenState || !NonnegativeInteger(Start) || Start > MaxBytes) throw SourceError('caption_source_range');
  const Context = ReaderContext(Signal, FrozenState);
  let Cursor = Start, Closed = false, DetachStop = () => {};
  const Finish = () => {
   if (Closed) return;
   Closed = true;
   DetachStop();
   Context.dispose();
  };
  try {
   CheckBoundary(Start, Exact ? End : Start, FrozenState);
   return new ReadableStream({
    start(Controller) {
     DetachStop = Context.onStop(ErrorValue => {
      if (Closed) return;
      Controller.error(ErrorValue);
      Finish();
     });
     if (Closed) return;
     try {
      Context.check();
      if (Exact && Cursor === End) { Controller.close(); Finish(); }
     } catch (ErrorValue) { Controller.error(ErrorValue); Finish(); }
    },
    async pull(Controller) {
     if (Closed) return;
     try {
      Context.check();
      if (!Exact) {
       while (Cursor >= CommittedLength) {
        if (Sealed) {
         if (Cursor > CommittedLength) throw SealedError();
         Controller.close(); Finish(); return;
        }
        if (!Owner) throw ReleasedError();
        await Change(Revision, Context);
        Context.check();
       }
      }
      const Frontier = Exact ? End : CommittedLength;
      // Subtraction avoids an unsafe Cursor + ReadChunkBytes intermediate.
      const Next = Cursor + Math.min(ReadChunkBytes, Frontier - Cursor);
      const Chunk = await ReadWithContext(Cursor, Next, Context, FrozenState);
      Context.check();
      if (Closed) return;
      Cursor = Next;
      Controller.enqueue(Chunk);
      if ((Exact && Cursor === End) || (!Exact && Sealed && Cursor === CommittedLength)) {
       Controller.close(); Finish();
      }
     } catch (ErrorValue) {
      if (!Closed) { Controller.error(ErrorValue); Finish(); }
     }
    },
    cancel() {
     // Never propagate consumer cancellation to Fail/the producer signal.
     Context.stop(new DOMException('Committed media stream canceled', 'AbortError'));
     Finish();
    },
   }, {highWaterMark: 0});
  } catch (ErrorValue) { Finish(); throw ErrorValue; }
 }

 function Frozen() {
  AssertAdmission();
  const ReturnLease = AcquireLease();
  const State = {
   revision: Revision, committedLength: CommittedLength,
   entries: Entries.slice(), readers: new Set(), released: false,
  };
  const PublicEntries = Object.freeze(State.entries.map(Entry => Object.freeze({...Entry})));
  return Object.freeze({
   revision: State.revision, committedLength: State.committedLength,
   resourceIdentity: ResourceIdentity, entries: PublicEntries,
   read: (Start, End, Options) => Read(Start, End, Options, State),
   rangeStream: (Start, End, {signal: Signal} = {}) => MakeStream(Start, End, Signal, State),
   release() {
    if (State.released) return;
    State.released = true;
    for (const Reader of [...State.readers]) Reader.stop(ReleasedError());
    State.readers.clear();
    State.entries = [];
    ReturnLease();
   },
  });
 }

 const Source = Object.freeze({
  get committedLength() { return CommittedLength; },
  get revision() { return Revision; },
  get sealed() { return Sealed; },
  get reason() { return Reason; },
  get failed() { return Failed; },
  snapshot: () => Metadata(),
  publish({sequence: Sequence, offset: Offset, file: File} = {}) {
   AssertAdmission();
   if (Sealed) throw SealedError();
   if (!NonnegativeInteger(Sequence) || !NonnegativeInteger(Offset)) throw SourceError('caption_source_sequence');
   const Size = ImmutableSize(File);
   // A duplicate must match the very same immutable byte snapshot object.
   const DuplicateIndex = EntryAt(Entries, Offset);
   const Duplicate = Entries[DuplicateIndex];
   if (Duplicate?.offset === Offset && Duplicate.sequence === Sequence && Duplicate.file === File && Duplicate.size === Size) return Metadata(false);
   const Previous = Entries[Entries.length - 1];
   if (Offset !== CommittedLength || (Previous && (Previous.sequence === Number.MAX_SAFE_INTEGER || Sequence !== Previous.sequence + 1))) {
    throw SourceError('caption_source_sequence');
   }
   if (Size > MaxBytes - Offset || Entries.length >= MaxEntries) throw SourceError('caption_source_budget');
   const End = Offset + Size, NewRevision = NextRevision();
   Entries.push(Object.freeze({sequence: Sequence, offset: Offset, size: Size, end: End, file: File}));
   CommittedLength = End;
   Revision = NewRevision;
   Notify();
   return Metadata(false);
  },
  seal({reason: SealReason, finalBytes: FinalBytes} = {}) {
   AssertAdmission();
   if (!['eof', 'finish', 'source-lost'].includes(SealReason) || !NonnegativeInteger(FinalBytes) || FinalBytes !== CommittedLength) {
    throw SourceError('caption_source_seal');
   }
   if (Sealed) {
    if (Reason !== SealReason) throw SourceError('caption_source_seal');
    return Metadata(false);
   }
   const NewRevision = NextRevision();
   Sealed = true;
   Reason = SealReason;
   Revision = NewRevision;
   Notify();
   return Metadata(false);
  },
  fail: Fail,
  read: (Start, End, Options) => Read(Start, End, Options),
  rangeStream: (Start, End, {signal: Signal} = {}) => MakeStream(Start, End, Signal),
  stream: ({offset: Offset = 0, signal: Signal} = {}) => MakeStream(Offset, null, Signal, null, false),
  frozen: Frozen,
  async waitForChange(ObservedRevision, {signal: Signal} = {}) {
   if (!NonnegativeInteger(ObservedRevision)) throw SourceError('caption_source_revision');
   const Context = ReaderContext(Signal);
   try { return await Change(ObservedRevision, Context); }
   finally { Context.dispose(); }
  },
  retain: () => AcquireLease(),
  release() {
   if (!Owner) return;
   Owner = false;
   // Settle missing-byte/revision waiters before an actual final disposal;
   // existing in-range reads and frozen contexts still own their file leases.
   Notify();
   References--;
   DisposeIfUnreferenced();
  },
 });
 ParentSignal?.addEventListener('abort', ParentAbort, {once: true});
 if (ParentSignal?.aborted) ParentAbort();
 return Source;
}
