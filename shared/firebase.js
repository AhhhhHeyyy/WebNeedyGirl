// Firestore-backed comment log for the chatboard (src/layers/chat.chatboardLayer.js).
// Loaded straight from the CDN's own ES module build — matches this project's
// no-build-step convention (see README.md §1), no npm/bundler needed.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js';
import {
  getFirestore, collection, addDoc, serverTimestamp,
  query, orderBy, limit, getDocs,
} from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';

// firebase-config.js ships with an empty apiKey until a real project is
// wired up (see that file's header) — `db` just stays null in that case, so
// every call below becomes a no-op instead of throwing, and the chat keeps
// working purely locally.
let db = null;
if (firebaseConfig.apiKey) {
  try {
    db = getFirestore(initializeApp(firebaseConfig));
  } catch (err) {
    console.warn('[firebase] init failed, comments will not be persisted', err);
  }
}

// One document per chat message, capturing exactly what the compose modal
// already knows about the send: the text, the commenter's chosen name (or
// null for anonymous), the superchat tier if one was armed, and the sticker
// id if one was attached (see chat.chatboardLayer.js's compose modal).
// Fire-and-forget from the caller's perspective — network/permission
// failures are swallowed here so a misconfigured or offline backend never
// blocks the local chat UI.
export async function saveComment({
  text, name, scAmount, scColor, sticker,
}) {
  if (!db) return;
  try {
    await addDoc(collection(db, 'comments'), {
      text,
      name: name || null,
      scAmount: scAmount ?? null,
      scColor: scColor ?? null,
      sticker: sticker ?? null,
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    console.warn('[firebase] failed to save comment', err);
  }
}

// How many past comments a fresh page load restores — bounded so a
// long-running stream's log can't turn every reload into an ever-growing
// read.
const HISTORY_LIMIT = 50;

// Reads the most recent comments back out so the chatboard doesn't start
// empty on every reload — same fire-and-forget contract as saveComment():
// no db (unconfigured) or a failed read both just resolve to an empty list
// instead of throwing, so a misconfigured/offline backend never blocks the
// local chat UI from showing its own seed messages.
export async function loadComments() {
  if (!db) return [];
  try {
    const snap = await getDocs(
      query(collection(db, 'comments'), orderBy('createdAt', 'desc'), limit(HISTORY_LIMIT)),
    );
    // Firestore gives newest-first (needed for the limit to keep the most
    // recent N) — reverse back to chronological order for display.
    return snap.docs.map((doc) => doc.data()).reverse();
  } catch (err) {
    console.warn('[firebase] failed to load comments', err);
    return [];
  }
}
