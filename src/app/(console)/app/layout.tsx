import { AppShell } from '@/components/app-shell';
import { currentWorkspace } from '@/server/session';
export const dynamic = 'force-dynamic';
export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const data = await currentWorkspace();
  return (
    <AppShell {...data} analysisProvider={process.env.AI_PROVIDER || 'development'}>
      {children}
    </AppShell>
  );
}
