BISAYA TOOLKIT VIP VOUCHER - VERCEL UPDATE

WHY VERCEL IS REQUIRED

GitHub Pages can host the screen, but it cannot securely store/consume one-time
codes. This package keeps the frontend static and adds Vercel serverless API
routes backed by Upstash Redis. The Redis token and signing secret stay on the
server and are never placed in config.js or the Android app.

DEPLOY

1. Upload every file/folder in this package to the root of the Vercel project
   currently published at https://silog-three.vercel.app/
2. In Vercel, open Project Settings > Environment Variables.
3. Create an Upstash Redis database through the Vercel Marketplace or Upstash.
4. Add these Production environment variables:
   - UPSTASH_REDIS_REST_URL
   - UPSTASH_REDIS_REST_TOKEN (standard/write token; server only)
   - VOUCHER_SIGNING_SECRET (random string, at least 32 characters)
   - PUBLIC_SITE_ORIGIN=https://silog-three.vercel.app
   - SHORT_LINK_URL=https://earn4link.in/IPuIw
   - ANDROID_APP_PACKAGE=com.bisayatoolkit.ph
5. Redeploy the project.

SHORTENER DESTINATION

The corrected shortened link is already configured:
https://earn4link.in/IPuIw

Its final destination must remain:
https://silog-three.vercel.app/claim/

VIP ITEM JSON

Mark a target item in suggested.json, custom.json, or meme.json like this:

{
  "hero_name": "Zilong",
  "skin_name": "Okarun",
  "image": "https://...",
  "script": "https://...",
  "vip": true,
  "voucher_item_id": "zilong_okarun",
  "tutorial_url": "https://..."
}

The tutorial_url field is optional. voucher_item_id should be unique and should
not be changed after users begin requesting vouchers.

OPTIONAL ALLOWLIST

Set VIP_ITEM_IDS to comma-separated IDs if only selected IDs should be accepted:
VIP_ITEM_IDS=zilong_okarun,alucard_example

SECURITY NOTES

- One generation token can create only one code.
- A voucher expires after 15 minutes.
- Redeem is atomic, one-time, and bound to the requesting device hash and item.
- Direct page visits/refreshes return to the corrected shortened link.
- The app package, device/item values, rate limits, and short gate time are checked.
- Do not commit .env or copy the Upstash standard token into public files.
