async function Identity(Track)
{
	const Input = JSON.stringify([Track.language || 'und', Track.label || '', Track.url || '', Track.text || '', Track.segments || []]);
	const Digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(Input));
	return Array.from(new Uint8Array(Digest), Value => Value.toString(16).padStart(2, '0')).join('');
}

export async function DescribeSubtitleTracks(Tracks)
{
	return Promise.all(Tracks.map(async Track => ({id: await Identity(Track), language: Track.language || 'und', label: Track.label || Track.language || 'und'})));
}

export async function SelectSubtitleTracks(Tracks, Ids)
{
	if (!Array.isArray(Ids) || Ids.length > 128 || Ids.some(Id => typeof Id !== 'string' || !/^[a-f0-9]{64}$/.test(Id))) throw new Error('subtitle_invalid');
	const Selected = new Set(Ids), Descriptions = await DescribeSubtitleTracks(Tracks);
	if (Ids.some(Id => !Descriptions.some(Track => Track.id === Id))) throw new Error('subtitle_invalid');
	return Tracks.filter((_Track, Index) => Selected.has(Descriptions[Index].id));
}
