// Unit tests: simulated provider adapters, demo receipt PDF, payment UI helpers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getPaymentProvider, listPaymentProviders, PROVIDER_CODES } from '../../apps/api/src/adapters/payment/index.js';
import { renderTextPdf } from '../../apps/api/src/utils/simplePdf.js';
import { normaliseWallet, paymentErrorKey } from '../../apps/web/src/features/payments/paymentUi.js';

test('three simulated providers share one interface and decide outcomes from demo wallet numbers', async () => {
  assert.deepEqual(PROVIDER_CODES, ['EVC_PLUS', 'ZAAD', 'EDAHAB']);
  assert.ok(listPaymentProviders().every((p) => p.simulated === true));
  for (const code of PROVIDER_CODES) {
    const p = getPaymentProvider(code);
    for (const fn of ['validateWallet', 'charge', 'checkStatus', 'refund']) assert.equal(typeof p[fn], 'function', `${code}.${fn}`);
    assert.equal((await p.charge({ msisdn: '+252615551234' })).outcome, 'SUCCESS');
    assert.equal((await p.charge({ msisdn: '+252610000001' })).outcome, 'FAILED');
    assert.equal((await p.charge({ msisdn: '+252610000002' })).outcome, 'PENDING');
    assert.equal((await p.checkStatus({ msisdn: '+252610000002' })).outcome, 'PENDING');
    assert.equal((await p.checkStatus({ msisdn: '+252610000003' })).outcome, 'SUCCESS');
    assert.equal((await p.refund({ msisdn: '+252610000004' })).outcome, 'FAILED');
    assert.equal((await p.refund({ msisdn: '+252615551234' })).outcome, 'SUCCESS');
    assert.equal(p.validateWallet('+252615551234'), null);
    assert.equal(p.validateWallet('0615551234'), 'WALLET_INVALID');
  }
  const a = await getPaymentProvider('EVC_PLUS').charge({ msisdn: '+252615551234' });
  const b = await getPaymentProvider('EVC_PLUS').charge({ msisdn: '+252615551234' });
  assert.notEqual(a.providerReference, b.providerReference, 'unique references');
  assert.throws(() => getPaymentProvider('WAAFIPAY'), /Unknown payment provider/);
});

test('the demo receipt is a valid single-page PDF with escaped, ASCII-only text', () => {
  const pdf = renderTextPdf([{ text: 'DEMO (receipt) \\ Cabdi Ḥasan •' }, { rule: true }], { title: 'T' }).toString('latin1');
  assert.ok(pdf.startsWith('%PDF-1.4') && pdf.trimEnd().endsWith('%%EOF'));
  assert.ok(pdf.includes('DEMO \\(receipt\\) \\\\ Cabdi Hasan *'), 'escaped and transliterated');
  const xref = Number(pdf.match(/startxref\n(\d+)/)[1]);
  assert.equal(pdf.slice(xref, xref + 4), 'xref', 'xref offset is exact');
});

test('wallet input is normalised to +252…, and errors map to translated keys', () => {
  assert.equal(normaliseWallet('+252 61 555 1234'), '+252615551234');
  assert.equal(normaliseWallet('0615551234'), '+252615551234');
  assert.equal(normaliseWallet('615551234'), '+252615551234');
  assert.equal(normaliseWallet('00252615551234'), '+252615551234');
  assert.equal(normaliseWallet('12345'), null);
  assert.equal(normaliseWallet('+44 7700 900123'), null);
  assert.equal(paymentErrorKey({ code: 'PAYMENT_PENDING' }), 'paymentErrors.PAYMENT_PENDING');
  assert.equal(paymentErrorKey({ code: 'X' }), 'paymentErrors.GENERIC');
});
