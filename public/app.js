const form = document.getElementById("patient-form");
const summaryEl = document.getElementById("summary");
const patientsEl = document.getElementById("patients");
const searchInput = document.getElementById("patient-search");
const visitPatientSelect = document.getElementById("visit-patient");
const recordStartBtn = document.getElementById("record-start");
const recordStopBtn = document.getElementById("record-stop");
const visitStatusEl = document.getElementById("visit-status");
const visitTranscriptEl = document.getElementById("visit-transcript");
const visitDoctorEl = document.getElementById("visit-doctor");
const visitPatientDocEl = document.getElementById("visit-patient-doc");

function patientsUrl() {
  const q = searchInput.value.trim();
  return q ? `/api/patients?q=${encodeURIComponent(q)}` : "/api/patients";
}

function setVisitStatus(message) {
  visitStatusEl.textContent = message;
}

function pickRecorderMimeType() {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  for (const candidate of candidates) {
    if (window.MediaRecorder && MediaRecorder.isTypeSupported(candidate)) {
      return candidate;
    }
  }
  return "";
}

function refreshVisitPatientOptions(patients) {
  const previous = visitPatientSelect.value;
  visitPatientSelect.innerHTML = "";

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Seciniz...";
  visitPatientSelect.appendChild(placeholder);

  for (const patient of patients) {
    const option = document.createElement("option");
    option.value = String(patient.id);
    option.textContent = `${patient.fullName} (#${patient.id})`;
    visitPatientSelect.appendChild(option);
  }

  const stillExists = patients.some((patient) => String(patient.id) === previous);
  visitPatientSelect.value = stillExists ? previous : "";
}

async function refreshUI() {
  const [summaryRes, patientsRes, allPatientsRes] = await Promise.all([
    fetch("/api/summary"),
    fetch(patientsUrl()),
    fetch("/api/patients"),
  ]);

  const summary = await summaryRes.json();
  const patients = await patientsRes.json();
  const allPatients = await allPatientsRes.json();

  refreshVisitPatientOptions(allPatients);

  summaryEl.innerHTML = `
    <p>Toplam Hasta: <strong>${summary.totalPatients}</strong></p>
    <p>Ortalama Yas: <strong>${summary.averageAge}</strong></p>
    <p>Son Kayit: <strong>${summary.latestPatient?.fullName || "-"}</strong></p>
  `;

  patientsEl.innerHTML = "";
  for (const patient of patients) {
    const li = document.createElement("li");
    li.innerHTML = `
      <span>${patient.fullName} (${patient.age}) - ${patient.complaint}</span>
      <div class="actions">
        <button type="button" data-action="edit" data-id="${patient.id}">Duzenle</button>
        <button type="button" data-action="delete" data-id="${patient.id}" class="danger">Sil</button>
      </div>
    `;
    patientsEl.appendChild(li);
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const payload = {
    fullName: document.getElementById("fullName").value,
    age: Number(document.getElementById("age").value),
    complaint: document.getElementById("complaint").value,
  };

  const response = await fetch("/api/patients", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    alert("Kayit basarisiz oldu.");
    return;
  }

  form.reset();
  await refreshUI();
});

refreshUI();

let mediaRecorder = null;
let recordedChunks = [];
let recorderMimeType = "";

recordStartBtn.addEventListener("click", async () => {
  const patientId = visitPatientSelect.value;
  if (!patientId) {
    alert("Once hasta secin.");
    return;
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    alert("Bu tarayici mikrofon kaydini desteklemiyor.");
    return;
  }

  recorderMimeType = pickRecorderMimeType();
  if (!recorderMimeType) {
    alert("Bu tarayici uygun ses formatini desteklemiyor (webm/opus).");
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recordedChunks = [];
    mediaRecorder = new MediaRecorder(stream, { mimeType: recorderMimeType });

    mediaRecorder.addEventListener("dataavailable", (event) => {
      if (event.data && event.data.size > 0) {
        recordedChunks.push(event.data);
      }
    });

    mediaRecorder.addEventListener("stop", () => {
      stream.getTracks().forEach((track) => track.stop());
    });

    mediaRecorder.start();
    recordStartBtn.disabled = true;
    recordStopBtn.disabled = false;
    setVisitStatus("Kayit devam ediyor...");
  } catch (error) {
    alert("Mikrofon izni alinamadi.");
    setVisitStatus("");
  }
});

