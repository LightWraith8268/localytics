# 🔥 Firebase Storage Testing Guide

This guide provides comprehensive instructions for testing Firebase storage functionality in the Localytics application.

## 📋 Overview

The Localytics app uses Firebase for cloud storage with localStorage as a fallback. This testing suite validates:

- **User Settings Storage** - Themes, filters, preferences
- **CSV Data Persistence** - Uploaded data and mappings
- **Authentication Flow** - Google sign-in integration
- **Error Handling** - Offline scenarios and edge cases
- **Performance** - Large dataset handling

## 🚀 Quick Start

### Option 1: Automated Testing (Recommended)

1. **Open the test suite**: Navigate to `test-firebase.html` in your browser
2. **Check configuration**: Click "Check Config" to validate Firebase setup
3. **Run all tests**: Click "🚀 Run All Tests" for comprehensive validation
4. **Review results**: Check the test summary for any failures

### Option 2: Manual Console Testing

1. **Open the main app** in browser with developer tools
2. **Load test script**:
   ```javascript
   import('./test-firebase-manual.js').then(module => {
     module.runAllTests();
   });
   ```
3. **Follow console output** for detailed results

### Option 3: Storage Validation Only

1. **Open**: `test-storage-validation.html`
2. **Click**: "🚀 Run Storage Validation"
3. **Review**: localStorage fallback functionality

## 🔧 Firebase Setup

### Prerequisites

