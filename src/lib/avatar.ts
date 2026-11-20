export type AvatarSourceType = 'google' | 'facebook' | 'uploaded' | 'initials';

export interface UserAvatarCandidate {
  name?: string | null;
  email?: string | null;
  avatarUrl?: string | null;
  avatarSources?: {
    google?: string | null;
    facebook?: string | null;
    uploaded?: string | null;
  } | null;
}

export interface ResolvedUserAvatar {
  url: string | null;
  source: AvatarSourceType;
  initials: string;
}

const graphemeSegmenter =
  typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null;

function splitGraphemes(input: string): string[] {
  const value = String(input || '').trim();
  if (!value) return [];
  if (graphemeSegmenter) {
    return Array.from(graphemeSegmenter.segment(value), (seg) => seg.segment);
  }
  return Array.from(value);
}

function formatGraphemeInitial(grapheme: string): string {
  if (!grapheme) return '';
  // Uppercase Latin / Unicode letters cleanly while keeping combining scripts intact
  return /^[a-z\u00C0-\u024F]$/i.test(grapheme) ? grapheme.toUpperCase() : grapheme.toUpperCase();
}

export function getInitials(name?: string | null, fallbackEmail?: string | null): string {
  const rawName = String(name || '')
    .trim()
    .replace(/\s+/g, ' ');

  if (rawName) {
    const words = rawName
      .split(' ')
      .map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
      .filter((w) => w.length > 0);

    if (words.length >= 2) {
      const firstWord = splitGraphemes(words[0]);
      const lastWord = splitGraphemes(words[words.length - 1]);
      if (firstWord.length > 0 && lastWord.length > 0) {
        return `${formatGraphemeInitial(firstWord[0])}${formatGraphemeInitial(lastWord[0])}`;
      }
    }

    if (words.length === 1) {
      const graphemes = splitGraphemes(words[0]);
      if (graphemes.length >= 2) {
        return `${formatGraphemeInitial(graphemes[0])}${formatGraphemeInitial(graphemes[1])}`;
      }
      if (graphemes.length === 1) {
        return formatGraphemeInitial(graphemes[0]);
      }
    }
  }

  const emailLocal = String(fallbackEmail || '')
    .trim()
    .split('@')[0]
    .replace(/[^a-zA-Z0-9\p{L}]/gu, '');
  if (emailLocal) {
    const emailGraphemes = splitGraphemes(emailLocal);
    if (emailGraphemes.length >= 2) {
      return `${formatGraphemeInitial(emailGraphemes[0])}${formatGraphemeInitial(emailGraphemes[1])}`;
    }
    if (emailGraphemes.length === 1) {
      return formatGraphemeInitial(emailGraphemes[0]);
    }
  }

  return 'NU';
}

export function sanitizeAvatarUrl(rawUrl?: string | null): string | null {
  const value = String(rawUrl || '').trim();
  if (!value || value.length > 1000) return null;

  // Reject control characters or whitespace inside URLs
  if (/[\u0000-\u001F\u007F]/.test(value)) return null;

  if (value.startsWith('/') && !value.startsWith('//')) {
    return value;
  }

  try {
    const parsed = new URL(value);
    if (parsed.protocol === 'https:') {
      return parsed.toString();
    }
    if (parsed.protocol === 'http:') {
      const host = parsed.hostname.toLowerCase();
      if (host === 'localhost' || host === '127.0.0.1') {
        return parsed.toString();
      }
    }
    return null;
  } catch {
    return null;
  }
}

export function resolveUserAvatar(user?: UserAvatarCandidate | null): ResolvedUserAvatar {
  const initials = getInitials(user?.name, user?.email);
  if (!user) {
    return { url: null, source: 'initials', initials };
  }

  const googleUrl = sanitizeAvatarUrl(user.avatarSources?.google);
  if (googleUrl) {
    return { url: googleUrl, source: 'google', initials };
  }

  const facebookUrl = sanitizeAvatarUrl(user.avatarSources?.facebook);
  if (facebookUrl) {
    return { url: facebookUrl, source: 'facebook', initials };
  }

  const uploadedUrl = sanitizeAvatarUrl(user.avatarSources?.uploaded) || sanitizeAvatarUrl(user.avatarUrl);
  if (uploadedUrl) {
    return { url: uploadedUrl, source: 'uploaded', initials };
  }

  return { url: null, source: 'initials', initials };
}
