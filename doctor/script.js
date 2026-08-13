
let doctorHeartbeatTimer = null;

async function sendDoctorHeartbeat() {
  try {
    await api("/api/doctor/heartbeat", {
      method: "POST",
      body: JSON.stringify({})
    });
  } catch (error) {
    console.error("Doctor heartbeat failed:", error.message);
  }
}

function startDoctorHeartbeat() {
  if (doctorHeartbeatTimer) {
    clearInterval(doctorHeartbeatTimer);
  }

  sendDoctorHeartbeat();

  doctorHeartbeatTimer = setInterval(
    sendDoctorHeartbeat,
    15000
  );
}

function stopDoctorHeartbeat() {
  if (doctorHeartbeatTimer) {
    clearInterval(doctorHeartbeatTimer);
    doctorHeartbeatTimer = null;
  }
}


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
let account = null;
let calendarWeekOffset = 0;
let doctorAppointments = [];

async function api(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    ...options
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || "Request failed");
  }

  return data;
}

function msg(element, text, type) {
  element.textContent = text;
  element.className = `msg ${type}`;
}

async function enter(accountData) {
  if (accountData.role !== "doctor") {
    throw new Error("Use a doctor account.");
  }

  account = accountData;
  doctorName.textContent = accountData.fullName;
  loginPage.classList.add("hidden");
  portal.classList.remove("hidden");

  await Promise.all([
    loadPatients(),
    loadAppointments(),
    loadPrescriptions()
  ]);
}

loginForm.onsubmit = async event => {
  event.preventDefault();
  loginMsg.classList.add("hidden");

  try {
    const data = await api("/api/login", {
      method: "POST",
      body: JSON.stringify({
        email: email.value,
        password: password.value
      })
    });

    await enter(data.account);
  } catch (error) {
    msg(loginMsg, error.message, "error");
  }
};

document.querySelectorAll(".nav[data-page]").forEach(button => {
  button.onclick = () => {
    document.querySelectorAll(".page").forEach(page => page.classList.remove("active"));
    document.querySelectorAll(".nav").forEach(item => item.classList.remove("active"));

    document.getElementById(button.dataset.page).classList.add("active");
    button.classList.add("active");

    if (button.dataset.page === "appointmentsPage") {
      renderDoctorCalendar();
    }
  };
});

async function loadPatients() {
  const data = await api("/api/doctor/patients");

  patientSelect.innerHTML = data.patients.map(patient => `
    <option value="${patient.id}">
      ${patient.fullName} (${patient.email})
    </option>
  `).join("");
}

function mondayOf(date) {
  const result = new Date(date);
  const day = result.getDay();
  const difference = day === 0 ? -6 : 1 - day;

  result.setDate(result.getDate() + difference);
  result.setHours(0, 0, 0, 0);
  return result;
}

function dateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function displayDate(date) {
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short"
  });
}

function displayLongDate(date) {
  return date.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "short"
  });
}

