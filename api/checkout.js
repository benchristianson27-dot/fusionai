import Stripe from 'stripe';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  const { tier, userEmail, userId } = req.body;
  if (!tier || !userEmail) return res.status(400).json({ error: 'Missing tier or email' });

  const PRICES = {
    starter: process.env.STRIPE_PRICE_STARTER,
    pro: process.env.STRIPE_PRICE_PRO,
    enterprise: process.env.STRIPE_PRICE_ENTERPRISE,
  };

  const priceId = PRICES[tier];
  if (!priceId) return res.status(400).json({ error: 'Invalid tier' });

  // Get the origin for redirect URLs
  const origin = req.headers.origin || req.headers.referer || 'https://fusionai-xi.vercel.app';
  const siteUrl = origin.replace(/\/$/, '');

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      allow_promotion_codes: true,
      customer_email: userEmail,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: siteUrl + '?payment=success&tier=' + tier,
      cancel_url: siteUrl + '?payment=cancelled',
      metadata: {
        userId: userId || '',
        tier: tier,
        userEmail: userEmail,
      },
    });

    return res.status(200).json({ url: session.url });
  } catch (e) {
    console.error('Stripe checkout error:', e);
    return res.status(500).json({ error: e.message });
  }
}
