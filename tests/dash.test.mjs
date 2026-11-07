import Assert from 'node:assert/strict';
import { execFile as ExecFile } from 'node:child_process';
import { existsSync as ExistsSync } from 'node:fs';
import { mkdtemp as Mkdtemp, readFile as ReadFile, realpath as Realpath, rm as Rm } from 'node:fs/promises';
import { createServer as CreateServer } from 'node:http';
import { tmpdir as Tmpdir } from 'node:os';
import { dirname as Dirname, join as Join } from 'node:path';
import { test as Test } from 'node:test';
import { promisify as Promisify } from 'node:util';
const Chrome = [process.env.CHROME_PATH,
	...[process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA]
	.filter(Boolean).map(Root => Join(Root, 'Google', 'Chrome', 'Application', 'chrome.exe')),
	'/usr/bin/chromium', '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].find(Path => Path && ExistsSync(Path));
async function ParseInChrome(Cases)
{
	const TempRoot = await Realpath(Tmpdir());
	const Profile = await Mkdtemp(Join(TempRoot, 'mdownloader-dash-'));
	const Server = CreateServer(async (Request, Response) =>
	{
		const ModulePath = /^\/([a-z0-9-]+\.js)$/.exec(Request.url);
		if (ModulePath)
		{
			try
			{
				const Source = await ReadFile(new URL(`../extension/lib/${ModulePath[1]}`, import.meta.url));
				Response.writeHead(200, { 'Content-Type': 'text/javascript' }).end(Source);
			}
			catch
			{
				Response.writeHead(404).end();
			}
			return;
		}
		Response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(`<!doctype html>
      <body><script type="module">
        import * as dash from './dash.js';
        const cases = ${JSON.stringify(Cases).replaceAll('<', '\\u003c')};
        const address = 'https://example.test/path/stream.mpd';
        const result = await Promise.all(cases.map(async (fixture) => {
          try {
            if (typeof fixture === 'string') return dash.ParseDash(fixture, address);
            const requests = [];
            const parsed = dash.ParseDash(fixture.text, address);
            const expanded = await dash.ResolveDash(fixture.text, address, async (url, range) => {
              requests.push({ url, range });
              return Uint8Array.from(fixture.bytes);
            });
            return { parsed, expanded, requests };
          }
          catch (error) { return { error: error.key ?? error.message }; }
        }));
        document.body.replaceChildren(document.createTextNode(encodeURIComponent(JSON.stringify(result))));
      </script></body>`);
	});
	try
	{
		await new Promise(Resolve => Server.listen(0, '127.0.0.1', Resolve));
		const Args = ['--headless', '--disable-gpu', '--disable-extensions', '--no-first-run', '--disable-background-networking',
			`--user-data-dir=${Profile}`, '--dump-dom', `http://127.0.0.1:${Server.address().port}`];
		if (process.getuid?.() === 0)
		{
			Args.unshift('--no-sandbox');
		}
		const { stdout: Stdout } = await Promisify(ExecFile)(Chrome, Args, { timeout: 25_000 });
		const Result = Stdout.match(/<body>(%5B.+%5D)<\/body>/s);
		Assert.ok(Result, 'Chrome did not run the DASH parser');
		return JSON.parse(decodeURIComponent(Result[1]));
	}
	finally
	{
		await new Promise(Resolve => Server.close(Resolve));
		const ResolvedProfile = await Realpath(Profile);
		Assert.equal(Dirname(ResolvedProfile), TempRoot);
		Assert.equal(ResolvedProfile, Profile);
		await Rm(ResolvedProfile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
	}
}

Test('expands DASH templates and selects clear H.264 video plus main AAC audio', { skip: !Chrome }, async () =>
{
	const [Playlist] = await ParseInChrome([`<m:MPD xmlns:m="urn:mpeg:dash:schema:mpd:2011" mediaPresentationDuration="PT5S">
    <m:BaseURL>../media/</m:BaseURL><m:Period><m:BaseURL>cut/</m:BaseURL>
      <m:AdaptationSet mimeType="video/mp4" codecs="avc1.64001f">
        <m:SegmentTemplate timescale="10" presentationTimeOffset="100" startNumber="7"
          initialization="$RepresentationID$/init.mp4" media="$RepresentationID$/$Number%03d$-$Time$-$$.m4s">
          <m:SegmentTimeline><m:S t="100" d="20" r="-1"/><m:S t="140" d="10"/></m:SegmentTimeline>
        </m:SegmentTemplate>
        <m:Representation id="low" bandwidth="500"/>
        <m:Representation id="high" bandwidth="1500"><m:BaseURL>primary/</m:BaseURL></m:Representation>
        <m:Representation id="av1" bandwidth="3000" codecs="av01.0.12M.08"/>
      </m:AdaptationSet>
      <m:AdaptationSet mimeType="audio/mp4" codecs="mp4a.40.2"><m:Role schemeIdUri="urn:mpeg:dash:role:2011" value="main"/>
        <m:Representation id="aac" bandwidth="100"><m:SegmentTemplate timescale="1" duration="2" presentationTimeOffset="2"
          initialization="audio-init.mp4" media="audio-$Bandwidth$-$Number$.m4s"/></m:Representation>
      </m:AdaptationSet>
      <m:AdaptationSet mimeType="audio/mp4" codecs="mp4a.40.2">
        <m:Representation id="alternate" bandwidth="200"><m:SegmentTemplate duration="5" media="alt-$Number$.m4s"/></m:Representation>
      </m:AdaptationSet>
    </m:Period></m:MPD>`]);
	Assert.deepEqual(Playlist.video, { ended: true, presentationTimeOffset: 10, segments: [
			{ url: 'https://example.test/media/cut/primary/high/007-100-$.m4s', duration: 2, sequence: 7,
				init: { url: 'https://example.test/media/cut/primary/high/init.mp4' } },
			{ url: 'https://example.test/media/cut/primary/high/008-120-$.m4s', duration: 2, sequence: 8,
				init: { url: 'https://example.test/media/cut/primary/high/init.mp4' } },
			{ url: 'https://example.test/media/cut/primary/high/009-140-$.m4s', duration: 1, sequence: 9,
				init: { url: 'https://example.test/media/cut/primary/high/init.mp4' } },
		] });
	Assert.equal(Playlist.audio.presentationTimeOffset, 2);
	Assert.deepEqual(Playlist.audio.segments.map(({ url: Url, duration: Duration }) => [Url, Duration]), [
		['https://example.test/media/cut/audio-100-1.m4s', 2],
		['https://example.test/media/cut/audio-100-2.m4s', 2],
		['https://example.test/media/cut/audio-100-3.m4s', 1],
	]);
});
Test('preserves inclusive byte ranges in SegmentList and rejects DRM, live and excessive expansion', { skip: !Chrome }, async () =>
{
	const List = `<MPD mediaPresentationDuration="PT3S"><Period><AdaptationSet mimeType="video/mp4" codecs="avc1.4d401f">
    <Representation id="main" bandwidth="123"><BaseURL>video.mp4</BaseURL>
      <SegmentList duration="2"><Initialization range="0-999"/>
        <SegmentURL mediaRange="1000-1999"/><SegmentURL mediaRange="2000-2999"/>
      </SegmentList></Representation></AdaptationSet></Period></MPD>`;
	const [Ranged, ProtectedTrack, Live, Oversized, Invalid, External] = await ParseInChrome([
		List, List.replace('<SegmentList', '<ContentProtection schemeIdUri="urn:mpeg:dash:mp4protection:2011"/><SegmentList'),
		List.replace('<MPD ', '<MPD type="dynamic" '),
		List.replace('PT3S', 'PT10002S').replace(/<SegmentList[\s\S]*?<\/SegmentList>/,
		'<SegmentTemplate duration="2" initialization="init.mp4" media="part-$Number$.mp4"/>'), '<MPD><Period>',
		List.replace('</Period>', '<AdaptationSet xmlns:xlink="http://www.w3.org/1999/xlink" xlink:href="audio.xml"/></Period>'),
	]);
	Assert.deepEqual(Ranged.video.segments, [
		{ url: 'https://example.test/path/video.mp4', duration: 2, sequence: 1, range: { start: 1000, end: 1999 },
			init: { url: 'https://example.test/path/video.mp4', range: { start: 0, end: 999 } } },
		{ url: 'https://example.test/path/video.mp4', duration: 1, sequence: 2, range: { start: 2000, end: 2999 },
			init: { url: 'https://example.test/path/video.mp4', range: { start: 0, end: 999 } } },
	]);
	Assert.equal(ProtectedTrack.error, 'stream_dash_encrypted');
	Assert.equal(Live.error, 'stream_dash_static_only');
	Assert.equal(Oversized.error, 'stream_dash_too_many_segments');
	Assert.ok(['stream_dash_invalid_mpd', 'stream_dash_no_track'].includes(Invalid.error));
	Assert.equal(External.error, 'stream_dash_xlink_unsupported');
});
Test('uses exact fixed-duration boundaries and handles a one-segment list', { skip: !Chrome }, async () =>
{
	const Mpd = Addressing => `<MPD mediaPresentationDuration="PT2.007S"><Period>
    <AdaptationSet mimeType="video/mp4" codecs="avc1.4d401f"><Representation id="main" bandwidth="123">
      ${Addressing}</Representation></AdaptationSet></Period></MPD>`;
	const [Fixed, List, MissingInit] = await ParseInChrome([
		Mpd('<SegmentTemplate timescale="1000" duration="669" startNumber="5" presentationTimeOffset="123" initialization="init.mp4" media="$Number$-$Time$.m4s"/>'),
		Mpd('<SegmentList><Initialization sourceURL="init.mp4"/><SegmentURL media="only.m4s"/></SegmentList>'),
		Mpd('<SegmentTemplate timescale="1000" duration="669" media="$Number$.m4s"/>'),
	]);
	Assert.deepEqual(Fixed.video.segments.map(Segment => Segment.url), [
		'https://example.test/path/5-0.m4s', 'https://example.test/path/6-669.m4s', 'https://example.test/path/7-1338.m4s',
	]);
	Assert.equal(List.video.segments[0].duration, 2.007);
	Assert.equal(MissingInit.error, 'stream_dash_init_url_missing');
});
function SidxFixture(Version, FirstOffset, References, PrefixLength = 0, bExtendedSize = false)
{
	const HeaderLength = bExtendedSize ? 16 : 8;
	const FieldsLength = Version ? 32 : 24;
	const BoxLength = HeaderLength + FieldsLength + References.length * 12;
	const Bytes = new Uint8Array(PrefixLength + BoxLength);
	const View = new DataView(Bytes.buffer);
	if (PrefixLength)
	{
		View.setUint32(0, PrefixLength);
		View.setUint32(4, 0x66726565);
		// free

	}
	View.setUint32(PrefixLength, bExtendedSize ? 1 : BoxLength);
	View.setUint32(PrefixLength + 4, 0x73696478);
	// sidx
	if (bExtendedSize)
	{
		View.setBigUint64(PrefixLength + 8, BigInt(BoxLength));
	}
	const Fields = PrefixLength + HeaderLength;
	View.setUint8(Fields, Version);
	View.setUint32(Fields + 4, 1);
	// reference ID
	View.setUint32(Fields + 8, 1000);
	if (Version)
	{
		View.setBigUint64(Fields + 20, BigInt(FirstOffset));
	}
	else
	{
		View.setUint32(Fields + 16, FirstOffset);
	}
	View.setUint16(Fields + FieldsLength - 2, References.length);
	References.forEach(([Size, Duration, Hierarchical], Index) =>
	{
		const Entry = Fields + FieldsLength + Index * 12;
		View.setUint32(Entry, (Hierarchical ? 0x80000000 : 0) + Size);
		View.setUint32(Entry + 4, Duration);
	});
	return [...Bytes];
}

Test('resolves flat SegmentBase indexes to inclusive absolute ranges', { skip: !Chrome }, async () =>
{
	const Mpd = End => `<MPD mediaPresentationDuration="PT2S"><Period>
    <AdaptationSet mimeType="video/mp4" codecs="avc1.4d401f"><SegmentBase timescale="1000" presentationTimeOffset="25"/>
      <Representation id="main" bandwidth="123"><BaseURL>video.mp4?signature=a%2Bb</BaseURL>
      <SegmentBase indexRange="100-${End}"><Initialization range="0-99"/></SegmentBase>
      </Representation></AdaptationSet></Period></MPD>`;
	const Standard = SidxFixture(0, 7, [[100, 1200], [50, 800]], 12);
	const Large = SidxFixture(1, 4294967308, [[80, 2000]], 0, true);
	const [V0, V1, Nested, Truncated, Missing, Overflow] = await ParseInChrome([
		{ text: Mpd(167), bytes: Standard },
		{ text: Mpd(159), bytes: Large },
		{ text: Mpd(143), bytes: SidxFixture(0, 0, [[80, 2000, true]]) },
		{ text: Mpd(167), bytes: Standard.slice(0, -1) },
		{ text: Mpd(107), bytes: [0, 0, 0, 8, 102, 114, 101, 101] },
		{ text: Mpd(159), bytes: SidxFixture(1, Number.MAX_SAFE_INTEGER, [[80, 2000]], 0, true) },
	]);
	const Url = 'https://example.test/path/video.mp4?signature=a%2Bb';
	const Init = { url: Url, range: { start: 0, end: 99 } };
	Assert.equal(V0.error, undefined);
	Assert.equal(V1.error, undefined);
	Assert.deepEqual(V0.parsed.video, { segments: [], ended: true, presentationTimeOffset: 0.025,
		index: { url: Url, range: { start: 100, end: 167 }, init: Init } });
	Assert.deepEqual(V0.requests, [{ url: Url, range: { start: 100, end: 167 } }]);
	Assert.deepEqual(V0.expanded.video, { ended: true, presentationTimeOffset: 0.025, segments: [
			{ url: Url, range: { start: 175, end: 274 }, duration: 1.2, sequence: 1, init: Init },
			{ url: Url, range: { start: 275, end: 324 }, duration: 0.8, sequence: 2, init: Init },
		] });
	Assert.deepEqual(V1.expanded.video.segments[0].range, { start: 4294967468, end: 4294967547 });
	Assert.equal(Nested.error, 'stream_dash_sidx_hierarchical');
	Assert.equal(Truncated.error, 'stream_dash_sidx_range_mismatch');
	Assert.equal(Missing.error, 'stream_dash_sidx_missing');
	Assert.equal(Overflow.error, 'stream_dash_sidx_segment_range');
});
