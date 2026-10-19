import { handleEmailRecoveryAcceptance } from '../../../../../src/nexus/email-recovery-acceptance.ts';
export const runtime = 'nodejs';
export async function POST(request: Request) { return handleEmailRecoveryAcceptance(request); }
