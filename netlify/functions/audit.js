const Anthropic = require('@anthropic-ai/sdk');
const CARRIERS = require('./carriers-data.js');
const { mintCodeForSession, tierForCode } = require('./_codes.js');

const ALLOWED_ORIGIN = 'https://ai-nsurance.com';

// Access codes live SERVER-SIDE only and are BOUND TO A TIER, so the tier a
// customer gets is tied to the code their Stripe purchase handed them — a
// $5 buyer cannot edit the URL to unlock the $79 audit.
//
// Configure in Netlify → Site settings → Environment variables (comma-separated):
//   AUDIT_CODES_T1  → tier 1 ($5 Coverage Score)
//   AUDIT_CODES_T2  → tier 2 ($39 Policy Review)
//   AUDIT_CODES_T3  → tier 3 ($79 Insurance Audit)
// Legacy AUDIT_ACCESS_CODES (if set) maps to tier 2 for backward compatibility.
// If nothing is configured, TEST/FOUNDINGFRIEND unlock tier 3 so launch + testing work.
function getCodeTierMap() {
  const map = {};
  const add = (envName, tier) => {
    const raw = process.env[envName];
    if (!raw) return;
    raw.split(',').forEach(c => {
      const k = c.trim().toUpperCase();
      if (k && !map[k]) map[k] = tier;
    });
  };
  add('AUDIT_CODES_T1', 1);
  add('AUDIT_CODES_T2', 2);
  add('AUDIT_CODES_T3', 3);
  add('AUDIT_ACCESS_CODES', 2); // legacy flat list → tier 2
  if (Object.keys(map).length === 0) { map.TEST = 3; map.FOUNDINGFRIEND = 3; }
  return map;
}

const SCORING_RUBRIC = `Score the policy using this exact 8-factor rubric (100 points total). Award points per factor, then sum for overall_score.
1. LIABILITY ADEQUACY (25 pts): 25 if limits >= 250/500/100 auto or $500k+ home liability aligned with assets; 18 if 100/300/100 or $300k home; 10 if 50/100/50 or $100k home; 0 if state minimums.
2. UM/UIM (15 pts, auto only): 15 if UM/UIM matches liability; 8 if present but lower; 0 if rejected/absent. For home policies, reallocate these 15 pts to factor 4.
3. REPLACEMENT COST BASIS (15 pts): 15 if RCV dwelling AND contents with extended replacement; 10 if RCV without extended; 5 if RCV dwelling but ACV contents; 0 if ACV dwelling.
4. LIMITS VS CURRENT VALUES (10 pts): 10 if limits plausibly match current rebuild/vehicle values; 5 if 10-25% stale; 0 if clearly outdated.
5. DEDUCTIBLE FIT (10 pts): 10 if efficient ($1,000-$2,500 typical, percentage deductibles understood); 5 if too low or unexplained-high; 0 if it would be a financial emergency.
6. UMBRELLA / ASSET ALIGNMENT (10 pts): 10 if umbrella present where warranted or clearly unneeded; 5 if no umbrella but underlying limits maxed; 0 if meaningful assets exposed.
7. CARRIER QUALITY (10 pts): Use the carrier data provided below. Composite >= 85 -> 10 pts; 75-84 -> 7; 65-74 -> 4; below 65 -> 1; carrier not in data -> 5 and flag for review.
8. POLICY HYGIENE & DISCOUNTS (5 pts): 5 if no lapses and discounts captured; 2 if 1-2 obvious unclaimed discounts; 0 if lapse indicators or multiple missed discounts.
If a factor cannot be determined from the document, award the midpoint and say so in the reason — honesty over false precision.`;

