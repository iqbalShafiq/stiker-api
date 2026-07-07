import { config } from '../config';
import type { LegalDocument, LegalSection } from '../content/legal/types';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatBody(body: string): string {
  const paragraphs = body.split('\n\n');
  return paragraphs
    .map((paragraph) => {
      const lines = paragraph.split('\n');
      if (lines.every((line) => line.startsWith('• ') || line.startsWith('- '))) {
        const items = lines
          .map((line) => `<li>${escapeHtml(line.replace(/^[•-]\s*/, ''))}</li>`)
          .join('');
        return `<ul>${items}</ul>`;
      }
      return `<p>${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`;
    })
    .join('\n');
}

function renderSections(sections: LegalSection[]): string {
  return sections
    .map(
      (section) =>
        `<section id="${escapeHtml(section.id)}"><h2>${escapeHtml(section.title)}</h2>${formatBody(section.body)}</section>`
    )
    .join('\n');
}

const baseStyles = `
  * { box-sizing: border-box; }
  body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; line-height: 1.6; color: #1a1a1a; margin: 0; padding: 0; background: #fafafa; }
  main { max-width: 720px; margin: 0 auto; padding: 24px 20px 48px; }
  h1 { font-size: 1.75rem; margin-bottom: 0.25rem; }
  .meta { color: #666; font-size: 0.9rem; margin-bottom: 1.5rem; }
  h2 { font-size: 1.15rem; margin-top: 1.75rem; margin-bottom: 0.5rem; }
  p, ul { margin: 0.5rem 0 1rem; }
  ul { padding-left: 1.25rem; }
  a { color: #2563eb; }
  .form-card { background: #fff; border: 2px solid #1a1a1a; border-radius: 8px; padding: 20px; margin-top: 2rem; box-shadow: 4px 4px 0 #1a1a1a; }
  label { display: block; font-weight: 600; margin-bottom: 0.35rem; }
  input[type="email"], textarea { width: 100%; padding: 10px 12px; border: 2px solid #1a1a1a; border-radius: 6px; font-size: 1rem; margin-bottom: 1rem; }
  textarea { min-height: 80px; resize: vertical; }
  .checkbox-row { display: flex; gap: 8px; align-items: flex-start; margin-bottom: 1rem; }
  button { background: #ef4444; color: #fff; border: 2px solid #1a1a1a; border-radius: 6px; padding: 12px 20px; font-size: 1rem; font-weight: 700; cursor: pointer; box-shadow: 3px 3px 0 #1a1a1a; }
  button:disabled { opacity: 0.6; cursor: not-allowed; }
  .message { padding: 12px; border-radius: 6px; margin-top: 1rem; }
  .message.success { background: #dcfce7; border: 1px solid #16a34a; }
  .message.error { background: #fee2e2; border: 1px solid #dc2626; }
`;

export function renderLegalDocumentHtml(doc: LegalDocument, options?: { showNav?: boolean }): string {
  const appName = config.legal.appName;
  const developerName = config.legal.developerName;
  const nav = options?.showNav
    ? `<nav style="margin-bottom:1.5rem"><a href="/privacy">Privacy</a> · <a href="/terms">Terms</a> · <a href="/account-deletion">Account deletion</a></nav>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(doc.title)} — ${escapeHtml(appName)}</title>
  <style>${baseStyles}</style>
</head>
<body>
  <main>
    ${nav}
    <h1>${escapeHtml(doc.title)}</h1>
    <p class="meta">${escapeHtml(developerName)} · ${escapeHtml(appName)} · Effective ${escapeHtml(doc.effectiveDate)}</p>
    <p><em>${escapeHtml(doc.summary)}</em></p>
    ${renderSections(doc.sections)}
  </main>
</body>
</html>`;
}

export function renderAccountDeletionPageHtml(doc: LegalDocument): string {
  const appName = config.legal.appName;
  const developerName = config.legal.developerName;
  const privacyEmail = config.legal.privacyEmail;
  const graceDays = config.legal.deletedAccountGraceDays;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Account Deletion — ${escapeHtml(appName)}</title>
  <style>${baseStyles}</style>
</head>
<body>
  <main>
    <nav style="margin-bottom:1.5rem"><a href="/privacy">Privacy Policy</a> · <a href="/terms">Terms</a></nav>
    <h1>${escapeHtml(doc.title)}</h1>
    <p class="meta">${escapeHtml(developerName)} · ${escapeHtml(appName)}</p>
    <p><em>${escapeHtml(doc.summary)}</em></p>
    ${renderSections(doc.sections)}
    <div class="form-card">
      <h2>Request account deletion</h2>
      <p>You do <strong>not</strong> need to reinstall the app. Submit your account email below. We typically process requests within ${graceDays} days.</p>
      <form id="deletion-form" method="post" action="/api/v1/legal/account-deletion/request">
        <label for="email">Account email</label>
        <input type="email" id="email" name="email" required autocomplete="email" placeholder="you@example.com">
        <label for="reason">Reason (optional)</label>
        <textarea id="reason" name="reason" maxlength="1000" placeholder="Optional reason for deletion"></textarea>
        <div class="checkbox-row">
          <input type="checkbox" id="confirmed" name="confirmed" value="true" required>
          <label for="confirmed" style="font-weight:400">I understand this will permanently delete my account and cloud data associated with it.</label>
        </div>
        <button type="submit" id="submit-btn">Submit deletion request</button>
        <div id="form-message" role="status" aria-live="polite"></div>
      </form>
      <p style="margin-top:1rem;font-size:0.9rem">Or contact <a href="mailto:${escapeHtml(privacyEmail)}">${escapeHtml(privacyEmail)}</a></p>
    </div>
  </main>
  <script>
    document.getElementById('deletion-form').addEventListener('submit', async function(e) {
      e.preventDefault();
      const btn = document.getElementById('submit-btn');
      const msg = document.getElementById('form-message');
      btn.disabled = true;
      msg.className = 'message';
      msg.textContent = 'Submitting...';
      const email = document.getElementById('email').value;
      const reason = document.getElementById('reason').value;
      const confirmed = document.getElementById('confirmed').checked;
      try {
        const res = await fetch('/api/v1/legal/account-deletion/request', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify({ email, reason: reason || undefined, confirmed })
        });
        const data = await res.json();
        if (res.ok && data.success) {
          msg.className = 'message success';
          msg.textContent = data.data.message || 'Request received. We will process your deletion request by email.';
          e.target.reset();
        } else {
          msg.className = 'message error';
          msg.textContent = data.error?.message || data.message || 'Request failed. Please email us directly.';
        }
      } catch (err) {
        msg.className = 'message error';
        msg.textContent = 'Network error. Please try again or email ${escapeHtml(privacyEmail)}.';
      }
      btn.disabled = false;
    });
  </script>
</body>
</html>`;
}
