# Clear Creek 3-15 Debugging Guide

## Problem Statement

After applying canonicalization fixes, "Clear Creek 3-15" items are still not showing on the allowed list or being filtered from CSV uploads.

## Root Cause Analysis

The issue could be one of several things. This guide helps diagnose which one.

### Potential Issues

1. **Allowed Items Enforcement Flag Not Enabled**
   - Even if the item is in the allowed list, it won't be filtered unless `enforceAllowed` is checked
   - Solution: Go to Settings → Allowed Items section and enable "Enforce Allowed Items" checkbox

2. **CSV Data Format Doesn't Match Regex**
   - The CSV might contain "Clear Creek 3-15" but the regex expects different spacing or quote styles
   - The canonicalization regex: `/clear\s+creek\s+3\s*[-"']?\s*15/gi`
   - This matches: "clear creek 3-15", "clear creek 3"15", "clear creek 3'15", etc.

3. **Browser Cache**
   - The service worker might be serving an older version of the JavaScript
   - Solution: Hard refresh (Ctrl+Shift+R or Cmd+Shift+R) or open DevTools and disable cache

4. **Item Not Actually in Allowed List**
   - The item might not have been loaded from the updated file
   - Solution: Check the console logs

## How to Debug

### Step 1: Open Browser Console
1. Open Localytics app
2. Press `F12` to open DevTools
3. Go to the "Console" tab
4. You should see logs starting with `[app]`

### Step 2: Check Allowed Items Are Loaded
Look for a log like:
```
[app] Allowed items loaded: 40 items
[app] First 3 allowed items: Array(3) [ ".75\" Black Granite", ".75\" Clear Creek", ".75\" Colorado Rose" ]
[app] Clear Creek items in allowed list: Array(3) [ ".75\" Clear Creek", "1.5\" Clear Creek", "Clear Creek 3\"-15" ]
[app] Canonical allowed items: Array(5) [ ".75\" Black Granite", ".75\" Clear Creek", ".75\" Colorado Rose", ".75\" Local River Rock", ".75\" Mountain Granite" ] ...
```

**Expected**: You should see exactly 3 Clear Creek items including `"Clear Creek 3\"-15"`

### Step 3: Check Enforcement Flag
Go to Settings page and look at the "Enforce Allowed Items" checkbox at the bottom of the Allowed Items section.

- If **unchecked**: Items won't be filtered at all. Check this box if you want filtering.
- If **checked**: Items should be filtered according to the allowed list.

### Step 4: Upload Test CSV and Check Filtering
1. Create a simple CSV with these items:
   ```
   item,qty,revenue
   Clear Creek 3-15,1,100
   Clear Creek 3"15,1,100
   Clear Creek 3'-15,1,100
   clear creek 3-15,1,100
   ```

2. Upload to Localytics
3. Check the console for logs like:
   ```
   [app][normalizeAndDedupe Row 0] Item: "Clear Creek 3-15", Canon: "Clear Creek 3\"-15"
   [app][normalizeAndDedupe Row 1] Item: "Clear Creek 3\"15", Canon: "Clear Creek 3\"-15"
   ```

   **Expected**: All four variants should canonicalize to `"Clear Creek 3"-15"` (with double quote)

### Step 5: Verify the Canonical Set
If the enforcement checkbox is enabled and items are still being filtered, check what's in the canonical allowed set.

When an item would be filtered out, you'll see a log like:
```
[app][normalizeAndDedupe] Filtering out item: "..." (canon: "...") - not in allowed list
[app][normalizeAndDedupe] Allowed set contains: Array(3) [ ".75\" Clear Creek", "1.5\" Clear Creek", "Clear Creek 3\"-15" ]
```

Compare the canonical form of your CSV item with what's in the allowed set.

## Common Solutions

### "I can see Clear Creek 3-15 in the allowed list, but items still get filtered"

**Check**: Is "Enforce Allowed Items" checkbox enabled?
- If NO → Check it to enable filtering
- If YES → Check the console logs to see what canonical form the CSV item becomes

### "My CSV says 'Clear Creek 3-15' but it doesn't match the canonical form"

The canonicalization converts it to: `Clear Creek 3"-15` (with double quote)

If the console shows it's not matching, it might be because:
1. The regex didn't match (spacing/quote issue)
2. The allowed list doesn't have exactly this canonical form

### "The logs show the item IS in the allowed set, but it's still filtered"

This would indicate a bug in the filtering logic. Check:
1. Console for any JavaScript errors (red text)
2. Whether you're using the latest version (hard refresh)
3. Create an issue with the console logs and we can investigate

## Expected Behavior After Fixes

1. **Allowed items list** contains exactly: `"Clear Creek 3"-15"`
2. **Canonicalization** of any variant (3-15, 3"15, 3'15) → `Clear Creek 3"-15"`
3. **Filtering** (when enabled) allows items that canonicalize to an item in the allowed list
4. **No filtering** when the "Enforce Allowed Items" checkbox is unchecked

## Files Modified

- `assets/js/allowed-items.js` - Fixed line 10 (Colorado Rose capitalization) and line 21 (Clear Creek 3-15)
- `assets/js/app.js` - Fixed canonicalization regex and title-case logic, added debug logging

## Related Documentation

- `CLAUDE.md` - Project architecture and canonicalization logic (section: "Data Normalization")
- `FIREBASE_RULES.md` - Firebase security configuration (if using cloud sync)

---

**Version**: 1.18.26
**Last Updated**: October 2025
