/** 탐지 결과와 스캔의 세션 저장 키를 조립합니다. 화면은 워커의 네트워크 파서를 가져오지 않고 이 키만 구독합니다. */
export const NetworkCachePrefix = 'network:';
export const NetworkCacheKey = TabId => NetworkCachePrefix + TabId;
export const RequestContextCachePrefix = 'request-context:';
export const RequestContextCacheKey = TabId => RequestContextCachePrefix + TabId;
export const MediaContextCachePrefix = 'media-context:';
export const MediaContextCacheKey = TabId => MediaContextCachePrefix + TabId;
export const SourceMetadataCachePrefix = 'source-metadata:';
export const SourceMetadataCacheKey = TabId => SourceMetadataCachePrefix + TabId;
export const ScanStorageKey = (TabId, Scope) => (Scope === 'sidepanel' ? 'sidepanel-scan:' : 'scan:') + TabId;
