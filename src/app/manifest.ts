import type { MetadataRoute } from 'next';
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'NABAT — Every plant, known.',
    short_name: 'NABAT',
    description: 'Plant identity and a lifetime of care.',
    start_url: '/app',
    scope: '/',
    display: 'standalone',
    background_color: '#f7f6ef',
    theme_color: '#153d32',
    lang: 'en',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'Plants', url: '/app/plants' },
      { name: 'Alerts', url: '/app/alerts' },
    ],
  };
}
