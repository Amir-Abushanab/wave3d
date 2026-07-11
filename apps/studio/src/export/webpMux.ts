// Assemble native single-frame WebP files (from canvas.toBlob("image/webp")) into one animated
// WebP. Hand-rolled and dependency-free — the same spirit as ./zip.ts. The browser already encodes
// each frame's VP8 bitstream natively; we only wrap those frames in the animation container, so
// there's no WASM encoder and the output keeps full 24-bit colour (and alpha), unlike GIF.
//
// Container layout (all multi-byte fields little-endian):
//   RIFF <size> WEBP
//     VP8X   flags(animation [+ alpha]) + canvas width-1 / height-1
//     ANIM   background(BGRA) + loop count
//     ANMF   x / y / width-1 / height-1 / duration / flags + <frame image sub-chunks>  (per frame)
// Spec: https://developers.google.com/speed/webp/docs/riff_container

export interface WebpAnimFrame {
  /** A complete single-frame WebP file, e.g. the bytes of canvas.toBlob("image/webp"). */
  file: Uint8Array;
  /** How long the frame is shown, in milliseconds. */
  durationMs: number;
}

/** A small growable little-endian byte writer. */
class ByteWriter {
  private buf = new Uint8Array(4096);
  private len = 0;

  private ensure(n: number): void {
    if (this.len + n <= this.buf.length) return;
    let cap = this.buf.length * 2;
    while (cap < this.len + n) cap *= 2;
    const next = new Uint8Array(cap);
    next.set(this.buf.subarray(0, this.len));
    this.buf = next;
  }

  u8(v: number): void {
    this.ensure(1);
    this.buf[this.len++] = v & 0xff;
  }
  u16(v: number): void {
    this.u8(v);
    this.u8(v >>> 8);
  }
  u24(v: number): void {
    this.u8(v);
    this.u8(v >>> 8);
    this.u8(v >>> 16);
  }
  u32(v: number): void {
    this.u8(v);
    this.u8(v >>> 8);
    this.u8(v >>> 16);
    this.u8(v >>> 24);
  }
  fourcc(s: string): void {
    for (let i = 0; i < 4; i++) this.u8(s.charCodeAt(i));
  }
  bytes(b: Uint8Array): void {
    this.ensure(b.length);
    this.buf.set(b, this.len);
    this.len += b.length;
  }
  take(): Uint8Array {
    return this.buf.subarray(0, this.len);
  }
}

const u32le = (b: Uint8Array, o: number): number =>
  (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

/**
 * Pull a frame's image sub-chunks (an optional ALPH plus the VP8/VP8L bitstream — each with its
 * own header + padding) out of a canvas-encoded WebP file. These bytes are exactly what an ANMF
 * chunk carries. We keep *only* those image chunks and drop everything else — the RIFF header and
 * any container-level metadata (VP8X, and crucially ICCP/EXIF/XMP). Chrome's
 * `canvas.toBlob("image/webp")` emits an extended file with an embedded colour profile (ICCP) on
 * colour-managed displays; left inside an ANMF frame that metadata is invalid and makes the whole
 * animation unreadable to libwebp and Chrome, so it must be stripped.
 */
function frameImageChunks(file: Uint8Array): { data: Uint8Array; hasAlpha: boolean } {
  let off = 12; // skip "RIFF" <u32 size> "WEBP"
  const parts: Uint8Array[] = [];
  let hasAlpha = false;
  while (off + 8 <= file.length) {
    const cc = String.fromCharCode(file[off], file[off + 1], file[off + 2], file[off + 3]);
    const size = u32le(file, off + 4);
    const end = off + 8 + size + (size & 1); // chunk = header + payload + odd-pad
    if (cc === "ALPH" || cc === "VP8 " || cc === "VP8L") {
      parts.push(file.subarray(off, Math.min(end, file.length)));
      if (cc === "ALPH") hasAlpha = true;
    }
    off = end;
  }
  let total = 0;
  for (const p of parts) total += p.length;
  const data = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    data.set(p, at);
    at += p.length;
  }
  return { data, hasAlpha };
}

/**
 * Mux single-frame WebP files into one animated WebP blob. `loop` 0 = loop forever. All frames
 * must share `width`×`height` (the caller renders them onto one fixed-size canvas).
 */
export function encodeAnimatedWebp(
  frames: WebpAnimFrame[],
  width: number,
  height: number,
  loop = 0,
): Blob {
  const parsed = frames.map((f) => ({ ...frameImageChunks(f.file), durationMs: f.durationMs }));
  const hasAlpha = parsed.some((p) => p.hasAlpha);

  const body = new ByteWriter();

  // VP8X: animation flag (+ alpha if any frame has it), then canvas dimensions minus one.
  body.fourcc("VP8X");
  body.u32(10);
  body.u8(0x02 | (hasAlpha ? 0x10 : 0));
  body.u24(0); // reserved
  body.u24(width - 1);
  body.u24(height - 1);

  // ANIM: transparent background + loop count.
  body.fourcc("ANIM");
  body.u32(6);
  body.u32(0x00000000); // background, BGRA
  body.u16(loop);

  // One ANMF per frame — full canvas, "do not blend" so each frame simply overwrites the last.
  for (const p of parsed) {
    const payload = 16 + p.data.length;
    body.fourcc("ANMF");
    body.u32(payload);
    body.u24(0); // frame x (stored ×2)
    body.u24(0); // frame y (stored ×2)
    body.u24(width - 1);
    body.u24(height - 1);
    body.u24(Math.max(0, Math.round(p.durationMs)));
    body.u8(0x02); // blending: do not blend; disposal: none
    body.bytes(p.data);
    if (payload & 1) body.u8(0); // pad odd chunk
  }

  const bodyBytes = body.take();
  const out = new ByteWriter();
  out.fourcc("RIFF");
  out.u32(4 + bodyBytes.length); // "WEBP" + all chunks
  out.fourcc("WEBP");
  out.bytes(bodyBytes);
  // Copy the view into a fresh ArrayBuffer-backed array — a subarray is typed
  // Uint8Array<ArrayBufferLike>, which the Blob (BlobPart) type rejects.
  return new Blob([new Uint8Array(out.take())], { type: "image/webp" });
}
