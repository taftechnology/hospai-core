/** Display label for a lowercase status token. Wire values stay unchanged. */
export function badgeStatusWord(status: string): string {
  if (status !== status.toLowerCase()) return status;
  const spaced = status.replaceAll('_', ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
