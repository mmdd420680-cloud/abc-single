import {
  getAllCityCorporations,
  getAllDistricts,
  getAllDivisions,
  getAllThanas,
  getAllUnions,
  getAllUpazilas,
  getAllWards,
  type CityCorpration,
  type District,
  type Division,
  type Thana,
  type Union,
  type Upazila,
  type Ward,
} from 'bangladesh-geo-data';

export type BdAreaType = 'union' | 'ward' | 'pourashava';
export type BdLevel3Kind = 'upazila' | 'metropolitan_thana' | 'city_corporation';

export interface BdArea {
  id: string;
  name: string;
  nameBn?: string;
  areaType: BdAreaType;
  postalCode?: string;
  postOffice?: string;
  wardNo?: number;
  cityCorpId?: string;
  cityCorpName?: string;
  cityCorpShortName?: string;
  upazilaId?: string;
}

export interface BdUpazila {
  id: string;
  name: string;
  nameBn?: string;
  districtId: string;
  areaKind: BdLevel3Kind;
  cityCorpId?: string;
  cityCorpName?: string;
  cityCorpShortName?: string;
  areas: BdArea[];
}

export interface BdDistrict {
  id: string;
  name: string;
  nameBn?: string;
  divisionId: string;
  isDhakaMetro?: boolean;
  upazilas: BdUpazila[];
}

export interface BdDivision {
  id: string;
  name: string;
  nameBn?: string;
  districts: BdDistrict[];
}

export interface BdLocationSummaryDivision {
  id: string;
  name: string;
  nameBn: string;
  districtCount: number;
}

export interface BdLocationSummaryDistrict {
  id: string;
  name: string;
  nameBn: string;
  divisionId: string;
  isDhakaMetro: boolean;
  upazilaCount: number;
}

export interface BdLocationSummaryUpazila {
  id: string;
  name: string;
  nameBn: string;
  districtId: string;
  areaKind: BdLevel3Kind;
  cityCorpId?: string;
  cityCorpName?: string;
  cityCorpShortName?: string;
  areaCount: number;
}

const DIVISION_NAME_ALIASES: Record<string, string> = {
  barisal: 'Barishal',
  chittagong: 'Chattogram',
};

const DISTRICT_NAME_ALIASES: Record<string, string> = {
  bogura: 'Bogra',
  jashore: 'Jessore',
  barisal: 'Barishal',
  chittagong: 'Chattogram',
  comilla: 'Cumilla',
  chapainawabganj: 'Chapai Nawabganj',
  "coxs bazar": "Cox's Bazar",
  'cox bazar': "Cox's Bazar",
  bramanbaria: 'Brahmanbaria',
  narsingdi: 'Narsingdi',
  moulavibazar: 'Moulvibazar',
};

const UPAZILA_NAME_ALIASES: Record<string, string> = {
  'bogura sadar': 'Bogra Sadar',
  'jashore sadar': 'Jessore Sadar',
  'barisal sadar': 'Barishal Sadar',
  'comilla adarsha sadar': 'Cumilla Adarsha Sadar',
  'comilla sadar dakshin': 'Cumilla Sadar Dakshin',
  mirpur: 'Mirpur Model',
  paltan: 'Paltan Model',
  ramna: 'Ramna Model',
  uttara: 'Uttara West',
  shahbagh: 'Shahbag',
  sherebanglanagar: 'Sher-e-Bangla Nagar',
  'sher e bangla nagar': 'Sher-e-Bangla Nagar',
  'chapainawabganj sadar': 'Chapai Nawabganj Sadar',
};

const DHAKA_SUBURB_UPAZILA_NAMES = new Set([
  'dhamrai',
  'dohar',
  'keraniganj',
  'nawabganj',
  'savar',
]);

