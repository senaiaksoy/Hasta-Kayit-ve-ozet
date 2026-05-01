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
  driveFileIds: string[];
}

export type TranscriptionProvider = "whisper" | "deepgram";

export interface IntegrationsConfig {
  transcriptionProvider: TranscriptionProvider;
  transcriptionApiKey: string;
  driveServiceAccountJson: string;
  driveTempFolderName: string;
  gmailClientId: string;
  gmailClientSecret: string;
  gmailRefreshToken: string;
}

export interface SecureConfigPayload extends IntegrationsConfig {}
