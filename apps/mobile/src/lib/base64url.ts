/** Las firmas nativas llegan en base64 estándar; el header X-Step-Up usa base64url sin relleno. */
export function toBase64Url(base64: string): string {
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
