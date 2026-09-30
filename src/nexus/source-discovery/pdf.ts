import { inflateRawSync, inflateSync } from "node:zlib";

type PdfRef = { ref: [number, number] };
type PdfValue = null | boolean | number | string | PdfName | PdfString | PdfValue[] | PdfDict | PdfRef;
type PdfName = { name: string };
type PdfString = { bytes: Uint8Array };
type PdfDict = { dict: Map<string, PdfValue> };
type PdfObject = { value: PdfValue; stream: Uint8Array | null };

export type PdfExtraction = { pages: string[]; pageCount: number; interpretable: boolean; warnings: string[] };

export const PDF_LIMITS = { maxObjects: 25_000, maxPages: 60, maxInflatedBytes: 40_000_000, maxCharsPerPage: 40_000, maxTotalChars: 400_000, maxXObjectDepth: 3 };

const isName = (value: PdfValue | undefined): value is PdfName => Boolean(value && typeof value === "object" && "name" in value);
const isDict = (value: PdfValue | undefined): value is PdfDict => Boolean(value && typeof value === "object" && "dict" in value);
const isRef = (value: PdfValue | undefined): value is PdfRef => Boolean(value && typeof value === "object" && "ref" in value);
const isString = (value: PdfValue | undefined): value is PdfString => Boolean(value && typeof value === "object" && "bytes" in value);

const DELIMITERS = new Set(["(", ")", "<", ">", "[", "]", "{", "}", "/", "%"]);
const isWhite = (char: string | undefined) => char === " " || char === "\n" || char === "\r" || char === "\t" || char === "\f" || char === "\0";

class Lexer {
  pos: number;
  readonly src: string;
  constructor(src: string, pos = 0) { this.src = src; this.pos = pos; }

  skip() {
    for (;;) {
      while (this.pos < this.src.length && isWhite(this.src[this.pos])) this.pos += 1;
      if (this.src[this.pos] !== "%") return;
      while (this.pos < this.src.length && this.src[this.pos] !== "\n" && this.src[this.pos] !== "\r") this.pos += 1;
    }
  }

  literal(): PdfString {
    const out: number[] = [];
    let depth = 1;
    this.pos += 1;
    while (this.pos < this.src.length && depth > 0) {
      const char = this.src[this.pos]!;
      if (char === "\\") {
        const next = this.src[this.pos + 1] ?? "";
        const escapes: Record<string, number> = { n: 10, r: 13, t: 9, b: 8, f: 12, "(": 40, ")": 41, "\\": 92 };
        if (next in escapes) { out.push(escapes[next]!); this.pos += 2; continue; }
        if (/[0-7]/.test(next)) {
          const octal = /^[0-7]{1,3}/.exec(this.src.slice(this.pos + 1, this.pos + 4))![0];
          out.push(Number.parseInt(octal, 8) & 255); this.pos += 1 + octal.length; continue;
        }
        if (next === "\r") { this.pos += this.src[this.pos + 2] === "\n" ? 3 : 2; continue; }
        if (next === "\n") { this.pos += 2; continue; }
        this.pos += 1; continue;
      }
      if (char === "(") depth += 1;
      if (char === ")") { depth -= 1; if (depth === 0) { this.pos += 1; break; } }
      out.push(char.charCodeAt(0) & 255);
      this.pos += 1;
    }
    return { bytes: Uint8Array.from(out) };
  }

  hex(): PdfString {
    const end = this.src.indexOf(">", this.pos);
    const body = this.src.slice(this.pos + 1, end < 0 ? this.src.length : end).replace(/[^0-9a-f]/gi, "");
    this.pos = end < 0 ? this.src.length : end + 1;
    const padded = body.length % 2 ? `${body}0` : body;
    const bytes = new Uint8Array(padded.length / 2);
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = Number.parseInt(padded.slice(index * 2, index * 2 + 2), 16);
    return { bytes };
  }

