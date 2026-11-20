import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Building2, Check, ChevronDown, Loader2, MapPin, Search, Users, X } from 'lucide-react';
import {
  getAllDivisionsSummary,
  getAreasByUpazilaId,
  getAreasForUpazila,
  getDistrictsByDivisionId,
  getDistrictsForDivision,
  getUpazilasByDistrictId,
  getUpazilasForDistrict,
  resolveBangladeshPartialSelection,
  type BdArea,
  type BdAreaType,
  type BdLevel3Kind,
  type BdLocationSummaryDistrict,
  type BdLocationSummaryDivision,
  type BdLocationSummaryUpazila,
} from '../../lib/bdLocations';
import { stepDropdownIndex } from '../../lib/authValidation';

export interface BangladeshLocationSelection {
  divisionId: string;
  division: string;
  divisionBn?: string;
  districtId: string;
  district: string;
  districtBn?: string;
  upazilaId: string;
  upazila: string;
  upazilaBn?: string;
  upazilaType?: BdLevel3Kind;
  areaId: string;
  area: string;
  areaBn?: string;
  areaType?: BdAreaType;
  postalCode?: string;
}

export interface BangladeshAddressSelectorValue {
  division: string;
  divisionId?: string;
  district: string;
  districtId?: string;
  upazila: string;
  upazilaId?: string;
  area: string;
  areaId?: string;
}

export interface BangladeshAddressSelectorProps {
  value: BangladeshAddressSelectorValue;
  onChange: (next: BangladeshLocationSelection) => void;
  errors?: {
    division?: string;
    district?: string;
    upazila?: string;
    area?: string;
  };
  idPrefix?: string;
  required?: boolean;
  variant?: 'checkout' | 'modal';
}

interface ComboOption {
  id: string;
  name: string;
  nameBn?: string;
  subtitle?: string;
  tag?: string;
  searchTokens: string;
}

interface SearchableGeoFieldProps {
  id: string;
  label: string;
  placeholder: string;
  searchPlaceholder: string;
  icon: ReactNode;
  options: ComboOption[];
  selectedId: string;
  selectedLabel: string;
  selectedBn?: string;
  disabled?: boolean;
  loading?: boolean;
  error?: string;
  helperNotice?: string;
  variant: 'checkout' | 'modal';
  onSelect: (opt: ComboOption) => void;
  onClear: () => void;
}

