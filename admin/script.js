
function formatAppointmentRange(startTime) {
  const [hourText, minuteText] = String(startTime || "00:00")
    .slice(0, 5)
    .split(":");

  const startMinutes =
    Number(hourText) * 60 + Number(minuteText);
  const endMinutes = startMinutes + 30;

  const compact = totalMinutes => {
    const hour = Math.floor(totalMinutes / 60);
    const minute = totalMinutes % 60;
    return minute === 0
      ? String(hour)
      : `${hour}${String(minute).padStart(2, "0")}`;
  };

  return `${compact(startMinutes)} - ${compact(endMinutes)}`;
}


async function requirePasswordChangeIfNeeded(account){if(!account?.mustChangePassword)return;const modal=document.getElementById("passwordChangeModal"),form=document.getElementById("passwordChangeForm"),input=document.getElementById("requiredNewPassword"),box=document.getElementById("passwordChangeMessage");modal.classList.remove("hidden");await new Promise(resolve=>{form.onsubmit=async e=>{e.preventDefault();try{await api("/api/change-password",{method:"POST",body:JSON.stringify({newPassword:input.value})});modal.classList.add("hidden");resolve()}catch(error){box.textContent=error.message;box.className="message error"}}})}
let doctors = [];
let resetDoctorId = null;
let rfidDoctorId = null;

async function api(url, options = {}) {
  const r = await fetch(url, {
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    ...options
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || "Request failed.");
  return d;
}

function message(el, text, type) {
  el.textContent = text;
  el.className = `message ${type}`;
}

function open(id) {
  document.getElementById(id).classList.remove("hidden");
}

function close(id) {
  document.getElementById(id).classList.add("hidden");
}

function showAdminMessage(text, type) {
  const el = document.getElementById("adminMessage");
  message(el, text, type);
  el.classList.remove("hidden");
  setTimeout(() => el.classList.add("hidden"), 2200);
}

async function enter(a) {
  if (a.role !== "admin") throw new Error("Use an administrator account.");
  await requirePasswordChangeIfNeeded(a);
  adminName.textContent = a.fullName;
  loginPage.classList.add("hidden");
  adminApp.classList.remove("hidden");
  await Promise.all([
    loadDoctors(),
    loadRoomAvailability(),
    loadMedicationUsage()
  ]);
}

loginForm.onsubmit = async e => {
  e.preventDefault();
  loginMessage.classList.add("hidden");
  try {
    const d = await api("/api/login", {
      method: "POST",
      body: JSON.stringify({ email: email.value, password: password.value })
    });
    await enter(d.account);
  } catch (err) {
    message(loginMessage, err.message, "error");
  }
};

async function loadDoctors() {
  const d = await api("/api/admin/doctors");
  doctors = d.doctors;
  render();
}

function render() {
  const q = searchInput.value.toLowerCase();
  const f = accessFilter.value;
  const list = doctors.filter(d =>
    `${d.fullName} ${d.email} ${d.specialisation || ""}`.toLowerCase().includes(q) &&
    (f === "all" ||
      (f === "active" && d.isActive) ||
      (f === "inactive" && !d.isActive))
  );

  doctorRows.innerHTML = list.map(d => `
    <tr>
      <td><strong>${d.fullName}</strong></td>
      <td>${d.email}</td>
      <td>${d.specialisation || "-"}</td>
      <td>${d.mobileNumber || "-"}</td>
      <td><code>${d.rfidUid || "-"}</code></td>
      <td>
        <span class="status ${d.isActive ? "active" : "inactive"}">
          ${d.isActive ? "Active" : "Disabled"}
        </span>
      </td>
      <td>
        <div class="actions">
          <button
            class="${d.isActive ? "danger" : "outline"}"
            onclick="toggleAccess('${d.id}', ${d.isActive ? 0 : 1})">
            ${d.isActive ? "Disable" : "Enable"}
          </button>
          <button class="outline" onclick="openReset('${d.id}')">
            Reset Password
          </button>
          <button class="outline" onclick="openRfid('${d.id}', '${d.rfidUid || ""}')">
            Link RFID
          </button>
        </div>
      </td>
    </tr>
  `).join("");
}

window.toggleAccess = async (id, isActive) => {
  try {
    await api(`/api/admin/doctors/${id}/access`, {
      method: "PATCH",
      body: JSON.stringify({ isActive: Boolean(isActive) })
    });
    showAdminMessage(Boolean(isActive) ? "Doctor access enabled." : "Doctor access disabled.", "success");
    await loadDoctors();
  } catch (err) {
    showAdminMessage(err.message, "error");
  }
};

window.openReset = id => {
  resetDoctorId = id;
  passwordForm.reset();
  passwordMessage.classList.add("hidden");
  open("passwordModal");
};

window.openRfid = (id, currentRfid) => {
  rfidDoctorId = id;
  rfidForm.reset();
  rfidUidInput.value = currentRfid === "null" ? "" : currentRfid;
  rfidMessage.classList.add("hidden");
  open("rfidModal");
};

openCreateButton.onclick = () => open("createModal");

document.querySelectorAll("[data-close]").forEach(b => {
  b.onclick = () => close(b.dataset.close);
});

createDoctorForm.onsubmit = async e => {
  e.preventDefault();
  createMessage.classList.add("hidden");
  try {
    await api("/api/admin/doctors", {
      method: "POST",
      body: JSON.stringify({
        fullName: doctorFullName.value,
        email: doctorEmail.value,
        password: doctorPassword.value,
        mobileNumber: doctorMobile.value,
        specialisation: doctorSpecialisation.value
      })
    });
    message(createMessage, "Doctor account created.", "success");
    e.target.reset();
    await loadDoctors();
    setTimeout(() => close("createModal"), 700);
  } catch (err) {
    message(createMessage, err.message, "error");
  }
};

passwordForm.onsubmit = async e => {
  e.preventDefault();
  passwordMessage.classList.add("hidden");
  try {
    await api(`/api/admin/doctors/${resetDoctorId}/reset-password`, {
      method: "POST",
      body: JSON.stringify({ password: resetPassword.value })
    });
    message(passwordMessage, "Password reset successfully.", "success");
    setTimeout(() => close("passwordModal"), 700);
  } catch (err) {
    message(passwordMessage, err.message, "error");
  }
};

rfidForm.onsubmit = async e => {
  e.preventDefault();
  rfidMessage.classList.add("hidden");
  try {
    await api(`/api/admin/doctors/${rfidDoctorId}/rfid`, {
      method: "PATCH",
      body: JSON.stringify({ rfidUid: rfidUidInput.value })
    });
    message(rfidMessage, "RFID tag linked successfully.", "success");
    await loadDoctors();
    setTimeout(() => close("rfidModal"), 700);
  } catch (err) {
    message(rfidMessage, err.message, "error");
  }
};

searchInput.oninput = render;
accessFilter.onchange = render;

logoutButton.onclick = async () => {
  await api("/api/logout", { method: "POST" }).catch(() => {});
  adminApp.classList.add("hidden");
  loginPage.classList.remove("hidden");
};

(async () => {
  try {
    const d = await api("/api/me");
    await enter(d.account);
  } catch {}
})();

async function loadRoomAvailability() {
  const date =
    roomAvailabilityDate.value ||
    new Date().toISOString().slice(0, 10);

  const data = await api(
    `/api/admin/room-availability?date=${encodeURIComponent(date)}`
  );

  roomAvailabilityGrid.innerHTML = data.rooms.length
    ? data.rooms.map(room => `
        <article class="room-card">
          <h3>${room.roomName}</h3>
          <div class="room-slot-grid">
            ${room.slots.map(slot => `
              <div
                class="room-slot ${slot.available ? "available" : "booked"}"
                title="${
                  slot.available
                    ? "Available"
                    : `${slot.doctorName} · ${slot.patientName}`
                }"
              >
                <strong>${formatAppointmentRange(slot.time)}</strong>
                <span>
                  ${
                    slot.available
                      ? "Available"
                      : `${slot.doctorName}<br>${slot.patientName}`
                  }
                </span>
              </div>
            `).join("")}
          </div>
        </article>
      `).join("")
    : `<p>No rooms configured.</p>`;
}