  token(): string | null {
    this.skip();
    if (this.pos >= this.src.length) return null;
    const start = this.pos;
    const char = this.src[this.pos]!;
    if (char === "<" && this.src[this.pos + 1] === "<") { this.pos += 2; return "<<"; }
    if (char === ">" && this.src[this.pos + 1] === ">") { this.pos += 2; return ">>"; }
    if ("[]{}".includes(char)) { this.pos += 1; return char; }
    if (char === "/") {
      this.pos += 1;
      while (this.pos < this.src.length && !isWhite(this.src[this.pos]) && !DELIMITERS.has(this.src[this.pos]!)) this.pos += 1;
      return this.src.slice(start, this.pos);
    }
    while (this.pos < this.src.length && !isWhite(this.src[this.pos]) && !DELIMITERS.has(this.src[this.pos]!)) this.pos += 1;
    if (this.pos === start) this.pos += 1;
    return this.src.slice(start, this.pos);
  }

  value(depth = 0): PdfValue | undefined {
    if (depth > 64) return null;
    this.skip();
    const char = this.src[this.pos];
    if (char === undefined) return undefined;
    if (char === "(") return this.literal();
    if (char === "<" && this.src[this.pos + 1] !== "<") return this.hex();
    const token = this.token();
    if (token === null) return undefined;
    if (token === "<<") {
      const dict = new Map<string, PdfValue>();
      for (;;) {
        this.skip();
        if (this.src.startsWith(">>", this.pos)) { this.pos += 2; break; }
        if (this.pos >= this.src.length) break;
        const key = this.token();
        if (!key || !key.startsWith("/")) continue;
        const item = this.value(depth + 1);
        if (item === undefined) break;
        dict.set(key.slice(1), item);
      }
      return { dict };
    }
    if (token === "[") {
      const items: PdfValue[] = [];
      for (;;) {
        this.skip();
        if (this.src[this.pos] === "]") { this.pos += 1; break; }
        if (this.pos >= this.src.length) break;
        const item = this.value(depth + 1);
        if (item === undefined) break;
        items.push(item);
      }
      return items;
    }
    if (token.startsWith("/")) return { name: token.slice(1) };
    if (token === "true") return true;
    if (token === "false") return false;
    if (token === "null") return null;
    if (/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(token)) {
      const save = this.pos;
      if (/^\d+$/.test(token)) {
        const generation = this.token();
        const marker = this.token();
        if (generation && /^\d+$/.test(generation) && marker === "R") return { ref: [Number(token), Number(generation)] };
      }
      this.pos = save;
      return Number(token);
    }
    return token;
  }
}

function inflate(bytes: Uint8Array, budget: { remaining: number }): Uint8Array | null {
  if (budget.remaining <= 0) return null;
  const options = { maxOutputLength: Math.max(1, budget.remaining) };
  for (const method of [inflateSync, inflateRawSync]) {
    try {
      const out = method(bytes, options);
      budget.remaining -= out.length;
      return out;
    } catch { /* try the next framing; truncated or corrupt streams yield no text */ }
  }
  return null;
}

function applyPredictor(data: Uint8Array, parms: PdfDict | undefined): Uint8Array {
  const predictor = Number(parms?.dict.get("Predictor") ?? 1);
  if (predictor < 10) return data;
  const columns = Number(parms?.dict.get("Columns") ?? 1);
  const rowLength = columns + 1;
  const out = new Uint8Array(Math.floor(data.length / rowLength) * columns);
  const previous = new Uint8Array(columns);
  for (let row = 0; row * rowLength < data.length - columns; row += 1) {
    const filter = data[row * rowLength]!;
    for (let col = 0; col < columns; col += 1) {
      const raw = data[row * rowLength + 1 + col]!;
      const left = col > 0 ? out[row * columns + col - 1]! : 0;
      const up = previous[col]!;
      const value = filter === 1 ? raw + left : filter === 2 ? raw + up : filter === 3 ? raw + ((left + up) >> 1) : raw;
      out[row * columns + col] = value & 255;
    }
    previous.set(out.subarray(row * columns, row * columns + columns));
  }
  return out;
}

