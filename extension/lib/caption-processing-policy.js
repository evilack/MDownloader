// These are native-messaging framing limits, separate from tunable processing
// choices in bootstrap.json. Build tooling and the extension use one validator.
export const CaptionProtocolLimits=Object.freeze({messageBytes:800000,chunkBytes:256*1024});
export const CaptionPackageLimits=Object.freeze({fileBase64Chars:1398104,bundleBytes:2*1024*1024,sourceBytes:1024*1024});
export function ValidateCaptionProcessingPolicy(Value){
 const Keys=['sampleRate','chunkSeconds','coreSeconds','contextSeconds','maxQueuedWindows','maxWindowBytes','maxPcmWindows','maxRepairAttempts','pollIntervalMs','cancelGraceMs','resultPageItems','resultPageBytes','uploadChunkBytes',
  'maxLedgerBytes','maxJobBytes','maxDiskBytes','minFreeBytes','maxWindows','maxWorkerResultBytes','workerStartupMs','workerInferenceMs','maxInferenceSessions','retentionMs'];
 if(!Value||Keys.some(Key=>!Number.isSafeInteger(Value[Key])||Value[Key]<=0)||
  Value.coreSeconds+2*Value.contextSeconds>Value.chunkSeconds||
  !Number.isSafeInteger((Value.chunkSeconds+2*Value.contextSeconds)*Value.sampleRate)||
  Value.uploadChunkBytes>CaptionProtocolLimits.chunkBytes||Value.uploadChunkBytes>Value.maxWindowBytes||
  Math.ceil(Value.uploadChunkBytes/3)*4>=CaptionProtocolLimits.messageBytes||
  Value.resultPageBytes>=CaptionProtocolLimits.messageBytes)throw Error('caption_processing_policy_invalid');
 return Object.freeze({...Value});
}