function normalizeKey(value: string | undefined | null): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function buildLocationIndex() {
  const rawDivisions: Division[] = getAllDivisions();
  const rawDistricts: District[] = getAllDistricts();
  const rawUpazilas: Upazila[] = getAllUpazilas();
  const rawUnions: Union[] = getAllUnions();
  const rawCityCorps: CityCorpration[] = getAllCityCorporations();
  const rawWards: Ward[] = getAllWards();
  const rawThanas: Thana[] = getAllThanas();

  const divisionById = new Map<string, BdDivision>();
  const divisionByName = new Map<string, BdDivision>();
  const districtById = new Map<string, BdDistrict>();
  const upazilaById = new Map<string, BdUpazila>();
  const areaById = new Map<string, BdArea>();
  const ccById = new Map<string, CityCorpration>();

  for (const cc of rawCityCorps) {
    ccById.set(cc.id, cc);
  }

  // Group wards by City Corporation ID
  const wardsByCcId = new Map<string, BdArea[]>();
  for (const w of rawWards) {
    const cc = ccById.get(w.cityCorpId);
    const wardArea: BdArea = {
      id: w.id,
      name: w.name,
      nameBn: w.nameBn,
      areaType: 'ward',
      wardNo: w.wardNo,
      cityCorpId: w.cityCorpId,
      cityCorpName: cc?.name,
      cityCorpShortName: cc?.shortName,
    };
    areaById.set(wardArea.id, wardArea);
    const arr = wardsByCcId.get(w.cityCorpId) || [];
    arr.push(wardArea);
    wardsByCcId.set(w.cityCorpId, arr);
  }

  for (const arr of wardsByCcId.values()) {
    arr.sort((a, b) => (a.wardNo ?? 0) - (b.wardNo ?? 0));
  }

  // Group unions by Upazila ID
  const unionsByUpazilaId = new Map<string, BdArea[]>();
  for (const u of rawUnions) {
    const unionArea: BdArea = {
      id: u.id,
      name: u.name,
      nameBn: u.nameBn,
      areaType: 'union',
      upazilaId: u.upazilaId,
      postOffice: u.postOffice || undefined,
      postalCode: u.postalCode || undefined,
    };
    areaById.set(unionArea.id, unionArea);
    const arr = unionsByUpazilaId.get(u.upazilaId) || [];
    arr.push(unionArea);
    unionsByUpazilaId.set(u.upazilaId, arr);
  }

  // Group metropolitan thanas by District ID + track which City Corporations already have metro thanas
  const metroThanasByDistrictId = new Map<string, BdUpazila[]>();
  const ccHasMetroThanas = new Set<string>();
  for (const t of rawThanas) {
    if (t.type !== 'metropolitan' || !t.cityCorpId) continue;
    const cc = ccById.get(t.cityCorpId);
    const ccWards = wardsByCcId.get(t.cityCorpId) || [];
    if (!cc || ccWards.length === 0) continue;
    ccHasMetroThanas.add(cc.id);

    const metroNode: BdUpazila = {
      id: t.id,
      name: t.name,
      nameBn: t.nameBn,
      districtId: t.districtId,
      areaKind: 'metropolitan_thana',
      cityCorpId: cc.id,
      cityCorpName: cc.name,
      cityCorpShortName: cc.shortName,
      areas: ccWards,
    };
    upazilaById.set(metroNode.id, metroNode);
    const list = metroThanasByDistrictId.get(t.districtId) || [];
    list.push(metroNode);
    metroThanasByDistrictId.set(t.districtId, list);
  }

  // Ensure City Corporations that have wards in the package without metropolitan thana mappings (e.g. Cumilla City Corporation) remain reachable
  for (const cc of rawCityCorps) {
    if (ccHasMetroThanas.has(cc.id)) continue;
    const ccWards = wardsByCcId.get(cc.id) || [];
    if (ccWards.length === 0) continue;
    const ccNode: BdUpazila = {
      id: cc.id,
      name: cc.name,
      nameBn: cc.nameBn,
      districtId: cc.districtId,
      areaKind: 'city_corporation',
      cityCorpId: cc.id,
      cityCorpName: cc.name,
      cityCorpShortName: cc.shortName,
      areas: ccWards,
    };
    upazilaById.set(ccNode.id, ccNode);
    const list = metroThanasByDistrictId.get(cc.districtId) || [];
    list.push(ccNode);
    metroThanasByDistrictId.set(cc.districtId, list);
  }

  // Group rural upazilas by District ID
  const upazilasByDistrictId = new Map<string, BdUpazila[]>();
  for (const u of rawUpazilas) {
    let areas = unionsByUpazilaId.get(u.id) || [];
    // Explicit typed urban fallback ONLY when an upazila has zero unions in the upstream dataset (e.g. Shaistaganj, upa-388)
    if (areas.length === 0) {
      const fallbackPourashava: BdArea = {
        id: `pourashava-${u.id}`,
        name: `${u.name} Pourashava`,
        nameBn: u.nameBn ? `${u.nameBn} পৌরসভা` : `${u.name} পৌরসভা`,
        areaType: 'pourashava',
        upazilaId: u.id,
      };
      areaById.set(fallbackPourashava.id, fallbackPourashava);
      areas = [fallbackPourashava];
    }
    const upaNode: BdUpazila = {
      id: u.id,
      name: u.name,
      nameBn: u.nameBn,
      districtId: u.districtId,
      areaKind: 'upazila',
      areas,
    };
    upazilaById.set(upaNode.id, upaNode);
    const list = upazilasByDistrictId.get(u.districtId) || [];
    list.push(upaNode);
    upazilasByDistrictId.set(u.districtId, list);
  }

  // Build Districts
  const districtsByDivisionId = new Map<string, BdDistrict[]>();
  for (const d of rawDistricts) {
    const metroList = (metroThanasByDistrictId.get(d.id) || []).slice().sort((a, b) => a.name.localeCompare(b.name));
    const ruralList = (upazilasByDistrictId.get(d.id) || []).slice().sort((a, b) => a.name.localeCompare(b.name));
    const combinedUpazilas = [...metroList, ...ruralList];
    const distNode: BdDistrict = {
      id: d.id,
      name: d.name,
      nameBn: d.nameBn,
      divisionId: d.divisionId,
      isDhakaMetro: d.name === 'Dhaka',
      upazilas: combinedUpazilas,
    };
    districtById.set(distNode.id, distNode);
    const list = districtsByDivisionId.get(d.divisionId) || [];
    list.push(distNode);
    districtsByDivisionId.set(d.divisionId, list);
  }

  // Build Divisions
  const divisions: BdDivision[] = rawDivisions.map((div) => {
    const distList = (districtsByDivisionId.get(div.id) || []).slice().sort((a, b) => a.name.localeCompare(b.name));
    // Put main namesake district first inside its division (Dhaka, Chattogram, Rajshahi, etc.) for ergonomic UX
    distList.sort((a, b) => {
      if (a.name === div.name) return -1;
      if (b.name === div.name) return 1;
      return a.name.localeCompare(b.name);
    });
    const divNode: BdDivision = {
      id: div.id,
      name: div.name,
      nameBn: div.nameBn,
      districts: distList,
    };
    divisionById.set(divNode.id, divNode);
    divisionByName.set(normalizeKey(divNode.name), divNode);
    return divNode;
  });

  return {
    divisions,
    divisionById,
    divisionByName,
    districtById,
    upazilaById,
    areaById,
    stats: {
      divisions: rawDivisions.length,
      districts: rawDistricts.length,
      upazilas: rawUpazilas.length,
      unions: rawUnions.length,
      cityCorporations: rawCityCorps.length,
      wards: rawWards.length,
      metropolitanThanas: rawThanas.filter((t) => t.type === 'metropolitan').length,
      level3Count: upazilaById.size,
    },
  };
}

