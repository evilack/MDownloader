import Assert from 'node:assert/strict';
import {test as Test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {HlsDecryptor} from '../extension/lib/hls-encryption.js';
const Fixture=JSON.parse(await readFile(new URL('./fixtures/hls-key-v7.json',import.meta.url),'utf8'));
const Bytes=Value=>new TextEncoder().encode(JSON.stringify(Value));
const Key=Uint8Array.from({length:16},(_,i)=>i), Iv=new Uint8Array(16);
const Plain=new TextEncoder().encode('independent synthetic media, no site keys');
const Cipher=new Uint8Array(await crypto.subtle.encrypt({name:'AES-CBC',iv:Iv},await crypto.subtle.importKey('raw',Key,'AES-CBC',false,['encrypt']),Plain));
const Resource={encryption:{method:'AES-128',url:'https://media.test/key',iv:'0'.repeat(32)}};
const Signal=new AbortController().signal;

Test('accepts a bounded version 7 JSON identity key response and decrypts media without changing raw keys',async()=>
{
	for(const Raw of [Key.slice(),Bytes(Fixture)])
	{
		const Original=Raw.slice();
		const Result=await new HlsDecryptor(async(_Resource,Limit)=>{Assert.ok(Limit>=Raw.length);return Raw;}).Decrypt(Resource,Cipher,Signal);
		Assert.deepEqual(Result,Plain);
		Assert.ok(Original.some((B,I)=>B!==Raw[I]),'consumed response bytes are cleared');
	}
});

Test('rejects malformed, oversized and unsupported key envelopes with a localized error',async()=>
{
	const Cases=[{...Fixture,version:8},{...Fixture,key_length:32},{...Fixture,total_layers:8},
		{...Fixture,layers:[...Fixture.layers,Fixture.layers[0]]},
		{...Fixture,layers:Fixture.layers.filter(L=>L.name!=='sbox')},
		{...Fixture,encrypted_key:'!not-base64!'},
		...['bit_interleave','segment_noise','decoy_shuffle'].map(Name=>({...Fixture,layers:Fixture.layers.map(L=>L.name===Name?{...L,[Name==='decoy_shuffle'?'real_positions':'perm']:Array(16).fill(0)}:L)}))];
	for(const Raw of [...Cases.map(Bytes),new Uint8Array(20000),new TextEncoder().encode('<html>blocked</html>')])
		await Assert.rejects(new HlsDecryptor(async()=>Raw).Decrypt(Resource,Cipher,Signal),{key:'stream_hls_invalid_key'});
});
