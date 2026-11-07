import { prisma } from '../../config/database.js';
import { ApiError } from '../../utils/ApiError.js';
import * as doctorRepository from '../doctors/doctor.repository.js';
import { assignedDoctorPhotoPath, DOCTOR_READ_STATUSES } from '../medical-history/medicalHistory.constants.js';
import * as realtime from '../notifications/notification.realtime.js';
import * as appointmentRepository from '../appointments/appointment.repository.js';

/**
 * Patient–doctor messages: one text conversation per PAID appointment (CONFIRMED, WAITING, IN_PROGRESS or
 * COMPLETED — the same statuses that let the doctor see the patient's information). Only the patient and
 * the assigned doctor take part; administrators have no access. Writing is open from payment until
 * WINDOW_DAYS after the consultation ends (or the slot ends if no call took place); afterwards the
 * conversation stays readable. Every rule is checked here on every call; the client is never trusted.
 */

export const WINDOW_DAYS = 7;
export const MAX_BODY = 2000;
const PAGE = 50;
const DAY = 86_400_000;

export const MessagingErrorCode = Object.freeze({
  NOT_FOUND: 'CONVERSATION_NOT_FOUND',
  CLOSED: 'CONVERSATION_CLOSED',
  NO_PROFILE: 'MESSAGING_PROFILE_REQUIRED',
});

/** The viewer's side: which profile id to match and who the other person is. */
async function participantOf(auth) {
  if (auth.activeRole === 'PATIENT') {
    const patient = await appointmentRepository.findPatientByUserId(prisma, auth.user.id);
    if (!patient) throw ApiError.forbidden('A patient profile is required', undefined, MessagingErrorCode.NO_PROFILE);
    return { role: 'PATIENT', where: { patientId: patient.id } };
  }
  if (auth.activeRole === 'DOCTOR') {
    const doctor = await doctorRepository.findDoctorByUserId(prisma, auth.user.id);
    if (!doctor) throw ApiError.forbidden('A doctor profile is required', undefined, MessagingErrorCode.NO_PROFILE);
    return { role: 'DOCTOR', where: { doctorId: doctor.id } };
  }
  throw ApiError.forbidden('Messages are for patients and doctors', undefined, MessagingErrorCode.NO_PROFILE);
}

/** When writing closes for an appointment: WINDOW_DAYS after the call ended, else after the slot ended. */
export function closesAt(a) {
  const end = a.consultation?.endedAt ?? a.endAtUtc;
  return new Date(new Date(end).getTime() + WINDOW_DAYS * DAY);
}

/** Whether a conversation accepts new messages now. */
export function isOpen(a, now = new Date()) {
  if (!DOCTOR_READ_STATUSES.includes(a.status)) return false;
  return a.status !== 'COMPLETED' || closesAt(a) > now;
}

const APPOINTMENT_SELECT = {
  id: true,
  status: true,
  startAtUtc: true,
  endAtUtc: true,
  patientId: true,
  doctorId: true,
  consultation: { select: { id: true, endedAt: true } },
  patient: { select: { id: true, userId: true, user: { select: { fullName: true, avatarUpdatedAt: true } } } },
  doctor: { select: { id: true, userId: true, user: { select: { fullName: true, avatarUpdatedAt: true } }, specialty: { select: { nameEn: true, nameSo: true } } } },
};

/** The other participant as the viewer sees them (photo through the existing authorised routes). */
function counterpart(a, role) {
  if (role === 'PATIENT') {
    const u = a.doctor.user;
    return { userId: a.doctor.userId, name: u.fullName, role: 'DOCTOR', specialty: a.doctor.specialty, photoUrl: u.avatarUpdatedAt ? `/v1/doctors/${a.doctor.id}/photo?v=${new Date(u.avatarUpdatedAt).getTime()}` : null };
  }
  const u = a.patient.user;
  return { userId: a.patient.userId, name: u.fullName, role: 'PATIENT', photoUrl: assignedDoctorPhotoPath({ patientId: a.patientId, appointmentId: a.id, status: a.status, avatarUpdatedAt: u.avatarUpdatedAt }) };
}

const presentMessage = (m, userId) => ({ id: m.id, body: m.body, mine: m.senderUserId === userId, createdAt: m.createdAt.toISOString(), readAt: m.readAt?.toISOString() ?? null });

function presentConversation(a, role, { last = null, unread = 0, userId, now }) {
  return {
    appointmentId: a.id,
    appointmentStatus: a.status,
    startAtUtc: a.startAtUtc.toISOString(),
    counterpart: counterpart(a, role),
    open: isOpen(a, now),
    closesAt: a.status === 'COMPLETED' ? closesAt(a).toISOString() : null,
    lastMessage: last ? presentMessage(last, userId) : null,
    unread,
  };
}

/** The viewer's eligible appointment, or the same 404 for anything else (never reveals other people's). */
async function loadConversation(auth, appointmentId) {
  const me = await participantOf(auth);
  const a = await prisma.appointment.findFirst({ where: { id: appointmentId, ...me.where, status: { in: DOCTOR_READ_STATUSES } }, select: APPOINTMENT_SELECT });
  if (!a) throw new ApiError(404, 'Conversation not found', undefined, MessagingErrorCode.NOT_FOUND);
  return { me, a };
}

const unreadWhere = (userId) => ({ senderUserId: { not: userId }, readAt: null });

