export type EmailSendInput = { messageId: string; recipientEmail: string; subject: string; body: string };
export type EmailSendResult = { provider: "sendgrid"; providerMessageId: string | null };

export async function sendEmail(input: EmailSendInput): Promise<EmailSendResult> {
  const apiKey = process.env.SENDGRID_API_KEY;
  const fromEmail = process.env.OUTREACH_FROM_EMAIL;
  if (!apiKey || !fromEmail) throw new Error("OUTREACH_PROVIDER_NOT_CONFIGURED: SENDGRID_API_KEY and OUTREACH_FROM_EMAIL are required for real sends.");
  const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: input.recipientEmail }] }],
      from: { email: fromEmail, name: process.env.OUTREACH_FROM_NAME || "AI Revenue Engine" },
      subject: input.subject,
      content: [{ type: "text/plain", value: input.body }],
      headers: { "X-AI-Revenue-Engine-Message-ID": input.messageId },
    }),
  });
  if (response.status !== 202) {
    const detail = await response.text().catch(() => "");
    throw new Error(`OUTREACH_PROVIDER_FAILED: SendGrid HTTP ${response.status}${detail ? `: ${detail.slice(0, 300)}` : ""}`);
  }
  return { provider: "sendgrid", providerMessageId: response.headers.get("x-message-id") };
}
