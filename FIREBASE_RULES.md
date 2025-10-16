# Firebase Security Rules for Localytics

This document provides the exact Firebase Security Rules configuration needed for Localytics to function properly.

## Required Firestore Rules

Copy these rules to your Firebase Console under **Firestore Database → Rules**:

```javascript
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {

    // User data - each user can only access their own data
    match /userData/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;

      // CSV Chunks subcollection - CRITICAL for data sync
      match /csvChunks/{chunkId} {
        allow read, write: if request.auth != null && request.auth.uid == userId;
      }
    }

    // User settings - each user can only access their own settings
    match /userSettings/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }

    // Reports - each user can only access their own reports
    match /reports/{userId}/{reportId=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

## Why These Rules Are Needed

### Main Document Access
```javascript
match /userData/{userId} {
  allow read, write: if request.auth != null && request.auth.uid == userId;
}
```
This allows authenticated users to read/write their main document containing metadata.

### Subcollection Access (CRITICAL)
```javascript
match /csvChunks/{chunkId} {
  allow read, write: if request.auth != null && request.auth.uid == userId;
}
```
**This is essential!** Firestore subcollections require **explicit rules**. Without this, users cannot read CSV chunk data even if they own the parent document.

## Common Error Without Proper Rules

If you see this error in the console:
```
[storage] loadCsvData failed to read Firestore chunks
FirebaseError: Missing or insufficient permissions.
```

**Cause**: The `csvChunks` subcollection doesn't have proper security rules.

**Solution**: Apply the rules above in Firebase Console.

## How to Apply Rules

1. Go to [Firebase Console](https://console.firebase.google.com)
2. Select your project
3. Navigate to **Firestore Database** → **Rules**
4. Replace existing rules with the rules above
5. Click **Publish**

## Testing Rules

After applying rules, test in the browser console:

```javascript
// This should succeed
await firebase.firestore()
  .collection('userData')
  .doc('YOUR_USER_ID')
  .collection('csvChunks')
  .get();
```

## Development Mode (NOT for Production)

For initial testing only, you can use open rules (⚠️ **insecure**):

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if request.time < timestamp.date(2025, 12, 31);
    }
  }
}
```

**Warning**: This allows **anyone** to read/write **all** data. Only use temporarily for testing, then switch to the proper rules above.

## Additional Security Considerations

### Rate Limiting
Consider adding rate limiting to prevent abuse:

```javascript
match /userData/{userId} {
  allow read: if request.auth != null && request.auth.uid == userId;
  allow write: if request.auth != null &&
                  request.auth.uid == userId &&
                  request.time > resource.data.lastUpdate + duration.value(1, 's');
}
```

### Size Limits
Validate document size to prevent large writes:

```javascript
match /csvChunks/{chunkId} {
  allow write: if request.auth != null &&
                  request.auth.uid == userId &&
                  request.resource.size() < 1000000; // 1MB limit per chunk
}
```

## Troubleshooting

### "Permission denied" errors persist after applying rules

1. **Clear browser cache** - Old security rules may be cached
2. **Wait 1-2 minutes** - Rule deployment takes time
3. **Check user is authenticated** - Rules require `request.auth` to exist
4. **Verify userId matches** - The document path must include the user's actual UID

### Rules not working for specific paths

Check the path structure matches your actual Firestore structure:
- Main docs: `/userData/{userId}`
- Chunks: `/userData/{userId}/csvChunks/{chunkId}`

Use Firebase Console → Firestore → Data tab to verify your actual paths.

## Related Documentation

- [FIREBASE_TESTING.md](./FIREBASE_TESTING.md) - Testing guide
- [Firebase Security Rules Docs](https://firebase.google.com/docs/firestore/security/get-started) - Official documentation

---

**Last Updated**: October 2025
**Version**: 1.13.6
