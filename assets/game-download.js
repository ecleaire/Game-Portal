const MAX_BYTES = 50 * 1024 * 1024;
export async function downloadArchive(response, onProgress = () => {}) {
  const declared = Number(response.headers.get('content-length'));
  const total = Number.isSafeInteger(declared) && declared > 0 ? declared : null;
  if (total > MAX_BYTES) throw new Error('invalid_preview');
  if (!response.body) {
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MAX_BYTES) throw new Error('invalid_preview');
    onProgress(buffer.byteLength,total); return buffer;
  }
  const reader = response.body.getReader(); const chunks = []; let received = 0;
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      received += value.byteLength;
      if (received > MAX_BYTES) { await reader.cancel(); throw new Error('invalid_preview'); }
      chunks.push(value); onProgress(received,total);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(received); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk,offset); offset += chunk.byteLength; }
  return bytes.buffer;
}
