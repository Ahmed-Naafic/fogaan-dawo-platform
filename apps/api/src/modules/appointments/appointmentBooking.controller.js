import * as booking from './appointmentBooking.service.js';

/** Thin controllers: the signed-in user is the patient or doctor; ids in the URL are ownership-checked. */

export const book = async (req, res) => res.status(201).json({ data: await booking.bookSlot(req.auth, req.body) });
export const listMine = async (req, res) => res.json({ data: await booking.listMine(req.auth, req.validatedQuery) });
export const getMine = async (req, res) => res.json({ data: await booking.getMine(req.auth, req.params.appointmentId) });
export const cancelMine = async (req, res) => res.json({ data: await booking.cancelMine(req.auth, req.params.appointmentId, req.body) });
export const rescheduleMine = async (req, res) => res.json({ data: await booking.rescheduleMine(req.auth, req.params.appointmentId, req.body) });

export const listForDoctor = async (req, res) => res.json({ data: await booking.listForDoctor(req.auth, req.validatedQuery) });
export const getForDoctor = async (req, res) => res.json({ data: await booking.getForDoctor(req.auth, req.params.appointmentId) });
export const cancelForDoctor = async (req, res) => res.json({ data: await booking.cancelForDoctor(req.auth, req.params.appointmentId, req.body) });