class PdfDocument {
  readonly objects = new Map<string, PdfObject>();
  readonly src: string;
  readonly bytes: Uint8Array;
  readonly budget = { remaining: PDF_LIMITS.maxInflatedBytes };
  encrypted = false;
  trailerRoot: PdfRef | null = null;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
    this.src = Buffer.from(bytes).toString("latin1");
    this.scan();
  }

  private scan() {
    const pattern = /(\d+)\s+(\d+)\s+obj\b/g;
    let count = 0;
    for (let match = pattern.exec(this.src); match && count < PDF_LIMITS.maxObjects; match = pattern.exec(this.src)) {
      count += 1;
      const lexer = new Lexer(this.src, pattern.lastIndex);
      const value = lexer.value();
      if (value === undefined) continue;
      let stream: Uint8Array | null = null;
      lexer.skip();
      if (this.src.startsWith("stream", lexer.pos) && isDict(value)) {
        let start = lexer.pos + 6;
        if (this.src[start] === "\r") start += 1;
        if (this.src[start] === "\n") start += 1;
        const declared = value.dict.get("Length");
        let end = typeof declared === "number" && this.src.startsWith("endstream", this.skipWhite(start + declared)) ? start + declared : this.src.indexOf("endstream", start);
        if (end < 0) end = this.src.length;
        stream = this.bytes.subarray(start, end);
        pattern.lastIndex = end;
      }
      this.objects.set(`${match[1]} ${match[2]}`, { value, stream });
      if (isDict(value)) {
        if (value.dict.has("Encrypt")) this.encrypted = true;
        const type = value.dict.get("Type");
        if (isName(type) && type.name === "XRef" && isRef(value.dict.get("Root"))) this.trailerRoot = value.dict.get("Root") as PdfRef;
      }
    }
    const trailer = this.src.lastIndexOf("trailer");
    if (trailer >= 0) {
      const dict = new Lexer(this.src, trailer + 7).value();
      if (isDict(dict)) {
        if (dict.dict.has("Encrypt")) this.encrypted = true;
        if (isRef(dict.dict.get("Root"))) this.trailerRoot = dict.dict.get("Root") as PdfRef;
      }
    }
    for (const object of [...this.objects.values()]) {
      if (!isDict(object.value) || !object.stream) continue;
      const type = object.value.dict.get("Type");
      if (!isName(type) || type.name !== "ObjStm") continue;
      const data = this.decodeStream(object);
      if (!data) continue;
      const text = Buffer.from(data).toString("latin1");
      const count = Number(object.value.dict.get("N") ?? 0);
      const first = Number(object.value.dict.get("First") ?? 0);
      const header = new Lexer(text.slice(0, first));
      for (let index = 0; index < count && this.objects.size < PDF_LIMITS.maxObjects; index += 1) {
        const number = header.token(); const offset = header.token();
        if (!number || !offset) break;
        const itemKey = `${number} 0`;
        if (this.objects.has(itemKey)) continue;
        const item = new Lexer(text, first + Number(offset)).value();
        if (item !== undefined) this.objects.set(itemKey, { value: item, stream: null });
      }
    }
  }

  private skipWhite(pos: number) {
    let index = pos;
    while (index < this.src.length && isWhite(this.src[index])) index += 1;
    return index;
  }

  resolve(value: PdfValue | undefined, depth = 0): PdfValue | undefined {
    if (!isRef(value) || depth > 16) return value;
    const object = this.objects.get(`${value.ref[0]} ${value.ref[1]}`) ?? this.objects.get(`${value.ref[0]} 0`);
    return object ? this.resolve(object.value, depth + 1) : undefined;
  }

  objectOf(value: PdfValue | undefined): PdfObject | null {
    if (!isRef(value)) return null;
    return this.objects.get(`${value.ref[0]} ${value.ref[1]}`) ?? this.objects.get(`${value.ref[0]} 0`) ?? null;
  }

  decodeStream(object: PdfObject): Uint8Array | null {
    if (!object.stream || !isDict(object.value)) return null;
    const filterValue = this.resolve(object.value.dict.get("Filter"));
    const filters = (Array.isArray(filterValue) ? filterValue : filterValue ? [filterValue] : []).map((item) => (isName(item) ? item.name : ""));
    const parmsValue = this.resolve(object.value.dict.get("DecodeParms"));
    const parms = Array.isArray(parmsValue) ? parmsValue : [parmsValue];
    let data: Uint8Array | null = object.stream;
    for (const [index, filter] of filters.entries()) {
      if (!data) return null;
      if (filter === "FlateDecode" || filter === "Fl") {
        data = inflate(data, this.budget);
        const parm = this.resolve(parms[index] as PdfValue | undefined);
        if (data && isDict(parm)) data = applyPredictor(data, parm);
      } else if (filter === "ASCIIHexDecode" || filter === "AHx") {
        data = new Lexer(`<${Buffer.from(data).toString("latin1")}`).hex().bytes;
      } else return null;
    }
    return data;
  }

  pages(): Array<{ page: PdfDict; resources: PdfDict | null }> {
    let root = this.resolve(this.trailerRoot ?? undefined);
    if (!isDict(root)) {
      for (const object of this.objects.values()) {
        const type = isDict(object.value) ? object.value.dict.get("Type") : undefined;
        if (isName(type) && type.name === "Catalog") { root = object.value; break; }
      }
    }
    const result: Array<{ page: PdfDict; resources: PdfDict | null }> = [];
    const seen = new Set<PdfValue>();
    const visit = (node: PdfValue | undefined, inherited: PdfDict | null, depth: number) => {
      const resolved = this.resolve(node);
      if (!isDict(resolved) || seen.has(resolved) || depth > 32 || result.length >= PDF_LIMITS.maxPages) return;
      seen.add(resolved);
      const own = this.resolve(resolved.dict.get("Resources"));
      const resources = isDict(own) ? own : inherited;
      const type = resolved.dict.get("Type");
      const kids = this.resolve(resolved.dict.get("Kids"));
      if (Array.isArray(kids) && (!isName(type) || type.name === "Pages")) {
        for (const kid of kids) visit(kid, resources, depth + 1);
      } else if (!isName(type) || type.name === "Page") result.push({ page: resolved, resources });
    };
    if (isDict(root)) visit(root.dict.get("Pages"), null, 0);
    return result;
  }
}

