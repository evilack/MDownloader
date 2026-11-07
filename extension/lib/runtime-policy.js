/**
 * 확장의 기본 동작을 정하는 값입니다. 사용자 선택은 settings.js에서 따로 읽고,
 * 브라우저나 미디어 표준이 정한 값은 해당 API를 해석하는 모듈에서 관리합니다.
 * 화면과 워커가 같은 제한을 읽으므로, 각 호출부에서 숫자를 반복해서 적을 필요가 없습니다.
 */
export const Units = Object.freeze({
	MillisecondsPerSecond: 1000,
	SecondsPerMinute: 60,
	MinutesPerHour: 60,
	HoursPerDay: 24,
	PercentScale: 100,
	DecimalKilo: 1000,
	DecimalMega: 1000 ** 2,
	BytesPerMebibyte: 1024 ** 2,
});
export const RuntimePolicy = Object.freeze({
	// 상세 실행 진단은 콘솔과 문맥별 제한 버퍼에만 남깁니다. OFF에는 전용 타이머가 없습니다.
	Debug: Object.freeze({ MaxEntries: 256, MaxTraceEvents: 32, EventIntervalMs: 250, ProgressIntervalMs: 1000 }),
	// 목록은 연속으로 발생하는 네트워크 이벤트를 모아 한 번에 갱신합니다.
	Detection: Object.freeze({
		MaxUrlChars: 8192,
		RefreshDelayMs: 150,
		PlaylistPathDepth: 3,
		MaxObservedMedia: 64,
		MaxMediaContextUrls: 256,
		MaxMediaContextDocuments: 16,
		MaxPendingHeaders: 128,
		MaxObservedManifestBytes: 256 * 1024,
		NativeManifestProbesPerScan: 2,
		NativeManifestRetryMs: 30_000,
		NativeManifestTimeoutMs: 5000,
		MaxPlayerComponentAncestors: 96,
		MaxPlayerHooks: 48,
		MaxSourceIdentityChars: 256,
		SourceRefreshMs: 15_000,
		MetadataRefreshMs: 30_000,
		AuxiliaryPlayerSelector: 'a[href], [role="link"], article, li, [role="listitem"], [data-card], [hidden], [aria-hidden="true"]',
		// 선택 소스의 선언을 조사할 때는 링크 안의 대표 플레이어도 허용합니다.
		// 실제 카드·광고 역할은 별도 관측 결과로 계속 제외합니다.
		SourcePlayerSelector: '[hidden], [aria-hidden="true"], .preview, .hover-preview, [data-hover-preview]',
		MaxSourceConfigBytes: Units.BytesPerMebibyte,
		MaxMetadataProbes: 5,
		DeclaredVariantProbeLanes: 2,
		MaxBadgeCount: 999,
	}),

	// 미리보기는 전체 영상 대신 짧은 구간과 작은 이미지만 유지합니다.
	Preview: Object.freeze({
		StreamTimeoutMs: 20_000,
		HoverOpenDelayMs: 160,
		HoverCloseDelayMs: 140,
		ViewportInsetPx: 8,
		AnchorGapPx: 6,
		PreferredWidthPx: 340,
		MinAdjacentWidthPx: 180,
		ThumbnailRetryDelaysMs: Object.freeze([250, 500, 1000, 2000, 4000, 8000, 8000]),
		ThumbnailRefreshMs: 15_000,
		ThumbnailReadTimeoutMs: 5000,
		MissingThumbnailRetryMs: 30_000,
		ThumbnailSamplesPerBatch: 2,
		ThumbnailSampleTimeoutMs: 10_000,
		ThumbnailFrame: Object.freeze({ maxWidth: 112, maxHeight: 63, jpegQuality: 0.75 }),
		HoverFrame: Object.freeze({ maxWidth: 480, maxHeight: 270, jpegQuality: 0.75 }),
		PlaybackCapture: Object.freeze({
			durationMs: 1500,
			timeoutMs: 3000,
			bitsPerSecond: 900_000,
			maxBytes: Units.BytesPerMebibyte,
		}),
		SampleTimeoutMs: 5000,
		ThumbnailSeekSeconds: 1,
		ShortSegmentSeconds: 2,
		MaxSampleBytes: 8 * Units.BytesPerMebibyte,
		MaxCachedThumbnails: 128,
		MaxCachedSamples: 24,
	}),

	// 네트워크·임시 저장소·병렬 처리에 상한을 두어 한 작업이 브라우저 전체를 점유하지 않게 합니다.
	Transfer: Object.freeze({
		FirstHeaderRuleId: 40000,
		MaxHeaderRules: 5000,
		RequestTimeoutMs: 30_000,
		MaxSnapshotMetadataBytes: 4 * Units.BytesPerMebibyte,
		BrowserSavePollMs: 500,
		MinLiveRefreshMs: 500,
		ProgressReportIntervalMs: 750,
		MaxVariants: 100,
		MaxLanes: 4,
		ObservedRequestLanes: 2,
		MaxAttempts: 3,
		MaxSegments: 5000,
		MaxScratchBytes: 2048 * Units.BytesPerMebibyte,
		// 고화질 장편 스트림의 디스크 임시 저장 상한입니다. 실제 브라우저 저장 공간 한도는 별도로 적용됩니다.
		MaxStreamScratchBytes: 16 * 1024 * Units.BytesPerMebibyte,
		MaxSegmentBytes: 32 * Units.BytesPerMebibyte,
		MaxPlaylistBytes: Units.BytesPerMebibyte,
		MaxDashIndexBytes: Units.BytesPerMebibyte,
		RemuxReadCacheBytes: Units.BytesPerMebibyte,
		RemuxWriteChunkBytes: Units.BytesPerMebibyte,
	}),

	// 브라우저 다운로드 이벤트에 누락된 바이트만 화면이 보일 때 주기적으로 확인합니다.
	Jobs: Object.freeze({
		RefreshIntervalMs: 1000,
		SpeedSampleMs: 750,
		BrowserLookupBatchSize: 16,
		MaxLogEntries: 200,
		MaxRememberedDenials: 64,
	}),

	// 긴 제목도 원본 파일명과 확장자를 포함할 수 있도록 길이 예산을 나눕니다.
	Filename: Object.freeze({
		MaxStemLength: 100,
		MinTitleBudget: 32,
		TitleSeparator: '_',
		PartialStem: 'partial',
		MaxFolderNameLength: 255,
	}),

	// 외부 XML에서 생성하는 표현·주소 수와 길이에 상한을 적용합니다.
	Dash: Object.freeze({
		MaxMpdCodeUnits: 4_194_304,
		MaxRepresentations: 200,
		MaxSegmentUrlLength: 8192,
		MaxTemplatePadding: 20,
	}),
});

