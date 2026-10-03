'use client';
import { useState, useEffect } from 'react';
import { Camera, ImagePlus, Upload } from 'lucide-react';
import Image from 'next/image';
import { Dialog, ErrorMessage } from './ui';
import { useLocale } from './locale';
import { mutate } from '@/lib/client';
async function compress(file: File) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1800 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Photo preparation failed. Try another photo.');
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Photo preparation failed.'))),
      'image/jpeg',
      0.88,
    ),
  );
}
export function PhotoCapture({
  plantId,
  careEventId,
  onClose,
  onUploaded,
}: {
  plantId: string;
  careEventId?: string;
  onClose: () => void;
  onUploaded: () => void;
}) {
  const { t } = useLocale();
  const [file, setFile] = useState<File | null>(null),
    [preview, setPreview] = useState(''),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(0),
    [note, setNote] = useState(''),
    [matched, setMatched] = useState(false),
    [error, setError] = useState<string | null>(null);
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );
  async function upload(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const image = await compress(file);
      if (image.size > 4 * 1024 * 1024)
        throw new Error('This photo is still too large. Crop it or choose a smaller photograph.');
      const { url } = await mutate<{ url: string }>('/api/observations/sign', {
        plantId,
        note,
        matchedView: matched,
        careEventId,
      });
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', url);
        xhr.setRequestHeader('Content-Type', 'image/jpeg');
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100));
        };
        xhr.onerror = () =>
          reject(new Error('Upload failed. Check your connection and try again.'));
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) resolve();
          else {
            try {
              reject(new Error(JSON.parse(xhr.responseText).error));
            } catch {
              reject(new Error('Upload failed. Try again.'));
            }
          }
        };
        xhr.send(image);
      });
      onUploaded();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  function choose(file?: File) {
    if (file && file.size > 20 * 1024 * 1024) {
      setError('Choose a photograph smaller than 20 MB before compression.');
      return;
    }
    setFile(file || null);
    setPreview(file ? URL.createObjectURL(file) : '');
    setError(null);
  }
  return (
    <Dialog
      title={t('Add observation')}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form onSubmit={upload}>
        <p>
          Use the whole plant, even light and a familiar viewpoint. A photograph adds context to its
          living record.
        </p>
        <div className="capture-options">
          <label className="button secondary">
            <Camera size={20} />
            {t('Take a photo')}
            <input
              className="visually-hidden"
              type="file"
              disabled={busy}
              accept="image/jpeg,image/png,image/webp"
              capture="environment"
              onChange={(e) => choose(e.target.files?.[0])}
            />
          </label>
          <label className="button secondary">
            <ImagePlus size={20} />
            {t('Choose a photo')}
            <input
              className="visually-hidden"
              type="file"
              disabled={busy}
              accept="image/jpeg,image/png,image/webp"
              onChange={(e) => choose(e.target.files?.[0])}
            />
          </label>
        </div>
        {preview && (
          <div className="capture-preview">
            <Image src={preview} alt="Observation preview" fill unoptimized />
          </div>
        )}
        <label>
          {t('Note')}
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={2000}
            placeholder="What did you notice?"
          />
        </label>
        <label className="checkbox-inline">
          <input type="checkbox" checked={matched} onChange={(e) => setMatched(e.target.checked)} />
          {t('Same viewpoint and similar lighting')}
        </label>
        <small className="helper">
          Only comparable observations contribute to a trend. JPEG, PNG or WebP. Photos are private.
        </small>
        <ErrorMessage message={error} />
        {busy && (
          <div className="upload-progress" role="status">
            <progress value={progress} max={100} />
            <span>
              {progress}% · {progress === 100 ? 'Saving observation…' : 'Uploading…'}
            </span>
          </div>
        )}
        <button className="button full" disabled={!file || busy}>
          <Upload size={18} />
          {busy ? t('Loading…') : t('Upload observation')}
        </button>
      </form>
    </Dialog>
  );
}
