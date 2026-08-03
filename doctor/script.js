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
          <span>${appointment.appointmentTime} · ${appointment.location}</span>
        `;

        appointmentButton.title =
          `${appointment.patientName}\n${appointment.appointmentDate} ${appointment.appointmentTime}\n${appointment.location}`;

        appointmentButton.onclick = () => showAppointmentDetails(appointment);
        slot.appendChild(appointmentButton);
      });

      calendar.appendChild(slot);
    });
  }
}

function showAppointmentDetails(appointment) {
  const existing = document.getElementById("appointmentDetail");
  if (existing) existing.remove();

  const details = document.createElement("div");
  details.id = "appointmentDetail";
  details.className = "appointment-detail";
  details.innerHTML = `
    <h3>${appointment.patientName}</h3>
    <p><strong>Date:</strong> ${appointment.appointmentDate}</p>
    <p><strong>Time:</strong> ${appointment.appointmentTime}</p>
    <p><strong>Location:</strong> ${appointment.location}</p>
    <p><strong>Status:</strong> ${appointment.status}</p>
  `;

  document.getElementById("calendarLegend").after(details);
}

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

openForm.onclick = () => formModal.classList.remove("hidden");
closeForm.onclick = () => formModal.classList.add("hidden");
closeResult.onclick = () => resultModal.classList.add("hidden");

prescriptionForm.onsubmit = async event => {
  event.preventDefault();
  formMsg.classList.add("hidden");

  try {
    const data = await api("/api/doctor/prescriptions", {
      method: "POST",
      body: JSON.stringify({
        patientId: patientSelect.value,
        medicationName: medicationName.value,
        dosage: dosage.value,
        frequency: frequency.value,
        quantity: Number(quantity.value),
        instructions: instructions.value,
        collectionLocation: collectionLocation.value
      })
    });

    formModal.classList.add("hidden");
    generatedPin.textContent = data.collectionPin;
    requestId.textContent = `Request ID: ${data.requestId}`;
    resultModal.classList.remove("hidden");
    event.target.reset();
    await loadPrescriptions();
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
