// POST /api/kids — age question and Kids Mode on/off (with parent PIN).
import { admin, getKids, setKids } from "./_admin.js";
import { makeKidsHandler } from "./_kids.js";

export const POST = makeKidsHandler({
  verifyToken: (t) => admin().auth.verifyIdToken(t),
  getKids,
  setKids,
});
