const Anthropic = require('@anthropic-ai/sdk');
const CARRIERS = require('./carriers-data.js');

const ALLOWED_ORIGIN = 'https://ai-nsurance.com';

// Access codes live SERVER-SIDE only. Set AUDIT_ACCESS_CODES in Netlify
// (Site settings → Environment variables) as a comma-separated list to
// rotate codes without a deploy. Fallback below keeps launch working.
function getValidCodes() {
  const env = process.env.AUDIT_ACCESS_CODES;
  return (env ? env.split(',') : ['TEST', 'FOUNDINGFRIEND']).map(c => c.trim().toUpperCase());
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

function buildPrompt(state, policyType, concern) {
  const carrierData = JSON.stringify(CARRIERS);
  return `You are an expert auto & home insurance policy auditor with 20 years of experience. You have been given a declarations page (or description of one) to audit.

Your job is to analyze this policy and produce a structured audit report. Be specific, practical, and honest. If you cannot determine something from the document, say so clearly rather than guessing. Your tone is a trusted advisor on the policyholder's side: warm, plain English, never alarmist, never bashing the insurance industry — most coverage problems come from policies going stale, not bad actors.

${SCORING_RUBRIC}

CARRIER DATA (use this for factor 7 and the carrier verdict — do NOT rely on your general knowledge for carrier scores):
${carrierData}

Return a JSON response with this exact structure:
{
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
  "full_summary": "<3-5 paragraph plain-English summary written directly to the policyholder. Include what to do this week, this month, and at next renewal.>"
}

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

  // ── SERVER-SIDE ACCESS CODE VALIDATION ──
  const code = (body.code || '').trim().toUpperCase();
  if (!getValidCodes().includes(code)) {
    return json(401, { error: 'Invalid or missing access code.' });
  }

  // Gate unlock check — validates the code without running an audit
  if (body.action === 'verify') {
    return json(200, { ok: true });
  }

  // ── AUDIT REQUEST ──
  const { fileBase64, mediaType, isPDF, state, policyType, concern } = body;
  if (!fileBase64 || !mediaType || !state || !policyType) {
    return json(400, { error: 'Missing required fields.' });
  }
  // ~6MB request ceiling on Netlify; reject oversized uploads with a clear message
  if (fileBase64.length > 5.5 * 1024 * 1024) {
    return json(413, { error: 'File too large. Please upload a file under 4MB (your declarations page, not the full policy book).' });
  }

  // The prompt is built HERE, server-side. Clients cannot send arbitrary
  // messages, so this endpoint cannot be repurposed as a free AI proxy.
  const prompt = buildPrompt(state, policyType, concern || 'None specified');

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 5000,
      messages: [{
        role: 'user',
        content: [
          { type: isPDF ? 'document' : 'image', source: { type: 'base64', media_type: mediaType, data: fileBase64 } },
          { type: 'text', text: prompt },
        ],
      }],
    });

    const rawText = (response.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
    let report;
    try {
      report = JSON.parse(rawText.replace(/```json|```/g, '').trim());
    } catch {
      const truncated = response.stop_reason === 'max_tokens';
      return json(502, {
        error: truncated
          ? 'The report was longer than expected and got cut off. Please try again — if it keeps happening, your declarations page may be very long.'
          : 'The analysis came back in an unexpected format. Please try again.'
      });
    }
    return json(200, { report });
  } catch (e) {
    const msg = (e.status === 401 || /api.?key/i.test(e.message || ''))
      ? 'The audit service is not configured correctly (API key). This is on our end — please contact help@ai-nsurance.com.'
      : (e.message || 'Something went wrong running the audit. Please try again.');
    return json(e.status || 500, { error: msg });
  }
};
