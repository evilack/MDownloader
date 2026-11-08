/** Short-lived provider thumbnail observations shared by candidate and job UI.
 * This cache grants no capture authority: callers must bind the source first. */
export function CreateSharedThumbnailCache({now: Now = () => performance.now(), ttl: Ttl = 15000, limit: Limit = 128} = {})
{
	const Entries = new Map();
	return {
		size: () => Entries.size,
		async read(Source, Load)
		{
			const Key = JSON.stringify([Source.tabId, Source.documentId, Source.page, Source.url]);
			let Entry = Entries.get(Key);
			if (Entry && Entry.expires > Now()) return Entry.pending;
			Entry = {expires: Now() + Ttl};
			Entry.pending = Promise.resolve().then(Load);
			Entries.delete(Key); Entries.set(Key, Entry);
			while (Entries.size > Limit) Entries.delete(Entries.keys().next().value);
			try
			{
				const Value = await Entry.pending;
				if (!Value?.some(Item => Item.still) && Entries.get(Key) === Entry) Entries.delete(Key);
				return Value;
			}
			catch (ErrorValue) { if (Entries.get(Key) === Entry) Entries.delete(Key); throw ErrorValue; }
		},
	};
}
