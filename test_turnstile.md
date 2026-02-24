# Turnstile Testing Guide

## Quick Test Steps

### 1. Rebuild Docker Container
```bash
docker rm -f brooklyncdl-app
docker build -t brooklyncdl .
docker run -d --name brooklyncdl-app -p 80:80 --add-host=host.docker.internal:host-gateway --env-file .env brooklyncdl
```

### 2. Test Normal Signup Flow
1. Open http://localhost
2. Click "Sign Up"
3. Fill in the form
4. Submit
5. ✅ **Expected**: Should work normally without Turnstile showing

### 3. Test Turnstile Trigger (After 5 Attempts)
1. Try to sign up with an existing email/license combination
2. See error: "An account with these credentials already exists"
3. Try again - repeat 5 times
4. ✅ **Expected**: After 5th attempt, Turnstile widget appears below password field
5. ✅ **Expected**: Message shows "Please complete the verification below to continue"

### 4. Test Turnstile Verification
1. Once widget appears (after 5 attempts), it should:
   - Show briefly (or be invisible)
   - Auto-complete (most cases)
   - Allow you to submit
2. Submit the form
3. ✅ **Expected**: Server logs show "🔐 Verifying Turnstile token..."
4. ✅ **Expected**: Server logs show "✅ Turnstile verification successful"

### 5. Verify in Browser Console
Open browser DevTools (F12) and check:
- No errors about Turnstile
- See: "✅ Turnstile verification successful" when widget completes
- Token is being sent to server

### 6. Check Server Logs
```bash
docker logs brooklyncdl-app
```

Look for:
```
🔐 Verifying Turnstile token...
✅ Turnstile verification successful
```

## Troubleshooting

### Widget Not Showing?
**Check**: Browser console for errors
**Fix**: Verify site key in index.html matches .env

### "Verification failed" Error?
**Check**: Server logs for Turnstile error details
**Fix**: Verify secret key in .env is correct

### Widget Shows but Won't Submit?
**Check**: Browser console for JavaScript errors
**Fix**: Ensure `window.turnstile` API is loaded

### Server Can't Verify Token?
**Check**: Server has internet access to reach Cloudflare
**Check**: Secret key in .env matches Cloudflare dashboard

## Expected Behavior Summary

| Scenario | Turnstile Visible? | Can Submit? |
|----------|-------------------|-------------|
| First signup | ❌ No | ✅ Yes |
| 1-4 failed attempts | ❌ No | ✅ Yes |
| 5+ failed attempts | ✅ Yes | ⚠️ After verification |
| Successful signup | ❌ Resets | ✅ Yes |

## Testing Checklist

- [ ] Docker container rebuilt with latest code
- [ ] Can access site at http://localhost
- [ ] Normal signup works (no Turnstile)
- [ ] After 5 "already exists" errors, Turnstile appears
- [ ] Turnstile widget loads without errors
- [ ] Can complete Turnstile verification
- [ ] Server successfully verifies token
- [ ] Browser console shows no errors
- [ ] Server logs confirm verification

## Notes

- **Invisible Mode**: In most cases, Turnstile will auto-verify without user interaction
- **Test Mode**: Your keys appear to be test keys (0x4AAAA...), which is perfect for development
- **Production**: When going live, create new keys for your production domain