/** .invalid는 RFC 2606 예약 도메인입니다. 아래 주소는 캐시 식별자와 상대 경로
 * 파싱 기준으로만 쓰며 실제 사이트·CDN으로 요청하지 않습니다. 캐시 호환성을 유지합니다. */
export const InternalMediaOrigin = 'https://mdownloader.invalid';

/** 클래식 스크립트는 모듈을 import할 수 없어 build-page-policy로 같은 값을 생성합니다.
 * MAIN의 값은 페이지가 바꿀 수 있으므로 권한·문서·본문 상한은 워커가 별도로 검증합니다. */
export const PagePolicy = Object.freeze({
	MaxManifestUrlChars: RuntimePolicy.Detection.MaxUrlChars,
	MaxManifestBytes: RuntimePolicy.Detection.MaxObservedManifestBytes,
	PlaylistWindowMs: 2500,
	MaxBatch: RuntimePolicy.Detection.MaxObservedMedia,
	MaxRoles: RuntimePolicy.Detection.MaxMediaContextUrls,
	MediaSelector: 'video, audio',
	ThumbnailSelector: 'img, picture, [poster], [class~="thumbnail"]',
	CardSelector: 'article, li, [role="listitem"], [data-card]',
	PreviewSelector: '.preview, .hover-preview, [data-hover-preview]',
	AdSlotSelector: '.ima-ad-container, [data-ad-slot][data-ad-client], [data-ad-slot][data-ad-format]',
	ManifestMessage: 'mdownloader-hls-manifest',
});
