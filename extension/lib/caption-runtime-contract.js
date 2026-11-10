import {CaptionPackageVersion} from '../data/caption-runtime-metadata.js';
export {CaptionPackageVersion};
// The newest optional speech package must not disable a usable staged package.
export const MinimumCaptionOutputPackageVersion=4;
export function CaptionRuntimeReady(Value){return !!(Value?.connected&&Value.executionProtocol>=2&&Value.engineReady&&Value.converterReady&&Value.modelManagement&&Value.modelDownloadVersion>=3&&Value.captionTranslationVersion>=1&&Value.recognitionOptionsVersion>=1&&Value.captionPackageVersion>=MinimumCaptionOutputPackageVersion);}
export function CaptionRuntimeOutdated(Value){return !!(Value?.connected&&(!CaptionRuntimeReady(Value)||Value.captionPackageVersion<CaptionPackageVersion));}
export function CaptionRuntimeEngines(Platform){return Platform==='mac'?['whisper.cpp']:['faster-whisper','whisper.cpp'];}