const INDEX = buildLocationIndex();

export const BD_DIVISIONS: BdDivision[] = INDEX.divisions;
export const BD_GEO_STATS = INDEX.stats;

function resolveDivisionRecord(divisionIdOrName: string): BdDivision | undefined {
  const raw = String(divisionIdOrName || '').trim();
  if (!raw) return undefined;
  const byId = INDEX.divisionById.get(raw);
  if (byId) return byId;
  const norm = normalizeKey(raw);
  const direct = INDEX.divisionByName.get(norm);
  if (direct) return direct;
  const aliased = DIVISION_NAME_ALIASES[norm];
  return aliased ? INDEX.divisionByName.get(normalizeKey(aliased)) : undefined;
}

function resolveDistrictRecord(division: BdDivision, districtIdOrName: string): BdDistrict | undefined {
  const raw = String(districtIdOrName || '').trim();
  if (!raw) return undefined;
  const byId = INDEX.districtById.get(raw);
  if (byId && byId.divisionId === division.id) return byId;
  const norm = normalizeKey(raw);
  const direct = division.districts.find((d) => normalizeKey(d.name) === norm);
  if (direct) return direct;
  const aliased = DISTRICT_NAME_ALIASES[norm];
  return aliased ? division.districts.find((d) => normalizeKey(d.name) === normalizeKey(aliased)) : undefined;
}

