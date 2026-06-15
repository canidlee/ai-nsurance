// Stripe webhook — fires when a checkout completes, mints the buyer's unique
// access code, and emails it to them. This is what makes a paid-but-not-yet-used
// purchase recoverable: the code lives in Netlify Blobs AND in the buyer's inbox.
//
// Setup (Netlify → Environment variables):
//   STRIPE_SECRET_KEY      = sk_live_… (or sk_test_… while testing)
//   STRIPE_WEBHOOK_SECRET  = whsec_… (from the Stripe webhook endpoint you create)
//   RESEND_API_KEY         = re_…   (for the confirmation email)
// Then in the Stripe dashboard add a webhook endpoint pointing at:
//   https://ai-nsurance.com/.netlify/functions/stripe-webhook
//   listening for the event:  checkout.session.completed
const Stripe = require('stripe');
const { mintCodeForSession, emailCode } = require('./_codes.js');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const apiKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!apiKey || !webhookSecret) {
    return { statusCode: 500, body: 'Stripe webhook is not configured.' };
  }

  const stripe = Stripe(apiKey);
  const sig = event.headers['stripe-signature'] || event.headers['Stripe-Signature'];
  // Stripe signature verification needs the EXACT raw body.
  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body, 'base64').toString('utf8')
    : event.body;

  let stripeEvent;
  try {
    stripeEvent = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err) {
    return { statusCode: 400, body: `Webhook signature verification failed: ${err.message}` };
  }

  if (stripeEvent.type === 'checkout.session.completed') {
    let session = stripeEvent.data.object;
    // The event payload omits line items; re-retrieve with them expanded so we can
    // map the purchase to a tier and read the customer's email.
    try {
      session = await stripe.checkout.sessions.retrieve(session.id, { expand: ['line_items'] });
    } catch { /* fall back to the event payload */ }

    // 'paid' for normal orders; 'no_payment_required' for $0 (100%-off promo) orders.
    if (session.payment_status === 'paid' || session.payment_status === 'no_payment_required') {
      try {
        const minted = await mintCodeForSession(session);
        if (minted && minted.email) {
          await emailCode({ to: minted.email, code: minted.code, tier: minted.tier });
        }
      } catch (e) {
        // Don't 500 back to Stripe for a downstream hiccup — the redirect path can
        // still mint the same code idempotently. Log and acknowledge.
        console.error('mint/email failed:', e.message);
      }
    }
  }

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};
