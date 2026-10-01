# TENSORRA mobile shell

TENSORRA v0.4 is web-first and installable as a PWA. This Capacitor shell is the App Store / Google Play path after the web app has a production URL.

Requires Node.js 22+ and native tooling (Xcode for iOS, Android Studio for Android).

```bash
cd mobile
npm install
TENSORRA_WEB_URL=https://YOUR_DEPLOYED_DOMAIN npm run add:ios
TENSORRA_WEB_URL=https://YOUR_DEPLOYED_DOMAIN npm run add:android
npm run sync
```

Then open the native projects with `npm run open:ios` or `npm run open:android`.

The shell intentionally points at the hosted TENSORRA app so auth, AI streaming, updates and backend behavior stay identical across web and mobile. Native capabilities can be added later through Capacitor plugins without replacing the AI backend.
