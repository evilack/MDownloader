/**
 * 브라우저가 보고한 바이트와 시간으로 진행률과 속도를 계산합니다. 완료된 작업은 용량과 전체 평균 속도를 표시합니다. 음성 자막 작업은 수신 100% 뒤 자막 진행률로 전환하며, 그 외 스트림은 파일 저장 완료까지 100% 미만으로 표시합니다.
 */
import { RuntimePolicy, Units } from './runtime-policy.js';
import { GetLocale, Translate } from './i18n.js';
export const ProgressMax = Units.PercentScale;
export const SpeedSampleMs = RuntimePolicy.Jobs.SpeedSampleMs;
let Locale;
let OneDecimal;
let Integer;
let Percentage;
function UpdateFormats()
{
	const ActiveLocale = GetLocale();
	if (ActiveLocale === Locale)
	{
		return;
	}
	Locale = ActiveLocale;
	OneDecimal = new Intl.NumberFormat(Locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
	Integer = new Intl.NumberFormat(Locale, { maximumFractionDigits: 0 });
	Percentage = new Intl.NumberFormat(Locale, { style: 'percent', maximumFractionDigits: 2 });
}

function Size(Bytes)
{
	if (Bytes >= Units.DecimalMega)
	{
		return Translate('view_metric_megabytes', OneDecimal.format(Bytes / Units.DecimalMega));
	}
	if (Bytes >= Units.DecimalKilo)
	{
		return Translate('view_metric_kilobytes', OneDecimal.format(Bytes / Units.DecimalKilo));
	}
	return Translate('view_metric_bytes', Integer.format(Math.round(Bytes)));
}

/** 현재 수신량은 진행률 계산과 분리하여 같은 단위·언어로 표시합니다. */
export function FormatDownloadBytes(Bytes)
{
	UpdateFormats();
	return Size(Number.isFinite(Bytes) && Bytes > 0 ? Bytes : 0);
}

function TransferPercent(Item)
{
	if (Item.state === 'active' && (Item.hls || Item.recording || Item.youtube))
	{
		if (Item.live || !(Item.count > 0))
		{
			return null;
		}
		// Caption jobs show transfer completion before the shared bar starts its
		// separate recognition phase. Other streams keep final-save headroom.
		const Max=Item.localCaptions?.enabled&&Item.captionPipeline==='staged'&&!Item.snapshot?ProgressMax:ProgressMax-1;
		return Math.max(0, Math.min(Max, ProgressMax * (Item.finished ?? 0) / Item.count));
	}
	if (Item.totalBytes > 0 && Item.bytesReceived >= 0)
	{
		return Math.max(0, Math.min(ProgressMax, Math.floor(ProgressMax * Item.bytesReceived / Item.totalBytes)));
	}
	return null;
}

export function GetDownloadMetrics(Item, Previous, Now = Date.now())
{
	UpdateFormats();
	const Bytes = Item.bytesReceived;
	if (Item.state === 'interrupted') return {progress: Size(Bytes || 0), speed: '—', percent: null};
	if (Item.state === 'complete')
	{
		const Seconds = (Date.parse(Item.endTime) - Date.parse(Item.startTime)) / Units.MillisecondsPerSecond;
		const Average = Seconds > 0 && Bytes >= 0 ? Translate('view_metric_rate', Size(Bytes / Seconds)) : '—';
		return {
			progress: FormatDownloadBytes(Bytes), speed: Translate('view_metric_average_rate', Average), percent: ProgressMax,
		};
	}
	const Percent = TransferPercent(Item);
	const Elapsed = Previous ? (Now - Previous.time) / Units.MillisecondsPerSecond : 0;
	const Speed = !Item.paused && Elapsed > 0 && Bytes >= Previous.bytes
	? Translate('view_metric_rate', Size((Bytes - Previous.bytes) / Elapsed)) : '—';
	const Progress = Percent === null ? Size(Bytes || 0) : Percentage.format(Percent / ProgressMax);
	return { progress: Progress, speed: Speed, percent: Percent };
}
