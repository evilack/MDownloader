/** Dependency-free, deterministic ZIP (DEFLATE, UTF-8 paths, fixed timestamps). */
import {readFile, readdir, writeFile} from 'node:fs/promises';
import {deflateRawSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import Path from 'node:path';
export async function DistributionFiles(Root) {
 const Files = [];
 async function Walk(Directory) {
  for (const Entry of await readdir(Directory, {withFileTypes: true})) {
   const File = Path.join(Directory, Entry.name);
   if (Entry.isDirectory()) await Walk(File);
   else if (Entry.isFile()) Files.push(Path.relative(Root, File).replaceAll('\\', '/'));
   else throw Error('Unsupported distribution entry: ' + File);
  }
 }
 await Walk(Root);
 return Files.sort();
}
function Crc32(Data) {
 let Value = 0xffffffff;
 for (const Byte of Data) {
  Value ^= Byte;
  for (let Bit = 0; Bit < 8; Bit++) Value = (Value >>> 1) ^ (Value & 1 ? 0xedb88320 : 0);
 }
 return (Value ^ 0xffffffff) >>> 0;
}
export async function WriteDistributionArchive(Root, Destination) {
 const Local = [], Central = [], Files = await DistributionFiles(Root);
 let Offset = 0;
 for (const File of Files) {
  const Name = Buffer.from(File), Data = await readFile(Path.join(Root, File)), Compressed = deflateRawSync(Data, {level: 6});
  const Header = Buffer.alloc(30);
  Header.writeUInt32LE(0x04034b50); Header.writeUInt16LE(20, 4); Header.writeUInt16LE(0x800, 6); Header.writeUInt16LE(8, 8);
  Header.writeUInt16LE(33, 12); Header.writeUInt32LE(Crc32(Data), 14); Header.writeUInt32LE(Compressed.length, 18);
  Header.writeUInt32LE(Data.length, 22); Header.writeUInt16LE(Name.length, 26);
  const Entry = Buffer.alloc(46);
  Entry.writeUInt32LE(0x02014b50); Entry.writeUInt16LE(20, 4); Header.copy(Entry, 6, 4, 30);
  Entry.writeUInt32LE(Offset, 42);
  Local.push(Header, Name, Compressed); Central.push(Entry, Name);
  Offset += Header.length + Name.length + Compressed.length;
 }
 const Directory = Buffer.concat(Central), End = Buffer.alloc(22);
 if (Files.length > 65535 || Offset + Directory.length > 0xffffffff) throw Error('Distribution exceeds ZIP32 limits');
 End.writeUInt32LE(0x06054b50); End.writeUInt16LE(Files.length, 8); End.writeUInt16LE(Files.length, 10);
 End.writeUInt32LE(Directory.length, 12); End.writeUInt32LE(Offset, 16);
 const Archive = Buffer.concat([...Local, Directory, End]);
 await writeFile(Destination, Archive);
 return {files: Files.length, bytes: Archive.length, sha256: createHash('sha256').update(Archive).digest('hex')};
}
