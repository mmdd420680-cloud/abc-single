import {
  BD_DIVISIONS,
  BD_GEO_STATS,
  getAllDivisionsSummary,
  getAreasByUpazilaId,
  getAreasForUpazila,
  getDistrictsByDivisionId,
  getDistrictsForDivision,
  getUpazilaNodeById,
  getUpazilasByDistrictId,
  getUpazilasForDistrict,
  type BdArea,
  type BdDistrict,
  type BdLocationSummaryDivision,
  type BdUpazila,
} from '../../../../src/lib/bdLocations';

function filterByQuery<T extends { name: string; nameBn?: string }>(items: T[], query?: string): T[] {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return items;
  return items.filter(
    (item) =>
      item.name.toLowerCase().includes(q) ||
      (item.nameBn ? item.nameBn.toLowerCase().includes(q) : false),
  );
}

export function listDivisionsGeo(query?: string): {
  stats: typeof BD_GEO_STATS;
  divisions: BdLocationSummaryDivision[];
} {
  return {
    stats: BD_GEO_STATS,
    divisions: filterByQuery(getAllDivisionsSummary(), query),
  };
}

export function listDistrictsByDivisionGeo(divisionIdOrName: string, query?: string) {
  const raw: BdDistrict[] = divisionIdOrName.startsWith('div-')
    ? getDistrictsByDivisionId(divisionIdOrName)
    : getDistrictsForDivision(divisionIdOrName);

  const items = raw.map((d) => ({
    id: d.id,
    name: d.name,
    nameBn: d.nameBn || d.name,
    divisionId: d.divisionId,
    isDhakaMetro: Boolean(d.isDhakaMetro),
    upazilaCount: d.upazilas.length,
  }));
  return filterByQuery(items, query);
}

export function listUpazilasByDistrictGeo(districtId: string, query?: string, divisionName?: string) {
  let raw: BdUpazila[] = [];
  if (districtId.startsWith('dis-')) {
    raw = getUpazilasByDistrictId(districtId);
  } else if (divisionName) {
    raw = getUpazilasForDistrict(divisionName, districtId);
  } else {
    for (const div of BD_DIVISIONS) {
      const found = div.districts.find((d) => d.name.toLowerCase() === districtId.trim().toLowerCase());
      if (found) {
        raw = found.upazilas;
        break;
      }
    }
  }

  const items = raw.map((u) => ({
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
  return filterByQuery(items, query);
}

export function listAreasByUpazilaGeo(
  upazilaId: string,
  query?: string,
  parentNames?: { division?: string; district?: string },
): { upazila?: Omit<BdUpazila, 'areas'>; areas: BdArea[] } {
  if (upazilaId.startsWith('upa-') || upazilaId.startsWith('tha-') || upazilaId.startsWith('cc-')) {
    const node = getUpazilaNodeById(upazilaId);
    if (!node) return { areas: [] };
    const { areas, ...meta } = node;
    return {
      upazila: meta,
      areas: filterByQuery(areas, query),
    };
  }
  if (parentNames?.division && parentNames?.district) {
    const areas = getAreasForUpazila(parentNames.division, parentNames.district, upazilaId);
    return { areas: filterByQuery(areas, query) };
  }
  return { areas: filterByQuery(getAreasByUpazilaId(upazilaId), query) };
}
