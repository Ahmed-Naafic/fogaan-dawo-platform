import * as availabilityService from './availability.service.js';

/** Thin controllers: the doctor is always the signed-in user (no doctor id is accepted from the client). */

/** GET /api/v1/doctors/me/availability — get mine. Thin HTTP adapter: validated input in, service result out as JSON. */
export async function getMine(req, res) {
  res.json({ data: await availabilityService.getMyAvailability(req.auth) });
}

/** GET /api/v1/doctors/me/availability/calendar — calendar. Thin HTTP adapter: validated input in, service result out as JSON. */
export async function calendar(req, res) {
  res.json({ data: await availabilityService.getMyCalendar(req.auth, req.validatedQuery) });
}

/** PUT /api/v1/doctors/me/availability/schedule — save schedule. Thin HTTP adapter: validated input in, service result out as JSON. */
export async function saveSchedule(req, res) {
  res.json({ data: await availabilityService.saveMySchedule(req.auth, req.body) });
}

/** DELETE /api/v1/doctors/me/availability/rules/:ruleId — delete rule. Thin HTTP adapter: validated input in, service result out as JSON. */
export async function deleteRule(req, res) {
  res.json({ data: await availabilityService.deleteMyRule(req.auth, req.params.ruleId) });
}

/** POST /api/v1/doctors/me/availability/blocks — add block. Thin HTTP adapter: validated input in, service result out as JSON. */
export async function addBlock(req, res) {
  res.status(201).json({ data: await availabilityService.addMyBlock(req.auth, req.body) });
}

/** DELETE /api/v1/doctors/me/availability/blocks/:blockId — remove block. Thin HTTP adapter: validated input in, service result out as JSON. */
export async function removeBlock(req, res) {
  res.json({ data: await availabilityService.removeMyBlock(req.auth, req.params.blockId) });
}
