import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';

/**
 * Official prescription PDF, rendered ONLY from the saved database record (never from client input).
 * Built-in Helvetica (WinAnsi) covers English and Somali (Latin script), so no font files are needed.
 * The document is generated once, at issue, then stored privately with its SHA-256; it is never re-rendered.
 */
const LABELS = {
  en: {
    title: 'Medical prescription',
    reference: 'Reference',
    issued: 'Issued',
    patient: 'Patient',
    dob: 'Date of birth',
    doctor: 'Prescribing doctor',
    specialty: 'Specialty',
    licence: 'Licence',
    verifiedDoctor: 'Licence verified by Fogaan Dawo',
    medicines: 'Medicines',
    medicine: 'Medicine',
    dose: 'Dosage',
    frequency: 'Frequency',
    duration: 'Duration',
    quantity: 'Quantity',
    instructions: 'Instructions',
    warnings: 'Warnings',
    notes: 'Notes from the doctor',
    replaces: 'Replaces prescription',
    signature: 'Digitally signed by',
    signatureNote: 'Issued electronically through Fogaan Dawo. The QR code confirms this prescription is genuine and shows its current status.',
    scan: 'Scan to verify',
    footer: 'Fogaan Dawo — Healthcare Without Borders. This document contains confidential medical information.',
    page: 'Page',
  },
  so: {
    title: 'Warqadda daawada',
    reference: 'Tixraac',
    issued: 'La bixiyay',
    patient: 'Bukaanka',
    dob: 'Taariikhda dhalashada',
    doctor: 'Dhakhtarka qoray',
    specialty: 'Takhasuska',
    licence: 'Shatiga',
    verifiedDoctor: 'Shatiga waxaa xaqiijisay Fogaan Dawo',
    medicines: 'Daawooyinka',
    medicine: 'Daawada',
    dose: 'Qiyaasta',
    frequency: 'Inta jeer',
    duration: 'Muddada',
    quantity: 'Tirada',
    instructions: 'Tilmaamaha',
    warnings: 'Digniinaha',
    notes: 'Qoraalka dhakhtarka',
    replaces: 'Wuxuu beddelayaa warqadda',
    signature: 'Saxiix elektaroonig ah',
    signatureNote: 'Waxaa si elektaroonig ah loogu bixiyay Fogaan Dawo. Koodhka QR wuxuu xaqiijinayaa in warqaddani tahay mid sax ah iyo xaaladdeeda hadda.',
    scan: 'Iska sawir si aad u xaqiijiso',
    footer: 'Fogaan Dawo — Daryeel Caafimaad oo aan Xad lahayn. Dukumentigan wuxuu ka kooban yahay xog caafimaad oo qarsoodi ah.',
    page: 'Bog',
  },
};

const NAVY = '#102F46';
const TEAL = '#0E857E';
const MUTED = '#5B6B79';
const LINE = '#D9E2E8';

