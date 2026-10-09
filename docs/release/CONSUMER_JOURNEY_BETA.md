# Shared consumer account journey
Android and iOS use the same account and profile screens and SessionProvider.
- Login verifies DataStorm account and active KICK'S entitlement, then opens Profile.
- Native refresh credentials use SecureStore; access tokens and passwords are not persisted.
- Restoration rotates refresh credentials and rechecks account/product identity.
- Logout clears local identity immediately and reports uncertain server revocation/storage failure.
- Rejected refresh or authenticated 401 signs out; protected Profile redirects to Account.
- Profile loads account/product, consumer-state, snapshot, devices, permissions, consent and wallet. Monitoring derives from snapshot. Optional failures remain unavailable.
- Profile responses from a changed session or superseded request are discarded; unavailable devices/consent counts are not presented as zero.
- Settings links account/profile on both platforms.
Configure explicit HTTPS staging origin: EXPO_PUBLIC_API_URL for Android; EXPO_PUBLIC_IOS_API_URL (or shared API URL) for iOS. No localhost fallback. SecureStore plugin configured for both generated native projects.
Web storage remains memory-only; browser reload persistence is outside native Android/iOS scope.
No collector identity rewrite, production changes or device data deletion.
Validation: exact commit CI required. Physical Android/iPad account flow and authenticated staging remain UNVERIFIED until device/operator checks. Native Android compilation and signing are separate release gates.
