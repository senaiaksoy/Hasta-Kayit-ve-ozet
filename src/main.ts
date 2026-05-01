import "./styles.css";
import { processConsultation, startRetentionScheduler } from "./services/pipeline";
import type { LetterLanguage } from "./types";

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

      <div class="actions">
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

function fakeTranscript(durationSec: number): string {
  return [
    "Patient describes fertility history and treatment expectations.",
    `Consultation duration was approximately ${durationSec} seconds.`,
    "Symptoms, previous investigations, and follow-up plan were discussed.",
  ].join(" ");
}

function getFormData():
  | { ok: true; patientCode: string; letterLanguage: LetterLanguage }
  | { ok: false; message: string } {
  const patientCode = patientCodeEl?.value?.trim() ?? "";
  const letterLanguage = letterLanguageEl?.value as LetterLanguage;
  const consentGranted = Boolean(consentEl?.checked);

  if (!letterLanguage) {
    return { ok: false, message: "Hasta mektubu dili secilmelidir." };
  }
  if (!consentGranted) {
    return { ok: false, message: "Onam kutusu isaretlenmelidir." };
  }
  return { ok: true, patientCode, letterLanguage };
}

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
  stopBtn.disabled = true;

  const form = getFormData();
  if (!form.ok) {
    setStatus(form.message);
    return;
  }

  setStatus("Transkripsiyon ve raporlar olusturuluyor...");
  const transcriptRaw = fakeTranscript(seconds);

  try {
    const result = await processConsultation({
      patientCode: form.patientCode,
      letterLanguage: form.letterLanguage,
      transcriptRaw,
    });

    setStatus(`Tamamlandi. 24 saat sonra silinecek: ${result.deleteAtIso}`);
    if (outputEl) {
      outputEl.textContent = [
        `Doktor PDF: ${result.doctorPdfFileName}`,
        `Hasta mektup PDF: ${result.patientLetterPdfFileName}`,
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
