export const IOS_BETA_STATUS = Object.freeze({
  platform: 'ios', enrollment: 'closed', collection: 'unverified',
  blockers: Object.freeze(['native_tunnel', 'consent_bound_enrollment', 'durable_ingestion', 'engine_validation', 'signed_candidate_validation']),
});

export function renderIosBeta() {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>KICK’S iOS Beta</title>
<style>body{margin:0;background:#101014;color:#f5f1ed;font:17px/1.6 system-ui,sans-serif}main{max-width:760px;margin:auto;padding:48px 24px}h1{font-size:42px;line-height:1.15}h2{font-size:23px}a{color:#ffac70}section{border:1px solid #594133;border-radius:16px;padding:24px;margin:24px 0}.status{color:#ffac70;font-weight:700}li{margin:12px 0}footer{color:#b8aaa0}</style></head>
<body><main><p>KICK’S · DataStorm Inc.</p><h1>iPhone and iPad beta</h1>
<p class="status" role="status">Enrollment is not open yet.</p>
<p>We are preparing a build with verified collection and engine behavior. There is no beta install or registration link available here yet.</p>
<section><h2>How testing will work</h2><ol>
<li>Receive an approved invitation and check device compatibility.</li>
<li>Register your device through the official Expo enrollment link supplied with your invitation. Internal builds only install on devices included in their signing profile.</li>
<li>Install the approved build, then sign in to your own DataStorm account.</li>
<li>Review the collection purpose and metadata categories before granting consent. Installation alone does not grant collection consent.</li>
<li>Enroll this device in the staging gateway and allow the iOS VPN prompt. The app must separately confirm the connection and authorized collection.</li>
<li>Send feedback through the invitation’s support channel. Stop collection or revoke consent through the app; uninstalling is not required.</li>
</ol></section>
<section><h2>Before invitations open</h2><p>The native tunnel, device-bound consent, durable ingestion, engines and signed build must pass validation. The existing visual build is not offered as a working collection beta.</p></section>
<section><h2>Privacy and access</h2><p>Testers will use individual accounts and device enrollment. You will not need a JumpCloud administrator account or API key. Never send passwords, private keys, personal browsing history or raw traffic captures as feedback.</p><p>No personal details are collected by this page.</p></section>
<footer><p>Distribution guidance: <a href="https://docs.expo.dev/build/internal-distribution/" rel="noreferrer">Expo internal distribution</a> · <a href="https://developer.apple.com/testflight/" rel="noreferrer">Apple TestFlight</a></p></footer>
</main></body></html>`;
}

export function registerIosBetaRoutes(app) {
  app.get('/beta/ios', async (_request, reply) => reply
    .header('cache-control', 'no-store')
    .header('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'")
    .header('referrer-policy', 'no-referrer')
    .header('x-content-type-options', 'nosniff')
    .type('text/html; charset=utf-8').send(renderIosBeta()));
  app.get('/v1/beta/ios/status', async (_request, reply) => reply.header('cache-control', 'no-store').send(IOS_BETA_STATUS));
  // No identity or device details are accepted until durable enrollment exists.
  app.post('/v1/beta/ios/enroll', async (_request, reply) => reply.header('cache-control', 'no-store')
    .code(503).send({ error: 'ios_beta_enrollment_closed', retryable: false }));
}
