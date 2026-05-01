import { jsPDF } from "jspdf";
import type { ConsultationArtifacts, LetterLanguage, RetentionRecord } from "../types";

const RETENTION_KEY = "consultation_retention_records";

function isoNow(): string {
  return new Date().toISOString();
}

function addHours(dateIso: string, hours: number): string {
  const date = new Date(dateIso);
  date.setHours(date.getHours() + hours);
  return date.toISOString();
}

function normalizeTranscript(transcript: string): string {
  return transcript.replace(/\s+/g, " ").trim();
}

function buildDoctorReportTr(transcript: string, patientCode: string): string {
  return [
    `Hasta Kodu: ${patientCode || "Belirtilmedi"}`,
    "",
    "Basvuru Nedeni:",
    "Gorusmede paylasilan sikayetler ve IVF surecine dair beklentiler degerlendirildi.",
    "",
    "Klinik Ozet:",
    normalizeTranscript(transcript),
    "",
    "Plan:",
    "- Klinik gecmis teyidi",
    "- Gerekli tetkiklerin planlanmasi",
    "- Takip gorusmesi icin tarih belirlenmesi",
    "",
    "Not:",
    "Bu rapor klinik dokumantasyon amaclidir.",
  ].join("\n");
}

function languageLabel(language: LetterLanguage): string {
  const map: Record<LetterLanguage, string> = {
    en: "English",
    tr: "Turkish",
    fr: "French",
    ar: "Arabic",
    de: "German",
    es: "Spanish",
  };
  return map[language];
}

function buildPatientLetter(language: LetterLanguage, transcript: string): string {
  const core = normalizeTranscript(transcript);
  return [
    `Consultation Summary Letter (${languageLabel(language)})`,
    "",
    "Dear Patient,",
    "Thank you for attending your consultation today.",
    "We reviewed your current concerns and discussed your IVF care pathway in detail.",
    "",
    "Key points from our discussion:",
    `- ${core}`,
    "- Your next steps include planned tests and a follow-up consultation.",
    "",
    "Please contact the clinic promptly if your symptoms change or worsen.",
    "",
    "Kind regards,",
    "Dr. Senai Aksoy Team",
  ].join("\n");
}

function downloadPdf(fileName: string, title: string, body: string): void {
  const doc = new jsPDF();
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text(title, 14, 18);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  const lines = doc.splitTextToSize(body, 180);
  doc.text(lines, 14, 28);
  doc.save(fileName);
}

function loadRetentionRecords(): RetentionRecord[] {
  const raw = localStorage.getItem(RETENTION_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as RetentionRecord[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveRetentionRecords(records: RetentionRecord[]): void {
  localStorage.setItem(RETENTION_KEY, JSON.stringify(records));
}

export function runRetentionCleanup(now = new Date()): RetentionRecord[] {
  const records = loadRetentionRecords();
  const pending = records.filter((record) => new Date(record.deleteAtIso) > now);
  saveRetentionRecords(pending);
  return pending;
}

export function startRetentionScheduler(): void {
  runRetentionCleanup();
  window.setInterval(() => runRetentionCleanup(), 10 * 60 * 1000);
}

export async function processConsultation(input: {
  patientCode: string;
  letterLanguage: LetterLanguage;
  transcriptRaw: string;
}): Promise<ConsultationArtifacts> {
  const generatedAtIso = isoNow();
  const deleteAtIso = addHours(generatedAtIso, 24);

  const doctorReportTr = buildDoctorReportTr(input.transcriptRaw, input.patientCode);
  const patientLetter = buildPatientLetter(input.letterLanguage, input.transcriptRaw);

  const safePatientCode = (input.patientCode || "hasta").replace(/[^\w-]/g, "_");
  const doctorPdfFileName = `doktor-raporu-${safePatientCode}-${Date.now()}.pdf`;
  const patientLetterPdfFileName = `hasta-mektubu-${safePatientCode}-${Date.now()}.pdf`;

  downloadPdf(doctorPdfFileName, "Doktor Gorusme Raporu", doctorReportTr);
  downloadPdf(patientLetterPdfFileName, "Patient Consultation Letter", patientLetter);

  const records = loadRetentionRecords();
  records.push({
    id: crypto.randomUUID(),
    fileNames: [doctorPdfFileName, patientLetterPdfFileName],
    deleteAtIso,
  });
  saveRetentionRecords(records);

  return {
    transcriptRaw: input.transcriptRaw,
    doctorReportTr,
    patientLetter,
    doctorPdfFileName,
    patientLetterPdfFileName,
    generatedAtIso,
    deleteAtIso,
  };
}
