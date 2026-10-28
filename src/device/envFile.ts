// The baked environment's bytes (generated/studio-env.dat), fetched and inflated without three.js, so the page can request
// them while the 3D engine's own chunk downloads (docs/device-design.md §23 and §55). studioEnvironment.ts turns them into
// a texture.
import envUrl from './generated/studio-env.dat?url';

/** zlib of four byte planes, inflated. Null when DecompressionStream or the file is unavailable, or with `?env=live`. */
export async function fetchBakedEnvironment(): Promise<Uint8Array | null> {
  if (typeof DecompressionStream === 'undefined' || new URLSearchParams(location.search).get('env') === 'live') return null;
  try {
    const res = await fetch(envUrl);
    if (!res.ok || !res.body) return null;
    return new Uint8Array(await new Response(res.body.pipeThrough(new DecompressionStream('deflate'))).arrayBuffer());
  } catch {
    return null;
  }
}