recordStopBtn.addEventListener("click", async () => {
  if (!mediaRecorder) {
    return;
  }

  const patientId = visitPatientSelect.value;
  if (!patientId) {
    alert("Once hasta secin.");
    return;
  }

  recordStopBtn.disabled = true;
  setVisitStatus("Kayit bitiriliyor...");

  await new Promise((resolve) => {
    mediaRecorder.addEventListener("stop", () => resolve(), { once: true });
    mediaRecorder.stop();
    mediaRecorder = null;
  });

  const blob = new Blob(recordedChunks, { type: recorderMimeType });
  if (!blob || blob.size === 0) {
    recordStartBtn.disabled = false;
    setVisitStatus("Kayit bos geldi.");
    return;
  }

  setVisitStatus("Sunucuya yukleniyor ve yerel whisper ile metne cevriliyor...");

  const response = await fetch(`/api/visits/transcribe?patientId=${encodeURIComponent(patientId)}`, {
    method: "POST",
    headers: { "Content-Type": recorderMimeType },
    body: blob,
  });

  const payloadText = await response.text();
  let payload = null;
  try {
    payload = JSON.parse(payloadText);
  } catch (error) {
    payload = null;
  }

  recordStartBtn.disabled = false;

  if (!response.ok) {
    visitTranscriptEl.value = "";
    visitDoctorEl.value = "";
    visitPatientDocEl.value = "";
    const rawMessage = payload?.message || "Islem basarisiz oldu.";
    const compactMessage = rawMessage.length > 280 ? `${rawMessage.slice(0, 280)}...` : rawMessage;
    setVisitStatus(compactMessage);
    return;
  }

  visitTranscriptEl.value = payload.transcript || "";
  visitDoctorEl.value = payload.doctorSummary || "";
  visitPatientDocEl.value = payload.patientHandout || "";
  setVisitStatus("Tamam: kayit islendi ve dosyaya yazildi.");
});

let searchDebounceId = 0;
searchInput.addEventListener("input", () => {
  window.clearTimeout(searchDebounceId);
  searchDebounceId = window.setTimeout(() => {
    refreshUI();
  }, 200);
});

patientsEl.addEventListener("click", async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLButtonElement)) {
    return;
  }

  const patientId = Number(target.dataset.id);
  const action = target.dataset.action;

  if (action === "delete") {
    const ok = confirm("Bu kaydi silmek istediginize emin misiniz?");
    if (!ok) {
      return;
    }

    const response = await fetch(`/api/patients/${patientId}`, {
      method: "DELETE",
    });

    if (!response.ok) {
      alert("Silme islemi basarisiz oldu.");
      return;
    }

    await refreshUI();
    return;
  }

  if (action === "edit") {
    const patientsResponse = await fetch("/api/patients");
    const patients = await patientsResponse.json();
    const currentPatient = patients.find((item) => item.id === patientId);
    if (!currentPatient) {
      alert("Hasta bulunamadi.");
      return;
    }

    const fullName = prompt("Ad Soyad", currentPatient.fullName);
    if (!fullName) {
      return;
    }
    const ageText = prompt("Yas", String(currentPatient.age));
    if (!ageText) {
      return;
    }
    const complaint = prompt("Sikayet", currentPatient.complaint);
    if (!complaint) {
      return;
    }

    const response = await fetch(`/api/patients/${patientId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fullName,
        age: Number(ageText),
        complaint,
      }),
    });

    if (!response.ok) {
      alert("Guncelleme basarisiz oldu.");
      return;
    }

    await refreshUI();
  }
});
