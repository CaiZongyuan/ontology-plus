import { deflateRawSync } from 'node:zlib';
import {
  compileDevelopmentPackage,
  type CompileDevelopmentPackageInput,
  type CompiledDevelopmentPackage,
} from './compiler.js';

export interface ZipArchiveEntryInput {
  path: string;
  content: string | Uint8Array;
}

export interface CompiledDevelopmentPackageZip {
  pkg: CompiledDevelopmentPackage;
  zipBytes: Uint8Array;
  fileName: string;
}

const LOCAL_FILE_HEADER_SIG = 0x04034b50;
const CENTRAL_DIR_HEADER_SIG = 0x02014b50;
const END_OF_CENTRAL_DIR_SIG = 0x06054b50;
const UTF8_BIT_FLAG = 0x0800;
const PKZIP_VERSION_NEEDED = 20;

const CRC32_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function computeCrc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC32_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function encodeDosDateTime(date: Date): { dosTime: number; dosDate: number } {
  const year = Math.max(date.getUTCFullYear(), 1980);
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  const hours = date.getUTCHours();
  const minutes = date.getUTCMinutes();
  const seconds = date.getUTCSeconds();

  const dosTime = ((hours & 0x1f) << 11) | ((minutes & 0x3f) << 5) | ((seconds >> 1) & 0x1f);
  const dosDate = (((year - 1980) & 0x7f) << 9) | ((month & 0x0f) << 5) | (day & 0x1f);
  return { dosTime, dosDate };
}

function normalizeZipPath(rawPath: string): string {
  return rawPath
    .replace(/\\/g, '/')
    .replace(/^(\.\/)+/, '')
    .replace(/^\/+/, '');
}

export function buildZipArchive(files: ZipArchiveEntryInput[]): Uint8Array {
  const encoder = new TextEncoder();
  const { dosTime, dosDate } = encodeDosDateTime(new Date());

  interface PreparedEntry {
    nameBytes: Uint8Array;
    rawSize: number;
    compressedBytes: Uint8Array;
    crc32: number;
    compressionMethod: number;
    localHeaderOffset: number;
  }

  const prepared: PreparedEntry[] = [];
  let localSectionBytes = 0;
  let centralDirBytes = 0;

  for (const file of files) {
    const cleanPath = normalizeZipPath(file.path);
    if (!cleanPath) continue;

    const nameBytes = encoder.encode(cleanPath);
    const rawBytes =
      typeof file.content === 'string'
        ? encoder.encode(file.content)
        : new Uint8Array(file.content.buffer, file.content.byteOffset, file.content.byteLength);

    const crc32 = computeCrc32(rawBytes);
    let compressionMethod = 0;
    let compressedBytes = rawBytes;

    if (rawBytes.length > 0) {
      const deflated = deflateRawSync(rawBytes, { level: 6 });
      compressionMethod = 8;
      compressedBytes = new Uint8Array(deflated.buffer, deflated.byteOffset, deflated.byteLength);
    }

    prepared.push({
      nameBytes,
      rawSize: rawBytes.length,
      compressedBytes,
      crc32,
      compressionMethod,
      localHeaderOffset: localSectionBytes,
    });

    localSectionBytes += 30 + nameBytes.length + compressedBytes.length;
    centralDirBytes += 46 + nameBytes.length;
  }

  const totalSize = localSectionBytes + centralDirBytes + 22;
  const output = new Uint8Array(totalSize);
  const view = new DataView(output.buffer, output.byteOffset, output.byteLength);

  let offset = 0;

  // 1. Write Local File Headers + Compressed Data
  for (const entry of prepared) {
    view.setUint32(offset, LOCAL_FILE_HEADER_SIG, true);
    view.setUint16(offset + 4, PKZIP_VERSION_NEEDED, true);
    view.setUint16(offset + 6, UTF8_BIT_FLAG, true);
    view.setUint16(offset + 8, entry.compressionMethod, true);
    view.setUint16(offset + 10, dosTime, true);
    view.setUint16(offset + 12, dosDate, true);
    view.setUint32(offset + 14, entry.crc32, true);
    view.setUint32(offset + 18, entry.compressedBytes.length, true);
    view.setUint32(offset + 22, entry.rawSize, true);
    view.setUint16(offset + 26, entry.nameBytes.length, true);
    view.setUint16(offset + 28, 0, true);
    offset += 30;

    output.set(entry.nameBytes, offset);
    offset += entry.nameBytes.length;

    output.set(entry.compressedBytes, offset);
    offset += entry.compressedBytes.length;
  }

  // 2. Write Central Directory Headers
  const centralDirOffset = offset;
  for (const entry of prepared) {
    view.setUint32(offset, CENTRAL_DIR_HEADER_SIG, true);
    view.setUint16(offset + 4, PKZIP_VERSION_NEEDED, true);
    view.setUint16(offset + 6, PKZIP_VERSION_NEEDED, true);
    view.setUint16(offset + 8, UTF8_BIT_FLAG, true);
    view.setUint16(offset + 10, entry.compressionMethod, true);
    view.setUint16(offset + 12, dosTime, true);
    view.setUint16(offset + 14, dosDate, true);
    view.setUint32(offset + 16, entry.crc32, true);
    view.setUint32(offset + 20, entry.compressedBytes.length, true);
    view.setUint32(offset + 24, entry.rawSize, true);
    view.setUint16(offset + 28, entry.nameBytes.length, true);
    view.setUint16(offset + 30, 0, true);
    view.setUint16(offset + 32, 0, true);
    view.setUint16(offset + 34, 0, true);
    view.setUint16(offset + 36, 0, true);
    view.setUint32(offset + 38, 0, true);
    view.setUint32(offset + 42, entry.localHeaderOffset, true);
    offset += 46;

    output.set(entry.nameBytes, offset);
    offset += entry.nameBytes.length;
  }

  // 3. Write End of Central Directory Record (EOCD)
  view.setUint32(offset, END_OF_CENTRAL_DIR_SIG, true);
  view.setUint16(offset + 4, 0, true);
  view.setUint16(offset + 6, 0, true);
  view.setUint16(offset + 8, prepared.length, true);
  view.setUint16(offset + 10, prepared.length, true);
  view.setUint32(offset + 12, centralDirBytes, true);
  view.setUint32(offset + 16, centralDirOffset, true);
  view.setUint16(offset + 20, 0, true);

  return output;
}

export function compileDevelopmentPackageZip(
  input: CompileDevelopmentPackageInput,
): CompiledDevelopmentPackageZip {
  const pkg = compileDevelopmentPackage({
    ...input,
    writeToDisk: input.writeToDisk ?? false,
  });

  const zipBytes = buildZipArchive(
    pkg.files.map((file) => ({
      path: file.relativePath,
      content: file.content,
    })),
  );

  const safeSlug = input.app.id.replace(/[^a-zA-Z0-9._-]+/g, '-') || 'ontology-package';
  const fileName = `${safeSlug}-dev-package.zip`;

  return {
    pkg,
    zipBytes,
    fileName,
  };
}
