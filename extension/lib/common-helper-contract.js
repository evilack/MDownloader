// The OS bridge protocol is independent from the extension-owned speech package.
export const MinimumHelperVersion=9;
export const MinimumWindowsHelperRevision=1;
export function CommonHelperConnected(Value){return !!(Value?.ok&&Value.protocol===1);}
export function HelperVersionLabel(Value){return Value?.helperVersion===undefined?'':String(Value.helperVersion)+(Number.isInteger(Value.helperRevision)?'.'+Value.helperRevision:'');}
export function CommonHelperReady(Value){return CommonHelperConnected(Value)&&Value.helperVersion>=MinimumHelperVersion&&(Value.helperVersion>MinimumHelperVersion||Value.platform==='mac'||Value.helperRevision>=MinimumWindowsHelperRevision)&&Value.capabilities?.includes('captionSetup')===true&&Value.capabilities?.includes('captionPackageUpdate')===true&&Value.capabilities?.includes('genericPackageManifest')===true;}
