import {LocalizedError} from './i18n.js';
export const MaxHlsKeyResponseBytes = 16 * 1024;
const Invalid = () => new LocalizedError('stream_hls_invalid_key');
function Binary(Value)
{
	if (typeof Value !== 'string' || !/^[A-Za-z0-9_-]+={0,2}$/.test(Value)) throw Invalid();
	return Uint8Array.from(atob(Value.replace(/-/g, '+').replace(/_/g, '/')), C => C.charCodeAt(0));
}
function Integers(Value, Length, Min, Max, Unique = false)
{
	if (!Array.isArray(Value) || Value.length !== Length ||
		Value.some(N => !Number.isInteger(N) || N < Min || N > Max) || Unique && new Set(Value).size !== Length) throw Invalid();
	return Value;
}

/** Decode the self-described v7 identity-key transport used by the public web
 * player. This is not a DRM license/key system. Raw AES keys stay unchanged. */
export function DecodeHlsKeyResponse(Bytes, Length)
{
	if (Bytes.byteLength === Length) return Bytes;
	if (Length !== 16 || Bytes.byteLength > MaxHlsKeyResponseBytes) throw Invalid();
	try
	{
		const Data = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(Bytes));
		if (Data.version !== 7 || Data.total_layers !== 7 || Data.key_length !== 16 || !Array.isArray(Data.layers) || Data.layers.length !== 7) throw Invalid();
		const Layers = new Map(Data.layers.map(L => [L.name, L]));
		if (Layers.size !== 7) throw Invalid();
		const Bits = Integers(Layers.get('bit_interleave').perm, 128, 0, 127, true);
		const Sbox = Binary(Layers.get('sbox').inverse_sbox);
		if (Sbox.length !== 256 || new Set(Sbox).size !== 256) throw Invalid();
		const Rotations = Integers(Layers.get('bit_rotate').rotations, 8, 0, 7);
		const Noise = Layers.get('segment_noise');
		const Order = Integers(Noise.perm, 16, 0, 15, true);
		const NoiseLengths = Integers(Noise.noise_lens, 16, 0, 255);
		const Shuffle = Layers.get('decoy_shuffle');
		const Count = Shuffle.segment_lengths?.length;
		if (!Number.isInteger(Count) || Count < 16 || Count > 256 || Shuffle.decoy_count !== Count - 16) throw Invalid();
		const Lengths = Integers(Shuffle.segment_lengths, Count, 1, 256);
		Integers(Shuffle.perm, Count, 0, Count - 1, true);
		const Positions = Integers(Shuffle.real_positions, 16, 0, Count - 1, true);
		if (Positions.some((P, I) => Lengths[P] !== NoiseLengths[I] + 1)) throw Invalid();
		const Final = Layers.get('final_encrypt');
		const Mask = Binary(Final.xor_mask), Encoded = Binary(Data.encrypted_key);
		let Previous = Binary(Layers.get('xor_chain').init_key);
		const Total = Lengths.reduce((Sum, N) => Sum + N, 0);
		if (!Mask.length || Mask.length > 256 || Previous.length !== 4 ||
			!Number.isInteger(Final.pad_len) || Final.pad_len < 0 || Final.pad_len > 4096 || Encoded.length !== Total + Final.pad_len) throw Invalid();
		const Chunks = [];
		let Offset = 0;
		for (const Size of Lengths)
		{
			const Chunk = Encoded.slice(Offset, Offset + Size);
			for (let I = 0; I < Size; I++) Chunk[I] ^= Mask[(Offset + I) % Mask.length];
			Chunks.push(Chunk);
			Offset += Size;
		}
		const Rotated = new Uint8Array(16);
		for (let I = 0; I < 16; I++)
		{
			const Chunk = Chunks[Positions[I]];
			Rotated[Order[I]] = Chunk[0] ^ Previous[0];
			Previous = Chunk.subarray(0, Math.min(4, Chunk.length));
		}
		const Interleaved = Rotated.map((B, I) => Sbox[((B >>> Rotations[I % 8]) | (B << (8 - Rotations[I % 8]))) & 255]);
		const Key = new Uint8Array(16);
		for (let I = 0; I < 128; I++) Key[Bits[I] >> 3] |= ((Interleaved[I >> 3] >> (7 - (I & 7))) & 1) << (7 - (Bits[I] & 7));
		return Key;
	}
	catch { throw Invalid(); }
}
