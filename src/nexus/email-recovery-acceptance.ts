import { InMemoryNexusResultStore, SOURCE_DISCOVERY_EXECUTION_VERSION } from './executor.ts';
import { handleNexusExecuteRequest } from './http.ts';

/** Fixed synthetic documents only: this adapter never performs a network or database operation. */
export async function handleEmailRecoveryAcceptance(request: Request, env: Record<string, string | undefined> = process.env) {
  const secret = env.EMAIL_RECOVERY_ACCEPTANCE_SECRET;
  if (env.VERCEL_ENV !== 'preview' || env.EMAIL_RECOVERY_ACCEPTANCE_ENABLED !== 'true' || !secret) {
    return Response.json({ code: 'NOT_AVAILABLE' }, { status: 404 });
  }
  const paths: string[] = [];
  const response = await handleNexusExecuteRequest(request, {
    secret, store: new InMemoryNexusResultStore(), allowResearch: false,
    allowContentInterpretation: false, allowSourceDiscovery: true,
    sourceDiscoveryOptions: {
      resolveHost: async () => [{ address: '93.184.216.34', family: 4 }],
      sleep: async () => {},
      fetchImpl: async input => {
        const url = new URL(String(input));
        if (url.origin !== 'https://recoveryvenue.org') throw new Error('FIXTURE_ORIGIN_ONLY');
        paths.push(url.pathname);
        if (url.pathname === '/robots.txt') return new Response('User-agent: *\nAllow: /');
        const pages: Record<string, string> = {
          '/': '<h1>Recovery Venue</h1><p>Recovery Venue is available for private hire.</p><a href="tel:+442012345678">Phone</a><a href="mailto:jane.smith@recoveryvenue.org">Jane Smith</a><a href="mailto:info@theatregroup.org">Head office group enquiries</a><a href="/functions/">Functions</a>',
          '/functions/': '<h1>Recovery Venue functions</h1><a href="/contact/">Venue hire contact</a>',
          '/contact/': '<h1>Recovery Venue contact</h1><p>Venue hire enquiries</p><a href="mailto:hire@recoveryvenue.org">Hire bookings</a><a href="mailto:info@recoveryvenue.org">General enquiries</a><a href="mailto:boxoffice@recoveryvenue.org">Box office</a>',
        };
        return new Response(`<html><body>${pages[url.pathname] ?? ''}</body></html>`, { status: pages[url.pathname] ? 200 : 404, headers: { 'content-type': 'text/html' } });
      },
    },
  });
  response.headers.set('x-email-recovery-execution-version', SOURCE_DISCOVERY_EXECUTION_VERSION);
  response.headers.set('x-email-recovery-fixture-paths', JSON.stringify(paths));
  response.headers.set('cache-control', 'no-store');
  return response;
}
