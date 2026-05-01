import "./styles.css";
import { invoke } from "@tauri-apps/api/core";
import { processConsultation, startRetentionScheduler } from "./services/pipeline";
import type {
  IntegrationsConfig,
  LetterLanguage,
  SecureConfigPayload,
  TranscriptionProvider,
} from "./types";

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("App root not found.");
}

app.innerHTML = `
  <main class="container">
    <h1>Hasta Gorusme Asistani</h1>
    <p class="subtitle">Cok dilli konusma, Turkce doktor raporu, hasta mektubu ve PDF ciktilari.</p>

    <form id="session-form" class="card">
      <label>Hasta kodu (opsiyonel)</label>
      <input id="patient-code" placeholder="Orn: HK-2026-051" />

      <label>Hasta mektubu dili (zorunlu)</label>
      <select id="letter-language" required>
        <option value="">Dil seciniz</option>
        <option value="en">English</option>
        <option value="tr">Turkce</option>
        <option value="fr">Francais</option>
        <option value="ar">Arabic</option>
        <option value="de">Deutsch</option>
        <option value="es">Espanol</option>
      </select>

      <label class="checkbox">
        <input id="consent" type="checkbox" />
        Kayit, transkripsiyon ve raporlama onamini aldim.
      </label>

      <label>Ses dosyasi (wav/mp3/m4a)</label>
      <input id="audio-file" type="file" accept="audio/*" />

      <label>Transkripsiyon servisi</label>
      <select id="transcription-provider">
        <option value="whisper">Whisper</option>
        <option value="deepgram">Deepgram</option>
      </select>

      <label>Transkripsiyon API key</label>
      <input id="transcription-api-key" type="password" />

      <label>Google Drive service account JSON</label>
      <textarea id="drive-sa-json" rows="5" placeholder='{"type":"service_account", ...}'></textarea>

      <label>Drive gecici klasor adi</label>
      <input id="drive-folder" value="hasta-kayit-temp" />

      <label>Gmail OAuth Client ID</label>
      <input id="gmail-client-id" />

      <label>Gmail OAuth Client Secret</label>
      <input id="gmail-client-secret" type="password" />

      <label>Gmail OAuth Refresh Token</label>
      <input id="gmail-refresh-token" type="password" />

      <p class="fixed-recipient">Sabit alici: drsenaiaksoy@gmail.com</p>

      <div class="actions">
        <button id="save-config-btn" type="button">Ayarları Sifreli Kaydet</button>
        <button id="load-config-btn" type="button">Kayitli Ayarlari Yukle</button>
        <button id="start-btn" type="button">Kaydi Baslat</button>
        <button id="stop-btn" type="button" disabled>Kaydi Durdur ve Isle</button>
      </div>
    </form>

    <section class="card">
      <h2>Durum</h2>
      <p id="status">Hazir.</p>
      <p id="timer">00:00</p>
    </section>

    <section class="card">
      <h2>Son Uretilen Cikti</h2>
      <pre id="output">Henuz rapor uretilmedi.</pre>
    </section>
  </main>
`;

const patientCodeEl = document.querySelector<HTMLInputElement>("#patient-code");
const letterLanguageEl = document.querySelector<HTMLSelectElement>("#letter-language");
const consentEl = document.querySelector<HTMLInputElement>("#consent");
const audioFileEl = document.querySelector<HTMLInputElement>("#audio-file");
const transcriptionProviderEl = document.querySelector<HTMLSelectElement>("#transcription-provider");
const transcriptionApiKeyEl = document.querySelector<HTMLInputElement>("#transcription-api-key");
const driveSaJsonEl = document.querySelector<HTMLTextAreaElement>("#drive-sa-json");
const driveFolderEl = document.querySelector<HTMLInputElement>("#drive-folder");
const gmailClientIdEl = document.querySelector<HTMLInputElement>("#gmail-client-id");
const gmailClientSecretEl = document.querySelector<HTMLInputElement>("#gmail-client-secret");
const gmailRefreshTokenEl = document.querySelector<HTMLInputElement>("#gmail-refresh-token");
const saveConfigBtn = document.querySelector<HTMLButtonElement>("#save-config-btn");
const loadConfigBtn = document.querySelector<HTMLButtonElement>("#load-config-btn");
const startBtn = document.querySelector<HTMLButtonElement>("#start-btn");
const stopBtn = document.querySelector<HTMLButtonElement>("#stop-btn");
const statusEl = document.querySelector<HTMLElement>("#status");
const timerEl = document.querySelector<HTMLElement>("#timer");
const outputEl = document.querySelector<HTMLElement>("#output");

