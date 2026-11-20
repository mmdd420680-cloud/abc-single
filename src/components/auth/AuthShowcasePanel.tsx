import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import signupShowcaseImg from '../../assets/images/signup_branding_showcase_1794907193841.jpg';
import type { MergedAuthBranding } from '../../lib/authValidation';

export interface AuthShowcaseFeature {
  icon: ReactNode;
  title: string;
  description: string;
}

interface AuthShowcasePanelProps {
  headlineTop: string;
  headlineHighlight: string;
  subtitle: string;
  features: AuthShowcaseFeature[];
  branding?: MergedAuthBranding | null;
}

export function AuthShowcasePanel({
  headlineTop,
  headlineHighlight,
  subtitle,
  features,
  branding,
}: AuthShowcasePanelProps) {
  const [logoFailed, setLogoFailed] = useState(false);

  const brandName = branding?.effectiveBrandName || 'NOVARA';
  const shortBrandTitle = brandName.toUpperCase() === 'NOVARA COMMERCE' ? 'NOVARA' : brandName;
  const tagline = branding?.showcaseTagline || 'Shop Smart. Live Better.';
  const logoUrl = branding?.effectiveLogoUrl || '';

  useEffect(() => {
    setLogoFailed(false);
  }, [logoUrl]);

  return (
    <div
      className="relative flex flex-col justify-between overflow-hidden"
      style={{
        background: 'linear-gradient(180deg, #F0F6FF 0%, #E5EFFF 54%, #D4E4FF 100%)',
      }}
    >
      {/* Compact Mobile Header (< lg) so auth form + OAuth buttons appear immediately above the fold */}
      <div className="relative z-10 flex items-center justify-between gap-2.5 px-4 py-3.5 sm:px-5 sm:py-4 lg:hidden">
        <Link to="/" className="inline-flex min-w-0 flex-1 items-center gap-2.5">
          {logoUrl && !logoFailed ? (
            <img
              src={logoUrl}
              alt={brandName}
              referrerPolicy="no-referrer"
              onError={() => setLogoFailed(true)}
              className="h-9 w-9 shrink-0 rounded-[11px] border border-white/80 bg-white object-contain p-1 shadow-xs"
            />
          ) : (
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] bg-gradient-to-b from-[#2371FF] to-[#0C44DF] text-white shadow-xs">
              <svg viewBox="0 0 28 28" className="h-5 w-5" fill="none" aria-hidden="true">
                <path
                  d="M9 10V8.5C9 5.8 11.2 3.8 14 3.8C16.8 3.8 19 5.8 19 8.5V10"
                  stroke="currentColor"
                  strokeWidth="2.3"
                  strokeLinecap="round"
                />
                <rect
                  x="5.5"
                  y="9.5"
                  width="17"
                  height="14.5"
                  rx="3.5"
                  fill="currentColor"
                  fillOpacity="0.16"
                  stroke="currentColor"
                  strokeWidth="2.1"
                />
                <path
                  d="M10.5 14.5C11.4 16.4 12.6 17.2 14 17.2C15.4 17.2 16.6 16.4 17.5 14.5"
                  stroke="currentColor"
                  strokeWidth="2.1"
                  strokeLinecap="round"
                />
              </svg>
            </span>
          )}
          <div className="min-w-0">
            <span className="font-display block truncate text-[16px] sm:text-[17px] font-extrabold leading-none tracking-tight text-[#0B1730]">
              {shortBrandTitle}
            </span>
            <span className="mt-0.5 block text-[10.5px] leading-tight font-medium text-[#2E4266]">{tagline}</span>
          </div>
        </Link>
        <span className="shrink-0 whitespace-nowrap rounded-full bg-white/85 px-2.5 py-1 text-[10.5px] font-semibold text-[#1155EE] ring-1 ring-[#C6DCFF]">
          {headlineHighlight}
        </span>
      </div>

      {/* Desktop Showcase Column (lg+) */}
      <div className="hidden lg:flex lg:flex-1 lg:flex-col lg:justify-between">
        {/* Soft diagonal geometric light highlight */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -left-20 top-10 h-[360px] w-[400px] -rotate-12 rounded-full bg-white/45 blur-2xl"
        />

        {/* Top-right 4x3 dot matrix */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute right-6 top-6 sm:right-7 sm:top-7 grid grid-cols-4 gap-1.5 sm:gap-2"
        >
          {Array.from({ length: 12 }).map((_, idx) => (
            <span key={idx} className="h-1.5 w-1.5 rounded-full bg-[#9BBDF8]/75" />
          ))}
        </div>

        <div className="relative z-10 px-6 pt-6 sm:px-8 sm:pt-7 lg:px-9 lg:pt-8">
          {/* Brand Lockup — Navigates cleanly to Storefront Home */}
          <Link to="/" className="inline-flex items-center gap-3 group">
            {logoUrl && !logoFailed ? (
              <img
                src={logoUrl}
                alt={brandName}
                referrerPolicy="no-referrer"
                onError={() => setLogoFailed(true)}
                className="h-10 w-10 sm:h-11 sm:w-11 rounded-[13px] border border-white/80 bg-white object-contain p-1 shadow-[0_8px_18px_-4px_rgba(17,85,238,0.28)]"
              />
            ) : (
              <span className="flex h-10 w-10 sm:h-11 sm:w-11 items-center justify-center rounded-[13px] bg-gradient-to-b from-[#2371FF] to-[#0C44DF] text-white shadow-[0_8px_18px_-4px_rgba(17,85,238,0.5)] transition-transform group-hover:scale-[1.03]">
                <svg viewBox="0 0 28 28" className="h-5 w-5 sm:h-6 sm:w-6" fill="none" aria-hidden="true">
                  <path
                    d="M9 10V8.5C9 5.8 11.2 3.8 14 3.8C16.8 3.8 19 5.8 19 8.5V10"
                    stroke="currentColor"
                    strokeWidth="2.3"
                    strokeLinecap="round"
                  />
                  <rect
                    x="5.5"
                    y="9.5"
                    width="17"
                    height="14.5"
                    rx="3.5"
                    fill="currentColor"
                    fillOpacity="0.16"
                    stroke="currentColor"
                    strokeWidth="2.1"
                  />
                  <path
                    d="M10.5 14.5C11.4 16.4 12.6 17.2 14 17.2C15.4 17.2 16.6 16.4 17.5 14.5"
                    stroke="currentColor"
                    strokeWidth="2.1"
                    strokeLinecap="round"
                  />
                </svg>
              </span>
            )}
            <div>
              <span className="font-display block text-[20px] sm:text-[22px] font-extrabold leading-none tracking-tight text-[#0B1730]">
                {shortBrandTitle}
              </span>
              <span className="mt-1 block text-[11px] font-medium tracking-tight text-[#2E4266]">
                {tagline}
              </span>
            </div>
          </Link>

          {/* Main Left Heading */}
          <div className="mt-4 sm:mt-5">
            <h2 className="font-display text-[26px] sm:text-[32px] lg:text-[34px] font-extrabold leading-[1.08] tracking-tight text-[#0F1D3A]">
              {headlineTop}
              <span className="block text-[#1155EE]">{headlineHighlight}</span>
            </h2>
            <p className="mt-2 max-w-[305px] text-[13px] sm:text-[13.5px] font-medium leading-snug text-[#1F3154]">
              {subtitle}
            </p>
          </div>

          {/* Feature Highlights */}
          <ul className="mt-4 sm:mt-5 grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-1 gap-3 lg:gap-3">
            {features.map((feat) => (
              <li key={feat.title} className="flex items-center gap-3">
                <span className="flex h-9 w-9 sm:h-10 sm:w-10 shrink-0 items-center justify-center rounded-full bg-white/85 p-1 shadow-xs ring-1 ring-[#C6DCFF]">
                  <span className="flex h-7 w-7 sm:h-8 sm:w-8 items-center justify-center rounded-full bg-[#1155EE] text-white">
                    {feat.icon}
                  </span>
                </span>
                <div className="min-w-0">
                  <p className="text-[13px] font-bold leading-tight text-[#0F1D3A]">{feat.title}</p>
                  <p className="text-[11.5px] leading-snug text-[#3E5278]">{feat.description}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        {/* Bottom Promotional Illustration */}
        <div className="relative mt-3 sm:mt-4 h-[165px] sm:h-[245px] lg:h-[225px] w-full overflow-hidden">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -bottom-16 right-4 h-56 w-56 rounded-full bg-gradient-to-tr from-[#3C7FFF]/65 to-[#8CB8FF]/35"
          />
          <img
            src={signupShowcaseImg}
            alt={`${shortBrandTitle} shopping showcase`}
            referrerPolicy="no-referrer"
            className="h-full w-full object-cover object-center lg:object-bottom"
            style={{
              WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, rgba(0,0,0,0.88) 22%, black 42%)',
              maskImage: 'linear-gradient(to bottom, transparent 0%, rgba(0,0,0,0.88) 22%, black 42%)',
            }}
          />
          {/* Bottom-left diagonal deep royal-blue corner accent */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -bottom-8 -left-10 h-20 w-72 rotate-[13deg] bg-gradient-to-r from-[#0738C0] to-[#1D6BFF] opacity-90"
          />
        </div>
      </div>
    </div>
  );
}