function resolveUpazilaCandidates(district: BdDistrict, upazilaIdOrName: string): BdUpazila[] {
  const raw = String(upazilaIdOrName || '').trim();
  if (!raw) return [];
  const byId = INDEX.upazilaById.get(raw);
  if (byId && byId.districtId === district.id) return [byId];

  const norm = normalizeKey(raw);
  const direct = district.upazilas.filter((u) => normalizeKey(u.name) === norm);
  if (direct.length > 0) return direct;

  const aliased = UPAZILA_NAME_ALIASES[norm];
  if (aliased) {
    return district.upazilas.filter((u) => normalizeKey(u.name) === normalizeKey(aliased));
  }
  return [];
}

export function getAllDivisionsSummary(): BdLocationSummaryDivision[] {
  return BD_DIVISIONS.map((d) => ({
    id: d.id,
    name: d.name,
    nameBn: d.nameBn || d.name,
    districtCount: d.districts.length,
  }));
}

export function getDivisionNames(): string[] {
  return BD_DIVISIONS.map((d) => d.name);
}

export function getDistrictsByDivisionId(divisionId: string): BdDistrict[] {
  return INDEX.divisionById.get(String(divisionId || '').trim())?.districts || [];
}

export function getDistrictsForDivision(divisionIdOrName: string): BdDistrict[] {
  return resolveDivisionRecord(divisionIdOrName)?.districts || [];
}

export function getUpazilasByDistrictId(districtId: string): BdUpazila[] {
  return INDEX.districtById.get(String(districtId || '').trim())?.upazilas || [];
}

export function getUpazilasForDistrict(divisionIdOrName: string, districtIdOrName: string): BdUpazila[] {
  const div = resolveDivisionRecord(divisionIdOrName);
  if (!div) return [];
  const dist = resolveDistrictRecord(div, districtIdOrName);
  return dist ? dist.upazilas : [];
}

export function getAreasByUpazilaId(upazilaId: string): BdArea[] {
  return INDEX.upazilaById.get(String(upazilaId || '').trim())?.areas || [];
}

export function getUpazilaNodeById(upazilaId: string): BdUpazila | undefined {
  return INDEX.upazilaById.get(String(upazilaId || '').trim());
}

export function getAreasForUpazila(
  divisionIdOrName: string,
  districtIdOrName: string,
  upazilaIdOrName: string,
): BdArea[] {
  const div = resolveDivisionRecord(divisionIdOrName);
  if (!div) return [];
  const dist = resolveDistrictRecord(div, districtIdOrName);
  if (!dist) return [];
  const matches = resolveUpazilaCandidates(dist, upazilaIdOrName);
  if (matches.length === 0) return [];
  if (matches.length === 1) return matches[0].areas;
  // Deduplicate if both a rural upazila and a metropolitan thana share the exact same name inside one district
  const seen = new Set<string>();
  const combined: BdArea[] = [];
  for (const m of matches) {
    for (const a of m.areas) {
      if (!seen.has(a.id)) {
        seen.add(a.id);
        combined.push(a);
      }
    }
  }
  return combined;
}