function SearchableGeoField({
  id,
  label,
  placeholder,
  searchPlaceholder,
  icon,
  options,
  selectedId,
  selectedLabel,
  selectedBn,
  disabled = false,
  loading = false,
  error,
  helperNotice,
  variant,
  onSelect,
  onClear,
}: SearchableGeoFieldProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listboxRef = useRef<HTMLUListElement>(null);
  const listboxId = useId();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.searchTokens.includes(q));
  }, [options, query]);

  useEffect(() => {
    setHighlightedIndex(0);
  }, [query, open, options.length]);

  useEffect(() => {
    if (!open || highlightedIndex < 0) return;
    const activeEl = listboxRef.current?.querySelector<HTMLElement>(`[data-geo-option-idx="${highlightedIndex}"]`);
    activeEl?.scrollIntoView({ block: 'nearest' });
  }, [open, highlightedIndex]);

  useEffect(() => {
    if (!open) return;
    const raf = window.requestAnimationFrame(() => {
      searchInputRef.current?.focus();
    });
    const onPointerDown = (ev: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(ev.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.cancelAnimationFrame(raf);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open]);

  useEffect(() => {
    if (disabled && open) {
      setOpen(false);
      setQuery('');
    }
  }, [disabled, open]);

  const commitOption = (opt: ComboOption) => {
    onSelect(opt);
    setOpen(false);
    setQuery('');
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const handleTriggerKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setOpen((prev) => !prev);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  const handleSearchKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex((prev) => stepDropdownIndex(prev, 1, filtered.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex((prev) => stepDropdownIndex(prev, -1, filtered.length));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const target = filtered[highlightedIndex];
      if (target) commitOption(target);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      setQuery('');
      triggerRef.current?.focus();
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  };

  const heightCls = variant === 'checkout' ? 'h-11' : 'h-10';
  const hasSelection = Boolean(selectedLabel);

  return (
    <div ref={containerRef} className="relative">
      <label htmlFor={id} className="mb-1.5 block text-xs font-bold text-[#0F1D3A]">
        {label}
      </label>

      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#64748B]">
          {icon}
        </span>

        <button
          ref={triggerRef}
          id={id}
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-controls={listboxId}
          disabled={disabled}
          onClick={() => {
            if (!disabled) setOpen((prev) => !prev);
          }}
          onKeyDown={handleTriggerKeyDown}
          className={`${heightCls} flex w-full items-center justify-between gap-2 rounded-xl border bg-white pl-9 ${
            hasSelection && !disabled ? 'pr-14' : 'pr-8'
          } text-left text-sm transition focus:outline-none focus:ring-2 focus:ring-[#1155EE]/20 ${
            disabled
              ? 'cursor-not-allowed border-[#DCE6F7] bg-slate-50 text-slate-400'
              : error
                ? 'border-rose-400 text-[#0F1D3A]'
                : open
                  ? 'border-[#1155EE] text-[#0F1D3A] ring-2 ring-[#1155EE]/20'
                  : 'border-[#DCE6F7] text-[#0F1D3A] hover:border-[#BFD3FA]'
          }`}
        >
          <span className="flex min-w-0 items-baseline gap-1.5 truncate">
            {hasSelection ? (
              <>
                <span className="truncate font-medium text-[#0F1D3A]">{selectedLabel}</span>
                {selectedBn && selectedBn !== selectedLabel && (
                  <span className="hidden truncate text-[11px] text-[#64748B] sm:inline">· {selectedBn}</span>
                )}
              </>
            ) : (
              <span className="truncate text-slate-400">{placeholder}</span>
            )}
          </span>
        </button>

        {hasSelection && !disabled && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onClear();
              setQuery('');
              setOpen(false);
            }}
            aria-label={`Clear ${label.replace(/\s*\*$/, '')}`}
            className="absolute right-7 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}

        <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400">
          {loading ? <Loader2 className="h-4 w-4 animate-spin text-[#1155EE]" /> : <ChevronDown className="h-4 w-4" />}
        </span>
      </div>

      {open && !disabled && (
        <div
          className="absolute left-0 right-0 z-50 mt-1.5 overflow-hidden rounded-xl border border-[#C7DAFD] bg-white shadow-[0_14px_34px_-12px_rgba(15,29,58,0.22)]"
        >
          <div className="border-b border-[#EEF3FC] bg-[#F8FAFF] p-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                ref={searchInputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleSearchKeyDown}
                placeholder={searchPlaceholder}
                aria-label={searchPlaceholder}
                className="h-8 w-full rounded-lg border border-[#DCE6F7] bg-white pl-8 pr-7 text-xs text-[#0F1D3A] placeholder:text-slate-400 focus:border-[#1155EE] focus:outline-none"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  aria-label="Clear search filter"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>

          <ul
            ref={listboxRef}
            id={listboxId}
            role="listbox"
            className="novara-scroll max-h-[min(14rem,42dvh)] overflow-y-auto overscroll-contain py-1 text-xs"
          >
            {filtered.length === 0 ? (
              <li className="px-3 py-4 text-center text-slate-500">
                {loading ? 'Loading locations...' : 'No matching location found.'}
              </li>
            ) : (
              filtered.map((opt, idx) => {
                const isSelected = (selectedId && opt.id === selectedId) || (!selectedId && opt.name === selectedLabel);
                const isHighlighted = idx === highlightedIndex;
                return (
                  <li
                    key={opt.id}
                    role="option"
                    data-geo-option-idx={idx}
                    data-highlighted={isHighlighted ? 'true' : undefined}
                    aria-selected={isSelected}
                    onMouseEnter={() => setHighlightedIndex(idx)}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      commitOption(opt);
                    }}
                    className={`flex cursor-pointer items-center justify-between gap-2 px-3 py-2 transition-colors ${
                      isSelected
                        ? 'bg-[#EEF4FF] font-semibold text-[#1155EE]'
                        : isHighlighted
                          ? 'bg-[#F4F7FF] text-[#0F1D3A]'
                          : 'text-[#0F1D3A] hover:bg-[#F4F7FF]'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-1.5 truncate">
                        <span className="truncate font-medium">{opt.name}</span>
                        {opt.nameBn && opt.nameBn !== opt.name && (
                          <span className="truncate text-[11px] text-[#64748B]">· {opt.nameBn}</span>
                        )}
                      </div>
                      {opt.subtitle && (
                        <p className="truncate text-[10.5px] text-[#64748B]">{opt.subtitle}</p>
                      )}
                    </div>

                    <div className="flex shrink-0 items-center gap-1.5">
                      {opt.tag && (
                        <span className="rounded-md bg-[#EEF4FF] px-1.5 py-0.5 text-[10px] font-semibold text-[#1155EE]">
                          {opt.tag}
                        </span>
                      )}
                      {isSelected && <Check className="h-3.5 w-3.5 text-[#1155EE]" />}
                    </div>
                  </li>
                );
              })
            )}
          </ul>
        </div>
      )}

      {error && <p className="mt-1 text-[11px] font-medium text-rose-600">{error}</p>}
      {!error && helperNotice && <p className="mt-1 text-[11px] font-medium text-amber-700">{helperNotice}</p>}
    </div>
  );
}

function formatUpazilaTag(u: { areaKind: BdLevel3Kind; cityCorpShortName?: string }): string {
  if (u.areaKind === 'metropolitan_thana') {
    return u.cityCorpShortName ? `Metro · ${u.cityCorpShortName}` : 'Metro Thana';
  }
  if (u.areaKind === 'city_corporation') {
    return u.cityCorpShortName || 'City Corp';
  }
  return 'Upazila';
}

function formatAreaTag(a: { areaType: BdAreaType; cityCorpShortName?: string; postalCode?: string }): string {
  if (a.areaType === 'ward') {
    return a.cityCorpShortName ? `Ward · ${a.cityCorpShortName}` : 'Ward';
  }
  if (a.areaType === 'pourashava') {
    return 'Pourashava';
  }
  return a.postalCode ? `Union · ${a.postalCode}` : 'Union';
}

export function BangladeshAddressSelector({
  value,
  onChange,
  errors,
  idPrefix = 'bd',
  required = true,
  variant = 'checkout',
}: BangladeshAddressSelectorProps) {
  const star = required ? ' *' : '';

  const resolvedPartial = useMemo(
    () =>
      resolveBangladeshPartialSelection({
        division: value.division,
        divisionId: value.divisionId,
        district: value.district,
        districtId: value.districtId,
        upazila: value.upazila,
        upazilaId: value.upazilaId,
        area: value.area,
        areaId: value.areaId,
      }),
    [
      value.division,
      value.divisionId,
      value.district,
      value.districtId,
      value.upazila,
      value.upazilaId,
      value.area,
      value.areaId,
    ],
  );

  const effectiveDivisionId = value.divisionId || resolvedPartial.divisionId;
  const effectiveDivisionName = resolvedPartial.division || value.division;
  const effectiveDistrictId = value.districtId || resolvedPartial.districtId;
  const effectiveDistrictName = resolvedPartial.district || value.district;
  const effectiveUpazilaId = value.upazilaId || resolvedPartial.upazilaId;
  const effectiveUpazilaName = resolvedPartial.upazila || value.upazila;
  const effectiveAreaId = value.areaId || resolvedPartial.areaId;
  const effectiveAreaName = resolvedPartial.area || value.area;

  const [divisions, setDivisions] = useState<BdLocationSummaryDivision[]>(() => getAllDivisionsSummary());
  const [districts, setDistricts] = useState<BdLocationSummaryDistrict[]>([]);
  const [upazilas, setUpazilas] = useState<BdLocationSummaryUpazila[]>([]);
  const [areas, setAreas] = useState<BdArea[]>([]);

  const [loadingDivisions, setLoadingDivisions] = useState(false);
  const [loadingDistricts, setLoadingDistricts] = useState(false);
  const [loadingUpazilas, setLoadingUpazilas] = useState(false);
  const [loadingAreas, setLoadingAreas] = useState(false);

  const divReqSeq = useRef(0);
  const distReqSeq = useRef(0);
  const upaReqSeq = useRef(0);
  const areaReqSeq = useRef(0);

  // Sync divisions from /api/locations/divisions (local package summary already hydrates synchronously)
  useEffect(() => {
    const seq = ++divReqSeq.current;
    const controller = new AbortController();
    setLoadingDivisions(true);
    fetch('/api/locations/divisions', { signal: controller.signal })
      .then(async (r) => {
        if (!r.ok) return null;
        return (await r.json()) as { ok?: boolean; divisions?: BdLocationSummaryDivision[] };
      })
      .then((data) => {
        if (seq !== divReqSeq.current) return;
        if (Array.isArray(data?.divisions) && data.divisions.length >= 8) {
          setDivisions(data.divisions);
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (seq === divReqSeq.current) setLoadingDivisions(false);
      });

    return () => controller.abort();
  }, []);

  // Load Districts when division changes
  useEffect(() => {
    const divKey = effectiveDivisionId || effectiveDivisionName;
    if (!divKey) {
      setDistricts([]);
      setLoadingDistricts(false);
      return;
    }

    const fallback = (effectiveDivisionId
      ? getDistrictsByDivisionId(effectiveDivisionId)
      : getDistrictsForDivision(effectiveDivisionName)
    ).map((d) => ({
      id: d.id,
      name: d.name,
      nameBn: d.nameBn || d.name,
      divisionId: d.divisionId,
      isDhakaMetro: Boolean(d.isDhakaMetro),
      upazilaCount: d.upazilas.length,
    }));
    setDistricts(fallback);

    const seq = ++distReqSeq.current;
    const controller = new AbortController();
    setLoadingDistricts(true);
    fetch(`/api/locations/divisions/${encodeURIComponent(divKey)}/districts`, {
      signal: controller.signal,
    })
      .then(async (r) => {
        if (!r.ok) return null;
        return (await r.json()) as { ok?: boolean; districts?: BdLocationSummaryDistrict[] };
      })
      .then((data) => {
        if (seq !== distReqSeq.current) return;
        if (Array.isArray(data?.districts) && data.districts.length > 0) {
          setDistricts(data.districts);
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (seq === distReqSeq.current) setLoadingDistricts(false);
      });

    return () => controller.abort();
  }, [effectiveDivisionId, effectiveDivisionName]);

  // Load Upazilas / Metropolitan Thanas when district changes
  useEffect(() => {
    const distKey = effectiveDistrictId || effectiveDistrictName;
    if (!effectiveDivisionName || !distKey) {
      setUpazilas([]);
      setLoadingUpazilas(false);
      return;
    }

    const fallback = (effectiveDistrictId
      ? getUpazilasByDistrictId(effectiveDistrictId)
      : getUpazilasForDistrict(effectiveDivisionName, effectiveDistrictName)
    ).map((u) => ({
      id: u.id,
      name: u.name,
      nameBn: u.nameBn || u.name,
      districtId: u.districtId,
      areaKind: u.areaKind,
      cityCorpId: u.cityCorpId,
      cityCorpName: u.cityCorpName,
      cityCorpShortName: u.cityCorpShortName,
      areaCount: u.areas.length,
    }));
    setUpazilas(fallback);

    const seq = ++upaReqSeq.current;
    const controller = new AbortController();
    setLoadingUpazilas(true);
    const params = effectiveDivisionName ? `?division=${encodeURIComponent(effectiveDivisionName)}` : '';
    fetch(`/api/locations/districts/${encodeURIComponent(distKey)}/upazilas${params}`, {
      signal: controller.signal,
    })
      .then(async (r) => {
        if (!r.ok) return null;
        return (await r.json()) as { ok?: boolean; upazilas?: BdLocationSummaryUpazila[] };
      })
      .then((data) => {
        if (seq !== upaReqSeq.current) return;
        if (Array.isArray(data?.upazilas) && data.upazilas.length > 0) {
          setUpazilas(data.upazilas);
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (seq === upaReqSeq.current) setLoadingUpazilas(false);
      });

    return () => controller.abort();
  }, [effectiveDivisionName, effectiveDistrictId, effectiveDistrictName]);

  // Load Unions / Wards / Pourashavas when upazila/thana changes
  useEffect(() => {
    const upaKey = effectiveUpazilaId || effectiveUpazilaName;
    if (!effectiveDivisionName || !effectiveDistrictName || !upaKey) {
      setAreas([]);
      setLoadingAreas(false);
      return;
    }

    const fallback = effectiveUpazilaId
      ? getAreasByUpazilaId(effectiveUpazilaId)
      : getAreasForUpazila(effectiveDivisionName, effectiveDistrictName, effectiveUpazilaName);
    setAreas(fallback);

    const seq = ++areaReqSeq.current;
    const controller = new AbortController();
    setLoadingAreas(true);
    const qs = new URLSearchParams();
    if (effectiveDivisionName) qs.set('division', effectiveDivisionName);
    if (effectiveDistrictName) qs.set('district', effectiveDistrictName);
    fetch(`/api/locations/upazilas/${encodeURIComponent(upaKey)}/areas?${qs.toString()}`, {
      signal: controller.signal,
    })
      .then(async (r) => {
        if (!r.ok) return null;
        return (await r.json()) as { ok?: boolean; areas?: BdArea[] };
      })
      .then((data) => {
        if (seq !== areaReqSeq.current) return;
        if (Array.isArray(data?.areas) && data.areas.length > 0) {
          setAreas(data.areas);
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (seq === areaReqSeq.current) setLoadingAreas(false);
      });

    return () => controller.abort();
  }, [effectiveDivisionName, effectiveDistrictName, effectiveUpazilaId, effectiveUpazilaName]);

  const divisionOptions: ComboOption[] = useMemo(
    () =>
      divisions.map((d) => ({
        id: d.id,
        name: d.name,
        nameBn: d.nameBn,
        tag: `${d.districtCount} Districts`,
        searchTokens: `${d.name} ${d.nameBn || ''}`.toLowerCase(),
      })),
    [divisions],
  );

  const districtOptions: ComboOption[] = useMemo(
    () =>
      districts.map((d) => ({
        id: d.id,
        name: d.name,
        nameBn: d.nameBn,
        tag: `${d.upazilaCount} Areas`,
        searchTokens: `${d.name} ${d.nameBn || ''}`.toLowerCase(),
      })),
    [districts],
  );

  const upazilaOptions: ComboOption[] = useMemo(
    () =>
      upazilas.map((u) => ({
        id: u.id,
        name: u.name,
        nameBn: u.nameBn,
        subtitle:
          u.areaKind === 'metropolitan_thana' && u.cityCorpName
            ? u.cityCorpName
            : undefined,
        tag: formatUpazilaTag(u),
        searchTokens: `${u.name} ${u.nameBn || ''} ${u.cityCorpName || ''} ${u.cityCorpShortName || ''} ${u.areaKind}`.toLowerCase(),
      })),
    [upazilas],
  );

  const areaOptions: ComboOption[] = useMemo(
    () =>
      areas.map((a) => ({
        id: a.id,
        name: a.name,
        nameBn: a.nameBn,
        subtitle:
          a.areaType === 'union' && a.postOffice
            ? `PO: ${a.postOffice}`
            : a.areaType === 'ward' && a.cityCorpName
              ? a.cityCorpName
              : undefined,
        tag: formatAreaTag(a),
        searchTokens: `${a.name} ${a.nameBn || ''} ${a.postalCode || ''} ${a.postOffice || ''} ${a.cityCorpShortName || ''} ${a.areaType}`.toLowerCase(),
      })),
    [areas],
  );

  const selectedUpazilaMeta = upazilas.find((u) => u.id === effectiveUpazilaId) || upazilas.find((u) => u.name === effectiveUpazilaName);
  const selectedAreaMeta = areas.find((a) => a.id === effectiveAreaId) || areas.find((a) => a.name === effectiveAreaName);

  const level4Label =
    selectedUpazilaMeta?.areaKind === 'metropolitan_thana' || selectedUpazilaMeta?.areaKind === 'city_corporation'
      ? `Ward / Area${star}`
      : `Union / Area${star}`;

  const level4Placeholder =
    selectedUpazilaMeta?.areaKind === 'metropolitan_thana' || selectedUpazilaMeta?.areaKind === 'city_corporation'
      ? 'Select Ward'
      : 'Select Union / Ward';

  return (
    <>
      <SearchableGeoField
        id={`${idPrefix}-division`}
        label={`Division${star}`}
        placeholder="Select Division"
        searchPlaceholder="Search division (English / বাংলা)..."
        icon={<Building2 className="h-4 w-4" />}
        options={divisionOptions}
        selectedId={effectiveDivisionId}
        selectedLabel={effectiveDivisionName}
        selectedBn={resolvedPartial.divisionBn}
        loading={loadingDivisions}
        error={errors?.division}
        variant={variant}
        onSelect={(opt) => {
          onChange({
            divisionId: opt.id,
            division: opt.name,
            divisionBn: opt.nameBn,
            districtId: '',
            district: '',
            districtBn: '',
            upazilaId: '',
            upazila: '',
            upazilaBn: '',
            areaId: '',
            area: '',
            areaBn: '',
            postalCode: undefined,
          });
        }}
        onClear={() => {
          onChange({
            divisionId: '',
            division: '',
            divisionBn: '',
            districtId: '',
            district: '',
            districtBn: '',
            upazilaId: '',
            upazila: '',
            upazilaBn: '',
            areaId: '',
            area: '',
            areaBn: '',
            postalCode: undefined,
          });
        }}
      />

      <SearchableGeoField
        id={`${idPrefix}-district`}
        label={`District${star}`}
        placeholder="Select District"
        searchPlaceholder="Search district (English / বাংলা)..."
        icon={<MapPin className="h-4 w-4" />}
        options={districtOptions}
        selectedId={effectiveDistrictId}
        selectedLabel={effectiveDistrictName}
        selectedBn={resolvedPartial.districtBn}
        disabled={!effectiveDivisionName}
        loading={loadingDistricts}
        error={errors?.district}
        variant={variant}
        onSelect={(opt) => {
          onChange({
            divisionId: effectiveDivisionId,
            division: effectiveDivisionName,
            divisionBn: resolvedPartial.divisionBn,
            districtId: opt.id,
            district: opt.name,
            districtBn: opt.nameBn,
            upazilaId: '',
            upazila: '',
            upazilaBn: '',
            areaId: '',
            area: '',
            areaBn: '',
            postalCode: undefined,
          });
        }}
        onClear={() => {
          onChange({
            divisionId: effectiveDivisionId,
            division: effectiveDivisionName,
            divisionBn: resolvedPartial.divisionBn,
            districtId: '',
            district: '',
            districtBn: '',
            upazilaId: '',
            upazila: '',
            upazilaBn: '',
            areaId: '',
            area: '',
            areaBn: '',
            postalCode: undefined,
          });
        }}
      />

      <SearchableGeoField
        id={`${idPrefix}-thana`}
        label={`Thana / Upazila${star}`}
        placeholder="Select Thana / Upazila"
        searchPlaceholder="Search upazila or metro thana..."
        icon={<MapPin className="h-4 w-4" />}
        options={upazilaOptions}
        selectedId={effectiveUpazilaId}
        selectedLabel={effectiveUpazilaName}
        selectedBn={resolvedPartial.upazilaBn}
        disabled={!effectiveDistrictName}
        loading={loadingUpazilas}
        error={errors?.upazila}
        variant={variant}
        onSelect={(opt) => {
          const matched = upazilas.find((u) => u.id === opt.id);
          onChange({
            divisionId: effectiveDivisionId,
            division: effectiveDivisionName,
            divisionBn: resolvedPartial.divisionBn,
            districtId: effectiveDistrictId,
            district: effectiveDistrictName,
            districtBn: resolvedPartial.districtBn,
            upazilaId: opt.id,
            upazila: opt.name,
            upazilaBn: opt.nameBn,
            upazilaType: matched?.areaKind,
            areaId: '',
            area: '',
            areaBn: '',
            postalCode: undefined,
          });
        }}
        onClear={() => {
          onChange({
            divisionId: effectiveDivisionId,
            division: effectiveDivisionName,
            divisionBn: resolvedPartial.divisionBn,
            districtId: effectiveDistrictId,
            district: effectiveDistrictName,
            districtBn: resolvedPartial.districtBn,
            upazilaId: '',
            upazila: '',
            upazilaBn: '',
            areaId: '',
            area: '',
            areaBn: '',
            postalCode: undefined,
          });
        }}
      />

      <SearchableGeoField
        id={`${idPrefix}-union`}
        label={level4Label}
        placeholder={level4Placeholder}
        searchPlaceholder="Search union, ward, or post code..."
        icon={<Users className="h-4 w-4" />}
        options={areaOptions}
        selectedId={effectiveAreaId}
        selectedLabel={effectiveAreaName}
        selectedBn={selectedAreaMeta?.nameBn || resolvedPartial.areaBn}
        disabled={!effectiveUpazilaName}
        loading={loadingAreas}
        error={errors?.area}
        helperNotice={
          resolvedPartial.unmatchedLegacyArea
            ? `Legacy area "${resolvedPartial.unmatchedLegacyArea}" needs confirmation — please select a Union, Ward, or Pourashava.`
            : undefined
        }
        variant={variant}
        onSelect={(opt) => {
          const matched = areas.find((a) => a.id === opt.id);
          onChange({
            divisionId: effectiveDivisionId,
            division: effectiveDivisionName,
            divisionBn: resolvedPartial.divisionBn,
            districtId: effectiveDistrictId,
            district: effectiveDistrictName,
            districtBn: resolvedPartial.districtBn,
            upazilaId: effectiveUpazilaId,
            upazila: effectiveUpazilaName,
            upazilaBn: resolvedPartial.upazilaBn,
            upazilaType: selectedUpazilaMeta?.areaKind || resolvedPartial.upazilaType,
            areaId: opt.id,
            area: opt.name,
            areaBn: opt.nameBn,
            areaType: matched?.areaType,
            postalCode: matched?.postalCode,
          });
        }}
        onClear={() => {
          onChange({
            divisionId: effectiveDivisionId,
            division: effectiveDivisionName,
            divisionBn: resolvedPartial.divisionBn,
            districtId: effectiveDistrictId,
            district: effectiveDistrictName,
            districtBn: resolvedPartial.districtBn,
            upazilaId: effectiveUpazilaId,
            upazila: effectiveUpazilaName,
            upazilaBn: resolvedPartial.upazilaBn,
            upazilaType: selectedUpazilaMeta?.areaKind || resolvedPartial.upazilaType,
            areaId: '',
            area: '',
            areaBn: '',
            postalCode: undefined,
          });
        }}
      />
    </>
  );
}
