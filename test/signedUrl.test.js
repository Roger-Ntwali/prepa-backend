const { signUploadPath, verifyUploadPath } = require('../src/utils/signedUrl');

describe('signUploadPath / verifyUploadPath', () => {
  it('accepts a signature it just issued for the same path', () => {
    const { exp, sig } = signUploadPath('paper.pdf', 300);
    expect(verifyUploadPath('paper.pdf', exp, sig)).toBe(true);
  });

  it('rejects a tampered signature', () => {
    const { exp, sig } = signUploadPath('paper.pdf', 300);
    const tampered = sig.slice(0, -2) + (sig.slice(-2) === '00' ? '11' : '00');
    expect(verifyUploadPath('paper.pdf', exp, tampered)).toBe(false);
  });

  it('rejects a signature reused for a different path', () => {
    const { exp, sig } = signUploadPath('paper.pdf', 300);
    expect(verifyUploadPath('other.pdf', exp, sig)).toBe(false);
  });

  it('rejects an expired signature', () => {
    const { sig } = signUploadPath('paper.pdf', 300);
    const expiredExp = Date.now() - 1000; // already in the past
    expect(verifyUploadPath('paper.pdf', expiredExp, sig)).toBe(false);
  });

  it('rejects a missing exp or sig', () => {
    expect(verifyUploadPath('paper.pdf', null, 'somesig')).toBe(false);
    expect(verifyUploadPath('paper.pdf', Date.now() + 1000, null)).toBe(false);
  });
});
