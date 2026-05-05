const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const app = express();
const PORT = process.env.PORT || 3000;
const dataDir = path.join(__dirname, "..", "data");
const dataFile = path.join(dataDir, "patients.json");
const visitsFile = path.join(dataDir, "visits.json");
const audioDir = path.join(dataDir, "audio");
const whisperCacheDir = path.join(dataDir, "whisper-cache");

app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "..", "public")));

function ensureStorage() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  if (!fs.existsSync(dataFile)) {
    fs.writeFileSync(dataFile, "[]", "utf8");
  }
  if (!fs.existsSync(visitsFile)) {
    fs.writeFileSync(visitsFile, "[]", "utf8");
  }
  if (!fs.existsSync(audioDir)) {
    fs.mkdirSync(audioDir, { recursive: true });
  }
  if (!fs.existsSync(whisperCacheDir)) {
    fs.mkdirSync(whisperCacheDir, { recursive: true });
  }
}

function loadPatients() {
  ensureStorage();
  try {
    const raw = fs.readFileSync(dataFile, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error("Could not load patients file:", error);
    return [];
  }
}

function savePatients(patients) {
  fs.writeFileSync(dataFile, JSON.stringify(patients, null, 2), "utf8");
}

function loadVisits() {
  ensureStorage();
  try {
    const raw = fs.readFileSync(visitsFile, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error("Could not load visits file:", error);
    return [];
  }
}

function saveVisits(visits) {
  fs.writeFileSync(visitsFile, JSON.stringify(visits, null, 2), "utf8");
}

const patients = loadPatients();
let nextId = patients.reduce((max, patient) => Math.max(max, Number(patient.id) || 0), 0) + 1;

const visits = loadVisits();
let nextVisitId =
  visits.reduce((max, visit) => Math.max(max, Number(visit.id) || 0), 0) + 1;

function getWhisperCommand() {
  return String(process.env.WHISPER_CMD || "whisper").trim() || "whisper";
}

function parseCommandString(commandText) {
  const tokens = String(commandText || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (tokens.length === 0) {
    return { command: "whisper", baseArgs: [] };
  }

  return { command: tokens[0], baseArgs: tokens.slice(1) };
}

function getWhisperCandidates() {
  const primary = parseCommandString(getWhisperCommand());
  const fallbacks = [parseCommandString("python3 -m whisper"), parseCommandString("python -m whisper")];
  return [primary, ...fallbacks].filter(
    (candidate, index, arr) =>
      arr.findIndex(
        (item) => item.command === candidate.command && item.baseArgs.join(" ") === candidate.baseArgs.join(" ")
      ) === index
  );
}

function isWhisperCandidateAvailable(candidate) {
  const helpAttempts = [["-h"], ["--help"]];
  for (const args of helpAttempts) {
    const result = spawnSync(candidate.command, [...candidate.baseArgs, ...args], { encoding: "utf8" });
    if (result.status === 0) {
      return true;
    }
  }
  return false;
}

function whisperAvailable() {
  for (const candidate of getWhisperCandidates()) {
    if (isWhisperCandidateAvailable(candidate)) {
      return true;
    }
  }
  return false;
}

function transcribeWithLocalWhisper(inputPath) {
  const availableCandidate = getWhisperCandidates().find((candidate) => isWhisperCandidateAvailable(candidate));
  if (!availableCandidate) {
    return { ok: false, message: "Whisper komutu bulunamadi. 'whisper' veya 'python3 -m whisper' kurun." };
  }

  const parsed = availableCandidate;
  const language = String(process.env.WHISPER_LANGUAGE || "tr").trim() || "tr";
  const model = String(process.env.WHISPER_MODEL || "small").trim() || "small";

  const args = [
    ...parsed.baseArgs,
    inputPath,
    "--language",
    language,
    "--model",
    model,
    "--output_format",
    "txt",
  ];

  const result = spawnSync(parsed.command, args, {
    encoding: "utf8",
    env: {
      ...process.env,
      XDG_CACHE_HOME: whisperCacheDir,
      WHISPER_CACHE_DIR: whisperCacheDir,
    },
  });
  if (result.error) {
    return { ok: false, message: `Whisper calistirilamadi: ${result.error.message}` };
  }

  if (result.status !== 0) {
    const stderr = String(result.stderr || "").trim();
    const lowered = stderr.toLowerCase();
    if (
      lowered.includes("tunnel connection failed") ||
      lowered.includes("403 forbidden") ||
      lowered.includes("urlopen error")
    ) {
      return {
        ok: false,
        message:
          "Whisper model indirilemedi (ag/proxy engeli: 403). Internet erisimi olan bir agda modeli bir kez indirip tekrar deneyin.",
      };
    }

    return {
      ok: false,
      message: `Whisper hata verdi (kod ${result.status}).${stderr ? ` Detay: ${stderr}` : ""}`,
    };
  }

  const baseName = path.basename(inputPath, path.extname(inputPath));
  const txtPath = path.join(path.dirname(inputPath), `${baseName}.txt`);
  if (!fs.existsSync(txtPath)) {
    return { ok: false, message: "Whisper cikti dosyasi bulunamadi (.txt)." };
  }

  const text = fs.readFileSync(txtPath, "utf8").trim();
  return { ok: true, text, txtPath };
}

function buildLocalSummaries({ patient, transcript }) {
  const patientLine = patient
    ? `Hasta: ${patient.fullName} (${patient.age}). Kayitli sikayet: ${patient.complaint}.`
    : "Hasta secilmedi (yalnizca gorusme metni).";

  const cleaned = String(transcript || "").trim();
  const shortTranscript =
    cleaned.length > 1200 ? `${cleaned.slice(0, 1200)}\n\n[... metin kisaltildi ...]` : cleaned;

  const doctorSummary = [
    "DOKTOR ICIN OZET (OTOMATIK / YEREL)",
    "",
    patientLine,
    "",
    "Gorusme transkripti (ham):",
    shortTranscript || "(bos)",
    "",
    "Not: Bu metin tibbi tani/tedavi onerisi degildir; klinik karar icin doktor degerlendirmesi gerekir.",
  ].join("\n");

  const patientHandout = [
    "HASTA ICIN BILGILENDIRME (OTOMATIK / YEREL)",
    "",
    "Bu belge, gorusmede gecenlerin basit bir ozetidir.",
    "Tani koymaz, tedavi onermez.",
    "",
    patient ? `Sayin ${patient.fullName},` : "Sayin hasta,",
    "",
    "Gorusmede one cikanlar (metin tabanli):",
    shortTranscript ? shortTranscript : "Transkript bulunamadi.",
    "",
    "Ne yapmalisiniz?",
    "- Doktorunun sordugu sorulari net yanitlayin.",
    "- Ilac dozunu kendi basina degistirmeyin.",
    "- Acil durumda 112'yi arayin.",
  ].join("\n");

  return { doctorSummary, patientHandout };
}

function parseAge(value) {
  if (value === null || value === undefined || value === "") {
    return { ok: false, message: "Yas gecersiz." };
  }

  const age = Number(value);
  if (!Number.isFinite(age)) {
    return { ok: false, message: "Yas sayi olmalidir." };
  }

  if (!Number.isInteger(age)) {
    return { ok: false, message: "Yas tam sayi olmalidir." };
  }

  if (age < 0 || age > 130) {
    return { ok: false, message: "Yas 0 ile 130 arasinda olmalidir." };
  }

  return { ok: true, age };
}

function normalizePatientInput(body) {
  const fullName = String(body.fullName ?? "").trim();
  const complaint = String(body.complaint ?? "").trim();
  const ageResult = parseAge(body.age);

  if (!fullName || !complaint) {
    return { ok: false, message: "fullName ve complaint alanlari zorunludur." };
  }

  if (!ageResult.ok) {
    return { ok: false, message: ageResult.message };
  }

  return { ok: true, fullName, complaint, age: ageResult.age };
}

function findLatestPatient(list) {
  if (list.length === 0) {
    return null;
  }

  let latest = list[0];
  let latestTime = Date.parse(latest.createdAt);

  for (const patient of list) {
    const time = Date.parse(patient.createdAt);
    if (Number.isFinite(time) && time >= latestTime) {
      latest = patient;
      latestTime = time;
    }
  }

  return latest;
}

app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

app.get("/api/patients", (req, res) => {
  const rawQuery = req.query.q;
  const q =
    typeof rawQuery === "string"
      ? rawQuery.trim().toLowerCase()
      : Array.isArray(rawQuery) && typeof rawQuery[0] === "string"
        ? rawQuery[0].trim().toLowerCase()
        : "";
  if (!q) {
    return res.json(patients);
  }

  const filtered = patients.filter((patient) => {
    const name = String(patient.fullName || "").toLowerCase();
    const complaint = String(patient.complaint || "").toLowerCase();
    const ageText = String(patient.age ?? "");
    return name.includes(q) || complaint.includes(q) || ageText.includes(q);
  });

  res.json(filtered);
});

app.post("/api/patients", (req, res) => {
  const input = normalizePatientInput(req.body);
  if (!input.ok) {
    return res.status(400).json({ message: input.message });
  }

  const patient = {
    id: nextId++,
    fullName: input.fullName,
    age: input.age,
    complaint: input.complaint,
    createdAt: new Date().toISOString(),
  };

  patients.push(patient);
  try {
    savePatients(patients);
  } catch (error) {
    patients.pop();
    return res.status(500).json({
      message: "Kayit dosyaya yazilamadi.",
    });
  }
  return res.status(201).json(patient);
});

app.put("/api/patients/:id", (req, res) => {
  const patientId = Number(req.params.id);
  const input = normalizePatientInput(req.body);
  if (!input.ok) {
    return res.status(400).json({ message: input.message });
  }

  const patient = patients.find((item) => item.id === patientId);
  if (!patient) {
    return res.status(404).json({ message: "Hasta bulunamadi." });
  }

  patient.fullName = input.fullName;
  patient.age = input.age;
  patient.complaint = input.complaint;

  try {
    savePatients(patients);
  } catch (error) {
    return res.status(500).json({
      message: "Kayit guncellenemedi.",
    });
  }

  return res.json(patient);
});

app.delete("/api/patients/:id", (req, res) => {
  const patientId = Number(req.params.id);
  const index = patients.findIndex((item) => item.id === patientId);

  if (index === -1) {
    return res.status(404).json({ message: "Hasta bulunamadi." });
  }

  const [deletedPatient] = patients.splice(index, 1);

  try {
    savePatients(patients);
  } catch (error) {
    patients.splice(index, 0, deletedPatient);
    return res.status(500).json({
      message: "Kayit silinemedi.",
    });
  }

  return res.status(204).send();
});

app.get("/api/summary", (req, res) => {
  const totalPatients = patients.length;
  const validAges = patients
    .map((patient) => Number(patient.age))
    .filter((age) => Number.isFinite(age));
  const avgAge =
    validAges.length === 0
      ? 0
      : Number((validAges.reduce((sum, age) => sum + age, 0) / validAges.length).toFixed(1));

  res.json({
    totalPatients,
    averageAge: avgAge,
    latestPatient: findLatestPatient(patients),
  });
});

app.get("/api/visits", (req, res) => {
  const rawPatientId = req.query.patientId;
  const patientId =
    typeof rawPatientId === "string"
      ? Number(rawPatientId)
      : Array.isArray(rawPatientId) && typeof rawPatientId[0] === "string"
        ? Number(rawPatientId[0])
        : NaN;

  if (rawPatientId !== undefined && !Number.isFinite(patientId)) {
    return res.status(400).json({ message: "patientId gecersiz." });
  }

  if (Number.isFinite(patientId)) {
    return res.json(visits.filter((visit) => visit.patientId === patientId));
  }

  res.json(visits);
});

app.post(
  "/api/visits/transcribe",
  express.raw({ type: "*/*", limit: "40mb" }),
  (req, res) => {
    const patientId = Number(req.query.patientId);
    if (!Number.isFinite(patientId)) {
      return res.status(400).json({ message: "patientId zorunludur." });
    }

    const patient = patients.find((item) => item.id === patientId);
    if (!patient) {
      return res.status(404).json({ message: "Hasta bulunamadi." });
    }

    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(400).json({ message: "Ses verisi bos." });
    }

    if (!whisperAvailable()) {
      return res.status(501).json({
        message:
          "Yerel transkripsiyon icin makinede 'whisper' komutu bulunamadi. OpenAI Whisper CLI kurun ve PATH'e ekleyin; veya WHISPER_CMD ile tam yolu verin.",
      });
    }

    const mimeType = String(req.get("content-type") || "application/octet-stream");
    const extension = mimeType.includes("webm") ? "webm" : mimeType.includes("wav") ? "wav" : "bin";
    const fileName = `${patientId}-${Date.now()}-${crypto.randomBytes(6).toString("hex")}.${extension}`;
    const inputPath = path.join(audioDir, fileName);

    try {
      fs.writeFileSync(inputPath, req.body);
    } catch (error) {
      return res.status(500).json({ message: "Ses dosyasi yazilamadi." });
    }

    const transcription = transcribeWithLocalWhisper(inputPath);
    if (!transcription.ok) {
      return res.status(500).json({ message: transcription.message });
    }

    const summaries = buildLocalSummaries({ patient, transcript: transcription.text });

    const visit = {
      id: nextVisitId++,
      patientId,
      createdAt: new Date().toISOString(),
      audioPath: inputPath,
      transcriptPath: transcription.txtPath,
      transcript: transcription.text,
      doctorSummary: summaries.doctorSummary,
      patientHandout: summaries.patientHandout,
    };

    visits.push(visit);
    try {
      saveVisits(visits);
    } catch (error) {
      visits.pop();
      return res.status(500).json({ message: "Ziyaret kaydi dosyaya yazilamadi." });
    }

    return res.status(201).json(visit);
  }
);

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
