import * as availabilityService from './availability.service.js';

/** Thin controllers: the doctor is always the signed-in user (no doctor id is accepted from the client). */

export async function getMine(req, res) {
  res.json({ data: await availabilityService.getMyAvailability(req.auth) });
}

export async function calendar(req, res) {
  res.json({ data: await availabilityService.getMyCalendar(req.auth, req.validatedQuery) });
}

export async function saveSchedule(req, res) {
  res.json({ data: await availabilityService.saveMySchedule(req.auth, req.body) });
}

export async function deleteRule(req, res) {
  res.json({ data: await availabilityService.deleteMyRule(req.auth, req.params.ruleId) });
}

export async function addBlock(req, res) {
  res.status(201).json({ data: await availabilityService.addMyBlock(req.auth, req.body) });
}

export async function removeBlock(req, res) {
  res.json({ data: await availabilityService.removeMyBlock(req.auth, req.params.blockId) });
}
