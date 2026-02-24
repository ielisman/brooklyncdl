# Cloudflare Turnstile Setup Guide

## Why Turnstile?
✅ **100% Free** - No limits, no costs
✅ **Invisible by default** - No user interaction needed in most cases  
✅ **Privacy-friendly** - No tracking or cookies
✅ **Fastest to implement** - Simpler than reCAPTCHA
✅ **Lightweight** - Minimal performance impact

## Setup Steps

### 1. Get Your Turnstile Keys (5 minutes)

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. Sign up/login (free account)
3. Click **Turnstile** in the left sidebar
4. Click **Add Site**
5. Configure:
   - **Site Name**: Brooklyn CDL
   - **Domain**: Add your domain (for testing, use `localhost`)
   - **Widget Mode**: Select **"Invisible"** ⭐
   - **Widget Type**: Managed (Recommended)
6. Click **Create**
7. Copy your keys:
   - **Site Key** (public, goes in HTML)
   - **Secret Key** (private, goes in .env)

### 2. Update Configuration Files

#### `.env` file:
```env
TURNSTILE_SITE_KEY=1x00000000000000000000AA
TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA
```

#### `index.html`:
Find this line (already added):
```html
<div class="cf-turnstile" 
     data-sitekey="YOUR_TURNSTILE_SITE_KEY"
```

Replace `YOUR_TURNSTILE_SITE_KEY` with your actual site key:
```html
<div class="cf-turnstile" 
     data-sitekey="1x00000000000000000000AA"
```

### 3. Test the Implementation

1. Rebuild your Docker container:
```bash
docker rm -f brooklyncdl-app
docker build -t brooklyncdl .
docker run -d --name brooklyncdl-app -p 80:80 --add-host=host.docker.internal:host-gateway -e DB_HOST=host.docker.internal --env-file .env brooklyncdl
```

2. Test the flow:
   - Try to sign up with an existing account
   - After 5 failed attempts, the Turnstile widget will appear
   - Complete the challenge (usually automatic/invisible)
   - Submit the form

### 4. How It Works

**Normal signup flow:**
- User fills out form
- Submits without CAPTCHA
- Works immediately ✅

**After 5 "already exists" errors:**
- Turnstile widget appears automatically
- Usually invisible - no user action needed
- Token sent to server for verification
- Server validates with Cloudflare
- If valid, signup proceeds

## Troubleshooting

### Widget not showing?
- Check browser console for errors
- Verify site key is correct in HTML
- Make sure domain matches Turnstile configuration

### Server verification failing?
- Check `.env` has correct `TURNSTILE_SECRET_KEY`
- Verify server has internet access to reach Cloudflare API
- Check server logs for detailed error messages

### Testing on localhost?
- Add `localhost` to your Turnstile site's domain list in Cloudflare dashboard

## Advanced Configuration

### Make it always visible (optional):
In `index.html`, remove the `style="display: none;"`:
```html
<div id="turnstile-container">
```

### Change theme:
```html
data-theme="light"  <!-- or "dark" or "auto" -->
```

### Adjust size:
```html
data-size="compact"  <!-- or "normal" or "flexible" -->
```

## Alternative Options (If Needed)

### hCaptcha
- **Free tier**: 1M requests/month
- **Invisible**: Requires paid plan ($20/month)
- **Setup**: Similar to Turnstile but slightly more complex
- **Use if**: You need specific compliance features

### Friendly Captcha
- **Cost**: $20/month minimum (no free tier)
- **Pros**: Very privacy-focused, GDPR compliant
- **Cons**: Not free, more expensive
- **Use if**: Privacy is absolute priority and budget allows

### ALTCHA
- **Cost**: Free (open-source)
- **Pros**: Self-hosted, full control
- **Cons**: Complex setup, requires infrastructure
- **Use if**: You want full control and have technical resources

## Recommendation
**Stick with Cloudflare Turnstile** - It's the perfect balance of:
- Free ✅
- Invisible ✅  
- Easy ✅
- Fast ✅
- Private ✅

No other option beats it for your use case!
