'use client';
import Link from 'next/link';
import Image from 'next/image';
import { useState } from 'react';
import { Copy, Download, Radio, RefreshCw, ShieldX, ArrowRight } from 'lucide-react';
import { useApp, PageHeading } from '../app-shell';
import { useLocale } from '../locale';
import { ErrorMessage, Dialog, Empty, Status } from '../ui';
import { useResource } from '@/lib/use-resource';
import { mutate, dateLabel } from '@/lib/client';
interface TagRecord {
  id: string;
  plant_id: string;
  name: string;
  code: string;
  public_token: string;
  state: string;
  activated_at: string;
  last_interaction_at: string | null;
  replaced_by: string | null;
}
export function TagsView({ baseUrl }: { baseUrl: string }) {
  const { workspace, toast } = useApp(),
    { t, locale } = useLocale(),
    resource = useResource<TagRecord[]>(`/api/workspaces/${workspace.id}/tags`),
    [retired, setRetired] = useState(false),
    [confirmation, setConfirmation] = useState<{
      tag: TagRecord;
      action: 'replace' | 'revoke';
    } | null>(null),
    [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState(false);
  const tags = resource.data?.filter((x) => retired || x.state === 'active');
  if (workspace.role === 'caretaker') return <Empty title="Tag provisioning requires a manager" />;
  return (
    <>
      <PageHeading title="Tags" description="From a digital identity to a real plant." />
      <section className="provision-banner">
        <div>
          <Radio size={28} />
          <h2>A small tag. A permanent connection.</h2>
        </div>
        <ol>
          <li>Create plant</li>
          <li>Generate identity</li>
          <li>Encode / print</li>
          <li>Attach</li>
          <li>Test tap</li>
        </ol>
        <p>
          Write the destination as an NDEF URL to a standard NFC sticker. Keep this domain stable.
          The QR is a fallback for the same identity.
        </p>
        <Link className="text-link" href="/app/plants/new">
          Create a plant identity
          <ArrowRight size={18} />
        </Link>
      </section>
      <div className="section-toolbar">
        <p>{resource.data?.filter((x) => x.state === 'active').length || 0} active identities</p>
        <label className="checkbox-inline">
          <input type="checkbox" checked={retired} onChange={(e) => setRetired(e.target.checked)} />
          Show replacement history
        </label>
      </div>
      <ErrorMessage message={error || resource.error} />
      {tags?.length ? (
        <div className="tag-grid">
          {tags.map((tag) => (
            <article
              className={`panel tag-card ${tag.state !== 'active' ? 'retired' : ''}`}
              key={tag.id}
            >
              <div className="tag-card-heading">
                <span>
                  <h2>{tag.name}</h2>
                  <small>{tag.code}</small>
                </span>
                <Status state={tag.state} />
              </div>
              {tag.state === 'active' && (
                <div className="tag-preview">
                  <Image
                    src={`/api/tags/${tag.id}/artwork`}
                    alt={`Printable NFC and QR tag for ${tag.code}`}
                    width={138}
                    height={200}
                    unoptimized
                  />
                </div>
              )}
              <label>
                Destination URL
                <input
                  readOnly
                  value={`${baseUrl}/p/${tag.public_token}`}
                  aria-label={`Destination URL for ${tag.code}`}
                />
              </label>
              <small>
                Activated {dateLabel(tag.activated_at, locale, workspace.timezone)}
                <br />
                Last interaction{' '}
                {tag.last_interaction_at
                  ? dateLabel(tag.last_interaction_at, locale, workspace.timezone)
                  : 'not yet tested'}
                {tag.replaced_by && (
                  <>
                    <br />
                    Replacement ID {tag.replaced_by}
                  </>
                )}
              </small>
              {tag.state === 'active' && (
                <>
                  <div className="tag-actions">
                    <button
                      className="button secondary small"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(`${baseUrl}/p/${tag.public_token}`);
                          toast('Destination URL copied.');
                        } catch {
                          setError('Copy the destination URL from the field above.');
                        }
                      }}
                    >
                      <Copy size={16} />
                      {t('Copy URL')}
                    </button>
                    <a
                      className="button secondary small"
                      href={`/api/tags/${tag.id}/artwork`}
                      download
                    >
                      <Download size={16} />
                      {t('Print tag')}
                    </a>
                    <Link className="button small" href={`/p/${tag.public_token}`}>
                      <Radio size={16} />
                      {t('Test tap')}
                    </Link>
                  </div>
                  <div className="tag-secondary">
                    <button onClick={() => setConfirmation({ tag, action: 'replace' })}>
                      <RefreshCw size={14} />
                      {t('Replace tag')}
                    </button>
                    <button onClick={() => setConfirmation({ tag, action: 'revoke' })}>
                      <ShieldX size={14} />
                      {t('Revoke tag')}
                    </button>
                  </div>
                </>
              )}
            </article>
          ))}
        </div>
      ) : resource.data ? (
        <Empty title="Your first tag starts with a plant">
          <Link className="button" href="/app/plants/new">
            {t('Add plant')}
          </Link>
        </Empty>
      ) : (
        <div className="loading">{t('Loading…')}</div>
      )}
      {confirmation && (
        <Dialog
          title={t(confirmation.action === 'replace' ? 'Replace tag' : 'Revoke tag')}
          onClose={() => setConfirmation(null)}
        >
          <p>
            {confirmation.tag.code}: the existing URL will stop opening this plant.{' '}
            {confirmation.action === 'replace'
              ? 'A new identity token will be provisioned. Encode and attach the new tag.'
              : 'The plant and its history will remain. Provision a new tag from the plant record when needed.'}
          </p>
          <ErrorMessage message={error} />
          <button
            className="button full"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await mutate(`/api/tags/${confirmation.tag.id}`, { action: confirmation.action });
                setConfirmation(null);
                resource.reload();
                toast('Tag state updated.');
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy
              ? t('Loading…')
              : t(confirmation.action === 'replace' ? 'Replace tag' : 'Revoke tag')}
          </button>
        </Dialog>
      )}
    </>
  );
}
