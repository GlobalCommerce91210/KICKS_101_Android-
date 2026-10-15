import test from 'node:test';
import assert from 'node:assert/strict';
import { IntelligenceEngine, type MarketplaceOffer } from './intelligence.js';
import { PermissionsEngine } from './permissions.js';

const event = (id: string, appId = 'com.example.unknown') => ({
  event_id: id,
  timestamp: new Date().toISOString(),
  app_id: appId,
  device_id: 'device-test',
  network: {
    domain: 'analytics.example.com',
    endpoint: '/collect',
    method: 'POST',
  },
  metadata: { product_category: 'test' },
});

const offer = (consentRequired: boolean): MarketplaceOffer => ({
  offer_id: `offer-${consentRequired ? 'consent' : 'bypass'}`,
  buyer_id: 'buyer-test',
  buyer_category: 'analytics',
  metadata_types: ['commercial'],
  pricing_model: { type: 'per_event', min_value_per_event: 1 },
  regions_allowed: ['US'],
  consent_required: consentRequired,
  status: 'active',
});

test('new users and unseen apps start with no app, buyer, or metadata authorization', () => {
  const intelligence = new IntelligenceEngine();
  const permissions = new PermissionsEngine(intelligence);

  assert.deepEqual(permissions.getAppPermissions('new-user'), []);
  assert.deepEqual(permissions.getBuyerPermissions('new-user'), []);
  const metadata = permissions.getMetadataPermissions('new-user', 'com.example.unknown');
  assert.equal(metadata.length, 7);
  assert.ok(metadata.every(item => item.state === 'blocked'));
});

test('intelligence defaults fail closed and cannot create marketplace eligibility', () => {
  const intelligence = new IntelligenceEngine();
  assert.ok(intelligence.getGates('com.example.unknown').gates.every(gate => gate.default_state === 'blocked'));

  intelligence.setOffers([offer(true)]);
  const processed = intelligence.processEvent(event('evt-blocked'));
  assert.ok(processed.metadata_inspection.metadata_items.every(item => item.consent_state === 'blocked'));
  assert.equal(processed.metadata_inspection.eligible_for_marketplace, false);
  assert.equal(intelligence.matchMarketplace({ app_id: 'com.example.unknown' }).matched_offers.length, 0);
});

test('conditional metadata never counts as marketplace authorization', () => {
  const intelligence = new IntelligenceEngine();
  intelligence.setOffers([offer(true)]);
  intelligence.updateGates('com.example.unknown', {
    app_id: 'com.example.unknown',
    gates: [{ metadata_type: 'commercial', default_state: 'conditional', buyer_overrides: [] }],
  });

  const processed = intelligence.processEvent(event('evt-conditional'));
  assert.equal(processed.metadata_inspection.eligible_for_marketplace, false);
  assert.equal(intelligence.matchMarketplace({ app_id: 'com.example.unknown' }).eligible_events, 0);
});

test('offer consent_required=false cannot bypass explicit authorization requirement', () => {
  const intelligence = new IntelligenceEngine();
  intelligence.setOffers([offer(false)]);
  intelligence.updateGates('com.example.unknown', {
    app_id: 'com.example.unknown',
    gates: [{ metadata_type: 'commercial', default_state: 'allowed', buyer_overrides: [] }],
  });

  const processed = intelligence.processEvent(event('evt-bypass'));
  assert.equal(processed.metadata_inspection.eligible_for_marketplace, true);
  const matched = intelligence.matchMarketplace({ app_id: 'com.example.unknown' });
  assert.equal(matched.matched_offers.length, 0);
});

test('explicit allowed metadata plus a consent-required active offer is the minimum engine match path', () => {
  const intelligence = new IntelligenceEngine();
  intelligence.setOffers([offer(true)]);
  intelligence.updateGates('com.example.unknown', {
    app_id: 'com.example.unknown',
    gates: [{ metadata_type: 'commercial', default_state: 'allowed', buyer_overrides: [] }],
  });

  intelligence.processEvent(event('evt-allowed'));
  const matched = intelligence.matchMarketplace({ app_id: 'com.example.unknown' });
  assert.equal(matched.eligible_events, 1);
  assert.equal(matched.matched_offers.length, 1);
  assert.equal(matched.matched_offers[0]?.events_matched, 1);
});
