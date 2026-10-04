import QRCode from 'qrcode';
import { randomUUID, randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { Actor } from '@/domain/types';
import { AppError } from './security';
import { database } from './db';
import { destination } from './tags';
import { mutate } from '@/domain/operations/mutations';
import { mutationBase } from '@/domain/operations/contracts';
import { audit } from '@/domain/audit/service';
import { tags } from '@/domain/tags/service';
export const templates = z.enum(['label', 'pot', 'nursery', 'thermal', 'a4']);
const escape = (s: string) =>
  s.replace(
    /[<>&"']/g,
    (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!,
  );
export async function tagDesign(code: string, name: string, token: string, template = 'label') {
  const type = templates.parse(template);
  const [width, height] =
    type === 'pot'
      ? [35, 35]
      : type === 'nursery'
        ? [50, 90]
        : type === 'thermal'
          ? [60, 40]
          : [45, 65];
  const qr = await QRCode.toString(destination(token), {
    type: 'svg',
    margin: 4,
    errorCorrectionLevel: 'M',
    color: { dark: '#153d32', light: '#fff' },
  });
  const box = qr.match(/viewBox="([^"]+)"/)?.[1] || '0 0 40 40';
  const inner = qr.replace(/^.*?<svg[^>]*>/s, '').replace(/<\/svg>\s*$/, '');
  const w = width * 4,
    h = height * 4,
    compact = type === 'pot' || type === 'thermal';
  const size = Math.min(w - 28, h - (compact ? 52 : 112));
  const x = (w - size) / 2,
    y = compact ? 25 : 88;
  const mark = `<g transform="translate(${w / 2 - (compact ? 46 : 74)} ${compact ? 3 : 8}) scale(${compact ? 0.25 : 0.48})" fill="none" stroke="#153d32" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4C4 16 2 38 23 49c21-11 19-33 0-45Z M23 5v44 M8 20l15 17 15-17 M12 11l11 15 11-15 M39 28q8-9 0-18 M43 33q13-13 0-27"/></g>`;
  const label =
    '<svg xmlns="http://www.w3.org/2000/svg" width="' +
    width +
    'mm" height="' +
    height +
    'mm" viewBox="0 0 ' +
    w +
    ' ' +
    h +
    '"><rect width="' +
    w +
    '" height="' +
    h +
    '" rx="8" fill="#f7f6ef"/><text x="' +
    w / 2 +
    '" y="' +
    (compact ? 18 : 33) +
    '" fill="#153d32" text-anchor="middle" font-family="Georgia,serif" font-size="' +
    (compact ? 13 : 25) +
    '" letter-spacing="3">NABAT</text>' +
    mark +
    (compact
      ? ''
      : '<text x="' +
        w / 2 +
        '" y="56" fill="#153d32" text-anchor="middle" font-family="Arial,sans-serif" font-size="12">' +
        escape(name.slice(0, 24)) +
        '</text><text x="' +
        w / 2 +
        '" y="76" fill="#153d32" text-anchor="middle" font-family="Arial,sans-serif" font-size="12">' +
        escape(code) +
        '</text>') +
    '<svg x="' +
    x +
    '" y="' +
    y +
    '" width="' +
    size +
    '" height="' +
    size +
    '" viewBox="' +
    box +
    '">' +
    inner +
    '</svg><text x="' +
    w / 2 +
    '" y="' +
    (h - 17) +
    '" fill="#153d32" text-anchor="middle" font-family="Arial,sans-serif" font-size="10">' +
    escape(compact ? code : 'Tap NFC or scan QR') +
    '</text></svg>';
  return { svg: label, widthMm: width, heightMm: height };
}
export async function tagSheet(actor: Actor, org: string, ids: string[]) {
  const inventory = await tags(actor, org);
  const selected = inventory.filter((t) => ids.includes(t.id));
  if (!selected.length || selected.length !== new Set(ids).size || selected.length > 16)
    throw new AppError(400, 'Choose 1–16 tags per A4 sheet.');
  const pieces = await Promise.all(
    selected.map(async (t, i) => {
      const design = await tagDesign(t.code, t.name, t.public_token);
      const content = design.svg.replace(/^.*?<svg[^>]*>/s, '').replace(/<\/svg>$/, '');
      return (
        '<svg x="' +
        (40 + (i % 4) * 190) +
        '" y="' +
        (36 + Math.floor(i / 4) * 276) +
        '" width="180" height="260" viewBox="0 0 180 260">' +
        content +
        '</svg>'
      );
    }),
  );
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" width="210mm" height="297mm" viewBox="0 0 840 1188"><rect width="840" height="1188" fill="#fff"/>' +
    pieces.join('') +
    '</svg>'
  );
}
const lifecycleSchema = mutationBase.extend({ action: z.enum(['replace', 'retire']) });
export async function tagLifecycle(actor: Actor, org: string, id: string, raw: unknown) {
  const data = lifecycleSchema.parse(raw);
  return mutate(
    actor,
    org,
    'fleet.manage',
    data.idempotencyKey,
    { operation: 'tag.lifecycle', id, ...data },
    async (tx) => {
      const old = (
        await tx.query<{ plant_id: string; state: string }>(
          'SELECT * FROM plant_tags WHERE id=$1 AND organisation_id=$2 FOR UPDATE',
          [id, org],
        )
      ).rows[0];
      if (!old || old.state !== 'active') throw new AppError(409, 'This tag is no longer active.');
      await tx.query('UPDATE plant_tags SET state=$2 WHERE id=$1', [
        id,
        data.action === 'retire' ? 'revoked' : 'replaced',
      ]);
      let next: string | null = null;
      if (data.action === 'replace') {
        next = randomUUID();
        await tx.query(
          'INSERT INTO plant_tags(id,organisation_id,plant_id,public_token) VALUES($1,$2,$3,$4)',
          [next, org, old.plant_id, randomBytes(24).toString('base64url')],
        );
        await tx.query('UPDATE plant_tags SET replaced_by=$2 WHERE id=$1', [id, next]);
      }
      await audit(tx, org, actor.id, 'tag.' + data.action, id, { replacementId: next });
      return { id: next || id, retiredId: id };
    },
  );
}
export async function programmingHistory(actor: Actor, org: string) {
  await tags(actor, org);
  return (
    await (
      await database()
    ).query(
      'SELECT tag_id,reader,uid,verification,created_at FROM tag_programming_events WHERE organisation_id=$1 ORDER BY created_at DESC LIMIT 200',
      [org],
    )
  ).rows;
}
