const Mp4='video/mp4;codecs=avc1.42001f,mp4a.40.2';
const WebM='video/webm;codecs=vp8,opus';
/** One app preference; serialized page tasks receive this list as data. */
export function RecordingMimeTypes(Captions=false){return Captions?[WebM,'video/webm',Mp4]:[Mp4,WebM,'video/webm'];}
