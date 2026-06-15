// Shared helpers for per-purchase audit access codes.
//
// Codes are MINTED when Stripe confirms a payment and persisted in Netlify Blobs,
// so a buyer who pays but doesn't upload right away can come back days later,
// enter the code from their email, and still unlock the audit they paid for.
//
// One code per Stripe checkout session (idempotent), bound to a tier (1|2|3) so a
// $5 buyer can never unlock the $79 audit.
const crypto = require('crypto');
const { getStore } = require('@netlify/blobs');

const STORE_NAME = 'audit-codes';
function store() { return getStore(STORE_NAME); }

// Map a paid Stripe session to a tier (1|2|3), or 0 if it can't be determined.
// Prefers an explicit price→tier env mapping; falls back to the amount paid so it
// still works before distinct Stripe prices are wired up.
//   STRIPE_PRICE_T1 / STRIPE_PRICE_T2 / STRIPE_PRICE_T3  = the Stripe price IDs
function sessionTier(session) {
  const priceMap = {
    [process.env.STRIPE_PRICE_T1]: 1,
    [process.env.STRIPE_PRICE_T2]: 2,
    [process.env.STRIPE_PRICE_T3]: 3,
  };
  const lineItems = session.line_items && session.line_items.data;
  if (lineItems && lineItems.length) {
    for (const li of lineItems) {
      const priceId = li.price && li.price.id;
      if (priceId && priceMap[priceId]) return priceMap[priceId];
    }
  }
  // Fallback: infer from the pre-discount subtotal (in cents). Using amount_subtotal
  // (not amount_total) means a 100%-off promo code like FOUNDERFREE / PRELAUNCHFREE
  // still maps to the right tier even though the buyer paid $0. Thresholds sit between
  // the tier prices ($5 / $39 / $79) so small tax/fees don't bump a buyer up a tier.
  const cents = session.amount_subtotal || session.amount_total || 0;
  if (cents >= 6000) return 3; // $79 Insurance Audit
  if (cents >= 2000) return 2; // $39 Policy Review
  if (cents >= 300)  return 1; // $5 Coverage Score
  return 0;
}

// Readable, hard-to-guess code, e.g. AUD-7F3K-9QX2.
function generateCode() {
  const part = () => crypto.randomBytes(4).toString('hex').toUpperCase().slice(0, 4);
  return `AUD-${part()}-${part()}`;
}

// Idempotent: returns the existing code for this session if one was already minted,
// otherwise creates and stores a new one. Returns { code, tier, email } or null.
async function mintCodeForSession(session) {
  const s = store();
  const sessionKey = `session/${session.id}`;

  const existingCode = await s.get(sessionKey).catch(() => null);
  if (existingCode) {
    const rec = await s.get(`code/${existingCode}`, { type: 'json' }).catch(() => null);
    if (rec) return { code: existingCode, tier: rec.tier, email: rec.email };
  }

  const tier = sessionTier(session);
  if (!tier) return null;

  const email = (session.customer_details && session.customer_details.email)
    || session.customer_email || '';
  const code = generateCode();
  const record = { tier, email, sessionId: session.id, created: new Date().toISOString() };

  await s.setJSON(`code/${code}`, record);
  await s.set(sessionKey, code);
  return { code, tier, email };
}

// Look up a minted code and return its tier (1|2|3), or 0 if unknown.
async function tierForCode(code) {
  const rec = await store().get(`code/${code}`, { type: 'json' }).catch(() => null);
  return rec ? rec.tier : 0;
}

// Email the access code to the buyer via Resend. No-ops (returns false) if RESEND_API_KEY
// or the recipient is missing, so a missing email never breaks the webhook.
async function emailCode({ to, code, tier }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || !to) return false;

  const from = process.env.RESEND_FROM || 'AI-nsurance <noreply@ai-nsurance.com>';
  const names = { 1: 'Coverage Score', 2: 'Policy Review', 3: 'Insurance Audit' };
  const tierName = names[tier] || 'audit';
  const link = `https://ai-nsurance.com/audit-tool.html?code=${encodeURIComponent(code)}`;

  const html = `
    <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;color:#1a1a18;line-height:1.6;">
      <h2 style="font-size:22px;margin:0 0 8px;">Your ${tierName} is ready to run</h2>
      <p style="color:#4a4a44;margin:0 0 20px;">Thanks for your purchase! Your access code is below. Use it whenever you're ready — it doesn't expire, so there's no rush if you need to gather your documents first.</p>
      <div style="background:#f0ede6;border-radius:10px;padding:18px;text-align:center;margin:0 0 20px;">
        <div style="font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#8a8a80;margin-bottom:6px;">Your access code</div>
        <div style="font-size:26px;font-weight:700;letter-spacing:0.04em;color:#1d6b4a;">${code}</div>
      </div>
      <p style="text-align:center;margin:0 0 24px;">
        <a href="${link}" style="display:inline-block;background:#1d6b4a;color:#fff;text-decoration:none;padding:12px 28px;border-radius:10px;font-weight:600;">Start my ${tierName} &rarr;</a>
      </p>
      <p style="font-size:13px;color:#8a8a80;margin:0;">If the button doesn't work, go to ai-nsurance.com/audit-tool.html and enter the code above. Questions? Reply to this email or reach us at help@ai-nsurance.com.</p>
    </div>`;

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, subject: `Your AI-nsurance access code — ${tierName}`, html }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

module.exports = { mintCodeForSession, tierForCode, emailCode, sessionTier, generateCode };
