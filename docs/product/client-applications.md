# Client Applications

Hulee should treat client applications as production-grade products from the beginning, not as optional MVP wrappers.

## Target Clients

- Web/PWA for browser access.
- Android app through Capacitor.
- iOS app through Capacitor.
- Windows desktop app through Tauri.
- macOS/Linux desktop apps through Tauri when required by customer deployments.

## Strategic Choice

- Mobile: Capacitor.
- Desktop: Tauri.
- Web: Next.js/PWA.

Capacitor and Tauri should not replace the web app. They should wrap a shared client platform and add native capabilities where the browser is not enough.

## Recommended Structure

```txt
apps/
  web/                 # Next.js web/PWA client
  mobile/              # Capacitor Android/iOS app
  desktop/             # Tauri Windows/macOS/Linux app

packages/
  ui/                  # shared UI primitives and tokens
  app-shell/           # shared navigation, layouts, auth state, inbox shell logic
  native-bridge/       # common interface for native capabilities
  i18n/                # dictionaries and formatting helpers
  contracts/           # API and event contracts
```

## Next.js And Native Shells

The web app can use Next.js App Router.

Native shells should not depend on server-only Next.js behavior. There are two acceptable production patterns:

1. Bundled client shell.

   The mobile/desktop app ships static web assets and talks to the Hulee API. This is the preferred store-grade model because the app has a real packaged client, predictable versioning and better offline/loading behavior.

2. Controlled remote shell.

   The native app loads a tenant/server web URL and adds native capabilities through a bridge. This can speed up UI updates, but it must still pass store review expectations and should not be just an unmanaged browser frame.

The preferred long-term approach is shared packages plus separate app entrypoints:

- `apps/web` may use Next.js features deeply.
- `apps/mobile` and `apps/desktop` should use the shared UI/app-shell packages and only the subset of web behavior that can run inside the native shell.

## Mobile: Capacitor

Capacitor is the standard mobile shell for Android and iOS.

Required production capabilities:

- push notifications;
- deep links;
- Universal Links for iOS;
- App Links for Android;
- file picker;
- camera/media permissions;
- clipboard where needed;
- local secure storage for session/device data;
- native permissions handling;
- app badge counters;
- tenant/server selection for SaaS, isolated SaaS and on-prem;
- crash/error diagnostics;
- app version and build metadata reporting.

Android builds require Android Studio and Android SDK.

iOS builds require Apple tooling: macOS, Xcode and Apple Developer account. iOS can be developed from shared TypeScript/React code on Windows, but final signing, TestFlight/App Store distribution and reliable simulator/device testing require Mac/Xcode or macOS CI.

## Desktop: Tauri

Tauri is the standard desktop shell for Windows, with macOS/Linux support when needed.

Required production capabilities:

- native desktop notifications;
- tray icon;
- deep links/custom protocol;
- autostart option;
- app badge/unread count where supported;
- secure local storage;
- file downloads/uploads;
- auto-update;
- code signing;
- Windows installer packaging;
- tenant/server selection for SaaS, isolated SaaS and on-prem;
- crash/error diagnostics;
- app version and build metadata reporting.

Electron should be avoided unless a specific integration requires it. Tauri is preferred because it is lighter and fits an operational/business app better.

## Push And Notifications

Notification channels:

- Web Push for browser/PWA.
- FCM for Android.
- APNs for iOS.
- Native desktop notifications for Tauri.

The platform notification service must deduplicate notifications across devices and channels. Closing a support case or receiving a message should produce one logical notification event that fan-outs to the user's active endpoints without duplicate visible alerts.

## Deep Links

Required link types:

- browser URLs;
- Android App Links;
- iOS Universal Links;
- desktop custom protocol links;
- fallback web URLs.

Deep links must support:

- opening a conversation;
- opening a support case;
- opening client profile;
- opening integration setup;
- completing auth/integration callbacks where appropriate.

## Distribution

Mobile:

- Google Play production/internal testing.
- App Store/TestFlight.
- Signing keys/certificates managed outside source control.
- Store metadata and screenshots tracked as release assets.

Desktop:

- Windows installer, preferably signed.
- Auto-update channel.
- Enterprise/manual installer for on-prem customers.
- macOS notarization/signing if macOS app is shipped.

## On-Prem Considerations

On-prem apps must be able to connect to customer-specific hosts. The app should support:

- tenant/server URL configuration;
- enterprise certificate constraints where needed;
- update channels compatible with customer policies;
- feature flags and module availability from the tenant config;
- clear diagnostics when the app cannot reach the server.

## Testing

Client apps require:

- unit tests for native bridge abstractions;
- contract tests for bridge implementations;
- Playwright tests for shared web flows;
- mobile smoke tests for auth, push, deep links and file upload;
- desktop smoke tests for launch, auth, notifications, deep links and auto-update.

## References

- Capacitor environment setup: https://capacitorjs.com/docs/getting-started/environment-setup
- Capacitor deep links: https://capacitorjs.com/docs/guides/deep-links
- Tauri documentation: https://v2.tauri.app/
- Tauri prerequisites: https://v2.tauri.app/start/prerequisites/
- Apple Xcode: https://developer.apple.com/xcode/
- Apple TestFlight: https://developer.apple.com/testflight/
