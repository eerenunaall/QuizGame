import { describe, expect, it } from '@jest/globals';
import { purchaseToClaim } from './storeClaims';

describe('purchaseToClaim', () => {
  it('maps iOS to the signed transaction only', () => {
    expect(
      purchaseToClaim({ productId: 'p', purchaseToken: 'JWS', platform: 'ios' }, 'IOS'),
    ).toEqual({
      platform: 'IOS',
      signedTransaction: 'JWS',
    });
  });
  it('maps Android to product id + purchase token', () => {
    expect(purchaseToClaim({ productId: 'p', purchaseToken: 'TOKEN' }, 'ANDROID')).toEqual({
      platform: 'ANDROID',
      productId: 'p',
      purchaseToken: 'TOKEN',
    });
  });
  it('has no claim without a token', () => {
    expect(purchaseToClaim({ productId: 'p', purchaseToken: null }, 'ANDROID')).toBeNull();
  });
});