function timeLabel(minutes) {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

function normaliseTime(time) {
  return String(time || "").slice(0, 5);
}

async function loadAppointments() {
  const data = await api("/api/doctor/appointments");
  doctorAppointments = data.appointments;
  renderDoctorCalendar();
}

function renderDoctorCalendar() {
  const calendar = document.getElementById("doctorCalendar");
  if (!calendar) return;

  const weekStart = mondayOf(new Date());
  weekStart.setDate(weekStart.getDate() + calendarWeekOffset * 7);

  const weekdays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
  const dates = weekdays.map((_, index) => {
    const date = new Date(weekStart);
    date.setDate(weekStart.getDate() + index);
    return date;
  });

  weekRange.textContent = `${displayDate(dates[0])} – ${displayDate(dates[4])}`;
  calendar.innerHTML = "";

  const corner = document.createElement("div");
  corner.className = "calendar-cell calendar-corner";
  calendar.appendChild(corner);

  const todayKey = dateKey(new Date());

  dates.forEach((date, index) => {
    const heading = document.createElement("div");
    heading.className = "calendar-cell calendar-day-heading";

    if (dateKey(date) === todayKey) {
      heading.classList.add("today");
    }

    heading.innerHTML = `
      ${weekdays[index]}
      <small>${displayLongDate(date)}</small>
    `;

    calendar.appendChild(heading);
  });

  const startMinutes = 8 * 60;
  const endMinutes = 17 * 60 + 30;

  for (let minutes = startMinutes; minutes <= endMinutes; minutes += 30) {
    const time = timeLabel(minutes);

    const timeCell = document.createElement("div");
    timeCell.className = "calendar-cell calendar-time";
    timeCell.textContent = time;
    calendar.appendChild(timeCell);

    dates.forEach(date => {
      const slot = document.createElement("div");
      slot.className = "calendar-cell calendar-slot";

      const slotDateTime = new Date(
        `${dateKey(date)}T${time}:00`
      );

      if (slotDateTime < new Date()) {
        slot.classList.add("past-slot");
      }

      const matchingAppointments = doctorAppointments.filter(appointment =>
        appointment.appointmentDate === dateKey(date) &&
        normaliseTime(appointment.appointmentTime) === time &&
        appointment.status !== "Cancelled"
      );

      matchingAppointments.forEach(appointment => {
        const appointmentButton = document.createElement("button");
        appointmentButton.type = "button";
        appointmentButton.className = "calendar-appointment";
        appointmentButton.innerHTML = `
          <strong>${appointment.patientName}</strong>
          <span>${formatAppointmentRange(appointment.appointmentTime)} · ${appointment.location}</span>
        `;

        appointmentButton.title =
          `${appointment.patientName}\n${appointment.appointmentDate} ${formatAppointmentRange(appointment.appointmentTime)}\n${appointment.location}`;

        appointmentButton.onclick = () => showAppointmentDetails(appointment);
        slot.appendChild(appointmentButton);
      });

      calendar.appendChild(slot);
    });
  }
}

async function showAppointmentDetails(appointment) {
  try {
    const data = await api(`/api/doctor/appointments/${appointment.id}`);
    const detail = data.appointment;

    selectedAppointment = detail;
    appointmentPatientName.textContent = detail.patientName;
    appointmentDetailDate.textContent = detail.appointmentDate;
    appointmentDetailTime.textContent = detail.appointmentTime;
    appointmentDetailLocation.textContent = detail.location;
    appointmentDetailStatus.textContent = detail.status;
    appointmentPatientEmail.textContent = detail.patientEmail || "-";
    appointmentPatientMobile.textContent = detail.patientMobile || "-";
    appointmentNotes.textContent = detail.notes || "No consultation notes.";

    appointmentPrescriptionList.innerHTML = data.prescriptions.length
      ? data.prescriptions.map(prescription => `
          <article class="mini-prescription">
            <strong>${prescription.medicationName}</strong>
            <span>${prescription.dosage} · ${prescription.frequency}</span>
            <span>Quantity: ${prescription.quantity}</span>
            <span class="status">${prescription.status}</span>
          </article>
        `).join("")
      : `<p class="muted">No prescription has been created from this appointment.</p>`;

    const appointmentDateTime = new Date(
      `${detail.appointmentDate}T${String(detail.appointmentTime).slice(0, 5)}:00`
    );
    const canPrescribe =
      detail.status === "Completed" || appointmentDateTime <= new Date();

    prescribeFromAppointment.disabled = !canPrescribe;
    prescribeFromAppointment.textContent = canPrescribe
      ? "Give Prescription"
      : "Consultation Has Not Started";

    appointmentModal.classList.remove("hidden");
    document.body.classList.add("modal-open");
  } catch (error) {
    alert(error.message);
  }
}


let selectedAppointment = null;

closeAppointmentModal.onclick = () => {
  appointmentModal.classList.add("hidden");
  document.body.classList.remove("modal-open");
};

prescribeFromAppointment.onclick = () => {
  if (!selectedAppointment || prescribeFromAppointment.disabled) return;

  selectedAppointmentId.value = selectedAppointment.id;
  patientSelect.innerHTML = `
    <option value="${selectedAppointment.patientId}">
      ${selectedAppointment.patientName}
    </option>
  `;
  patientSelect.value = selectedAppointment.patientId;
  patientSelect.disabled = true;

  appointmentModal.classList.add("hidden");
  document.body.classList.remove("modal-open");
  formMsg.classList.add("hidden");
  formModal.classList.remove("hidden");
  document.body.classList.add("modal-open");
};

previousWeekButton.onclick = () => {
  calendarWeekOffset -= 1;
  renderDoctorCalendar();
};

nextWeekButton.onclick = () => {
  calendarWeekOffset += 1;
  renderDoctorCalendar();
};

todayButton.onclick = () => {
  calendarWeekOffset = 0;
  renderDoctorCalendar();
};

async function loadPrescriptions() {
  const data = await api("/api/doctor/prescriptions");

  prescriptionRows.innerHTML = data.prescriptions.map(prescription => `
    <tr>
      <td>${prescription.requestId}</td>
      <td>${prescription.patientName}</td>
      <td>${prescription.medicationName} ${prescription.dosage}</td>
      <td>${prescription.collectionPin}</td>
      <td><span class="status">${prescription.status}</span></td>
    </tr>
  `).join("");
}


closeForm.onclick = () => {
  formModal.classList.add("hidden");
  document.body.classList.remove("modal-open");
  selectedAppointmentId.value = "";
  selectedAppointment = null;
};
closeResult.onclick = () => resultModal.classList.add("hidden");

prescriptionForm.onsubmit = async event => {
  event.preventDefault();
  formMsg.classList.add("hidden");

  try {
    const data = await api("/api/doctor/prescriptions", {
      method: "POST",
      body: JSON.stringify({
        appointmentId: selectedAppointmentId.value,
        patientId: patientSelect.value,
        medicationName: medicationName.value,
        dosage: dosage.value,
        frequency: frequency.value,
        quantity: Number(quantity.value),
        instructions: instructions.value
      })
    });

    formModal.classList.add("hidden");
  document.body.classList.remove("modal-open");
    generatedPin.textContent = data.collectionPin;
    requestId.textContent = `Request ID: ${data.requestId}`;
    resultModal.classList.remove("hidden");
    event.target.reset();
    selectedAppointmentId.value = "";
    selectedAppointment = null;
    followUpRequired.checked = false;
    followUpReason.value = "";
    followUpDetails.classList.add("hidden");
    patientSelect.disabled = true;
    await Promise.all([loadPrescriptions(), loadAppointments()]);
  } catch (error) {
    msg(formMsg, error.message, "error");
  }
};

logoutBtn.onclick = async () => {
  await api("/api/logout", { method: "POST" }).catch(() => {});
  portal.classList.add("hidden");
  loginPage.classList.remove("hidden");
};

(async () => {
  try {
    const data = await api("/api/me");
    await enter(data.account);
  } catch {
    // No active doctor session.
  }
})();


if (typeof followUpRequired !== "undefined") {
  followUpRequired.onchange = () => {
    followUpDetails.classList.toggle(
      "hidden",
      !followUpRequired.checked
    );

    followUpReason.required =
      followUpRequired.checked;

    if (!followUpRequired.checked) {
      followUpReason.value = "";
    }
  };
}


window.addEventListener("beforeunload", () => {
  stopDoctorHeartbeat();
});
