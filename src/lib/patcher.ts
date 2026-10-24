export interface RomHeader {
  title: string;
  code: string;
}

const ascii = (bytes: Uint8Array) => String.fromCharCode(...bytes).replace(/\0+$/, '').trim();

/** Lit le titre (0x00, 12 octets) et le code jeu (0x0C, 4 octets) de l'en-tête .nds. */
export async function readHeader(file: File): Promise<RomHeader> {
  const bytes = new Uint8Array(await file.slice(0, 0x10).arrayBuffer());
  return { title: ascii(bytes.subarray(0, 12)), code: ascii(bytes.subarray(12, 16)) };
}

/**
 * Applique le patch du jeu à la ROM et renvoie la ROM patchée.
 * À brancher sur les patchers existants.
 */
export async function applyPatch(slug: string, rom: ArrayBuffer): Promise<ArrayBuffer> {
  throw new Error(`Le patch pour « ${slug} » n'est pas encore branché.`);
}
