/** `ma-sauvegarde.sav` → `ma-sauvegarde-adl.sav`; keeps only safe filename characters. */
export function linkedFileName(original: string) {
  const base = original.replace(/\.sav$/i, '').replace(/[^\w.\- ]+/g, '').trim().slice(0, 80);
  return `${base || 'mario-kart-ds'}-adl.sav`;
}
