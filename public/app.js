const form = document.getElementById("patient-form");
const summaryEl = document.getElementById("summary");
const patientsEl = document.getElementById("patients");
const searchInput = document.getElementById("patient-search");

function patientsUrl() {
  const q = searchInput.value.trim();
  return q ? `/api/patients?q=${encodeURIComponent(q)}` : "/api/patients";
}

async function refreshUI() {
  const [summaryRes, patientsRes] = await Promise.all([
    fetch("/api/summary"),
    fetch(patientsUrl()),
  ]);

  const summary = await summaryRes.json();
  const patients = await patientsRes.json();

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
