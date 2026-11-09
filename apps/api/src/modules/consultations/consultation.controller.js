import * as calls from './consultationCall.service.js';
import { saveNote } from './consultation.service.js';

/** Thin controllers: the participant is always the signed-in user in their active role. */
export const join = async (req, res) => res.json({ data: await calls.join(req.auth, req.params.appointmentId) });
/** POST /api/v1/consultations/:consultationId/ticket — ticket. Thin HTTP adapter: validated input in, service result out as JSON. */
export const ticket = async (req, res) => res.json({ data: await calls.reconnectTicket(req.auth, req.params.consultationId) });
/** GET /api/v1/consultations/:consultationId — get. Thin HTTP adapter: validated input in, service result out as JSON. */
export const get = async (req, res) => res.json({ data: await calls.getState(req.auth, req.params.consultationId) });
/** POST /api/v1/consultations/:consultationId/admit — admit. Thin HTTP adapter: validated input in, service result out as JSON. */
export const admit = async (req, res) => res.json({ data: await calls.admit(req.auth, req.params.consultationId) });
/** POST /api/v1/consultations/:consultationId/reject — reject. Thin HTTP adapter: validated input in, service result out as JSON. */
export const reject = async (req, res) => res.json({ data: await calls.reject(req.auth, req.params.consultationId) });
/** POST /api/v1/consultations/:consultationId/leave — leave. Thin HTTP adapter: validated input in, service result out as JSON. */
export const leave = async (req, res) => res.json({ data: await calls.leave(req.auth, req.params.consultationId) });
/** POST /api/v1/consultations/:consultationId/end — end. Thin HTTP adapter: validated input in, service result out as JSON. */
export const end = async (req, res) => res.json({ data: await calls.end(req.auth, req.params.consultationId) });

/** Doctor's consultation note (existing saveNote rules: doctor only, locked 24 h after completion). */
export const saveMyNote = async (req, res) => {
  const fields = Object.fromEntries(Object.entries(req.body).filter(([, v]) => v !== undefined));
  await calls.getState(req.auth, req.params.consultationId); // ownership + active doctor check
  const note = await saveNote({ consultationId: req.params.consultationId, actorUserId: req.auth.user.id, fields });
  res.json({ data: { lockedAt: note.lockedAt?.toISOString() ?? null, updatedAt: note.updatedAt.toISOString() } });
};
