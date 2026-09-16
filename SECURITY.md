# Security status

Do not use this scaffold with sensitive personal data or real payouts until the production gates in `docs/ARCHITECTURE.md` pass.

## Dependency baseline

Type checks and API tests pass. The current React Native/Metro dependency chain retains a high-severity `image-size` development-tool advisory for which the registry currently reports no patched release. It is not accepted for production: track upstream remediation, restrict untrusted build assets, keep build workers isolated, and require a clean high/critical production dependency audit before release.

Report suspected vulnerabilities privately to the repository owner. Do not open a public issue containing user data, secrets, exploit details, or production identifiers.
