import { describe, expect, it } from 'vitest';
import zlib from 'node:zlib';
import { parseZipArchive } from '../utils/zipUtils.js';

function createMockZip(
  files: Array<{ name: string; content: string; compress?: boolean }>
): Buffer {
  const localHeaders: Buffer[] = [];
  const centralHeaders: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = Buffer.from(file.name, 'utf8');
    const rawContent = Buffer.from(file.content, 'utf8');
    const compress = file.compress ?? true;
    const method = compress ? 8 : 0;
    const body = compress ? zlib.deflateRawSync(rawContent) : rawContent;

    // Local Header
    const local = Buffer.alloc(30 + nameBytes.length + body.length);
    local.writeUInt32LE(0x04034b50, 0); // signature
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(method, 8); // method
    local.writeUInt16LE(0, 10); // time
    local.writeUInt16LE(0, 12); // date
    local.writeUInt32LE(0, 14); // crc32 (mock 0)
    local.writeUInt32LE(body.length, 18); // compressed size
    local.writeUInt32LE(rawContent.length, 22); // uncompressed size
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28); // extra length
    nameBytes.copy(local, 30);
    body.copy(local, 30 + nameBytes.length);
    localHeaders.push(local);

    // Central Directory Header
    const cd = Buffer.alloc(46 + nameBytes.length);
    cd.writeUInt32LE(0x02014b50, 0); // signature
    cd.writeUInt16LE(20, 4); // version made by
    cd.writeUInt16LE(20, 6); // version needed
    cd.writeUInt16LE(0, 8); // flags
    cd.writeUInt16LE(method, 10); // method
    cd.writeUInt16LE(0, 12); // time
    cd.writeUInt16LE(0, 14); // date
    cd.writeUInt32LE(0, 16); // crc32
    cd.writeUInt32LE(body.length, 20); // compressed size
    cd.writeUInt32LE(rawContent.length, 24); // uncompressed size
    cd.writeUInt16LE(nameBytes.length, 28);
    cd.writeUInt16LE(0, 30); // extra len
    cd.writeUInt16LE(0, 32); // comment len
    cd.writeUInt16LE(0, 34); // disk start
    cd.writeUInt16LE(0, 36); // internal attrs
    cd.writeUInt32LE(0, 38); // external attrs
    cd.writeUInt32LE(offset, 42); // local header offset
    nameBytes.copy(cd, 46);
    centralHeaders.push(cd);

    offset += local.length;
  }

  const cdTotalSize = centralHeaders.reduce((acc, h) => acc + h.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // EOCD signature
  eocd.writeUInt16LE(0, 4); // disk number
  eocd.writeUInt16LE(0, 6); // start disk
  eocd.writeUInt16LE(files.length, 8); // total records on disk
  eocd.writeUInt16LE(files.length, 10); // total records
  eocd.writeUInt32LE(cdTotalSize, 12); // size of CD
  eocd.writeUInt32LE(offset, 16); // offset of CD
  eocd.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([...localHeaders, ...centralHeaders, eocd]);
}

describe('zipUtils', () => {
  it('parses stored and deflated zip entries correctly', () => {
    const zipBuf = createMockZip([
      {
        name: 'FOOD NAME.csv',
        content: 'FoodID,FoodDescription\n1,Apple',
        compress: true,
      },
      {
        name: 'readme.txt',
        content: 'Health Canada CNF Archive',
        compress: false,
      },
    ]);

    const entries = parseZipArchive(zipBuf);
    expect(entries).toHaveLength(2);
    expect(entries[0].path).toBe('FOOD NAME.csv');
    expect(entries[0].getData().toString('utf8')).toBe(
      'FoodID,FoodDescription\n1,Apple'
    );
    expect(entries[1].path).toBe('readme.txt');
    expect(entries[1].getData().toString('utf8')).toBe(
      'Health Canada CNF Archive'
    );
  });

  it('throws an error if EOCD signature is missing', () => {
    const invalidBuf = Buffer.from('not a zip file');
    expect(() => parseZipArchive(invalidBuf)).toThrow('Invalid ZIP archive');
  });

  it('throws an error if central directory or local header offsets exceed buffer', () => {
    const validZip = createMockZip([
      {
        name: 'test.csv',
        content: 'hello world',
      },
    ]);
    // Truncate the buffer so the central directory or data offsets exceed buffer length
    const truncatedBuf = validZip.subarray(0, validZip.length - 15);
    expect(() => parseZipArchive(truncatedBuf)).toThrow('Invalid ZIP archive');
  });
});
