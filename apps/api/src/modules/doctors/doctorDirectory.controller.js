import * as directoryService from './doctorDirectory.service.js';

/** Public, unauthenticated reads of verified doctors. */

export async function search(req, res) {
  res.json({ data: await directoryService.searchDirectory(req.validatedQuery) });
}

export async function get(req, res) {
  res.json({ data: await directoryService.getPublicDoctor(req.params.doctorId) });
}

export async function slots(req, res) {
  res.json({ data: await directoryService.getPublicSlots(req.params.doctorId, req.validatedQuery) });
}
