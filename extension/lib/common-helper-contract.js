// The OS bridge protocol is independent from the extension-owned speech package.
export const MinimumHelperVersion=9;
export const MinimumWindowsHelperRevision=2;
export function CommonHelperConnected(Value){return !!(Value?.ok&&Value.protocol===1);}
export function HelperVersionLabel(Value){return Value?.helperVersion===undefined?'':String(Value.helperVersion)+(Number.isInteger(Value.helperRevision)?'.'+Value.helperRevision:'');}
export function CaptionSetupReady(Value){
 if(!CommonHelperConnected(Value)||!(Value.helperVersion>=MinimumHelperVersion))return false;
 const SupportedRevision=Value.helperVersion>MinimumHelperVersion||Value.platform==='mac'||Value.helperRevision>=1;
 return SupportedRevision&&['captionSetup','captionPackageUpdate','genericPackageManifest'].every(Name=>Value.capabilities?.includes(Name));
}
export function CommonHelperReady(Value){
 return CaptionSetupReady(Value)&&(Value.platform==='mac'||Value.helperVersion>MinimumHelperVersion||Value.helperRevision>=MinimumWindowsHelperRevision);
}