export interface BdHierarchyValidationInput {
  division?: string;
  divisionId?: string;
  district?: string;
  districtId?: string;
  upazila?: string;
  upazilaId?: string;
  area?: string;
  areaId?: string;
}

export interface BdHierarchyValidationResult {
  valid: boolean;
  reason?: string;
  resolved?: {
    divisionId: string;
    division: string;
    divisionBn: string;
    districtId: string;
    district: string;
    districtBn: string;
    upazilaId: string;
    upazila: string;
    upazilaBn: string;
    upazilaType: BdLevel3Kind;
    areaId: string;
    area: string;
    areaBn: string;
    areaType: BdAreaType;
    postalCode?: string;
  };
}

export function validateBangladeshAddressHierarchy(
  input: BdHierarchyValidationInput,
): BdHierarchyValidationResult {
  const div = resolveDivisionRecord(input.divisionId || input.division || '');
  if (!div) {
    return { valid: false, reason: `Unknown division: ${input.division || input.divisionId || ''}` };
  }
  if (
    input.divisionId &&
    input.division &&
    normalizeKey(div.name) !== normalizeKey(DIVISION_NAME_ALIASES[normalizeKey(input.division)] || input.division)
  ) {
    return { valid: false, reason: `Division ID "${input.divisionId}" does not match "${input.division}"` };
  }

  const dist = resolveDistrictRecord(div, input.districtId || input.district || '');
  if (!dist) {
    return {
      valid: false,
      reason: `District "${input.district || input.districtId || ''}" does not belong to ${div.name}`,
    };
  }
  if (
    input.districtId &&
    input.district &&
    normalizeKey(dist.name) !== normalizeKey(DISTRICT_NAME_ALIASES[normalizeKey(input.district)] || input.district)
  ) {
    return { valid: false, reason: `District ID "${input.districtId}" does not match "${input.district}"` };
  }

  const upazilaCandidates = resolveUpazilaCandidates(dist, input.upazilaId || input.upazila || '');
  if (upazilaCandidates.length === 0) {
    return {
      valid: false,
      reason: `Upazila/Thana "${input.upazila || input.upazilaId || ''}" does not belong to ${dist.name}`,
    };
  }
  if (
    input.upazilaId &&
    input.upazila &&
    !upazilaCandidates.some(
      (u) =>
        normalizeKey(u.name) ===
        normalizeKey(UPAZILA_NAME_ALIASES[normalizeKey(input.upazila)] || input.upazila),
    )
  ) {
    return { valid: false, reason: `Upazila ID "${input.upazilaId}" does not match "${input.upazila}"` };
  }

  const areaIdTrimmed = String(input.areaId || '').trim();
  const areaNameKey = normalizeKey(input.area);
  let matchedUpa: BdUpazila | undefined;
  let matchedArea: BdArea | undefined;

  for (const candidate of upazilaCandidates) {
    const found = candidate.areas.find((a) => {
      if (areaIdTrimmed && a.id === areaIdTrimmed) {
        if (!areaNameKey || normalizeKey(a.name) === areaNameKey || normalizeKey(a.nameBn) === areaNameKey) {
          return true;
        }
        return false;
      }
      if (!areaIdTrimmed && areaNameKey) {
        return normalizeKey(a.name) === areaNameKey || normalizeKey(a.nameBn) === areaNameKey;
      }
      return false;
    });
    if (found) {
      matchedUpa = candidate;
      matchedArea = found;
      break;
    }
  }

  if (!matchedUpa || !matchedArea) {
    return {
      valid: false,
      reason: `Area/Union/Ward "${input.area || input.areaId || ''}" does not belong to ${upazilaCandidates[0].name}`,
    };
  }

  return {
    valid: true,
    resolved: {
      divisionId: div.id,
      division: div.name,
      divisionBn: div.nameBn || div.name,
      districtId: dist.id,
      district: dist.name,
      districtBn: dist.nameBn || dist.name,
      upazilaId: matchedUpa.id,
      upazila: matchedUpa.name,
      upazilaBn: matchedUpa.nameBn || matchedUpa.name,
      upazilaType: matchedUpa.areaKind,
      areaId: matchedArea.id,
      area: matchedArea.name,
      areaBn: matchedArea.nameBn || matchedArea.name,
      areaType: matchedArea.areaType,
      postalCode: matchedArea.postalCode,
    },
  };
}

