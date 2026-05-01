export type LetterLanguage = "en" | "tr" | "fr" | "ar" | "de" | "es";

export interface SessionFormData {
  patientCode: string;
  letterLanguage: LetterLanguage;
  consentGranted: boolean;
}

export interface ConsultationArtifacts {
  transcriptRaw: string;
  doctorReportTr: string;
  patientLetter: string;
  doctorPdfFileName: string;
  patientLetterPdfFileName: string;
  generatedAtIso: string;
  deleteAtIso: string;
}

export interface RetentionRecord {
  id: string;
  fileNames: string[];
  deleteAtIso: string;
}
