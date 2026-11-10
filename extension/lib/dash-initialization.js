/** DASH가 명시한 초기화 파일만 독립 MP4 후보에서 제외합니다. 서명·문서 경계를 유지합니다. */
import {RuntimePolicy} from './runtime-policy.js';
import {MediaResourceKey} from './media.js';
import {RememberDashInitialization} from '../network.js';
const Probes = new Map();

export async function DiscoverDashInitialization(TabId, DocumentId, Page, Observed)
{
	const Items = Observed.filter(Item => Item.format === 'MPD' && Item.documentId === DocumentId &&
		Item.initiator === new URL(Page).origin);
	const Keys = new Map(Items.map(Item => [Item, JSON.stringify([TabId, DocumentId, Page, Item.url])]));
	// 기존 결과는 모두 합칩니다. 아직 읽지 않은 MPD를 먼저 처리해 앞의 광고/실패가 뒤의 본편을 막지 않게 합니다.
	const Work = new Set([...Items.filter(Item => !Probes.has(Keys.get(Item))), ...Items.filter(Item =>
	{
		const Previous = Probes.get(Keys.get(Item));
		return Previous && (Previous.text !== Item.dashManifest || Date.now() - Previous.started >= RuntimePolicy.Detection.NativeManifestRetryMs);
	})].slice(0, RuntimePolicy.Detection.NativeManifestProbesPerScan));
	const Results = await Promise.all(Items.map(async Item =>
	{
		const Key = Keys.get(Item);
		let Probe = Probes.get(Key);
		if (Work.has(Item))
		{
			Probe = {started: Date.now(), text: Item.dashManifest};
			Probes.set(Key, Probe);
			if (Probes.size > RuntimePolicy.Detection.MaxObservedMedia) Probes.delete(Probes.keys().next().value);
			Probe.result = (async() =>
			{
				try
				{
					const [Frame] = await chrome.scripting.executeScript({target: {tabId: TabId, documentIds: [DocumentId]},
						func: ParseDashInitializationUrls, args: [Item.dashManifest ?? null, Item.url, Page, RuntimePolicy.Dash.MaxRepresentations,
							RuntimePolicy.Detection.MaxObservedManifestBytes, RuntimePolicy.Detection.NativeManifestTimeoutMs]});
					if (Frame?.documentId !== DocumentId || !Array.isArray(Frame.result)) return [];
					return await RememberDashInitialization(TabId, DocumentId, Page, Item.url, Frame.result) ?? Frame.result;
				}
				catch {return [];}
			})();
		}
		return [...(Item.resources ?? []), ...await (Probe?.result ?? [])];
	}));
	return new Set(Results.flat().map(MediaResourceKey));
}

/** 주입 함수입니다. XML은 페이지 문서에 삽입하지 않으며 외부 링크도 따라가지 않습니다. */
export async function ParseDashInitializationUrls(Text, Address, Page, Limit, MaxBytes = 262144, TimeoutMs = 5000)
{
	if (location.href !== Page) return [];
	if (Text === null)
	{
		// 동일 MPD의 새 요청은 CDN·서명을 바꿀 수 있습니다. 플레이어 문서의 원래 캐시를 우선 사용합니다.
		const Response = await fetch(Address, {credentials: 'omit', cache: 'force-cache', redirect: 'error', signal: AbortSignal.timeout(TimeoutMs)});
		const Reader = Response.body?.getReader();
		if (!Reader) return [];
		const Decoder = new TextDecoder();
		let Bytes = 0;
		Text = '';
		try
		{
			if (Response.status !== 200) return [];
			for (;;)
			{
				const {done: Done, value: Part} = await Reader.read();
				if (Done) break;
				Bytes += Part.byteLength;
				if (Bytes > MaxBytes) return [];
				Text += Decoder.decode(Part, {stream: true});
			}
			Text += Decoder.decode();
		}
		finally {await Reader.cancel().catch(() => {}); Reader.releaseLock();}
	}
	if (location.href !== Page || typeof Text !== 'string' || Text.length > MaxBytes || /<!DOCTYPE|<!ENTITY/i.test(Text)) return [];
	const Xml = new DOMParser().parseFromString(Text, 'application/xml');
	const Mpd = Xml.documentElement;
	const Namespace = 'urn:mpeg:dash:schema:mpd:2011';
	if (Xml.querySelector('parsererror') || Mpd.localName !== 'MPD' || Mpd.namespaceURI !== Namespace) return [];
	const Children = (Node, Name) => [...Node.children].filter(Item => Item.namespaceURI === Namespace && Item.localName === Name);
	const Resolve = (Value, Base) =>
	{
		const Url = new URL(Value, Base);
		if (!['http:', 'https:'].includes(Url.protocol) || Url.username || Url.password) throw Error('invalid resource');
		Url.hash = '';
		return Url.href;
	};
	const Resources = new Set();
	let Count = 0;
	for (const Period of Children(Mpd, 'Period')) for (const Adaptation of Children(Period, 'AdaptationSet'))
	for (const Representation of Children(Adaptation, 'Representation'))
	{
		if (++Count > Limit) return [];
		try
		{
			let Base = Address, Type, Initialization, Template;
			for (const Node of [Mpd, Period, Adaptation, Representation])
			{
				if (Node.hasAttributeNS('http://www.w3.org/1999/xlink', 'href')) throw Error('external link');
				const XmlBase = Node.getAttributeNS('http://www.w3.org/XML/1998/namespace', 'base');
				if (XmlBase) Base = Resolve(XmlBase, Base);
				const Bases = Children(Node, 'BaseURL');
				if (Bases.length > 1) throw Error('ambiguous base');
				if (Bases.length) Base = Resolve(Bases[0].textContent.trim(), Base);
				const Addressing = [...Node.children].filter(Item => Item.namespaceURI === Namespace &&
					['SegmentTemplate', 'SegmentList', 'SegmentBase'].includes(Item.localName));
				if (Addressing.length > 1) throw Error('ambiguous addressing');
				if (!Addressing.length) continue;
				const [Segment] = Addressing;
				if (Segment.localName !== Type) {Type = Segment.localName; Initialization = undefined; Template = undefined;}
				if (Type === 'SegmentTemplate' && Segment.hasAttribute('initialization')) Template = Segment.getAttribute('initialization');
				const Init = Children(Segment, 'Initialization')[0];
				if (Init) Initialization = Init;
			}
			let Source;
			if (Type === 'SegmentTemplate' && Template)
			{
				Source = Template.replace(/\$\$|\$([^$]+)\$|\$/g, (Match, Token) =>
				{
					if (Match === '$$') return '$';
					const [, Name, Width] = /^(RepresentationID|Bandwidth)(?:%0(\d{1,2})d)?$/.exec(Token ?? '') ?? [];
					if (!Name || (Name === 'RepresentationID' && Width) || Number(Width) > 20) throw Error('unsupported template');
					const Value = Representation.getAttribute(Name === 'RepresentationID' ? 'id' : 'bandwidth');
					if (Value === null) throw Error('missing template value');
					return Value.padStart(Number(Width) || 0, '0');
				});
			}
			// SegmentBase/바이트 범위 초기화는 완전한 MP4와 주소를 공유할 수 있어 숨기지 않습니다.
			if (Type === 'SegmentList' && Initialization && !Initialization.hasAttribute('range')) Source = Initialization.getAttribute('sourceURL');
			if (Source) Resources.add(Resolve(Source, Base));
		}
		catch { /* 해석이 불명확하면 해당 파일을 추측해 숨기지 않습니다. */ }
	}
	return [...Resources];
}
