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

app.get("/api/patients", (req, res) => {
  const rawQuery = req.query.q;
  const q = typeof rawQuery === "string" ? rawQuery.trim().toLowerCase() : "";
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
  const { fullName, age, complaint } = req.body;

  if (!fullName || !age || !complaint) {
    return res.status(400).json({
      message: "fullName, age ve complaint alanlari zorunludur.",
    });
  }

  const patient = {
    id: nextId++,
    fullName: String(fullName).trim(),
    age: Number(age),
    complaint: String(complaint).trim(),
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
  const { fullName, age, complaint } = req.body;

  if (!fullName || !age || !complaint) {
    return res.status(400).json({
      message: "fullName, age ve complaint alanlari zorunludur.",
    });
  }

  const patient = patients.find((item) => item.id === patientId);
  if (!patient) {
    return res.status(404).json({ message: "Hasta bulunamadi." });
  }

  patient.fullName = String(fullName).trim();
  patient.age = Number(age);
  patient.complaint = String(complaint).trim();

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
  const avgAge =
    totalPatients === 0
      ? 0
      : Number(
          (patients.reduce((sum, patient) => sum + patient.age, 0) / totalPatients).toFixed(1)
        );

  res.json({
    totalPatients,
    averageAge: avgAge,
    latestPatient: patients[totalPatients - 1] || null,
  });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
