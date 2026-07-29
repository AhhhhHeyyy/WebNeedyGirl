// Fill this in from your own Firebase project — Firebase Console
// (https://console.firebase.google.com) → ⚙ Project settings → General →
// "Your apps" → Web app → SDK setup and configuration → "Config".
//
// A web app's apiKey isn't a secret (it's meant to ship to browsers) — what
// actually protects the data is the Firestore Security Rules you set on the
// project itself, so this file is fine to commit. Just don't leave the
// default open-to-anyone rules on past initial testing.
//
// Leaving apiKey empty (the default below) keeps the chat running in
// local-only mode — shared/firebase.js checks for this and simply skips
// persistence, so nothing breaks before you've set up a project.
export const firebaseConfig = {
  apiKey: 'AIzaSyBH5k2Y5BuElr4wt_j-TL4hLxHEzjjpvBM',
  authDomain: 'needy-31c07.firebaseapp.com',
  projectId: 'needy-31c07',
  storageBucket: 'needy-31c07.firebasestorage.app',
  messagingSenderId: '454647526233',
  appId: '1:454647526233:web:6fb911468feed91d6f5248',
};