export interface BdPartialResolution {
  divisionId: string;
  division: string;
  divisionBn: string;
  districtId: string;
  district: string;
  districtBn: string;
  upazilaId: string;
  upazila: string;
  upazilaBn: string;
  upazilaType?: BdLevel3Kind;
  areaId: string;
  area: string;
  areaBn: string;
  areaType?: BdAreaType;
  postalCode?: string;
  unmatchedLegacyArea?: string;
}

export function resolveBangladeshPartialSelection(input: BdHierarchyValidationInput): BdPartialResolution {
  const empty: BdPartialResolution = {
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
  };

  const div = resolveDivisionRecord(input.divisionId || input.division || '');
  if (!div) return empty;

  const result: BdPartialResolution = {
    ...empty,
    divisionId: div.id,
    division: div.name,
    divisionBn: div.nameBn || div.name,
  };

  const dist = resolveDistrictRecord(div, input.districtId || input.district || '');
  if (!dist) return result;

  result.districtId = dist.id;
  result.district = dist.name;
  result.districtBn = dist.nameBn || dist.name;

  const candidates = resolveUpazilaCandidates(dist, input.upazilaId || input.upazila || '');
  if (candidates.length === 0) return result;

  const areaIdTrimmed = String(input.areaId || '').trim();
  const areaNameKey = normalizeKey(input.area);
  let matchedUpa: BdUpazila = candidates[0];
  let matchedArea: BdArea | undefined;

  for (const candidate of candidates) {
    const found = candidate.areas.find((a) => {
      if (areaIdTrimmed && a.id === areaIdTrimmed) return true;
      if (areaNameKey && (normalizeKey(a.name) === areaNameKey || normalizeKey(a.nameBn) === areaNameKey)) return true;
      return false;
    });
    if (found) {
      matchedUpa = candidate;
      matchedArea = found;
      break;
    }
  }

  result.upazilaId = matchedUpa.id;
  result.upazila = matchedUpa.name;
  result.upazilaBn = matchedUpa.nameBn || matchedUpa.name;
  result.upazilaType = matchedUpa.areaKind;

  if (matchedArea) {
    result.areaId = matchedArea.id;
    result.area = matchedArea.name;
    result.areaBn = matchedArea.nameBn || matchedArea.name;
    result.areaType = matchedArea.areaType;
    result.postalCode = matchedArea.postalCode;
  } else if (String(input.area || '').trim()) {
    result.unmatchedLegacyArea = String(input.area).trim();
  }

  return result;
}

export interface ShippingConfig {
  dhakaMetroCharge: number;
  dhakaSuburbCharge: number;
  nationwideCharge: number;
  freeShippingThreshold: number;
  expressSurcharge: number;
}

export interface DeliveryZoneConfig {
  name: string;
  divisions: string[];
  charge: number;
  freeAbove: number;
  estimatedDays: string;
  isActive: boolean;
}

export interface DeliveryOptionSpec {
  code: string;
  name: string;
  description: string;
  estimatedTime: string;
  methodType: 'standard' | 'express';
  surcharge: number;
  freeShippingEligible: boolean;
  isActive: boolean;
  sortOrder: number;
  divisions?: string[];
}

