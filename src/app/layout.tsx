import type { Metadata, Viewport } from 'next';
import { cookies } from 'next/headers';
import { Geist, Fraunces, Noto_Sans_Arabic } from 'next/font/google';
import { LocaleProvider } from '@/components/locale';
import { PwaRegistration } from '@/components/pwa';
import './globals.css';
const sans = Geist({ subsets: ['latin'], variable: '--font-sans', display: 'swap' });
const serif = Fraunces({ subsets: ['latin'], variable: '--font-serif', display: 'swap' });
const arabic = Noto_Sans_Arabic({
  subsets: ['arabic'],
  variable: '--font-arabic',
  display: 'swap',
});
export const metadata: Metadata = {
  title: { default: 'NABAT · Every plant, known.', template: '%s · NABAT' },
  description: 'One tap connects a living plant to its identity, care and lifetime history.',
  manifest: '/manifest.webmanifest',
  icons: { icon: '/icon.svg', apple: '/icons/apple-touch-icon.png' },
};
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#153d32',
};
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = (await cookies()).get('nabat_locale')?.value === 'ar' ? 'ar' : 'en';
  return (
    <html
      lang={locale}
      dir={locale === 'ar' ? 'rtl' : 'ltr'}
      data-scroll-behavior="smooth"
      className={`${sans.variable} ${serif.variable} ${arabic.variable}`}
    >
      <body>
        <a className="skip-link" href="#main-content">
          Skip to content
        </a>
        <LocaleProvider locale={locale}>
          {children}
          <PwaRegistration />
        </LocaleProvider>
      </body>
    </html>
  );
}