function buildPrompt(tier, state, policyType, concern, fileCount) {
  const carrierData = JSON.stringify(CARRIERS);

  const intro = tier === 3
    ? `You are an expert auto & home insurance auditor with 20 years of experience. You have been given ${fileCount > 1 ? `${fileCount} declarations pages from the same household` : 'a declarations page'} to audit TOGETHER as a single household. The most valuable findings live BETWEEN policies (coverage that overlaps, gaps that fall between auto and home, liability that no single policy covers) — look for those specifically.`
    : `You are an expert auto & home insurance policy auditor with 20 years of experience. You have been given a declarations page (or description of one) to audit.`;

  const toneAndData = `Your job is to analyze ${tier === 3 ? 'these policies' : 'this policy'} and produce a structured audit report. Be specific, practical, and honest. If you cannot determine something from the document, say so clearly rather than guessing. Your tone is a trusted advisor on the policyholder's side: warm, plain English, never alarmist, never bashing the insurance industry — most coverage problems come from policies going stale, not bad actors.

${SCORING_RUBRIC}

CARRIER DATA (use this for factor 7 and the carrier verdict — do NOT rely on your general knowledge for carrier scores):
${carrierData}`;

  // Tier-specific output contract
  let schema, depth;
  if (tier === 1) {
    depth = `This is a TIER 1 "Coverage Score" — a fast checkup. Identify the THREE most important findings only (most severe first). Keep the summary to a single short paragraph.`;
    schema = `{
  "tier": 1,
  "overall_score": <number 0-100, the sum of rubric factors>,
  "score_breakdown": [ { "factor": "<factor name>", "points": <awarded>, "possible": <max>, "reason": "<1 sentence>" } ],
  "issues_count": <total number of issues you observed, even if only top 3 are listed>,
  "discounts_count": <number>,
  "estimated_savings": "<string like '$200-400/yr'>",
  "carrier_name": "<carrier name from document>",
  "carrier_score": <composite score from carrier data, or 50 if unknown>,
  "carrier_verdict": "<1-2 sentence assessment grounded in the carrier data above>",
  "findings": [ <EXACTLY the top 3, each: { "severity": "critical|warning|good", "title": "<short title>", "description": "<1-2 sentences>", "action": "<specific next step>" }> ],
  "full_summary": "<ONE short paragraph: should they be worried, and the single most important next step.>"
}`;
  } else if (tier === 2) {
    depth = `This is a TIER 2 "Policy Review" — a complete read of one policy. List ALL findings, a full discount breakdown, and a thorough summary.`;
    schema = `{
  "tier": 2,
  "overall_score": <number 0-100, the sum of rubric factors>,
  "score_breakdown": [ { "factor": "<factor name>", "points": <awarded>, "possible": <max>, "reason": "<1 sentence>" } ],
  "issues_count": <number>,
  "discounts_count": <number>,
  "estimated_savings": "<string like '$200-400/yr'>",
  "carrier_name": "<carrier name from document>",
  "carrier_score": <composite score from carrier data, or 50 if unknown>,
  "carrier_verdict": "<2-3 sentence assessment grounded in the carrier data above>",
  "findings": [ { "severity": "critical|warning|good", "title": "<short title>", "description": "<2-3 sentences>", "action": "<specific next step>" } ],
  "discounts": [ { "name": "<discount name>", "savings": "<estimated range>" } ],
  "exclusions": [ { "title": "<what is NOT covered>", "description": "<1-2 sentences in plain English>" } ],
  "full_summary": "<3-5 paragraph plain-English summary written directly to the policyholder. Include what to do this week, this month, and at next renewal.>"
}`;
  } else {
    depth = `This is a TIER 3 "Insurance Audit" — the household review across ${fileCount > 1 ? 'all uploaded policies' : 'the policy provided'}. Include everything in a full review PLUS cross-policy analysis, a priority-ranked action plan, an agent discussion guide, and a one-paragraph executive summary. The overall_score should reflect the household's combined coverage health.`;
    schema = `{
  "tier": 3,
  "overall_score": <number 0-100, household combined coverage health>,
  "score_breakdown": [ { "factor": "<factor name>", "points": <awarded>, "possible": <max>, "reason": "<1 sentence>" } ],
  "issues_count": <number>,
  "discounts_count": <number>,
  "estimated_savings": "<string like '$200-400/yr'>",
  "carrier_name": "<primary carrier, or 'Multiple' if policies span carriers>",
  "carrier_score": <composite score from carrier data for the primary carrier, or 50 if unknown>,
  "carrier_verdict": "<2-3 sentence assessment grounded in the carrier data above>",
  "executive_summary": "<ONE paragraph: the household's overall situation and the single biggest priority.>",
  "findings": [ { "severity": "critical|warning|good", "title": "<short title>", "description": "<2-3 sentences>", "action": "<specific next step>" } ],
  "cross_policy_findings": [ { "severity": "critical|warning|good", "title": "<short title>", "description": "<what happens between policies — overlap or gap — and why it matters>", "action": "<specific next step>" } ],
  "discounts": [ { "name": "<discount name>", "savings": "<estimated range>" } ],
  "exclusions": [ { "title": "<what is NOT covered>", "description": "<1-2 sentences>" } ],
  "action_plan": [ { "priority": <1 is highest>, "item": "<what to do>", "impact": "<dollar or risk impact>" } ],
  "agent_guide": [ "<specific question to ask the agent>", "..." ],
  "full_summary": "<3-5 paragraph plain-English summary. Include what to do this week, this month, and at next renewal.>"
}`;
  }

  return `${intro}

${toneAndData}

${depth}

Return a JSON response with this exact structure:
${schema}

The policyholder's state: ${state}
Policy type: ${policyType}
Specific concern: ${concern}

Return ONLY the JSON. No preamble, no markdown code blocks, just the raw JSON object.`;
}

