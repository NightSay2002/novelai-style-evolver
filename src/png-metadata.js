const encoder = new TextEncoder();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
  const typeBytes = encoder.encode(type);
  const chunk = new Uint8Array(12 + data.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length, false);
  chunk.set(typeBytes, 4);
  chunk.set(data, 8);
  const crcInput = new Uint8Array(typeBytes.length + data.length);
  crcInput.set(typeBytes);
  crcInput.set(data, typeBytes.length);
  view.setUint32(8 + data.length, crc32(crcInput), false);
  return chunk;
}

function makeInternationalTextChunk(keyword, value) {
  const keywordBytes = encoder.encode(keyword);
  const textBytes = encoder.encode(value);
  const data = new Uint8Array(keywordBytes.length + 5 + textBytes.length);
  data.set(keywordBytes, 0);
  data[keywordBytes.length] = 0;
  data[keywordBytes.length + 1] = 0;
  data[keywordBytes.length + 2] = 0;
  data[keywordBytes.length + 3] = 0;
  data[keywordBytes.length + 4] = 0;
  data.set(textBytes, keywordBytes.length + 5);
  return makeChunk("iTXt", data);
}

export async function injectCandidateMetadata(blob, candidate) {
  if (blob.type !== "image/png") return blob;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (signature.some((value, index) => bytes[index] !== value)) return blob;
  let offset = 8;
  let iendOffset = -1;
  while (offset + 12 <= bytes.length) {
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 8);
    const length = view.getUint32(0, false);
    const type = new TextDecoder("ascii").decode(bytes.slice(offset + 4, offset + 8));
    if (type === "IEND") {
      iendOffset = offset;
      break;
    }
    offset += 12 + length;
  }
  if (iendOffset < 0) return blob;
  const metadata = JSON.stringify({
    source: "novelai_style_evolver",
    version: 1,
    createdAt: candidate.createdAt,
    batchId: candidate.batchId,
    prompt: candidate.prompt,
    negativePrompt: candidate.negativePrompt,
    genome: candidate.genome,
    fixedSettings: candidate.fixedSettings,
    image2Image: candidate.image2Image,
    referenceTools: candidate.referenceTools,
    request: candidate.request
  });
  const chunk = makeInternationalTextChunk("NovelAIStyleEvolver", metadata);
  return new Blob([bytes.slice(0, iendOffset), chunk, bytes.slice(iendOffset)], { type: "image/png" });
}