/**
 * GET /api/v1/messages/conversations — the viewer's conversations: every paid appointment that has
 * messages or is still open for writing, most recent activity first.
 */
export async function listConversations(auth, now = new Date()) {
  const me = await participantOf(auth);
  const userId = auth.user.id;
  const appointments = await prisma.appointment.findMany({
    where: { ...me.where, status: { in: DOCTOR_READ_STATUSES } },
    select: APPOINTMENT_SELECT,
    orderBy: { startAtUtc: 'desc' },
    take: 500,
  });
  const ids = appointments.map((a) => a.id);
  const [lastRows, unreadRows] = await Promise.all([
    ids.length
      ? prisma.message.findMany({ where: { appointmentId: { in: ids } }, distinct: ['appointmentId'], orderBy: [{ appointmentId: 'asc' }, { createdAt: 'desc' }], select: { id: true, appointmentId: true, body: true, senderUserId: true, createdAt: true, readAt: true } })
      : [],
    ids.length ? prisma.message.groupBy({ by: ['appointmentId'], where: { appointmentId: { in: ids }, ...unreadWhere(userId) }, _count: { _all: true } }) : [],
  ]);
  const last = new Map(lastRows.map((m) => [m.appointmentId, m]));
  const unread = new Map(unreadRows.map((u) => [u.appointmentId, u._count._all]));
  const items = appointments
    .filter((a) => last.has(a.id) || isOpen(a, now))
    .map((a) => presentConversation(a, me.role, { last: last.get(a.id), unread: unread.get(a.id) ?? 0, userId, now }));
  const activity = (c) => new Date(c.lastMessage?.createdAt ?? c.startAtUtc).getTime();
  items.sort((x, y) => activity(y) - activity(x));
  return { items, unreadTotal: items.reduce((s, c) => s + c.unread, 0), windowDays: WINDOW_DAYS };
}

/** GET /api/v1/messages/conversations/:appointmentId?before=<messageId> — newest PAGE messages before the cursor, oldest first. */
export async function getConversation(auth, appointmentId, { before } = {}, now = new Date()) {
  const { me, a } = await loadConversation(auth, appointmentId);
  const userId = auth.user.id;
  let cursorAt = null;
  if (before) {
    const cursor = await prisma.message.findFirst({ where: { id: before, appointmentId }, select: { createdAt: true } });
    if (!cursor) throw ApiError.badRequest('Unknown cursor', [{ path: 'before', message: 'Unknown message' }], 'VALIDATION_ERROR');
    cursorAt = cursor.createdAt;
  }
  const rows = await prisma.message.findMany({
    where: { appointmentId, ...(cursorAt ? { createdAt: { lt: cursorAt } } : {}) },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: PAGE + 1,
    select: { id: true, body: true, senderUserId: true, createdAt: true, readAt: true },
  });
  const hasMore = rows.length > PAGE;
  const unread = await prisma.message.count({ where: { appointmentId, ...unreadWhere(userId) } });
  return {
    conversation: presentConversation(a, me.role, { unread, userId, now }),
    messages: rows.slice(0, PAGE).reverse().map((m) => presentMessage(m, userId)),
    hasMore,
  };
}

/** POST /api/v1/messages/conversations/:appointmentId/messages — text only, while the conversation is open. */
export async function sendMessage(auth, appointmentId, { body }, now = new Date()) {
  const { a } = await loadConversation(auth, appointmentId);
  if (!isOpen(a, now)) throw ApiError.conflict('This conversation is closed', { closedAt: closesAt(a).toISOString() }, MessagingErrorCode.CLOSED);
  const text = body.trim();
  const message = await prisma.message.create({
    data: { appointmentId, consultationId: a.consultation?.id ?? null, senderUserId: auth.user.id, body: text, createdAt: now },
    select: { id: true, body: true, senderUserId: true, createdAt: true, readAt: true },
  });
  const recipient = auth.user.id === a.patient.userId ? a.doctor.userId : a.patient.userId;
  realtime.publish(recipient, { type: 'message', appointmentId, messageId: message.id });
  realtime.publish(auth.user.id, { type: 'message', appointmentId, messageId: message.id }); // the sender's other tabs
  return presentMessage(message, auth.user.id);
}

/** POST /api/v1/messages/conversations/:appointmentId/read — marks the other person's messages as read. */
export async function markRead(auth, appointmentId, now = new Date()) {
  const { a } = await loadConversation(auth, appointmentId);
  const { count } = await prisma.message.updateMany({ where: { appointmentId, ...unreadWhere(auth.user.id) }, data: { readAt: now } });
  if (count) {
    const other = auth.user.id === a.patient.userId ? a.doctor.userId : a.patient.userId;
    realtime.publish(other, { type: 'message-read', appointmentId }); // their "seen" ticks
    realtime.publish(auth.user.id, { type: 'message-read', appointmentId }); // my badge on other tabs
  }
  return { marked: count };
}

/** GET /api/v1/messages/unread-count — unread messages across the viewer's conversations (menu badge). */
export async function unreadCount(auth) {
  const me = await participantOf(auth);
  const total = await prisma.message.count({ where: { appointment: { ...me.where, status: { in: DOCTOR_READ_STATUSES } }, ...unreadWhere(auth.user.id) } });
  return { unreadMessages: total };
}
