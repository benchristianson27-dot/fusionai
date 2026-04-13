import admin from 'firebase-admin';

// Initialize Firebase Admin (singleton)
if (!admin.apps.length) {
  const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT 
    ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT) 
    : null;
  if (serviceAccount) {
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  } else {
    admin.initializeApp();
  }
}

const db = admin.firestore();

const ADMIN_EMAILS = ['ben.christianson27@gmail.com', 'tiffany@cglegalgroup.com'];

// Verify Firebase auth token and return user info + tier from Firestore
export async function verifyAuth(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ') || authHeader === 'Bearer anonymous') {
    return { authenticated: false, tier: 'free', isAdmin: false, uid: null, email: null };
  }
  
  try {
    const token = authHeader.split('Bearer ')[1];
    const decoded = await admin.auth().verifyIdToken(token);
    const uid = decoded.uid;
    const email = decoded.email || '';
    const isAdmin = ADMIN_EMAILS.includes(email);
    
    // Get tier from Firestore (server-side truth)
    let tier = 'free';
    if (isAdmin) {
      tier = 'enterprise';
    } else {
      try {
        const userDoc = await db.collection('users').doc(uid).get();
        if (userDoc.exists && userDoc.data().userTier) {
          tier = userDoc.data().userTier;
        }
      } catch (e) { /* default to free */ }
    }
    
    return { authenticated: true, tier, isAdmin, uid, email };
  } catch (e) {
    return { authenticated: false, tier: 'free', isAdmin: false, uid: null, email: null };
  }
}

export { admin, db };
