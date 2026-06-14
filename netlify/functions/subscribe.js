// Mailchimp subscribe — API key lives in Netlify env vars, NEVER in this repo (repo is public).
// Netlify: Site settings → Environment variables → add:
//   MAILCHIMP_API_KEY  = your key (the one ending in -us10)
//   MAILCHIMP_LIST_ID  = e6f1723940
const ALLOWED_ORIGIN = 'https://ai-nsurance.com';

exports.handler = async (event) => {
  const origin = event.headers.origin || event.headers.Origin || '';
  const isAllowed = origin === ALLOWED_ORIGIN || origin.endsWith('.netlify.app');
  const corsHeaders = {
    'Access-Control-Allow-Origin': isAllowed ? origin : ALLOWED_ORIGIN,
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
  const json = (statusCode, obj) => ({ statusCode, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify(obj) });

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: corsHeaders, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  const apiKey = process.env.MAILCHIMP_API_KEY;
  const listId = process.env.MAILCHIMP_LIST_ID || 'e6f1723940';
  if (!apiKey) return json(500, { error: 'Subscribe service not configured.' });

  let body;
  try { body = JSON.parse(event.body); } catch { return json(400, { error: 'Invalid request.' }); }

  const email = (body.email || '').trim().toLowerCase();
  const firstName = (body.firstName || '').trim().slice(0, 100);
  const concern = (body.concern || '').trim().slice(0, 200);
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json(400, { error: 'Please enter a valid email address.' });
  }

  const dc = apiKey.split('-')[1]; // e.g. "us10"
  const url = `https://${dc}.api.mailchimp.com/3.0/lists/${listId}/members`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from('anystring:' + apiKey).toString('base64'),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email_address: email,
        status: 'subscribed',
        merge_fields: { FNAME: firstName },
        tags: ['free-coverage-checkup', concern ? 'concern:' + concern.slice(0, 50) : 'concern:none'].filter(Boolean),
      }),
    });
    const data = await res.json();

    if (res.ok) return json(200, { ok: true });
    // Already subscribed → treat as success, not an error
    if (data.title === 'Member Exists') return json(200, { ok: true, existing: true });
    return json(502, { error: data.detail || 'Could not subscribe right now. Please try again.' });
  } catch (e) {
    return json(500, { error: 'Could not reach the email service. Please try again.' });
  }
};
