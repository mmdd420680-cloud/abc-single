import { Router, type Request, type Response } from 'express';
import {
  listAreasByUpazilaGeo,
  listDistrictsByDivisionGeo,
  listDivisionsGeo,
  listUpazilasByDistrictGeo,
} from './location.service';

const router = Router();

// Public, lightweight, cache-friendly Bangladesh 4-tier cascading location endpoints
router.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'public, max-age=3600');
  next();
});

router.get('/divisions', (req: Request, res: Response) => {
  const q = typeof req.query.q === 'string' ? req.query.q : undefined;
  const { stats, divisions } = listDivisionsGeo(q);
  res.json({ ok: true, stats, divisions });
});

router.get('/divisions/:divisionId/districts', (req: Request, res: Response) => {
  const divisionId = String(req.params.divisionId || '').trim();
  const q = typeof req.query.q === 'string' ? req.query.q : undefined;
  const districts = listDistrictsByDivisionGeo(divisionId, q);
  if (!q && districts.length === 0) {
    res.status(404).json({ ok: false, code: 'DIVISION_NOT_FOUND', error: 'Unknown Bangladesh division.' });
    return;
  }
  res.json({ ok: true, divisionId, districts });
});

router.get('/districts/:districtId/upazilas', (req: Request, res: Response) => {
  const districtId = String(req.params.districtId || '').trim();
  const q = typeof req.query.q === 'string' ? req.query.q : undefined;
  const division = typeof req.query.division === 'string' ? req.query.division : undefined;
  const upazilas = listUpazilasByDistrictGeo(districtId, q, division);
  if (!q && upazilas.length === 0) {
    res.status(404).json({ ok: false, code: 'DISTRICT_NOT_FOUND', error: 'Unknown Bangladesh district.' });
    return;
  }
  res.json({ ok: true, districtId, upazilas });
});

router.get('/upazilas/:upazilaId/areas', (req: Request, res: Response) => {
  const upazilaId = String(req.params.upazilaId || '').trim();
  const q = typeof req.query.q === 'string' ? req.query.q : undefined;
  const division = typeof req.query.division === 'string' ? req.query.division : undefined;
  const district = typeof req.query.district === 'string' ? req.query.district : undefined;
  const { upazila, areas } = listAreasByUpazilaGeo(upazilaId, q, { division, district });
  if (!q && !upazila && areas.length === 0) {
    res.status(404).json({ ok: false, code: 'UPAZILA_NOT_FOUND', error: 'Unknown Bangladesh upazila or thana.' });
    return;
  }
  res.json({ ok: true, upazilaId, upazila, areas });
});

export default router;