exports.handler = async (event) => {
  const origin = event.headers.origin || event.headers.Origin || '';
  const isAllowed = origin === ALLOWED_ORIGIN || origin.endsWith('.netlify.app');

  const corsHeaders = {
    'Access-Control-Allow-Origin': isAllowed ? origin : ALLOWED_ORIGIN,
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
  const json = (statusCode, obj) => ({
    statusCode,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify(obj),
  });

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: corsHeaders, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return json(400, { error: 'Invalid request body' });
  }

  // ── POST-PAYMENT SESSION EXCHANGE ──
  // Stripe redirects the buyer to audit-tool.html?session_id=cs_… after checkout.
  // We verify the session is paid and hand back the durable code minted for it
  // (idempotent with the webhook — both converge on one code per session).
  if (body.action === 'session') {
    const sessionId = (body.sessionId || '').trim();
    if (!sessionId) return json(400, { error: 'Missing checkout session.' });
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) return json(500, { error: 'Checkout verification is not configured.' });
    try {
      const stripe = require('stripe')(stripeKey);
      const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ['line_items'] });
      if (!session || session.payment_status !== 'paid') {
        return json(402, { error: 'This checkout session has not been paid.' });
      }
      const minted = await mintCodeForSession(session);
      if (!minted) return json(400, { error: 'Could not determine your plan from this purchase.' });
      return json(200, { ok: true, code: minted.code, tier: minted.tier });
    } catch {
      return json(400, { error: 'Could not verify this checkout session.' });
    }
  }

  // ── SERVER-SIDE ACCESS CODE VALIDATION (tier-bound) ──
  // Accept both pre-shared env codes and unique codes minted per Stripe purchase.
  const code = (body.code || '').trim().toUpperCase();
  let tier = getCodeTierMap()[code];
  if (!tier) tier = await tierForCode(code);
  if (!tier) {
    return json(401, { error: 'Invalid or missing access code.' });
  }

  // Gate unlock check — validates the code and reports the tier without running an audit
  if (body.action === 'verify') {
    return json(200, { ok: true, tier });
  }

  // ── AUDIT REQUEST ──
  const { state, policyType, concern } = body;
  // Accept a `files` array (tier 3 multi-policy) or legacy single-file fields.
  let files = Array.isArray(body.files) && body.files.length
    ? body.files
    : (body.fileBase64 ? [{ fileBase64: body.fileBase64, mediaType: body.mediaType, isPDF: body.isPDF }] : []);

  if (!files.length || !state || !policyType) {
    return json(400, { error: 'Missing required fields.' });
  }
  // Only tier 3 may submit multiple policies; lower tiers analyze the first file.
  if (tier < 3) files = files.slice(0, 1);
  if (files.some(f => !f.fileBase64 || !f.mediaType)) {
    return json(400, { error: 'One or more uploads are missing data. Please re-upload.' });
  }
  // ~6MB request ceiling on Netlify; reject oversized uploads with a clear message
  const totalBytes = files.reduce((sum, f) => sum + f.fileBase64.length, 0);
  if (totalBytes > 5.5 * 1024 * 1024) {
    return json(413, { error: 'Uploads are too large. Please keep total under ~4MB (declarations pages, not full policy books).' });
  }

  // The prompt is built HERE, server-side. Clients cannot send arbitrary
  // messages, so this endpoint cannot be repurposed as a free AI proxy.
  const prompt = buildPrompt(tier, state, policyType, concern || 'None specified', files.length);

  const docBlocks = files.map(f => ({
    type: f.isPDF ? 'document' : 'image',
    source: { type: 'base64', media_type: f.mediaType, data: f.fileBase64 },
  }));

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: tier === 3 ? 6500 : tier === 1 ? 3000 : 5000,
      messages: [{
        role: 'user',
        content: [...docBlocks, { type: 'text', text: prompt }],
      }],
    });

    const rawText = (response.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
    let report;
    try {
      let cleaned = rawText.replace(/```json|```/g, '').trim();
      const start = cleaned.indexOf('{');
      const end = cleaned.lastIndexOf('}');
      if (start !== -1 && end !== -1) cleaned = cleaned.slice(start, end + 1);
      report = JSON.parse(cleaned);
    } catch {
      const truncated = response.stop_reason === 'max_tokens';
      return json(502, {
        error: truncated
          ? 'The report was longer than expected and got cut off. Please try again — if it keeps happening, your declarations page may be very long.'
          : 'The analysis came back in an unexpected format. Please try again.'
      });
    }
    report.tier = tier; // authoritative tier from the validated code
    return json(200, { report });
  } catch (e) {
    const msg = (e.status === 401 || /api.?key/i.test(e.message || ''))
      ? 'The audit service is not configured correctly (API key). This is on our end — please contact help@ai-nsurance.com.'
      : (e.message || 'Something went wrong running the audit. Please try again.');
    return json(e.status || 500, { error: msg });
  }
};
