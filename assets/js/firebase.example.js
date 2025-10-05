// Firebase Configuration Template
// Copy this file to firebase.js and fill in your actual Firebase project credentials
// Get these values from: Firebase Console > Project Settings > General > Your apps

export const firebaseConfig = {
  apiKey: "YOUR_API_KEY_HERE",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID",
  measurementId: "YOUR_MEASUREMENT_ID" // Optional, for Analytics
};

export default firebaseConfig;

/*
SETUP INSTRUCTIONS:
1. Go to https://console.firebase.google.com/
2. Create a new project or select existing one
3. Go to Project Settings > General tab
4. Scroll down to "Your apps" section
5. Add a web app or select existing one
6. Copy the config values and replace the placeholders above
7. Save this file as firebase.js (it's gitignored for security)

REQUIRED FIREBASE SERVICES:
- Authentication (Enable Google Sign-in provider)
- Firestore Database (Create in test mode initially)
- Optional: Analytics, App Check
*/