export const DEFAULT_DELIVERY_OPTIONS: DeliveryOptionSpec[] = [
  {
    code: 'standard',
    name: 'Standard Delivery',
    description: 'Doorstep parcel courier across Bangladesh',
    estimatedTime: 'Within 2–5 Business Days',
    methodType: 'standard',
    surcharge: 0,
    freeShippingEligible: true,
    isActive: true,
    sortOrder: 0,
    divisions: ['All'],
  },
  {
    code: 'express',
    name: 'Priority Express',
    description: 'Accelerated dispatch & priority courier handling',
    estimatedTime: 'Within 1–2 Business Days',
    methodType: 'express',
    surcharge: 80,
    freeShippingEligible: false,
    isActive: true,
    sortOrder: 1,
    divisions: ['All'],
  },
];

export const DEFAULT_SHIPPING_CONFIG: ShippingConfig = {
  dhakaMetroCharge: 60,
  dhakaSuburbCharge: 90,
  nationwideCharge: 120,
  freeShippingThreshold: 999,
  expressSurcharge: 80,
};

export function calculateShippingCharge(params: {
  division: string;
  district: string;
  upazila: string;
  subtotal: number;
  deliveryMethod?: 'standard' | 'express';
  deliveryOptionCode?: string;
  deliveryOptions?: DeliveryOptionSpec[];
  config?: Partial<ShippingConfig>;
  deliveryZones?: DeliveryZoneConfig[];
}): {
  charge: number;
  freeShippingApplied: boolean;
  zone: 'dhaka_metro' | 'dhaka_suburb' | 'nationwide';
  zoneName?: string;
  estimatedDays: string;
  deliveryOptionCode: string;
  deliveryMethodName: string;
} {
  const cfg: ShippingConfig = { ...DEFAULT_SHIPPING_CONFIG, ...params.config };
  const divNorm = normalizeKey(params.division);
  const distNorm = normalizeKey(params.district);
  const upaNorm = normalizeKey(params.upazila);

  const isDhakaDivision = divNorm === 'dhaka' || divNorm === 'div-01';
  const isDhakaDistrict = isDhakaDivision && (distNorm === 'dhaka' || distNorm === 'dis-01');
  const isDhakaSuburbUpazila = isDhakaDistrict && DHAKA_SUBURB_UPAZILA_NAMES.has(upaNorm);

  let zone: 'dhaka_metro' | 'dhaka_suburb' | 'nationwide' = 'nationwide';
  let baseCharge = cfg.nationwideCharge;
  let estimatedDays = 'Within 2–5 Business Days';
  let effectiveThreshold = cfg.freeShippingThreshold;
  let zoneName: string | undefined;

  if (!params.division || (isDhakaDistrict && !isDhakaSuburbUpazila)) {
    zone = 'dhaka_metro';
    baseCharge = cfg.dhakaMetroCharge;
    estimatedDays = 'Within 1–2 Business Days';
  } else if (
    isDhakaSuburbUpazila ||
    (isDhakaDivision && (distNorm === 'gazipur' || distNorm === 'narayanganj' || distNorm === 'dis-03' || distNorm === 'dis-09'))
  ) {
    zone = 'dhaka_suburb';
    baseCharge = cfg.dhakaSuburbCharge;
    estimatedDays = 'Within 2–3 Business Days';
  }

  const normalizedDivision = divNorm;
  const matchedZone = normalizedDivision
    ? (params.deliveryZones || []).find(
        (z) =>
          z &&
          z.isActive !== false &&
          Array.isArray(z.divisions) &&
          z.divisions.some((d) => {
            const clean = normalizeKey(d);
            return clean === normalizedDivision || clean === 'all';
          }),
      )
    : undefined;

  if (matchedZone) {
    baseCharge = Math.max(0, Number(matchedZone.charge) || 0);
    if (matchedZone.estimatedDays?.trim()) {
      estimatedDays = matchedZone.estimatedDays.trim();
    }
    if (Number(matchedZone.freeAbove) > 0) {
      effectiveThreshold = Number(matchedZone.freeAbove);
    }
    if (matchedZone.name?.trim()) {
      zoneName = matchedZone.name.trim();
    }
  }

  const configuredOptions =
    Array.isArray(params.deliveryOptions) && params.deliveryOptions.length > 0
      ? params.deliveryOptions
      : DEFAULT_DELIVERY_OPTIONS;

  const requestedCode =
    params.deliveryOptionCode || (params.deliveryMethod === 'express' ? 'express' : 'standard');

  const selectedOption =
    configuredOptions.find((o) => o.isActive !== false && o.code === requestedCode) ||
    configuredOptions.find((o) => o.isActive !== false) ||
    DEFAULT_DELIVERY_OPTIONS[0];

  const isExpress =
    params.deliveryMethod === 'express' || selectedOption.methodType === 'express' || selectedOption.code === 'express';

  const thresholdEligible = effectiveThreshold > 0 && params.subtotal >= effectiveThreshold;
  const freeShippingApplied = thresholdEligible && (selectedOption.freeShippingEligible !== false || !isExpress);

  let charge = thresholdEligible && selectedOption.freeShippingEligible !== false ? 0 : baseCharge;
  if (isExpress) {
    const expressAddOn =
      params.deliveryOptionCode && selectedOption.surcharge >= 0
        ? selectedOption.surcharge || cfg.expressSurcharge
        : cfg.expressSurcharge;
    if (thresholdEligible) {
      charge = expressAddOn;
    } else {
      charge = baseCharge + expressAddOn;
    }
    estimatedDays =
      selectedOption.estimatedTime?.trim() ||
      (zone === 'dhaka_metro' ? 'Same day / Next day' : '1-2 business days');
  } else if (selectedOption.surcharge > 0) {
    charge += selectedOption.surcharge;
  }

  return {
    charge: Math.max(0, Math.round(charge)),
    freeShippingApplied,
    zone,
    ...(zoneName ? { zoneName } : {}),
    estimatedDays:
      selectedOption.code !== 'standard' && selectedOption.estimatedTime?.trim()
        ? selectedOption.estimatedTime.trim()
        : matchedZone?.estimatedDays?.trim() || selectedOption.estimatedTime?.trim() || estimatedDays,
    deliveryOptionCode: selectedOption.code,
    deliveryMethodName: selectedOption.name,
  };
}