let recording = false;
let seconds = 0;
let timerHandle: number | null = null;

function setStatus(text: string): void {
  if (statusEl) statusEl.textContent = text;
}

function setTimerLabel(totalSeconds: number): void {
  if (!timerEl) return;
  const mm = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const ss = String(totalSeconds % 60).padStart(2, "0");
  timerEl.textContent = `${mm}:${ss}`;
}

function getFormData():
  | {
      ok: true;
      patientCode: string;
      letterLanguage: LetterLanguage;
      audioFile: File;
      config: IntegrationsConfig;
    }
  | { ok: false; message: string } {
  const patientCode = patientCodeEl?.value?.trim() ?? "";
  const letterLanguage = letterLanguageEl?.value as LetterLanguage;
  const consentGranted = Boolean(consentEl?.checked);
  const audioFile = audioFileEl?.files?.[0];

  const transcriptionProvider = (transcriptionProviderEl?.value || "whisper") as TranscriptionProvider;
  const transcriptionApiKey = transcriptionApiKeyEl?.value?.trim() ?? "";
  const driveServiceAccountJson = driveSaJsonEl?.value?.trim() ?? "";
  const driveTempFolderName = driveFolderEl?.value?.trim() || "hasta-kayit-temp";
  const gmailClientId = gmailClientIdEl?.value?.trim() ?? "";
  const gmailClientSecret = gmailClientSecretEl?.value?.trim() ?? "";
  const gmailRefreshToken = gmailRefreshTokenEl?.value?.trim() ?? "";

  if (!letterLanguage) {
    return { ok: false, message: "Hasta mektubu dili secilmelidir." };
  }
  if (!consentGranted) {
    return { ok: false, message: "Onam kutusu isaretlenmelidir." };
  }
  if (!audioFile) {
    return { ok: false, message: "Ses dosyasi secilmelidir." };
  }
  if (!transcriptionApiKey) {
    return { ok: false, message: "Transkripsiyon API key girilmelidir." };
  }
  if (!driveServiceAccountJson) {
    return { ok: false, message: "Drive service account JSON gereklidir." };
  }
  if (!gmailClientId || !gmailClientSecret || !gmailRefreshToken) {
    return { ok: false, message: "Gmail OAuth bilgileri eksik." };
  }

  return {
    ok: true,
    patientCode,
    letterLanguage,
    audioFile,
    config: {
      transcriptionProvider,
      transcriptionApiKey,
      driveServiceAccountJson,
      driveTempFolderName,
      gmailClientId,
      gmailClientSecret,
      gmailRefreshToken,
    },
  };
}

function buildConfigPayload(): SecureConfigPayload | null {
  const transcriptionProvider = (transcriptionProviderEl?.value || "whisper") as TranscriptionProvider;
  const transcriptionApiKey = transcriptionApiKeyEl?.value?.trim() ?? "";
  const driveServiceAccountJson = driveSaJsonEl?.value?.trim() ?? "";
  const driveTempFolderName = driveFolderEl?.value?.trim() || "hasta-kayit-temp";
  const gmailClientId = gmailClientIdEl?.value?.trim() ?? "";
  const gmailClientSecret = gmailClientSecretEl?.value?.trim() ?? "";
  const gmailRefreshToken = gmailRefreshTokenEl?.value?.trim() ?? "";

  if (
    !transcriptionApiKey ||
    !driveServiceAccountJson ||
    !gmailClientId ||
    !gmailClientSecret ||
    !gmailRefreshToken
  ) {
    return null;
  }

  return {
    transcriptionProvider,
    transcriptionApiKey,
    driveServiceAccountJson,
    driveTempFolderName,
    gmailClientId,
    gmailClientSecret,
    gmailRefreshToken,
  };
}

