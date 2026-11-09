import * as booking from './appointmentBooking.service.js';

/** Thin controllers: the signed-in user is the patient or doctor; ids in the URL are ownership-checked. */

/** POST /api/v1/appointments — book. Thin HTTP adapter: validated input in, service result out as JSON. */
export const book = async (req, res) => res.status(201).json({ data: await booking.bookSlot(req.auth, req.body) });
/** GET /api/v1/appointments — list mine. Thin HTTP adapter: validated input in, service result out as JSON. */
export const listMine = async (req, res) => res.json({ data: await booking.listMine(req.auth, req.validatedQuery) });
/** GET /api/v1/appointments/:appointmentId — get mine. Thin HTTP adapter: validated input in, service result out as JSON. */
export const getMine = async (req, res) => res.json({ data: await booking.getMine(req.auth, req.params.appointmentId) });
/** POST /api/v1/appointments/:appointmentId/cancel — cancel mine. Thin HTTP adapter: validated input in, service result out as JSON. */
export const cancelMine = async (req, res) => res.json({ data: await booking.cancelMine(req.auth, req.params.appointmentId, req.body) });
/** POST /api/v1/appointments/:appointmentId/reschedule — reschedule mine. Thin HTTP adapter: validated input in, service result out as JSON. */
export const rescheduleMine = async (req, res) => res.json({ data: await booking.rescheduleMine(req.auth, req.params.appointmentId, req.body) });

/** GET /api/v1/doctors/me/appointments — list for doctor. Thin HTTP adapter: validated input in, service result out as JSON. */
export const listForDoctor = async (req, res) => res.json({ data: await booking.listForDoctor(req.auth, req.validatedQuery) });
/** GET /api/v1/doctors/me/appointments/:appointmentId — get for doctor. Thin HTTP adapter: validated input in, service result out as JSON. */
export const getForDoctor = async (req, res) => res.json({ data: await booking.getForDoctor(req.auth, req.params.appointmentId) });
/** POST /api/v1/doctors/me/appointments/:appointmentId/cancel — cancel for doctor. Thin HTTP adapter: validated input in, service result out as JSON. */
export const cancelForDoctor = async (req, res) => res.json({ data: await booking.cancelForDoctor(req.auth, req.params.appointmentId, req.body) });
