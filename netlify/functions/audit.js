const Anthropic = require('@anthropic-ai/sdk');

const ALLOWED_ORIGIN = 'https://ai-nsurance.com';

exports.handler = async (event) => {
  const origin = event.headers.origin || event.headers.Origin || '';
  const isAllowed = origin === ALLOWED_ORIGIN || origin.endsWith('.netlify.app');

  const corsHeaders = {
    'Access-Control-Allow-Origin': isAllowed ? origin : ALLOWED_ORIGIN,
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: corsHeaders, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let params;
  try {
    params = JSON.parse(event.body).params;
    if (!params) throw new Error('Missing params');
  } catch {
    return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Invalid request body' }) };
  }

  // Enforce safe limits — callers cannot override these
  params.model = 'claude-haiku-4-5-20251001';
  params.max_tokens = Math.min(params.max_tokens || 2000, 2000);

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await client.messages.create(params);
    return {
      statusCode: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify(response),
    };
  } catch (e) {
    const status = e.status || 500;
    return {
      statusCode: status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: e.message }),
    };
  }
};
