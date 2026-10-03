import QRCode from 'qrcode';
export function destination(token: string) {
  const base = process.env.APP_URL || 'http://localhost:3000';
  return new URL(`/p/${token}`, base).toString();
}
const escape = (value: string) =>
  value.replace(
    /[<>&"']/g,
    (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!,
  );
export async function tagArtwork(code: string, token: string) {
  const qr = await QRCode.toString(destination(token), {
    type: 'svg',
    margin: 4,
    errorCorrectionLevel: 'M',
    color: { dark: '#153d32', light: '#ffffff' },
  });
  const viewBox = qr.match(/viewBox="([^"]+)"/)?.[1] || '0 0 40 40';
  const inner = qr.replace(/^.*?<svg[^>]*>/s, '').replace(/<\/svg>\s*$/, '');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="45mm" height="65mm" viewBox="0 0 180 260"><rect width="180" height="260" rx="8" fill="#f7f6ef"/><g stroke="#153d32" fill="none" stroke-width="2"><path d="M90 20c-25 17-25 38 0 47 25-9 25-30 0-47Z M90 21v46 M73 34l17 17 17-17"/><path d="M110 47q8-9 0-18 M115 52q15-14 0-28"/></g><text x="90" y="89" fill="#153d32" text-anchor="middle" font-family="Georgia,serif" font-size="22" letter-spacing="4">NABAT</text><text x="90" y="112" fill="#153d32" text-anchor="middle" font-family="Arial,sans-serif" font-size="12">${escape(code)}</text><svg x="35" y="124" width="110" height="110" viewBox="${viewBox}">${inner}</svg><text x="90" y="249" fill="#153d32" text-anchor="middle" font-family="Arial,sans-serif" font-size="9">Tap NFC or scan QR</text></svg>`;
}
