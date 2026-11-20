import { useEffect } from 'react';

type JsonLdNode = Record<string, unknown>;

interface SeoMetaOptions {
  title: string;
  description?: string;
  image?: string;
  type?: 'website' | 'product' | 'article';
  noIndex?: boolean;
  jsonLd?: JsonLdNode | JsonLdNode[];
}

export function useSeoMeta({
  title,
  description,
  image,
  type = 'website',
  noIndex = false,
  jsonLd,
}: SeoMetaOptions) {
  const serializedJsonLd = jsonLd ? JSON.stringify(jsonLd) : '';

  useEffect(() => {
    document.title = title;

    const setMeta = (selector: string, attrName: 'name' | 'property', attrVal: string, content: string) => {
      let el = document.querySelector<HTMLMetaElement>(selector);
      if (!el) {
        el = document.createElement('meta');
        el.setAttribute(attrName, attrVal);
        document.head.appendChild(el);
      }
      el.setAttribute('content', content);
    };

    const canonicalUrl = window.location.origin + window.location.pathname;

    if (description) {
      setMeta('meta[name="description"]', 'name', 'description', description);
      setMeta('meta[property="og:description"]', 'property', 'og:description', description);
      setMeta('meta[name="twitter:description"]', 'name', 'twitter:description', description);
    }

    setMeta('meta[property="og:title"]', 'property', 'og:title', title);
    setMeta('meta[property="og:type"]', 'property', 'og:type', type);
    setMeta('meta[property="og:url"]', 'property', 'og:url', canonicalUrl);
    setMeta('meta[name="twitter:card"]', 'name', 'twitter:card', 'summary_large_image');
    setMeta('meta[name="twitter:title"]', 'name', 'twitter:title', title);

    if (image) {
      const absImage = image.startsWith('http') ? image : `${window.location.origin}${image.startsWith('/') ? '' : '/'}${image}`;
      setMeta('meta[property="og:image"]', 'property', 'og:image', absImage);
      setMeta('meta[name="twitter:image"]', 'name', 'twitter:image', absImage);
    }

    setMeta('meta[name="robots"]', 'name', 'robots', noIndex ? 'noindex, nofollow' : 'index, follow');

    let canonicalEl = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!canonicalEl) {
      canonicalEl = document.createElement('link');
      canonicalEl.setAttribute('rel', 'canonical');
      document.head.appendChild(canonicalEl);
    }
    canonicalEl.setAttribute('href', canonicalUrl);

    const existingJsonLd = document.getElementById('novara-json-ld');
    if (serializedJsonLd) {
      const script = existingJsonLd || document.createElement('script');
      script.id = 'novara-json-ld';
      script.setAttribute('type', 'application/ld+json');
      script.textContent = serializedJsonLd;
      if (!existingJsonLd) document.head.appendChild(script);
    } else if (existingJsonLd) {
      existingJsonLd.remove();
    }
  }, [title, description, image, type, noIndex, serializedJsonLd]);
}