roomAvailabilityDate.onchange=loadRoomAvailability;


async function loadMedicationUsage() {
  const date =
    medicationUsageDate.value ||
    new Date().toISOString().slice(0, 10);

  const data = await api(
    `/api/admin/medication-usage?date=${encodeURIComponent(date)}`
  );

  totalMedicationQuantity.textContent =
    data.summary.totalMedicationQuantity;

  totalMedicationCollections.textContent =
    data.summary.totalCollections;

  totalMedicationTypes.textContent =
    data.summary.uniqueMedicationTypes;

  medicationUsageList.innerHTML = data.medications.length
    ? data.medications.map(medication => `
        <article class="medication-usage-card">
          <div class="medication-usage-header">
            <div>
              <h3>${medication.medicationName}</h3>
              <p>
                ${medication.collectionCount}
                collection${medication.collectionCount === 1 ? "" : "s"}
              </p>
            </div>
            <div class="medication-total">
              <span>Total quantity</span>
              <strong>${medication.totalQuantity}</strong>
            </div>
          </div>

          <div class="table-wrap">
            <table class="medication-detail-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Patient</th>
                  <th>Doctor</th>
                  <th>Dosage</th>
                  <th>Frequency</th>
                  <th>Quantity</th>
                  <th>Request ID</th>
                </tr>
              </thead>
              <tbody>
                ${medication.details.map(detail => `
                  <tr>
                    <td>
                      ${new Date(detail.collectedAt).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit"
                      })}
                    </td>
                    <td>${detail.patientName}</td>
                    <td>${detail.doctorName}</td>
                    <td>${detail.dosage}</td>
                    <td>${detail.frequency}</td>
                    <td><strong>${detail.quantity}</strong></td>
                    <td>${detail.requestId}</td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
        </article>
      `).join("")
    : `
      <div class="empty-state">
        No medication was collected on this date.
      </div>
    `;
}

medicationUsageDate.onchange=loadMedicationUsage;


setInterval(() => {
  const accountsPage =
    document.getElementById("accountsPage");

  if (
    accountsPage &&
    accountsPage.classList.contains("active")
  ) {
    loadDoctors().catch(error =>
      console.error("Doctor status refresh failed:", error)
    );
  }
}, 15000);
