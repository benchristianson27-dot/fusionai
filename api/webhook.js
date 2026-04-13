import Stripe from 'stripe';
import admin from 'firebase-admin';

// Initialize Firebase Admin
if (!admin.apps.length) {
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
  } catch (e) {
    console.error('Firebase Admin init failed:', e.message);
  }
}

const db = admin.apps.length ? admin.firestore() : null;

// Stripe needs the raw body for webhook verification
export const config = {
  api: {
    bodyParser: false,
  },
};

async function getRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;
  try {
    const rawBody = await getRawBody(req);
    const sig = req.headers['stripe-signature'];
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (e) {
    console.error('Webhook signature verification failed:', e.message);
    return res.status(400).json({ error: 'Webhook verification failed' });
  }

  // Handle the event
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const userEmail = session.customer_email || session.metadata?.userEmail;
    const tier = session.metadata?.tier;
    const userId = session.metadata?.userId;
    const customerId = session.customer;
    const subscriptionId = session.subscription;

    console.log('Payment completed:', { userEmail, tier, userId, customerId });

    if (db && userEmail && tier) {
      try {
        // Find user by email or userId
        let userDoc = null;
        if (userId) {
          userDoc = db.collection('users').doc(userId);
        } else {
          // Search by email
          const snapshot = await db.collection('users').where('email', '==', userEmail).limit(1).get();
          if (!snapshot.empty) {
            userDoc = snapshot.docs[0].ref;
          }
        }

        // Update or create user record
        const updateData = {
          userTier: tier,
          stripeCustomerId: customerId,
          stripeSubscriptionId: subscriptionId,
          email: userEmail,
          paidAt: admin.firestore.FieldValue.serverTimestamp(),
          promptsUsedMonth: 0, // Reset on new subscription
        };

        if (userDoc) {
          await userDoc.set(updateData, { merge: true });
        } else {
          // Create new doc keyed by email (fallback)
          await db.collection('users').doc(userEmail.replace(/[^a-zA-Z0-9]/g, '_')).set(updateData);
        }

        console.log('User tier updated:', userEmail, '->', tier);
      } catch (e) {
        console.error('Firestore update failed:', e.message);
      }
    }
  }

  if (event.type === 'customer.subscription.deleted') {
    const subscription = event.data.object;
    const customerId = subscription.customer;

    console.log('Subscription cancelled:', customerId);

    if (db) {
      try {
        // Find user by Stripe customer ID and downgrade to free
        const snapshot = await db.collection('users')
          .where('stripeCustomerId', '==', customerId)
          .limit(1)
          .get();

        if (!snapshot.empty) {
          await snapshot.docs[0].ref.set({
            userTier: 'free',
            stripeSubscriptionId: null,
            cancelledAt: admin.firestore.FieldValue.serverTimestamp(),
          }, { merge: true });
          console.log('User downgraded to free');
        }
      } catch (e) {
        console.error('Downgrade failed:', e.message);
      }
    }
  }

  return res.status(200).json({ received: true });
}
