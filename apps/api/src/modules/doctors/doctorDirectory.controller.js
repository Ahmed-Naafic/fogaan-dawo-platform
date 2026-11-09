import * as directoryService from './doctorDirectory.service.js';

/** Public, unauthenticated reads of verified doctors. */

/** GET /api/v1/doctors — search. Thin HTTP adapter: validated input in, service result out as JSON. */
export async function search(req, res) {
  res.json({ data: await directoryService.searchDirectory(req.validatedQuery) });
}

/** GET /api/v1/admin/doctor-applications/:doctorId, GET /api/v1/doctors/:doctorId — get. Thin HTTP adapter: validated input in, service result out as JSON. */
export async function get(req, res) {
  res.json({ data: await directoryService.getPublicDoctor(req.params.doctorId) });
}

/** GET /api/v1/doctors/:doctorId/slots — slots. Thin HTTP adapter: validated input in, service result out as JSON. */
export async function slots(req, res) {
  res.json({ data: await directoryService.getPublicSlots(req.params.doctorId, req.validatedQuery) });
}
