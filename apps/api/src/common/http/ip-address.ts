/**
 * Adresse IP lisible : une IPv4 vue à travers une socket IPv6 (« ::ffff:192.168.43.120 ») est
 * ramenée à « 192.168.43.120 ». Les autres adresses sont gardées telles quelles.
 */
export function normalizeIpAddress(ip: string | null | undefined): string | null {
  if (!ip) return null;
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  return mapped?.[1] ?? ip;
}
