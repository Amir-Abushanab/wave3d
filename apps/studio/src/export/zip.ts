/**
 * A tiny store-only (uncompressed) ZIP writer — enough to bundle a wallpaper folder (a handful of
 * small HTML/JSON files + a preview image) without a dependency. Files are stored as-is (method 0).
 */

const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = ~0;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (~c >>> 0) as number;
}

export interface ZipEntry {
  name: string;
  // ArrayBuffer-backed (not SharedArrayBuffer) so the bytes can go straight into a Blob.
  data: Uint8Array<ArrayBuffer> | string;
}

/** Build a store-only ZIP archive from a list of files. */
export function createZip(entries: ZipEntry[]): Blob {
  const enc = new TextEncoder();
  const files = entries.map((e) => ({
    name: enc.encode(e.name),
    data: typeof e.data === "string" ? enc.encode(e.data) : e.data,
  }));

  const localParts: BlobPart[] = [];
  const centralParts: BlobPart[] = [];
  let offset = 0;

  for (const f of files) {
    const crc = crc32(f.data);
    const size = f.data.length;

    const local = new Uint8Array(30 + f.name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); // local file header signature
    lv.setUint16(4, 20, true); // version needed
    lv.setUint16(8, 0, true); // method: store (fields 6=flags left 0)
    lv.setUint16(12, 0x21, true); // mod date = 1980-01-01 (times left 0)
    lv.setUint32(14, crc, true);
    lv.setUint32(18, size, true); // compressed size
    lv.setUint32(22, size, true); // uncompressed size
    lv.setUint16(26, f.name.length, true);
    local.set(f.name, 30);
    localParts.push(local, f.data);

    const central = new Uint8Array(46 + f.name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true); // central directory header signature
    cv.setUint16(4, 20, true); // version made by
    cv.setUint16(6, 20, true); // version needed
    cv.setUint16(14, 0x21, true); // mod date
    cv.setUint32(16, crc, true);
    cv.setUint32(20, size, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, f.name.length, true);
    cv.setUint32(42, offset, true); // relative offset of local header
    central.set(f.name, 46);
    centralParts.push(central);

    offset += local.length + size;
  }

  const centralSize = centralParts.reduce((n, p) => n + (p as Uint8Array).length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true); // end of central directory signature
  ev.setUint16(8, files.length, true); // entries on this disk
  ev.setUint16(10, files.length, true); // total entries
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true); // central directory offset

  return new Blob([...localParts, ...centralParts, eocd], { type: "application/zip" });
}