function fillConfigForm(config: SecureConfigPayload): void {
  if (transcriptionProviderEl) transcriptionProviderEl.value = config.transcriptionProvider;
  if (transcriptionApiKeyEl) transcriptionApiKeyEl.value = config.transcriptionApiKey;
  if (driveSaJsonEl) driveSaJsonEl.value = config.driveServiceAccountJson;
  if (driveFolderEl) driveFolderEl.value = config.driveTempFolderName;
  if (gmailClientIdEl) gmailClientIdEl.value = config.gmailClientId;
  if (gmailClientSecretEl) gmailClientSecretEl.value = config.gmailClientSecret;
  if (gmailRefreshTokenEl) gmailRefreshTokenEl.value = config.gmailRefreshToken;
}

saveConfigBtn?.addEventListener("click", async () => {
  const payload = buildConfigPayload();
  if (!payload) {
    setStatus("Kayit icin tum entegrasyon alanlari doldurulmalidir.");
    return;
  }
  try {
    await invoke("save_secure_config", { config: payload });
    setStatus("Ayarlar sifreli olarak kaydedildi.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sifreli kayit hatasi.";
    setStatus(`Hata: ${message}`);
  }
});

loadConfigBtn?.addEventListener("click", async () => {
  try {
    const config = await invoke<SecureConfigPayload | null>("load_secure_config");
    if (!config) {
      setStatus("Kayitli sifreli ayar bulunamadi.");
      return;
    }
    fillConfigForm(config);
    setStatus("Kayitli sifreli ayarlar yuklendi.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sifreli yukleme hatasi.";
    setStatus(`Hata: ${message}`);
  }
});

startBtn?.addEventListener("click", () => {
  const form = getFormData();
  if (!form.ok) {
    setStatus(form.message);
    return;
  }
  if (recording) return;

  recording = true;
  seconds = 0;
  setTimerLabel(seconds);
  setStatus("Kayit suruyor...");
  if (startBtn) startBtn.disabled = true;
  if (stopBtn) stopBtn.disabled = false;

  timerHandle = window.setInterval(() => {
    seconds += 1;
    setTimerLabel(seconds);
  }, 1000);
});

stopBtn?.addEventListener("click", async () => {
  if (!recording) return;
  recording = false;

  if (timerHandle !== null) {
    window.clearInterval(timerHandle);
    timerHandle = null;
  }

  if (startBtn) startBtn.disabled = false;
  if (stopBtn) stopBtn.disabled = true;

  const form = getFormData();
  if (!form.ok) {
    setStatus(form.message);
    return;
  }

  setStatus("Transkripsiyon ve raporlar olusturuluyor...");

  try {
    const result = await processConsultation({
      patientCode: form.patientCode,
      letterLanguage: form.letterLanguage,
      audioFile: form.audioFile,
      config: form.config,
    });

    setStatus(`Tamamlandi. 24 saat sonra silinecek: ${result.deleteAtIso}`);
    if (outputEl) {
      outputEl.textContent = [
        `Doktor PDF: ${result.doctorPdfFileName}`,
        `Hasta mektup PDF: ${result.patientLetterPdfFileName}`,
        `Drive dosya ID'leri: ${result.driveFileIds.join(", ") || "-"}`,
        "",
        "Doktor raporu (TR):",
        result.doctorReportTr,
        "",
        "Hasta mektubu:",
        result.patientLetter,
      ].join("\n");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Beklenmeyen hata.";
    setStatus(`Hata: ${message}`);
  }
});

startRetentionScheduler();
