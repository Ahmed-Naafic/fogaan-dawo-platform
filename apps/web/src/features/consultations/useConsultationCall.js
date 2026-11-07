import { useCallback, useEffect, useRef, useState } from 'react';
import { apiSocketUrl } from '@/lib/apiClient';
import * as api from './services/consultationApi';

/*
 * One-to-one WebRTC video consultation (peer-to-peer, STUN only in this phase).
 *
 * - Nothing touches the camera/microphone until start() is called from a user action.
 * - The server decides everything (eligibility, admission, start/end, duration); this hook mirrors its
 *   state and refreshes it whenever the signaling hub says "state-changed".
 * - The doctor is always the offerer: the hub sends the doctor "negotiate" when both are present in a
 *   live call; each new peer connection gets a random session id so stale messages are ignored.
 * - Recovery: ICE "disconnected" → ICE restart after a short grace period; "failed" → the user is told
 *   and can retry or continue with audio only. A dropped signaling socket reconnects with a FRESH ticket.
 * - Poor network: outgoing video bitrate/resolution step down from live statistics.
 * - Cleanup: tracks stopped, peer connection closed, socket closed, timers cleared on leave/end/unmount.
 */

const RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 15000];
const STATS_EVERY_MS = 5000;
const DISCONNECT_GRACE_MS = 4000;

const randomSession = () => {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
};

