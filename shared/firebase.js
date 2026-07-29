// Firestore-backed comment log for the chatboard (src/layers/chat.chatboardLayer.js).
// Loaded straight from the CDN's own ES module build — matches this project's
// no-build-step convention (see README.md §1), no npm/bundler needed.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js';
import {
  getFirestore, collection, addDoc, serverTimestamp,
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
