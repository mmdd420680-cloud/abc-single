import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getInitials, resolveUserAvatar, sanitizeAvatarUrl } from './avatar.ts';

describe('avatar utilities', () => {
  it('computes English multi-word and single-word initials accurately', () => {
    assert.equal(getInitials('Mahim Hasan'), 'MH');
    assert.equal(getInitials('  mahim   bin   hasan  '), 'MH');
    assert.equal(getInitials('Mahim'), 'MA');
    assert.equal(getInitials('X'), 'X');
    assert.equal(getInitials('NOVARA User'), 'NU');
  });

  it('handles empty names, email fallback, and Unicode / Bengali graphemes safely', () => {
    assert.equal(getInitials('', ''), 'NU');
    assert.equal(getInitials('   ', 'rahim@example.com'), 'RA');
    assert.equal(getInitials('!!!', null), 'NU');
    // Multi-word Bengali name preserves full grapheme clusters (vowel signs remain attached)
    assert.equal(getInitials('আহমেদ রাহমান'), 'আরা');
    assert.equal(getInitials('সাকিব আল হাসান'), 'সাহা');
    // Single-word Bengali name splits cleanly on grapheme boundaries
    assert.equal(getInitials('সাকিব'), 'সাকি');
  });

  it('sanitizes unsafe URLs and preserves valid HTTPS, localhost HTTP, and relative paths', () => {
    assert.equal(sanitizeAvatarUrl('https://lh3.googleusercontent.com/a/photo=s96-c'), 'https://lh3.googleusercontent.com/a/photo=s96-c');
    assert.equal(sanitizeAvatarUrl('/assets/avatars/user.png'), '/assets/avatars/user.png');
    assert.equal(sanitizeAvatarUrl('http://localhost:3000/avatar.png'), 'http://localhost:3000/avatar.png');

    assert.equal(sanitizeAvatarUrl('javascript:alert(1)'), null);
    assert.equal(sanitizeAvatarUrl('data:text/html,<script>alert(1)</script>'), null);
    assert.equal(sanitizeAvatarUrl('//evil.example.com/pic.png'), null);
    assert.equal(sanitizeAvatarUrl('http://insecure.example.com/pic.png'), null);
    assert.equal(sanitizeAvatarUrl(''), null);
  });

  it('resolves avatar source in strict priority: google -> facebook -> uploaded -> avatarUrl -> initials', () => {
    const googleFirst = resolveUserAvatar({
      name: 'Mahim Hasan',
      avatarUrl: 'https://cdn.example.com/custom.jpg',
      avatarSources: {
        google: 'https://lh3.googleusercontent.com/photo.jpg',
        facebook: 'https://graph.facebook.com/photo.jpg',
        uploaded: 'https://cdn.example.com/uploaded.jpg',
      },
    });
    assert.deepEqual(googleFirst, {
      url: 'https://lh3.googleusercontent.com/photo.jpg',
      source: 'google',
      initials: 'MH',
    });

    const facebookSecond = resolveUserAvatar({
      name: 'Mahim Hasan',
      avatarUrl: 'https://cdn.example.com/custom.jpg',
      avatarSources: {
        google: 'javascript:alert(1)',
        facebook: 'https://platform-lookaside.fbsbx.com/pic.jpg',
      },
    });
    assert.deepEqual(facebookSecond, {
      url: 'https://platform-lookaside.fbsbx.com/pic.jpg',
      source: 'facebook',
      initials: 'MH',
    });

    const uploadedThird = resolveUserAvatar({
      name: 'Mahim',
      avatarUrl: 'https://cdn.example.com/legacy.jpg',
      avatarSources: {
        uploaded: 'https://cdn.example.com/uploaded.jpg',
      },
    });
    assert.equal(uploadedThird.source, 'uploaded');
    assert.equal(uploadedThird.url, 'https://cdn.example.com/uploaded.jpg');

    const initialsFallback = resolveUserAvatar({
      name: 'NOVARA User',
      avatarUrl: '',
      avatarSources: {},
    });
    assert.deepEqual(initialsFallback, {
      url: null,
      source: 'initials',
      initials: 'NU',
    });
  });
});