const fmtDate = (d, lang) =>
  new Intl.DateTimeFormat(lang === 'so' ? 'so-SO' : 'en-GB', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Africa/Mogadishu' }).format(new Date(d));
const fmtDateTime = (d, lang) =>
  new Intl.DateTimeFormat(lang === 'so' ? 'so-SO' : 'en-GB', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Africa/Mogadishu', timeZoneName: 'short' }).format(new Date(d));

/**
 * @param {object} rx  saved prescription (DETAIL_SELECT shape) with reference, issuedAt, items, doctor, patient
 * @param {{ lang?: 'en'|'so', verifyUrl: string }} options
 * @returns {Promise<Buffer>}
 */
export async function renderPrescriptionPdf(rx, { lang = 'en', verifyUrl }) {
  const L = LABELS[lang === 'so' ? 'so' : 'en'];
  const qr = await QRCode.toBuffer(verifyUrl, { errorCorrectionLevel: 'M', margin: 1, width: 240, color: { dark: NAVY, light: '#FFFFFF' } });
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 48, bottom: 64, left: 48, right: 48 },
    bufferPages: true,
    info: { Title: `${L.title} ${rx.reference}`, Author: 'Fogaan Dawo', Subject: L.title, Creator: 'Fogaan Dawo', Producer: 'Fogaan Dawo' },
  });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve, reject) => {
    doc.on('end', resolve);
    doc.on('error', reject);
  });

  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;
  const specialty = rx.doctor.specialty ? (lang === 'so' ? rx.doctor.specialty.nameSo : rx.doctor.specialty.nameEn) : '';

  // Header band with brand + QR.
  doc.rect(0, 0, doc.page.width, 110).fill(NAVY);
  doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(22).text('Fogaan Dawo', left, 34);
  doc.font('Helvetica').fontSize(10).fillColor('#BFE9E4').text(lang === 'so' ? 'Daryeel Caafimaad oo aan Xad lahayn' : 'Healthcare Without Borders', left, 62);
  doc.font('Helvetica-Bold').fontSize(13).fillColor('#FFFFFF').text(L.title.toUpperCase(), left, 82, { characterSpacing: 1 });
  const qrSize = 92;
  doc.roundedRect(doc.page.width - left - qrSize - 8, 9, qrSize + 8, qrSize + 8, 6).fill('#FFFFFF');
  doc.image(qr, doc.page.width - left - qrSize - 4, 13, { width: qrSize, height: qrSize });
  doc.fillColor(MUTED).font('Helvetica').fontSize(7.5).text(L.scan, doc.page.width - left - qrSize - 8, 114, { width: qrSize + 8, align: 'center' });

  // Reference + issue date.
  let y = 132;
  doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(11).text(`${L.reference}: ${rx.reference}`, left, y);
  doc.font('Helvetica').fillColor(MUTED).text(`${L.issued}: ${fmtDateTime(rx.issuedAt, lang)}`, left, y + 15);
  if (rx.replaces?.reference) doc.text(`${L.replaces}: ${rx.replaces.reference}`, left, y + 30);
  y += rx.replaces?.reference ? 54 : 40;

  // Patient / doctor boxes.
  const boxW = (width - 12) / 2;
  const box = (x, title, lines) => {
    doc.roundedRect(x, y, boxW, 78, 6).lineWidth(0.8).stroke(LINE);
    doc.fillColor(TEAL).font('Helvetica-Bold').fontSize(8.5).text(title.toUpperCase(), x + 10, y + 9, { width: boxW - 20, characterSpacing: 0.6 });
    let ly = y + 24;
    for (const [i, line] of lines.entries()) {
      doc.fillColor(i === 0 ? NAVY : MUTED).font(i === 0 ? 'Helvetica-Bold' : 'Helvetica').fontSize(i === 0 ? 11 : 9).text(line, x + 10, ly, { width: boxW - 20, lineBreak: false, ellipsis: true });
      ly += i === 0 ? 16 : 13;
    }
  };
  box(left, L.patient, [rx.patient.user.fullName, ...(rx.patient.dateOfBirth ? [`${L.dob}: ${fmtDate(rx.patient.dateOfBirth, lang)}`] : [])]);
  box(left + boxW + 12, L.doctor, [rx.doctor.user.fullName, `${L.specialty}: ${specialty}`, `${L.licence}: ${rx.doctor.licenceNumber} (${rx.doctor.licenceCountry})`, L.verifiedDoctor]);
  y += 94;

  // Medicines.
  doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(12).text(L.medicines, left, y);
  y += 20;
  rx.items.forEach((it, i) => {
    const lines = [
      `${L.dose}: ${it.dose}    ${L.frequency}: ${it.frequency}    ${L.duration}: ${it.duration}${it.quantity ? `    ${L.quantity}: ${it.quantity}` : ''}`,
      ...(it.instructions ? [`${L.instructions}: ${it.instructions}`] : []),
    ];
    const warnH = it.warnings ? doc.heightOfString(`${L.warnings}: ${it.warnings}`, { width: width - 40 }) + 6 : 0;
    const bodyH = lines.reduce((h, l) => h + doc.font('Helvetica').fontSize(9.5).heightOfString(l, { width: width - 40 }) + 3, 0);
    const blockH = 26 + bodyH + warnH + 8;
    if (y + blockH > doc.page.height - doc.page.margins.bottom - 120) {
      doc.addPage();
      y = doc.page.margins.top;
    }
    doc.roundedRect(left, y, width, blockH, 6).fill('#F4F8FA');
    doc.circle(left + 16, y + 15, 9).fill(TEAL);
    doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(9).text(String(i + 1), left + 7, y + 11, { width: 18, align: 'center' });
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(11.5).text(it.medicineName, left + 32, y + 9, { width: width - 44 });
    let ly = y + 26;
    for (const l of lines) {
      doc.fillColor('#22313D').font('Helvetica').fontSize(9.5).text(l, left + 32, ly, { width: width - 40 });
      ly = doc.y + 3;
    }
    if (it.warnings) doc.fillColor('#B42318').font('Helvetica-Bold').fontSize(9.5).text(`${L.warnings}: ${it.warnings}`, left + 32, ly, { width: width - 40 });
    y += blockH + 8;
  });

  if (rx.generalNotes) {
    if (y > doc.page.height - doc.page.margins.bottom - 180) {
      doc.addPage();
      y = doc.page.margins.top;
    }
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(11).text(L.notes, left, y + 4);
    doc.fillColor('#22313D').font('Helvetica').fontSize(9.5).text(rx.generalNotes, left, doc.y + 4, { width });
    y = doc.y + 10;
  }

  // Signature block.
  if (y > doc.page.height - doc.page.margins.bottom - 110) {
    doc.addPage();
    y = doc.page.margins.top;
  }
  y += 10;
  doc.moveTo(left, y).lineTo(left + width, y).lineWidth(0.8).stroke(LINE);
  doc.fillColor(MUTED).font('Helvetica').fontSize(8.5).text(L.signature, left, y + 10);
  doc.fillColor(NAVY).font('Helvetica-BoldOblique').fontSize(15).text(rx.doctor.user.fullName, left, y + 22);
  doc.fillColor(MUTED).font('Helvetica').fontSize(8.5).text(`${specialty} · ${L.licence} ${rx.doctor.licenceNumber} · ${fmtDateTime(rx.issuedAt, lang)}`, left, y + 42);
  doc.fillColor(MUTED).fontSize(8).text(L.signatureNote, left, y + 58, { width });

  // Footer on every page.
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);
    const fy = doc.page.height - 44;
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0; // writing inside the bottom margin must not add a page
    doc.fillColor(MUTED).font('Helvetica').fontSize(7.5).text(L.footer, left, fy, { width, align: 'center', lineBreak: false });
    doc.text(`${rx.reference}  ·  ${L.page} ${i + 1}/${range.count}`, left, fy + 11, { width, align: 'center', lineBreak: false });
    doc.page.margins.bottom = bottom;
  }
  doc.end();
  await done;
  return Buffer.concat(chunks);
}