1. **Firebase Project**: Create at [console.firebase.google.com](https://console.firebase.google.com)
2. **Enable Services**:
   - Authentication (Google provider)
   - Firestore Database
   - Optional: Analytics, App Check

### Configuration

1. **Copy template**: `cp assets/js/firebase.example.js assets/js/firebase.js`
2. **Update credentials**: Replace placeholder values with your Firebase config
3. **Test connection**: Use test suite to verify setup

### Required Firebase Config Structure

```javascript
export const firebaseConfig = {
  apiKey: "your-api-key",
  authDomain: "your-project.firebaseapp.com",
  projectId: "your-project-id",
  storageBucket: "your-project.appspot.com",
  messagingSenderId: "123456789012",
  appId: "1:123456789012:web:abcdef123456",
  measurementId: "G-MEASUREMENT123" // Optional
};
```

## 🧪 Test Categories

### 1. Configuration Testing

**Purpose**: Validate Firebase setup and connection

**Tests**:
- ✅ Config file exists and is valid
- ✅ Required fields present (apiKey, projectId, appId)
- ✅ No placeholder values remain
- ✅ Firebase initialization succeeds

**Expected Results**:
```
✅ Firebase config imported
✅ All required configuration fields present
✅ Firebase connection successful
```

### 2. Authentication Testing

**Purpose**: Verify Google sign-in integration

**Tests**:
- ✅ Auth observer setup
- ✅ Sign-in flow initiation
- ✅ User object populated correctly
- ✅ Sign-out functionality

**Expected Results**:
```
✅ User signed in: user@example.com
✅ User object contains uid, email, displayName
✅ Sign-out successful
```

### 3. User Settings Storage

**Purpose**: Test key-value storage for app preferences

**Tests**:
- ✅ String values (theme names)
- ✅ Boolean values (feature flags)
- ✅ Number values (numeric settings)
- ✅ Object values (complex preferences)
- ✅ Array values (lists of items)

**Expected Results**:
```
✅ Saved string: "dark"
✅ Loaded string correctly
✅ Saved object: {"bg":"#1a1a1a","text":"#fff"}
✅ Loaded object correctly
```

### 4. CSV Data Storage

**Purpose**: Validate large dataset persistence

**Tests**:
- ✅ Save CSV rows, headers, mapping
- ✅ Load complete dataset
- ✅ Metadata preservation (upload date, row count)
- ✅ Delete functionality

**Expected Results**:
```
✅ CSV data saved successfully (500 rows)
✅ CSV data loaded successfully (500 rows)
✅ Upload metadata preserved
✅ CSV data deleted successfully
```

### 5. Filter Persistence

**Purpose**: Test all 12 filter types

**Tests**:
- ✅ Date filters (start, end)
- ✅ Text filters (item, client, staff, order, category)
- ✅ Number filters (revMin, revMax, qtyMin, qtyMax)
- ✅ Boolean filters (noZero)

**Expected Results**:
```
✅ All 12 filter types saved and loaded correctly
✅ Filter UI restoration on page reload
```

### 6. Error Handling

**Purpose**: Validate robustness and fallback behavior

**Tests**:
- ✅ Invalid data types handled gracefully
- ✅ Network failures fall back to localStorage
- ✅ Large datasets perform adequately
- ✅ Circular references rejected properly

**Expected Results**:
```
✅ Invalid data 'function' properly rejected
✅ Large dataset (1000 items) save time: 45.2ms
✅ Offline mode falls back to localStorage
```

## 📊 Performance Benchmarks

### Target Performance

| Operation | Target Time | Notes |
|-----------|-------------|-------|
| User Settings Save | < 50ms | Small objects |
| User Settings Load | < 30ms | Cached data |
| CSV Save (1000 rows) | < 200ms | Large datasets |
| CSV Load (1000 rows) | < 100ms | Bulk data |
| Filter Save/Load | < 20ms | Frequent operations |

### Performance Testing

Run large dataset tests to validate performance:

```javascript
// Test with various dataset sizes
const sizes = [100, 500, 1000, 5000];
for (const size of sizes) {
  await testLargeDataset(size);
}
```

## 🐛 Troubleshooting

### Common Issues

#### 1. Configuration Problems

**Symptoms**: Tests fail with "Invalid Firebase config"

**Solutions**:
- Verify `firebase.js` exists and has valid credentials
- Check Firebase Console project settings
- Ensure all required fields are present
- Remove any `YOUR_` placeholder values

#### 2. Authentication Failures

**Symptoms**: "Sign-in is disabled" or auth errors

**Solutions**:
- Enable Authentication in Firebase Console
- Add Google as sign-in provider
- Check domain authorization (localhost should work)
- Verify API keys have correct permissions

#### 3. Firestore Permission Errors

**Symptoms**: "Missing or insufficient permissions" or "loadCsvData failed to read Firestore chunks"

**Solutions**:
- **Apply proper Security Rules**: See [FIREBASE_RULES.md](./FIREBASE_RULES.md) for required rules
- **Critical**: CSV chunks require explicit subcollection rules - parent rules don't inherit
- Start Firestore in test mode initially for development
- Ensure user is signed in before storage operations
- Wait 1-2 minutes after publishing rules for changes to propagate

**Quick Fix**:
```javascript
// Add this rule to Firestore Rules in Firebase Console:
match /userData/{userId}/csvChunks/{chunkId} {
  allow read, write: if request.auth != null && request.auth.uid == userId;
}
```

See [FIREBASE_RULES.md](./FIREBASE_RULES.md) for complete rule configuration.

#### 4. Network/Offline Issues

**Symptoms**: Storage operations fail intermittently

**Solutions**:
- Verify localStorage fallback is working
- Check network connectivity
- Test offline behavior explicitly
- Monitor browser developer tools for errors

### Debug Mode

Enable detailed logging by adding to console:

```javascript
// Enable Firebase debug logging
window.__firebaseDebug = true;

// Monitor storage operations
window.addEventListener('storage', (e) => {
  console.log('Storage changed:', e.key, e.newValue);
});
```

## 📈 Test Results Interpretation

### Success Criteria

- **All tests pass**: Firebase fully functional
- **Some tests fail with fallback**: Partial functionality, localStorage working
- **Many tests fail**: Configuration or setup issues

### Expected Patterns

#### With Valid Firebase Config + Authentication
```
✅ Configuration: Pass
✅ Storage Functions: Pass
✅ Authentication: Pass
✅ Error Handling: Pass
Overall: 4/4 tests passed
```

#### With Invalid Config (localStorage fallback)
```
❌ Configuration: Fail
✅ Storage Functions: Pass (localStorage)
❌ Authentication: Fail
✅ Error Handling: Pass
Overall: 2/4 tests passed
```

#### With Network Issues
```
✅ Configuration: Pass
⚠️  Storage Functions: Partial (fallback mode)
✅ Authentication: Pass
✅ Error Handling: Pass
Overall: 3/4 tests passed (acceptable)
```

## 🔄 Continuous Testing

### Development Workflow

1. **Before changes**: Run validation suite
2. **After storage changes**: Full test suite
3. **Before deployment**: Performance benchmarks
4. **Production monitoring**: Error rate tracking

### Automated Testing

Consider integrating these tests into CI/CD:

```bash
# Example CI test command
npm test:firebase
```

## 📝 Test Files Reference

| File | Purpose | Usage |
|------|---------|-------|
| `test-firebase.html` | Interactive test suite | Open in browser |
| `test-firebase-manual.js` | Console-based testing | Import in dev tools |
| `validate-storage.js` | localStorage validation | Fallback testing |
| `test-storage-validation.html` | Simple validation UI | Quick storage check |
| `firebase.example.js` | Configuration template | Copy to firebase.js |

## 🎯 Next Steps

After successful testing:

1. **Deploy with confidence** - All storage operations validated
2. **Monitor production** - Watch for authentication/storage errors
3. **Update tests** - Add new features to test suite
4. **Document findings** - Share results with team

---

**📞 Support**: If tests consistently fail, check Firebase Console for service status and billing limits.