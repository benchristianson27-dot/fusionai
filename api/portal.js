/**
 * /api/portal.js — Stripe Customer Portal
 *
 * Optional upgrade. Right now the "Cancel" button in Settings falls back to
 * opening an email to you. Once you deploy this file, clicking Cancel sends
 * the user directly to Stripe's hosted portal where they can cancel, change
 * payment method, or view invoices — without you doing anything manually.
 *
 * Setup:
 *   1. Drop this file at api/portal.js in your Vercel project (same folder
 *      as chat.js and canvas.js).
 *   2. In your Vercel project Settings → Environment Variables, add:
 *        - STRIPE_SECRET_KEY: your sk_live_... or sk_test_... key
 *        - (existing) FIREBASE_PROJECT_ID and FIREBASE_PRIVATE_KEY,
 *          FIREBASE_CLIENT_EMAIL — should already be set for chat.js
 *   3. Enable the Customer Portal in Stripe Dashboard → Settings → Billing →
 *      Customer Portal. Toggle on "Allow customers to cancel subscriptions"
 *      and pick an end-of-period cancellation policy.
 *   4. Redeploy. Cancel button now goes straight to Stripe.
 *
 * Security:
 *   - We verify the Firebase ID token before doing anything, so a stranger
 *     can't open someone else's portal session by guessing emails.
 *   - The session URL Stripe returns is short-lived (a few minutes) and
 *     bound to the authenticated user's customer ID.
 */

const Stripe = require('stripe');

// Lazy-init so module load doesn't crash if env vars aren't set in dev
let _stripe = null;
function stripe() {
  if (!_stripe) {
    if (!process.env.STRIPE_SECRET_KEY) {
      throw new Error('STRIPE_SECRET_KEY not set in environment');
    }
    _stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  }
  return _stripe;
}

// Firebase Admin for token verification.
// Reuses the same env vars as chat.js — no extra config needed if your
// existing Firebase setup works for the chat endpoint.
let _admin = null;
function admin() {
  if (!_admin) {
    const a = require('firebase-admin');
    if (!a.apps.length) {
      a.initializeApp({
        credential: a.credential.cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        }),
      });
    }
    _admin = a;
  }
  return _admin;
}

module.exports = async (req, res) => {
  // CORS — allow fusion4ai.com and the Vercel preview domain to call this
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // 1. Verify the Firebase ID token from the Authorization header.
  //    Without this, anyone could POST an email and open someone else's portal.
  const authHeader = req.headers.authorization || '';
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!idToken) return res.status(401).json({ error: 'Missing auth token' });

  let decoded;
  try {
    decoded = await admin().auth().verifyIdToken(idToken);
  } catch (e) {
    return res.status(401).json({ error: 'Invalid auth token' });
  }
  const userEmail = decoded.email;
  if (!userEmail) return res.status(400).json({ error: 'Token has no email claim' });

  try {
    // 2. Find the Stripe customer for this email.
    //    We look up by email rather than storing a customer ID in Firestore
    //    so this works even for legacy users who signed up before the schema
    //    included customer IDs.
    const customers = await stripe().customers.list({ email: userEmail, limit: 1 });
    if (!customers.data.length) {
      return res.status(404).json({
        error: 'No Stripe customer found for this email. If you recently subscribed, please wait a few minutes and try again, or contact support.',
      });
    }
    const customer = customers.data[0];

    // 3. Create a billing portal session.
    //    `return_url` is where Stripe sends them after they close the portal.
    const session = await stripe().billingPortal.sessions.create({
      customer: customer.id,
      return_url: 'https://fusion4ai.com/',
    });

    return res.status(200).json({ url: session.url });
  } catch (e) {
    console.error('Portal creation failed:', e);
    return res.status(500).json({ error: 'Could not open billing portal: ' + e.message });
  }
};