type CMap = { codeLength: number; map: Map<number, string> };

function utf16(bytes: Uint8Array): string {
  let out = "";
  for (let index = 0; index + 1 < bytes.length; index += 2) out += String.fromCharCode((bytes[index]! << 8) | bytes[index + 1]!);
  return out;
}

function parseCMap(data: Uint8Array): CMap {
  const text = Buffer.from(data).toString("latin1");
  const map = new Map<number, string>();
  const range = /begincodespacerange\s*<([0-9a-f]+)>/i.exec(text);
  const codeLength = range ? Math.max(1, Math.ceil(range[1]!.length / 2)) : 2;
  const hexBytes = (hex: string) => new Lexer(`<${hex}>`).hex().bytes;
  const hexNumber = (hex: string) => Number.parseInt(hex, 16);
  for (const block of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const pair of block[1]!.matchAll(/<([0-9a-f]+)>\s*<([0-9a-f]*)>/gi)) {
      if (map.size < 70_000) map.set(hexNumber(pair[1]!), utf16(hexBytes(pair[2]!)));
    }
  }
  for (const block of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const item of block[1]!.matchAll(/<([0-9a-f]+)>\s*<([0-9a-f]+)>\s*(?:<([0-9a-f]+)>|\[([^\]]*)\])/gi)) {
      const low = hexNumber(item[1]!); const high = Math.min(hexNumber(item[2]!), low + 5000);
      if (item[3] !== undefined) {
        const base = hexBytes(item[3]);
        for (let code = low; code <= high && map.size < 70_000; code += 1) {
          const bytes = Uint8Array.from(base);
          let carry = code - low;
          for (let index = bytes.length - 1; index >= 0 && carry > 0; index -= 1) {
            const sum = bytes[index]! + carry; bytes[index] = sum & 255; carry = sum >> 8;
          }
          map.set(code, utf16(bytes));
        }
      } else {
        const targets = [...(item[4] ?? "").matchAll(/<([0-9a-f]*)>/gi)].map((target) => utf16(hexBytes(target[1]!)));
        targets.forEach((target, offset) => { if (low + offset <= high) map.set(low + offset, target); });
      }
    }
  }
  return { codeLength, map };
}

const WIN_ANSI_HIGH: Record<number, string> = { 0x80: "€", 0x85: "…", 0x91: "‘", 0x92: "’", 0x93: "“", 0x94: "”", 0x95: "•", 0x96: "–", 0x97: "—", 0x99: "™", 0xa0: " " };

type Font = { cmap: CMap | null; composite: boolean };

