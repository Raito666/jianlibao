/** Shared by the page cache and the generated classic Service Worker. */
export async function validRasterResponse(response) {
  if (!response?.ok) return false;
  const mime = response.headers
    .get("content-type")
    ?.split(";")[0]
    .trim()
    .toLowerCase();
  if (!["image/png", "image/jpeg", "image/webp"].includes(mime)) return false;
  try {
    const bytes = new Uint8Array(await response.clone().arrayBuffer());
    if (mime === "image/png")
      return (
        bytes.length >= 45 &&
        [137, 80, 78, 71, 13, 10, 26, 10].every(
          (byte, i) => bytes[i] === byte,
        ) &&
        [73, 69, 78, 68, 174, 66, 96, 130].every(
          (byte, i) => bytes[bytes.length - 8 + i] === byte,
        )
      );
    if (mime === "image/jpeg")
      return (
        bytes.length >= 4 &&
        bytes[0] === 255 &&
        bytes[1] === 216 &&
        bytes[bytes.length - 2] === 255 &&
        bytes[bytes.length - 1] === 217
      );
    return (
      bytes.length >= 20 &&
      String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
      String.fromCharCode(...bytes.slice(8, 12)) === "WEBP" &&
      new DataView(bytes.buffer).getUint32(4, true) === bytes.length - 8
    );
  } catch {
    return false;
  }
}

export async function validReferenceResponse(response, asset) {
  if (
    !response ||
    response.status !== 200 ||
    response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !==
      asset.mime
  )
    return false;
  try {
    const bytes = await response.clone().arrayBuffer();
    if (bytes.byteLength !== asset.bytes) return false;
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const actual = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    return actual === asset.sha256;
  } catch {
    return false;
  }
}

export async function rangeResponse(response, header) {
  const body = await response.arrayBuffer(),
    size = body.byteLength;
  const invalid = () =>
    new Response(null, {
      status: 416,
      headers: { "Content-Range": `bytes */${size}`, "Accept-Ranges": "bytes" },
    });
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || !size || (!match[1] && !match[2])) return invalid();
  let start, end;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return invalid();
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start >= size ||
      end < start
    )
      return invalid();
    end = Math.min(end, size - 1);
  }
  return new Response(body.slice(start, end + 1), {
    status: 206,
    headers: {
      "Content-Type":
        response.headers.get("content-type") || "application/octet-stream",
      "Accept-Ranges": "bytes",
      "Content-Range": `bytes ${start}-${end}/${size}`,
      "Content-Length": String(end - start + 1),
    },
  });
}

export function referenceWorkerSource(manifest) {
  return `
const REFERENCE_CACHE = ${JSON.stringify(`jianlibao-reference-${manifest.version}`)};
const REFERENCE_ASSETS = new Map(${JSON.stringify(manifest.assets.map((asset) => [asset.url, { mime: asset.mime, bytes: asset.bytes, sha256: asset.sha256 }]))});
${validReferenceResponse.toString()}
${rangeResponse.toString()}
${validRasterResponse.toString()}
self.addEventListener('message', event => {
  if (event.data?.type === 'jianlibao-reference-capability') {
    const proof = event.data.proof;
    const verified = Array.isArray(proof) && proof.length > 0 && proof.every(item => Array.isArray(item) && item.length === 2 && REFERENCE_ASSETS.get(item[0])?.sha256 === item[1]);
    event.ports?.[0]?.postMessage({ type: 'jianlibao-reference-ready', cache: REFERENCE_CACHE, version: 1, proof: verified ? proof : null });
  }
});
async function referenceFetch(request) {
  const path = new URL(request.url).pathname, asset = REFERENCE_ASSETS.get(path);
  let cache;
  try { cache = await caches.open(REFERENCE_CACHE); } catch { return fetch(request); }
  const cached = await cache.match(path, { ignoreVary: true });
  if (await validReferenceResponse(cached, asset)) {
    const range = request.headers.get('range');
    return range ? rangeResponse(cached, range) : cached;
  }
  // Never delete based on a stale snapshot: a page may have repaired this entry
  // while validation was awaiting its digest. A verified fetch replaces it.
  const response = await fetch(request);
  // Native video requests may be 206. Only a verified complete file is reusable offline.
  if (!request.headers.has('range') && await validReferenceResponse(response, asset)) {
    try { await cache.put(path, response.clone()); } catch { /* Online playback still works; explicit preparation reports write failures. */ }
  }
  return response;
}
`;
}
