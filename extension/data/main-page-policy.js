/** 자동 생성: tools/build/build-page-policy.mjs. 원본 정책은 lib/runtime-policy.js입니다. */
globalThis.MDownloaderPagePolicy = Object.freeze({
	"MaxManifestUrlChars": 8192,
	"MaxManifestBytes": 262144,
	"PlaylistWindowMs": 2500,
	"MaxBatch": 64,
	"MaxRoles": 256,
	"MediaSelector": "video, audio",
	"ThumbnailSelector": "img, picture, [poster], [class~=\"thumbnail\"]",
	"CardSelector": "article, li, [role=\"listitem\"], [data-card]",
	"PreviewSelector": ".preview, .hover-preview, [data-hover-preview]",
	"AdSlotSelector": ".ima-ad-container, [data-ad-slot][data-ad-client], [data-ad-slot][data-ad-format]",
	"ManifestMessage": "mdownloader-hls-manifest"
});