function decodeShown(bytes: Uint8Array, font: Font | undefined): string | null {
  if (font?.cmap) {
    let out = "";
    const length = font.cmap.codeLength;
    for (let index = 0; index + length <= bytes.length; index += length) {
      let code = 0;
      for (let offset = 0; offset < length; offset += 1) code = (code << 8) | bytes[index + offset]!;
      out += font.cmap.map.get(code) ?? "";
    }
    return out;
  }
  if (font?.composite) return null;
  let out = "";
  for (const byte of bytes) out += WIN_ANSI_HIGH[byte] ?? (byte >= 32 && byte !== 127 ? String.fromCharCode(byte) : byte === 9 ? " " : "");
  return out;
}

function fontsOf(pdf: PdfDocument, resources: PdfDict | null, cache: Map<PdfValue, Font>): Map<string, Font> {
  const fonts = new Map<string, Font>();
  const fontDict = pdf.resolve(resources?.dict.get("Font"));
  if (!isDict(fontDict)) return fonts;
  for (const [name, ref] of fontDict.dict) {
    const font = pdf.resolve(ref);
    if (!isDict(font)) continue;
    const cached = cache.get(font);
    if (cached) { fonts.set(name, cached); continue; }
    const subtype = font.dict.get("Subtype");
    const composite = isName(subtype) && subtype.name === "Type0";
    const toUnicode = pdf.objectOf(font.dict.get("ToUnicode"));
    const data = toUnicode ? pdf.decodeStream(toUnicode) : null;
    const entry: Font = { cmap: data ? parseCMap(data) : null, composite };
    cache.set(font, entry);
    fonts.set(name, entry);
  }
  return fonts;
}

function interpret(pdf: PdfDocument, content: Uint8Array, resources: PdfDict | null, fontCache: Map<PdfValue, Font>, depth: number, out: { text: string; undecodable: number }) {
  const fonts = fontsOf(pdf, resources, fontCache);
  const lexer = new Lexer(Buffer.from(content).toString("latin1"));
  const operands: PdfValue[] = [];
  let font: Font | undefined;
  let fontSize = 12;
  let leading = 0;
  // Text line matrix [a b c d e f]; only what is needed to tell "same baseline" from "new line".
  let line = [1, 0, 0, 1, 0, 0];
  let last: { y: number; endX: number; size: number } | null = null;
  const moveLine = (tx: number, ty: number) => {
    line = [line[0]!, line[1]!, line[2]!, line[3]!, line[4]! + tx * line[0]! + ty * line[2]!, line[5]! + tx * line[1]! + ty * line[3]!];
  };
  const emit = (value: string | null) => {
    if (value === null) { out.undecodable += 1; return; }
    if (!value) return;
    const size = Math.max(1, Math.abs(fontSize * line[3]!) || fontSize);
    const x = line[4]!; const y = line[5]!;
    const sameLine = last !== null && Math.abs(y - last.y) <= Math.max(1, 0.4 * Math.min(size, last.size));
    if (last && !sameLine) newline();
    else if (last && x - last.endX > 0.15 * size) space();
    if (out.text.length < PDF_LIMITS.maxCharsPerPage) out.text += value;
    const start = sameLine && last && x <= last.endX ? last.endX : x;
    last = { y, endX: start + value.length * size * 0.5, size };
  };
  const newline = () => { if (!out.text.endsWith("\n")) out.text += "\n"; };
  const space = () => { if (!/[\s]$/.test(out.text)) out.text += " "; };
  for (let steps = 0; steps < 2_000_000; steps += 1) {
    lexer.skip();
    if (lexer.pos >= lexer.src.length) break;
    const char = lexer.src[lexer.pos]!;
    if (char === "(" || char === "[" || char === "<" || char === "/" || /[\d+.-]/.test(char)) {
      const value = lexer.value();
      if (value === undefined) break;
      operands.push(value);
      if (operands.length > 64) operands.shift();
      continue;
    }
    const operator = lexer.token();
    if (!operator) break;
    if (operator === "BI") {
      const end = lexer.src.indexOf("EI", lexer.pos);
      lexer.pos = end < 0 ? lexer.src.length : end + 2;
    } else if (operator === "Tf") {
      const name = operands[operands.length - 2];
      font = isName(name) ? fonts.get(name.name) : undefined;
      const size = Number(operands[operands.length - 1]);
      if (Number.isFinite(size) && size !== 0) fontSize = Math.abs(size);
    } else if (operator === "TL") {
      leading = Number(operands[operands.length - 1] ?? 0) || 0;
    } else if (operator === "BT") {
      line = [1, 0, 0, 1, 0, 0];
    } else if (operator === "Tj" || operator === "'" || operator === '"') {
      if (operator !== "Tj") { moveLine(0, -leading); newline(); last = null; }
      const shown = operands[operands.length - 1];
      if (isString(shown)) emit(decodeShown(shown.bytes, font));
    } else if (operator === "TJ") {
      const array = operands[operands.length - 1];
      if (Array.isArray(array)) for (const item of array) {
        if (isString(item)) emit(decodeShown(item.bytes, font));
        else if (typeof item === "number" && item < -250) space();
      }
    } else if (operator === "Td" || operator === "TD") {
      const ty = Number(operands[operands.length - 1] ?? 0) || 0; const tx = Number(operands[operands.length - 2] ?? 0) || 0;
      if (operator === "TD") leading = -ty;
      moveLine(tx, ty);
    } else if (operator === "Tm") {
      const values = operands.slice(-6).map((item) => Number(item));
      if (values.length === 6 && values.every(Number.isFinite)) line = values;
    } else if (operator === "T*") {
      moveLine(0, -leading);
    } else if (operator === "Do" && depth < PDF_LIMITS.maxXObjectDepth) {
      const name = operands[operands.length - 1];
      const xobjects = pdf.resolve(resources?.dict.get("XObject"));
      const object = isName(name) && isDict(xobjects) ? pdf.objectOf(xobjects.dict.get(name.name)) : null;
      const subtype = object && isDict(object.value) ? object.value.dict.get("Subtype") : undefined;
      if (object && isName(subtype) && subtype.name === "Form") {
        const data = pdf.decodeStream(object);
        const own = isDict(object.value) ? pdf.resolve(object.value.dict.get("Resources")) : undefined;
        if (data) interpret(pdf, data, isDict(own) ? own : resources, fontCache, depth + 1, out);
      }
    }
    operands.length = 0;
  }
}

