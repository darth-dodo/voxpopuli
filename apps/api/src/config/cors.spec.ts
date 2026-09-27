import { resolveCorsOrigin } from './cors';

describe('resolveCorsOrigin', () => {
  it('returns a single origin unchanged', () => {
    expect(resolveCorsOrigin('http://localhost:4200')).toBe('http://localhost:4200');
  });

  it('splits a comma-separated list and trims whitespace', () => {
    expect(
      resolveCorsOrigin(
        'https://voxpopuli-web-embx.onrender.com, https://voxpopuli-web-1o3v.onrender.com',
      ),
    ).toEqual([
      'https://voxpopuli-web-embx.onrender.com',
      'https://voxpopuli-web-1o3v.onrender.com',
    ]);
  });

  it('strips trailing slashes, which browsers never send in Origin', () => {
    expect(resolveCorsOrigin('https://voxpopuli-web-embx.onrender.com/')).toBe(
      'https://voxpopuli-web-embx.onrender.com',
    );
  });

  it('maps "onrender.com" to a Render subdomain pattern for PR previews', () => {
    const origin = resolveCorsOrigin('onrender.com') as RegExp;

    expect(origin).toBeInstanceOf(RegExp);
    expect(origin.test('https://voxpopuli-web-pr-30.onrender.com')).toBe(true);
    expect(origin.test('https://evil.example.com')).toBe(false);
  });

  it('ignores empty entries', () => {
    expect(resolveCorsOrigin('https://a.example.com,, ')).toBe('https://a.example.com');
  });
});
