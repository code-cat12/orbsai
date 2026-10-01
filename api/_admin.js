// Firebase Admin (server-only). Shared by the API files.
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

export function admin() {
  if (!getApps().length) {
    const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    if (sa.private_key) sa.private_key = sa.private_key.replace(/\\n/g, "\n");
    initializeApp({ credential: cert(sa) });
  }
  return { auth: getAuth(), db: getFirestore() };
}

// Kids Mode settings live in kids/{uid}. Only the server can change them (see firestore.rules).
export async function getKids(uid) {
  const snap = await admin().db.doc(`kids/${uid}`).get();
  return snap.exists ? snap.data() : null;
}
export async function setKids(uid, data) {
  await admin().db.doc(`kids/${uid}`).set(data, { merge: true });
}
// Safety log for the site owner: what kind of thing was blocked, never the message itself.
export async function flag(uid, info) {
  await admin().db.collection("flags").add({ uid, ...info, at: new Date() });
}
