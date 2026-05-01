import { invoke } from "@tauri-apps/api/core";
import { jsPDF } from "jspdf";
import type {
  ConsultationArtifacts,
  IntegrationsConfig,
  LetterLanguage,
  TranscriptionProvider,
} from "../types";

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
    "Gorusme boyunca infertilite sureci, onceki denemeler ve mevcut beklentiler ele alindi.",
    "",
    "Klinik Ozet:",
    normalizeTranscript(transcript),
    "",
    "Plan:",
    "- Onceki raporlarin klinik teyidi",
    "- Gereken tetkik ve laboratuvar adimlarinin planlanmasi",
    "- Tedavi takvimi icin kontrol gorusmesi",
    "",
    "Not:",
    "Bu dokuman bilgi ve klinik takip amaclidir.",
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
    "Thank you for meeting with us today.",
    "We carefully reviewed your history, current concerns, and treatment options in a clear step-by-step way.",
    "",
    "What we discussed:",
    `- ${core}`,
    "- The next clinical step is to complete planned investigations and review the results together.",
    "",
    "If you develop new or worsening symptoms, please contact us promptly.",
    "",
    "Warm regards,",
    "Dr. Senai Aksoy Team",
  ].join("\n");
}

function buildPdfBytes(title: string, body: string): Uint8Array {
  const doc = new jsPDF();
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text(title, 14, 18);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  const lines = doc.splitTextToSize(body, 180);
  doc.text(lines, 14, 28);
  const buffer = doc.output("arraybuffer") as ArrayBuffer;
  return new Uint8Array(buffer);
}

function downloadPdf(fileName: string, bytes: Uint8Array): void {
  const blob = new Blob([bytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary);
}

function providerToRust(provider: TranscriptionProvider): string {
  return provider === "deepgram" ? "deepgram" : "whisper";
}

export async function runRetentionCleanup(): Promise<number> {
  return invoke<number>("run_retention_cleanup");
}

export function startRetentionScheduler(): void {
  runRetentionCleanup().catch(() => {});
  window.setInterval(() => {
    runRetentionCleanup().catch(() => {});
  }, 10 * 60 * 1000);
}

export async function processConsultation(input: {
  patientCode: string;
  letterLanguage: LetterLanguage;
  audioFile: File;
  config: IntegrationsConfig;
}): Promise<ConsultationArtifacts> {
  const generatedAtIso = isoNow();
  const deleteAtIso = addHours(generatedAtIso, 24);
  const safePatientCode = (input.patientCode || "hasta").replace(/[^\w-]/g, "_");

  const audioBytes = new Uint8Array(await input.audioFile.arrayBuffer());
  const audioB64 = toBase64(audioBytes);

  const transcriptRaw = await invoke<string>("transcribe_audio", {
    provider: providerToRust(input.config.transcriptionProvider),
    apiKey: input.config.transcriptionApiKey,
    audioFileName: input.audioFile.name,
    audioBase64: audioB64,
  });

  const doctorReportTr = buildDoctorReportTr(transcriptRaw, input.patientCode);
  const patientLetter = buildPatientLetter(input.letterLanguage, transcriptRaw);

  const stamp = Date.now();
  const doctorPdfFileName = `doktor-raporu-${safePatientCode}-${stamp}.pdf`;
  const patientLetterPdfFileName = `hasta-mektubu-${safePatientCode}-${stamp}.pdf`;

  const doctorPdfBytes = buildPdfBytes("Doktor Gorusme Raporu", doctorReportTr);
  const patientPdfBytes = buildPdfBytes("Patient Consultation Letter", patientLetter);

  downloadPdf(doctorPdfFileName, doctorPdfBytes);
  downloadPdf(patientLetterPdfFileName, patientPdfBytes);

  const driveFileIds = await invoke<string[]>("deliver_consultation_artifacts", {
    request: {
      driveServiceAccountJson: input.config.driveServiceAccountJson,
      driveTempFolderName: input.config.driveTempFolderName,
      deleteAtIso,
      originalAudioFileName: input.audioFile.name,
      originalAudioBase64: audioB64,
      recipientEmail: "drsenaiaksoy@gmail.com",
      gmailClientId: input.config.gmailClientId,
      gmailClientSecret: input.config.gmailClientSecret,
      gmailRefreshToken: input.config.gmailRefreshToken,
      emailSubject: `Konsultasyon Raporu - ${safePatientCode}`,
      emailBodyText:
        "Eklerde doktor raporu ve hasta gorusme ozeti yer almaktadir. Ses kaydi 24 saat sonra Drive uzerinden otomatik silinecektir.",
      attachments: [
        {
          fileName: doctorPdfFileName,
          mimeType: "application/pdf",
          contentBase64: toBase64(doctorPdfBytes),
        },
        {
          fileName: patientLetterPdfFileName,
          mimeType: "application/pdf",
          contentBase64: toBase64(patientPdfBytes),
        },
      ],
    },
  });

  return {
    transcriptRaw,
    doctorReportTr,
    patientLetter,
    doctorPdfFileName,
    patientLetterPdfFileName,
    generatedAtIso,
    deleteAtIso,
    driveFileIds,
  };
}