/** Camera + microphone, degrading to audio only / nothing. Returns { stream, issue }. */
export async function acquireMedia({ audioOnly = false } = {}) {
  if (!window.isSecureContext) return { stream: null, issue: 'INSECURE' };
  if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === 'undefined') return { stream: null, issue: 'UNSUPPORTED' };
  const gum = (constraints) => navigator.mediaDevices.getUserMedia(constraints);
  const denied = (e) => e?.name === 'NotAllowedError' || e?.name === 'SecurityError';
  if (!audioOnly) {
    try {
      return { stream: await gum({ audio: { echoCancellation: true, noiseSuppression: true }, video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' } }), issue: null };
    } catch (error) {
      if (denied(error)) return { stream: null, issue: 'DENIED' };
      try {
        const stream = await gum({ audio: true });
        return { stream, issue: error?.name === 'NotFoundError' || error?.name === 'OverconstrainedError' ? 'NO_CAMERA' : 'CAMERA_UNAVAILABLE' };
      } catch (inner) {
        if (denied(inner)) return { stream: null, issue: 'DENIED' };
        return { stream: null, issue: 'NO_DEVICES' };
      }
    }
  }
  try {
    return { stream: await gum({ audio: true }), issue: null };
  } catch (error) {
    return { stream: null, issue: denied(error) ? 'DENIED' : 'NO_DEVICES' };
  }
}

/** Connection quality from two stats snapshots: 'good' | 'fair' | 'poor'. */
export function qualityFrom({ rtt, lossRatio }) {
  if ((rtt ?? 0) > 0.6 || lossRatio > 0.08) return 'poor';
  if ((rtt ?? 0) > 0.3 || lossRatio > 0.03) return 'fair';
  return 'good';
}

const BITRATE = { good: null, fair: 400_000, poor: 150_000 };

export default function useConsultationCall({ appointmentId, role }) {
  const [consultation, setConsultation] = useState(null);
  const [phase, setPhase] = useState('idle'); // idle | starting | active | left | ended | replaced | error
  const [error, setError] = useState(null); // { code, details }
  const [mediaIssue, setMediaIssue] = useState(null);
  const [localStream, setLocalStream] = useState(null);
  const [mic, setMic] = useState(true);
  const [camera, setCamera] = useState(true);
  const [remoteStream, setRemoteStream] = useState(null);
  const [remoteMedia, setRemoteMedia] = useState({ audio: true, video: true });
  const [presence, setPresence] = useState({ patient: false, doctor: false });
  const [iceState, setIceState] = useState('new');
  const [signalState, setSignalState] = useState('closed'); // connecting | open | reconnecting | closed
  const [quality, setQuality] = useState('good');
  const [failed, setFailed] = useState(false);
  const [clockOffset, setClockOffset] = useState(0);

  const r = useRef({}).current; // mutable call objects: pc, ws, stream, iceServers, session, timers…

  /* ---------------------------------------------------------------- helpers */

  const sendSignal = useCallback(
    (msg) => {
      if (r.ws?.readyState === WebSocket.OPEN) r.ws.send(JSON.stringify(msg));
    },
    [r],
  );

  /** Tells the other side whether our mic / camera are on (shown as "muted" / "camera off"). */
  const announceMedia = useCallback(() => {
    sendSignal({ type: 'media', audio: Boolean(r.mic), video: Boolean(r.camera) && Boolean(r.stream?.getVideoTracks().length) });
  }, [r, sendSignal]);

  const applyState = useCallback(
    (state) => {
      if (!state) return;
      r.consultationId = state.id;
      setConsultation(state);
      setPresence(state.presence ?? { patient: false, doctor: false });
      if (state.serverTime) setClockOffset(new Date(state.serverTime).getTime() - Date.now());
      if (state.status === 'COMPLETED' || state.status === 'CANCELLED') setPhase('ended');
    },
    [r],
  );

  const closePeer = useCallback(() => {
    clearTimeout(r.disconnectTimer);
    clearInterval(r.statsTimer);
    if (r.pc) {
      r.pc.onicecandidate = null;
      r.pc.ontrack = null;
      r.pc.oniceconnectionstatechange = null;
      r.pc.close();
    }
    r.pc = null;
    r.session = null;
    r.pendingCandidates = [];
    r.remote = null;
    r.lastStats = null;
    setRemoteStream(null);
    setIceState('new');
  }, [r]);

  const teardown = useCallback(() => {
    r.disposed = true;
    clearTimeout(r.reconnectTimer);
    closePeer();
    if (r.ws) {
      r.ws.intentional = true;
      r.ws.close(1000);
      r.ws = null;
    }
    r.stream?.getTracks().forEach((t) => t.stop());
    r.stream = null;
    setLocalStream(null);
    setSignalState('closed');
  }, [closePeer, r]);

  useEffect(() => () => teardown(), [teardown]);

  const refresh = useCallback(async () => {
    if (!r.consultationId) return;
    try {
      applyState(await api.getConsultationState(r.consultationId));
    } catch {
      /* the next state-changed or poll retries */
    }
  }, [applyState, r]);

  /* ---------------------------------------------------------------- media on the wire */

  const attachLocalTracks = useCallback(
    (pc) => {
      const audio = r.stream?.getAudioTracks()[0] ?? null;
      const video = r.stream?.getVideoTracks()[0] ?? null;
      for (const t of pc.getTransceivers()) {
        const kind = t.receiver.track?.kind;
        const track = kind === 'audio' ? audio : kind === 'video' ? video : null;
        t.direction = 'sendrecv';
        t.sender.replaceTrack(track).catch(() => {});
      }
    },
    [r],
  );

  const tuneBitrate = useCallback(
    async (level) => {
      const sender = r.pc?.getSenders().find((s) => s.track?.kind === 'video');
      if (!sender) return;
      const params = sender.getParameters();
      if (!params.encodings?.length) params.encodings = [{}];
      const max = BITRATE[level];
      params.encodings[0].maxBitrate = max ?? undefined;
      params.encodings[0].scaleResolutionDownBy = level === 'poor' ? 2 : 1;
      if (!max) delete params.encodings[0].maxBitrate;
      await sender.setParameters(params).catch(() => {});
    },
    [r],
  );

  const sampleStats = useCallback(async () => {
    if (!r.pc) return;
    const report = await r.pc.getStats().catch(() => null);
    if (!report) return;
    let rtt = null;
    let lost = 0;
    let received = 0;
    report.forEach((s) => {
      if (s.type === 'candidate-pair' && s.nominated && s.state === 'succeeded' && typeof s.currentRoundTripTime === 'number') rtt = s.currentRoundTripTime;
      if (s.type === 'inbound-rtp' && !s.isRemote) {
        lost += s.packetsLost ?? 0;
        received += s.packetsReceived ?? 0;
      }
    });
    const prev = r.lastStats ?? { lost, received };
    r.lastStats = { lost, received };
    const dLost = Math.max(0, lost - prev.lost);
    const dReceived = Math.max(0, received - prev.received);
    const level = qualityFrom({ rtt, lossRatio: dLost + dReceived > 0 ? dLost / (dLost + dReceived) : 0 });
    if (level !== r.quality) {
      r.quality = level;
      setQuality(level);
      tuneBitrate(level);
    }
  }, [r, tuneBitrate]);

  const restartIce = useCallback(async () => {
    if (role !== 'DOCTOR') return sendSignal({ type: 'restart' });
    if (!r.pc || r.pc.signalingState === 'closed') return undefined;
    try {
      const offer = await r.pc.createOffer({ iceRestart: true });
      await r.pc.setLocalDescription(offer);
      sendSignal({ type: 'offer', sdp: r.pc.localDescription.sdp, session: r.session });
    } catch {
      /* the next negotiate starts over */
    }
    return undefined;
  }, [r, role, sendSignal]);

  const createPeer = useCallback(
    (session) => {
      closePeer();
      const pc = new RTCPeerConnection({ iceServers: r.iceServers ?? [] });
      r.pc = pc;
      r.session = session;
      r.pendingCandidates = [];
      r.remote = new MediaStream();
      r.quality = 'good';
      setQuality('good');
      setFailed(false);
      pc.onicecandidate = (e) => {
        sendSignal({ type: 'candidate', session, candidate: e.candidate?.candidate ?? '', sdpMid: e.candidate?.sdpMid ?? null, sdpMLineIndex: e.candidate?.sdpMLineIndex ?? null });
      };
      pc.ontrack = (e) => {
        if (r.pc !== pc) return;
        r.remote.addTrack(e.track);
        setRemoteStream(new MediaStream(r.remote.getTracks()));
      };
      pc.oniceconnectionstatechange = () => {
        if (r.pc !== pc) return;
        const s = pc.iceConnectionState;
        setIceState(s);
        clearTimeout(r.disconnectTimer);
        if (s === 'connected' || s === 'completed') {
          setFailed(false);
          clearInterval(r.statsTimer);
          r.statsTimer = setInterval(sampleStats, STATS_EVERY_MS);
        } else if (s === 'disconnected') {
          r.disconnectTimer = setTimeout(() => {
            if (r.pc === pc && pc.iceConnectionState === 'disconnected') restartIce();
          }, DISCONNECT_GRACE_MS);
        } else if (s === 'failed') {
          setFailed(true);
          restartIce();
        }
      };
      return pc;
    },
    [closePeer, r, restartIce, sampleStats, sendSignal],
  );

  /** Doctor: a brand-new peer connection and offer (new session). */
  const negotiate = useCallback(async () => {
    const session = randomSession();
    const pc = createPeer(session);
    pc.addTransceiver('audio', { direction: 'sendrecv' });
    pc.addTransceiver('video', { direction: 'sendrecv' });
    attachLocalTracks(pc);
    try {
      await pc.setLocalDescription(await pc.createOffer());
      sendSignal({ type: 'offer', sdp: pc.localDescription.sdp, session });
      announceMedia();
    } catch {
      /* closed meanwhile */
    }
  }, [announceMedia, attachLocalTracks, createPeer, sendSignal]);

  const flushCandidates = useCallback(async () => {
    const pc = r.pc;
    const queued = r.pendingCandidates ?? [];
    r.pendingCandidates = [];
    for (const c of queued) await pc?.addIceCandidate(c).catch(() => {});
  }, [r]);

  const onOffer = useCallback(
    async (msg) => {
      let pc = r.pc;
      if (!pc || r.session !== msg.session) pc = createPeer(msg.session);
      try {
        await pc.setRemoteDescription({ type: 'offer', sdp: msg.sdp });
        attachLocalTracks(pc);
        await pc.setLocalDescription(await pc.createAnswer());
        sendSignal({ type: 'answer', sdp: pc.localDescription.sdp, session: msg.session });
        announceMedia();
        await flushCandidates();
      } catch {
        /* a newer offer will follow */
      }
    },
    [announceMedia, attachLocalTracks, createPeer, flushCandidates, r, sendSignal],
  );

  const onSignal = useCallback(
    async (msg) => {
      switch (msg.type) {
        case 'ready':
          setSignalState('open');
          r.attempt = 0;
          refresh();
          break;
        case 'presence':
          setPresence({ patient: msg.patient, doctor: msg.doctor });
          if (!(role === 'DOCTOR' ? msg.patient : msg.doctor)) setRemoteStream(null);
          break;
        case 'state-changed':
          refresh();
          break;
        case 'negotiate':
          if (role === 'DOCTOR') negotiate();
          break;
        case 'restart':
          if (role === 'DOCTOR') restartIce();
          break;
        case 'offer':
          if (role === 'PATIENT') onOffer(msg);
          break;
        case 'answer':
          if (role === 'DOCTOR' && r.pc && msg.session === r.session) {
            await r.pc.setRemoteDescription({ type: 'answer', sdp: msg.sdp }).catch(() => {});
            await flushCandidates();
          }
          break;
        case 'candidate': {
          if (msg.session !== r.session || !r.pc) break;
          const candidate = msg.candidate ? { candidate: msg.candidate, sdpMid: msg.sdpMid, sdpMLineIndex: msg.sdpMLineIndex } : null;
          if (!candidate) break;
          if (r.pc.remoteDescription) await r.pc.addIceCandidate(candidate).catch(() => {});
          else r.pendingCandidates.push(candidate);
          break;
        }
        case 'media':
          setRemoteMedia({ audio: msg.audio, video: msg.video });
          break;
        default:
          break;
      }
    },
    [flushCandidates, negotiate, onOffer, r, refresh, restartIce, role, sendSignal],
  );

  /* ---------------------------------------------------------------- signaling socket */

  const openSocket = useCallback(
    (signaling) => {
      if (r.disposed) return;
      const ws = new WebSocket(apiSocketUrl(signaling.path));
      r.ws = ws;
      setSignalState(r.attempt ? 'reconnecting' : 'connecting');
      ws.onopen = () => ws.send(JSON.stringify({ type: 'auth', ticket: signaling.ticket }));
      ws.onmessage = (e) => {
        let msg;
        try {
          msg = JSON.parse(e.data);
        } catch {
          return;
        }
        onSignal(msg);
      };
      ws.onclose = (e) => {
        if (r.ws !== ws || ws.intentional || r.disposed) return;
        r.ws = null;
        if (e.code === 4010) {
          closePeer();
          refresh();
          setPhase('ended');
          return;
        }
        if (e.code === 4009) {
          teardown();
          setPhase('replaced');
          return;
        }
        // Network drop or rejected/expired ticket: reconnect with a FRESH ticket, with back-off
        // (an established peer-to-peer call keeps running meanwhile).
        setSignalState('reconnecting');
        const retry = () => {
          const delay = RECONNECT_DELAYS[Math.min(r.attempt ?? 0, RECONNECT_DELAYS.length - 1)];
          r.attempt = (r.attempt ?? 0) + 1;
          r.reconnectTimer = setTimeout(async () => {
            if (r.disposed) return;
            try {
              const fresh = await api.newSignalingTicket(r.consultationId);
              r.iceServers = fresh.iceServers;
              openSocket(fresh.signaling);
            } catch (err) {
              if (['CONSULTATION_ENDED', 'CONSULTATION_TOO_LATE', 'CONSULTATION_NOT_JOINABLE'].includes(err.code)) {
                teardown();
                await refresh();
                setPhase(err.code === 'CONSULTATION_ENDED' ? 'ended' : 'error');
                if (err.code !== 'CONSULTATION_ENDED') setError({ code: err.code, details: err.details });
              } else {
                retry();
              }
            }
          }, delay);
        };
        retry();
      };
    },
    [closePeer, onSignal, r, refresh, teardown],
  );

  /* ---------------------------------------------------------------- actions */

  /** Joins (user action): media first, then the server join, then signaling. */
  const start = useCallback(
    async ({ withoutDevices = false, audioOnly = false } = {}) => {
      r.disposed = false;
      setPhase('starting');
      setError(null);
      setMediaIssue(null);
      let stream = null;
      if (!withoutDevices) {
        const media = await acquireMedia({ audioOnly });
        if (media.issue === 'DENIED' || media.issue === 'INSECURE' || media.issue === 'UNSUPPORTED') {
          setMediaIssue(media.issue);
          setPhase('idle');
          return;
        }
        stream = media.stream;
        setMediaIssue(media.issue);
      }
      r.stream = stream;
      r.mic = Boolean(stream?.getAudioTracks().length);
      r.camera = Boolean(stream?.getVideoTracks().length);
      setMic(r.mic);
      setCamera(r.camera);
      setLocalStream(stream);
      try {
        const joined = await api.joinConsultation(appointmentId);
        if (r.disposed) return;
        r.iceServers = joined.iceServers;
        r.attempt = 0;
        applyState(joined.consultation);
        setPhase(joined.consultation.status === 'COMPLETED' ? 'ended' : 'active');
        openSocket(joined.signaling);
      } catch (err) {
        teardown();
        setError({ code: err.code ?? 'GENERIC', details: err.details });
        setPhase('error');
      }
    },
    [appointmentId, applyState, openSocket, r, teardown],
  );

  const toggleMic = useCallback(() => {
    const track = r.stream?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    r.mic = track.enabled;
    setMic(track.enabled);
    sendSignal({ type: 'media', audio: r.mic, video: Boolean(r.camera) });
  }, [r, sendSignal]);

  const toggleCamera = useCallback(() => {
    const track = r.stream?.getVideoTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    r.camera = track.enabled;
    setCamera(track.enabled);
    sendSignal({ type: 'media', audio: Boolean(r.mic), video: r.camera });
  }, [r, sendSignal]);

  /** Drops outgoing video entirely (frees bandwidth) and retries the connection. */
  const switchToAudioOnly = useCallback(() => {
    r.pc?.getSenders().forEach((s) => {
      if (s.track?.kind === 'video') s.replaceTrack(null).catch(() => {});
    });
    r.stream?.getVideoTracks().forEach((t) => {
      t.stop();
      r.stream.removeTrack(t);
    });
    r.camera = false;
    setCamera(false);
    setLocalStream(r.stream ? new MediaStream(r.stream.getTracks()) : null);
    sendSignal({ type: 'media', audio: Boolean(r.mic), video: false });
    restartIce();
  }, [r, restartIce, sendSignal]);

  const retryConnection = useCallback(() => {
    setFailed(false);
    if (role === 'DOCTOR') negotiate();
    else sendSignal({ type: 'restart' });
  }, [negotiate, role, sendSignal]);

  const run = useCallback(
    async (fn) => {
      try {
        applyState(await fn(r.consultationId));
        return true;
      } catch (err) {
        setError({ code: err.code ?? 'GENERIC', details: err.details, transient: true });
        await refresh();
        return false;
      }
    },
    [applyState, r, refresh],
  );

  const admit = useCallback(() => run(api.admitPatient), [run]);
  const reject = useCallback(() => run(api.rejectPatient), [run]);

  const leave = useCallback(async () => {
    const id = r.consultationId;
    teardown();
    setPhase('left');
    if (id) await api.leaveConsultation(id).catch(() => {});
  }, [r, teardown]);

  const end = useCallback(async () => {
    const ok = await run(api.endConsultation);
    if (ok) {
      teardown();
      setPhase('ended');
    }
    return ok;
  }, [run, teardown]);

  const saveNote = useCallback(async (note) => {
    const saved = await api.saveConsultationNote(r.consultationId, note);
    return saved;
  }, [r]);

  return {
    phase,
    consultation,
    error,
    clearError: () => setError(null),
    mediaIssue,
    localStream,
    mic,
    camera,
    hasAudio: Boolean(localStream?.getAudioTracks().length),
    hasVideo: Boolean(localStream?.getVideoTracks().length),
    remoteStream,
    remoteMedia,
    presence,
    iceState,
    signalState,
    quality,
    failed,
    clockOffset,
    start,
    toggleMic,
    toggleCamera,
    switchToAudioOnly,
    retryConnection,
    admit,
    reject,
    leave,
    end,
    saveNote,
  };
}
