import { workspaceAgentMcp } from '@/server/workspace-agent-mcp';
import { ready } from '@/server/db';
import { rateLimit } from '@/server/security';
export const runtime = 'nodejs';
export const maxDuration = 60;
async function handler(request: Request) {
  if (process.env.AI_PROVIDER !== 'workspace-agent')
    return Response.json({ error: 'This connection is inactive.' }, { status: 404 });
  const origin = request.headers.get('origin');
  if (origin && ![process.env.APP_URL, 'https://chatgpt.com'].includes(origin))
    return new Response('Origin not permitted.', { status: 403 });
  try {
    await ready();
    await rateLimit(
      `agent-mcp:${request.headers.get('x-forwarded-for')?.split(',')[0] || 'local'}`,
      120,
      60,
    );
    return await workspaceAgentMcp.fetch(request);
  } catch {
    return Response.json(
      { error: 'The observation tool request could not be completed.' },
      { status: 503 },
    );
  }
}
export const GET = handler;
export const POST = handler;
export const DELETE = handler;
