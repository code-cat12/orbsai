// Firebase Admin (server-only). Shared by the API files.
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

// Turns setup mistakes into a short, safe reason the page can show (never secrets).
export function setupProblem(e) {
  const msg = String((e && (e.message || e.details)) || e || "");
  const code = e && e.code;
  if (/FIREBASE_SERVICE_ACCOUNT is missing/.test(msg)) return "FIREBASE_SERVICE_ACCOUNT isn't set in Vercel";
  if (/not valid JSON|Unexpected token|JSON/.test(msg)) return "FIREBASE_SERVICE_ACCOUNT isn't the whole .json file";
  if (/private key|PEM|DECODER|asn1/i.test(msg)) return "the Firebase private key got cut off or changed";
  if (code === 5 || /NOT_FOUND/.test(msg)) return "the Firestore database isn't created yet";
  if (code === 7 || /PERMISSION_DENIED/.test(msg)) return "the service account isn't allowed to use Firestore (or the Firestore API is off)";
  if (/project/i.test(msg) && /mismatch|audience|aud/i.test(msg)) return "the service account is from a different Firebase project";
  return "server error";
}

export function admin() {
  if (!getApps().length) {
    const env = process.env;
    let sa;
    if (env.FIREBASE_PROJECT_ID && env.FIREBASE_CLIENT_EMAIL && env.FIREBASE_PRIVATE_KEY) {
      // Option B: three one-line values copied out of the .json file
      sa = { project_id: env.FIREBASE_PROJECT_ID.trim(), client_email: env.FIREBASE_CLIENT_EMAIL.trim(),
             private_key: env.FIREBASE_PRIVATE_KEY.trim().replace(/^"|"$/g, "") };
    } else {
      // Option A: the whole .json file in FIREBASE_SERVICE_ACCOUNT
      if (!env.FIREBASE_SERVICE_ACCOUNT) throw new Error("FIREBASE_SERVICE_ACCOUNT is missing");
      try { sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT.trim()); } catch { throw new Error("FIREBASE_SERVICE_ACCOUNT is not valid JSON"); }
    }
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