function normalisePage(text: string): string {
  return text.split("\n").map((line) => line.replace(/[\u0000-\u0008\u000b-\u001f]/g, "").replace(/\s+/g, " ").trim()).filter(Boolean).join("\n");
}

/** Deterministic text extraction. Scanned pages, diagrams, and undecodable fonts yield no text rather than guesses. */
export function extractPdfText(bytes: Uint8Array): PdfExtraction {
  const warnings: string[] = [];
  let pdf: PdfDocument;
  try { pdf = new PdfDocument(bytes); } catch { return { pages: [], pageCount: 0, interpretable: false, warnings: ["PDF structure could not be parsed."] }; }
  if (pdf.encrypted) return { pages: [], pageCount: 0, interpretable: false, warnings: ["Encrypted PDF is not interpreted."] };
  const pages = pdf.pages();
  const fontCache = new Map<PdfValue, Font>();
  const texts: string[] = [];
  let total = 0;
  let undecodable = 0;
  for (const { page, resources } of pages) {
    const contents = page.dict.get("Contents");
    const resolvedContents = pdf.resolve(contents);
    const refs = Array.isArray(resolvedContents) ? resolvedContents : [contents];
    const out = { text: "", undecodable: 0 };
    for (const ref of refs) {
      const object = pdf.objectOf(ref as PdfValue);
      const data = object ? pdf.decodeStream(object) : null;
      if (data) interpret(pdf, data, resources, fontCache, 0, out);
      out.text += "\n";
    }
    undecodable += out.undecodable;
    const text = total < PDF_LIMITS.maxTotalChars ? normalisePage(out.text).slice(0, PDF_LIMITS.maxTotalChars - total) : "";
    total += text.length;
    texts.push(text);
  }
  const meaningful = texts.join(" ").replace(/[^A-Za-z0-9]/g, "").length;
  if (undecodable) warnings.push(`${undecodable} PDF text runs used fonts without a Unicode map and were not interpreted.`);
  if (pages.length >= PDF_LIMITS.maxPages) warnings.push(`PDF page extraction stopped at ${PDF_LIMITS.maxPages} pages.`);
  const interpretable = meaningful >= 40;
  if (!interpretable) warnings.push("PDF has no interpretable text layer (scanned image, diagram, or unsupported encoding); no facts were taken from it.");
  return { pages: interpretable ? texts : [], pageCount: pages.length, interpretable, warnings };
}
