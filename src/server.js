const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const dataDir = path.join(__dirname, "..", "data");
const dataFile = path.join(dataDir, "patients.json");

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

function ensureStorage() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  if (!fs.existsSync(dataFile)) {
    fs.writeFileSync(dataFile, "[]", "utf8");
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

const patients = loadPatients();
let nextId = patients.reduce((max, patient) => Math.max(max, Number(patient.id) || 0), 0) + 1;

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

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
