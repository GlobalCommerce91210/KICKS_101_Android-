# KICK'S zero-trust collector boundary

Status: mandatory architecture rule.

- Deny every device and write by default.
- Authenticate every request; private-network location is never identity.
- Store only hashes of device bearer credentials and support immediate revocation.
- Authorize each observation against the current subject, consent identifier, exact purpose, and consent state.
- Reject unknown fields so payloads, URLs, query strings, and unapproved identifiers cannot enter the metadata store.
- Reject batch replay and cap body and batch sizes.
- Keep staging and production identities, credentials, databases, encryption keys, and logs separate.
- Redact credentials from application logs and return `no-store` responses.
- Treat the Android client, device, network, forwarding gateway, API, operators, and partners as independently untrusted.

The service must continue to say `metadata-only` and `staging` until persistent storage, encrypted forwarding, revocation, deletion, monitoring, and a physical-device test pass end to end.