export function buildAvailableDeliveryOptions(params: {
  division: string;
  district: string;
  upazila: string;
  subtotal: number;
  config?: Partial<ShippingConfig>;
  deliveryZones?: DeliveryZoneConfig[];
  deliveryOptions?: DeliveryOptionSpec[];
}) {
  const configured =
    Array.isArray(params.deliveryOptions) && params.deliveryOptions.length > 0
      ? params.deliveryOptions
      : DEFAULT_DELIVERY_OPTIONS;

  const normalizedDivision = normalizeKey(params.division);

  return configured
    .filter((opt) => opt && opt.isActive !== false)
    .filter((opt) => {
      if (!normalizedDivision || !opt.divisions || opt.divisions.length === 0) return true;
      return opt.divisions.some((d) => {
        const clean = normalizeKey(d);
        return clean === 'all' || clean === normalizedDivision;
      });
    })
    .slice()
    .sort((a, b) => Number(a.sortOrder ?? 0) - Number(b.sortOrder ?? 0))
    .map((opt) => {
      const calc = calculateShippingCharge({
        division: params.division,
        district: params.district,
        upazila: params.upazila,
        subtotal: params.subtotal,
        deliveryMethod: opt.methodType === 'express' ? 'express' : 'standard',
        deliveryOptionCode: opt.code,
        deliveryOptions: configured,
        config: params.config,
        deliveryZones: params.deliveryZones,
      });
      return {
        code: opt.code,
        name: opt.name,
        description: opt.description,
        methodType: opt.methodType,
        estimatedTime: calc.estimatedDays,
        charge: calc.charge,
        freeShippingApplied: calc.freeShippingApplied,
        zone: calc.zone,
        zoneName: calc.zoneName,
      };
    });
}
