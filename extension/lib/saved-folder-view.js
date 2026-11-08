const MediaTypes = new Map(Object.entries({mp4:'video/mp4',webm:'video/webm',mp3:'audio/mpeg',m4a:'audio/mp4',aac:'audio/aac',ogg:'audio/ogg',wav:'audio/wav'}));
export const SavedMediaMime = Name => MediaTypes.get(Name.split('.').at(-1).toLowerCase());
/** The resolved output stays visible even when the directory has many entries. */
export async function SelectedFolderEntries(Folder, SelectedName)
{
	const Entries = [{name: SelectedName, kind: 'file'}];
	for await (const Entry of Folder.values())
	{
		if (Entry.name === SelectedName) continue;
		if (Entries.length === 1000) return {entries: Entries, truncated: true};
		Entries.push({name: Entry.name, kind: Entry.kind});
	}
	return {entries: Entries, truncated: false};
}
