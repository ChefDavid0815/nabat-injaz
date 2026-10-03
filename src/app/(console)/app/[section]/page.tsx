import { notFound } from 'next/navigation';
import { AlertsView } from '@/components/admin/alerts-view';
import { TagsView } from '@/components/admin/tags-view';
import { LocationsView } from '@/components/admin/locations-view';
import { TeamView } from '@/components/admin/team-view';
import { AnalyticsView } from '@/components/admin/analytics-view';
import { SettingsView } from '@/components/admin/settings-view';
export async function generateMetadata({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  return { title: section.charAt(0).toUpperCase() + section.slice(1) };
}
export default async function SectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  switch (section) {
    case 'alerts':
      return <AlertsView />;
    case 'tags':
      return (
        <TagsView baseUrl={(process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '')} />
      );
    case 'locations':
      return <LocationsView />;
    case 'team':
      return <TeamView />;
    case 'analytics':
      return <AnalyticsView />;
    case 'settings':
      return <SettingsView />;
    default:
      notFound();
  }
}
