# KICK’S native SwiftUI Auth0 integration

This is a separate native SwiftUI sample project added alongside (not in place of) the existing Expo/React Native app. It is based on Auth0's official Swift quickstart and uses the official Auth0.swift SDK via Swift Package Manager.

## Auth0 application values
- Tenant: `dev-dxqiztc3dpbtcfkd.us.auth0.com`
- Client ID: `jWaXQ4x8m1I3VlpKRrkHoj6ti2tDpvpF`
- Native sample bundle identifier: `com.datastorm.kicks.auth0sample`
- Callback mode: custom URL scheme (Universal Links intentionally not enabled because Apple Team ID is not yet supplied)

## Register callback and logout URLs
In Auth0 Dashboard > Applications > your Native application > Settings, add the exact platform-specific URLs you intend to test to **Allowed Callback URLs** and **Allowed Logout URLs**:

```text
com.datastorm.kicks.auth0sample://dev-dxqiztc3dpbtcfkd.us.auth0.com/ios/com.datastorm.kicks.auth0sample/callback
com.datastorm.kicks.auth0sample://dev-dxqiztc3dpbtcfkd.us.auth0.com/macos/com.datastorm.kicks.auth0sample/callback
com.datastorm.kicks.auth0sample://dev-dxqiztc3dpbtcfkd.us.auth0.com/visionos/com.datastorm.kicks.auth0sample/callback
```

Register only the platform URLs you intend to support, but exact string matches are required. Configure Auth0 before testing login/logout. The project does not use a client secret.

## Open
Open `auth0-ios-sample.xcodeproj` inside this directory with Xcode 16+. Xcode resolves the Auth0.swift package dependency. The native app is isolated from the existing KICK’S Expo project.

## Included behavior
- Login/signup uses `Auth0.webAuth()` Universal Login.
- `CredentialsManager` persists credentials in Keychain and requests `offline_access` for renewal.
- Logout calls the SDK's `clearSession` and clears locally stored credentials after successful logout.
- The official sample configuration script is included at `Configure.swift`.

## Verification status
Repository files have been added on a review branch. No Xcode build or physical-device test was performed in this environment; compilation, callback, login, token renewal, and logout validation remain required.
