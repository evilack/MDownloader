/**
 * 브라우저가 보고한 바이트와 시간으로 진행률과 속도를 계산합니다. 전송이 끝난 작업은 전체 평균 속도를 표시하고, HLS 조각을 모두 받아도 파일 저장이 끝나기 전에는 100%로 표시하지 않습니다.
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
	Percentage = new Intl.NumberFormat(Locale, { style: 'percent' });
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

function TransferPercent(Item)
{
	if (Item.state === 'active' && (Item.hls || Item.recording))
	{
		if (Item.live || !(Item.count > 0))
		{
			return null;
		}
		// 스트림은 MP4가 저장된 뒤에 완료됩니다. 조각을 다 받은 시점에는 100%보다 낮게 표시합니다.
		return Math.max(0, Math.min(ProgressMax - 1, Math.floor(ProgressMax * (Item.finished ?? 0) / Item.count)));
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
	if (Item.state === 'complete')
	{
		const Seconds = (Date.parse(Item.endTime) - Date.parse(Item.startTime)) / Units.MillisecondsPerSecond;
		const Average = Seconds > 0 && Bytes >= 0 ? Translate('view_metric_rate', Size(Bytes / Seconds)) : '—';
		return {
			progress: Percentage.format(1), speed: Translate('view_metric_average_rate', Average), percent: ProgressMax,
		};
	}
	const Percent = TransferPercent(Item);
	const Elapsed = Previous ? (Now - Previous.time) / Units.MillisecondsPerSecond : 0;
	const Speed = !Item.paused && Elapsed > 0 && Bytes >= Previous.bytes
	? Translate('view_metric_rate', Size((Bytes - Previous.bytes) / Elapsed)) : '—';
	const Progress = Percent === null ? Size(Bytes || 0) : Percentage.format(Percent / ProgressMax);
	return { progress: Progress, speed: Speed, percent: Percent };
}
