import { NextResponse, type NextRequest } from 'next/server';
// The preview process admits only the lead workspace and its local adapter.
export function middleware(request: NextRequest) {
  if(process.env.AIRE_LEAD_PREVIEW!=='1') return NextResponse.next();
  const p=request.nextUrl.pathname;
  const allowed=p==='/lead-preview'||p==='/api/incoming-leads'||(p==='/api/operator'&&request.method==='GET'&&request.nextUrl.searchParams.get('view')==='meta')||p==='/operator/incoming-leads'||/^\/operator\/incoming-leads\/[a-f0-9-]+$/.test(p)||p.startsWith('/_next/')||p==='/favicon.ico';
  if(!allowed) return new NextResponse('Unavailable in isolated lead preview',{status:404});
  const response=NextResponse.next(); response.headers.set('x-robots-tag','noindex, nofollow'); response.headers.set('cache-control','no-store');
  response.headers.set('content-security-policy',"default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: blob:; connect-src 'self' ws://127.0.0.1:3123 ws://localhost:3123; form-action 'self'; base-uri 'self'; frame-ancestors 'none'");
  return response;
}
