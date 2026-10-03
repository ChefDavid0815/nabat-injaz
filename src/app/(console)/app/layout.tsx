import { AppShell } from '@/components/app-shell';
import { currentWorkspace } from '@/server/session';
import { gatewayRoute } from '@/domain/analysis/routing';
export const dynamic = 'force-dynamic';
export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const data = await currentWorkspace();
  return (
    <AppShell
      {...data}
      analysisProvider={process.env.AI_PROVIDER || 'development'}
      analysisModel={
        process.env.AI_PROVIDER === 'gateway'
          ? gatewayRoute(data.workspace.ai_tier).label
          : process.env.AI_PROVIDER === 'workspace-agent'
            ? 'GPT-5.6 Luna'
            : ''
      }
    >
      {children}
    </AppShell>
  );
}
