require("dotenv").config();

const path = require("path");
const express = require("express");
const session = require("express-session");
const MongoStore = require("connect-mongo");
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const MONGODB_URI =
  process.env.MONGODB_URI ||
  (process.env.NODE_ENV === "production"
    ? ""
    : "mongodb://127.0.0.1:27017/medisync");

if (!MONGODB_URI) {
  throw new Error(
    "MONGODB_URI is required. Add the MongoDB Atlas connection string to the hosting environment."
  );
}

const { Schema } = mongoose;

if (process.env.NODE_ENV === "production") {
  app.set("trust proxy", 1);
}

const accountSchema = new Schema(
  {
    fullName: { type: String, required: true, trim: true },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true
    },
    passwordHash: { type: String, required: true },
    role: {
      type: String,
      required: true,
      enum: ["doctor", "patient", "admin"]
    },
    mobileNumber: { type: String, default: "", trim: true },
    specialisation: { type: String, default: "", trim: true },
    isActive: { type: Boolean, default: true }
  },
  { timestamps: true }
);

const appointmentSchema = new Schema(
  {
    patientId: {
      type: Schema.Types.ObjectId,
      ref: "Account",
      required: true,
      index: true
    },
    doctorId: {
      type: Schema.Types.ObjectId,
      ref: "Account",
      required: true,
      index: true
    },
    appointmentDate: { type: String, required: true },
    appointmentTime: { type: String, required: true },
    location: { type: String, required: true, trim: true },
    notes: { type: String, default: "", trim: true },
    status: {
      type: String,
      enum: ["Booked", "Completed", "Cancelled"],
      default: "Booked"
    }
  },
  { timestamps: true }
);

appointmentSchema.index(
  {
    doctorId: 1,
    appointmentDate: 1,
    appointmentTime: 1,
    status: 1
  }
);

const prescriptionSchema = new Schema(
  {
    requestId: { type: String, required: true, unique: true, index: true },
    patientId: {
      type: Schema.Types.ObjectId,
      ref: "Account",
      required: true,
      index: true
    },
    doctorId: {
      type: Schema.Types.ObjectId,
      ref: "Account",
      required: true,
      index: true
    },
    medicationName: { type: String, required: true, trim: true },
    dosage: { type: String, required: true, trim: true },
    frequency: { type: String, required: true, trim: true },
    quantity: { type: Number, required: true, min: 1 },
    instructions: { type: String, default: "", trim: true },
    collectionLocation: { type: String, required: true, trim: true },
    collectionPin: { type: String, required: true, unique: true, index: true },
    status: {
      type: String,
      enum: ["Ready", "Collected"],
      default: "Ready"
    },
    collectedAt: { type: Date, default: null }
  },
  { timestamps: true }
);

const Account = mongoose.model("Account", accountSchema);
const Appointment = mongoose.model("Appointment", appointmentSchema);
const Prescription = mongoose.model("Prescription", prescriptionSchema);

const failedAttemptSchema = new Schema(
  {
    collectionPin: { type: String, required: true, index: true },
    deviceAddress: { type: String, required: true, index: true },
    attemptCount: { type: Number, default: 0 },
    lastAttemptAt: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

failedAttemptSchema.index(
  { collectionPin: 1, deviceAddress: 1 },
  { unique: true }
);

const FailedAttempt = mongoose.model(
  "FailedAttempt",
  failedAttemptSchema
);


app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.use(
  session({
    name: "medisync.sid",
    secret: process.env.SESSION_SECRET || "change-this-session-secret",
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
      mongoUrl: MONGODB_URI,
      collectionName: "sessions",
      ttl: 8 * 60 * 60
    }),
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 8 * 60 * 60 * 1000
    }
  })
);

function auth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Please sign in." });
  }
  next();
}

function role(requiredRole) {
  return (req, res, next) => {
    if (req.session.role !== requiredRole) {
      return res.status(403).json({ error: "Access denied." });
    }
    next();
  };
}

function accountView(account) {
  return {
    id: account._id.toString(),
    fullName: account.fullName,
    email: account.email,
    role: account.role,
    mobileNumber: account.mobileNumber,
    specialisation: account.specialisation
  };
}

function isObjectId(value) {
  return mongoose.Types.ObjectId.isValid(String(value || ""));
}

function appointmentDateTime(appointment) {
  return new Date(
    `${appointment.appointmentDate}T${appointment.appointmentTime}:00`
  );
}

async function generatePin() {
  let collectionPin;

  do {
    collectionPin = String(
      Math.floor(100000 + Math.random() * 900000)
    );
  } while (await Prescription.exists({ collectionPin }));

  return collectionPin;
}

async function generateRequestId() {
  let requestId;

  do {
    requestId = `MED-${Date.now().toString().slice(-8)}-${Math.floor(
      Math.random() * 100
    )
      .toString()
      .padStart(2, "0")}`;
  } while (await Prescription.exists({ requestId }));

  return requestId;
}

async function seedAccount({
  fullName,
  email,
  password,
  role,
  mobileNumber = "",
  specialisation = ""
}) {
  const normalisedEmail = email.toLowerCase();

  if (await Account.exists({ email: normalisedEmail })) {
    return Account.findOne({ email: normalisedEmail });
  }

  return Account.create({
    fullName,
    email: normalisedEmail,
    passwordHash: await bcrypt.hash(password, 12),
    role,
    mobileNumber,
    specialisation,
    isActive: true
  });
}

async function seedDatabase() {
  const doctor = await seedAccount({
    fullName: "Ravad Nadam",
    email: "doctor@medisync.com",
    password: "password123",
    role: "doctor",
    mobileNumber: "81234567",
    specialisation: "Cardiologist"
  });

  await seedAccount({
    fullName: "System Administrator",
    email: "admin@medisync.com",
    password: "admin12345",
    role: "admin"
  });

  const patient = await seedAccount({
    fullName: "John Doe William",
    email: "patient@medisync.com",
    password: "password123",
    role: "patient",
    mobileNumber: "92345678"
  });

  if ((await Appointment.countDocuments()) === 0) {
    await Appointment.create({
      patientId: patient._id,
      doctorId: doctor._id,
      appointmentDate: "2026-07-20",
      appointmentTime: "13:00",
      location: "Yishun Polyclinic - Level 3",
      notes: "General consultation"
    });
  }

  if ((await Prescription.countDocuments()) === 0) {
    await Prescription.create({
      requestId: "MED-100001",
      patientId: patient._id,
      doctorId: doctor._id,
      medicationName: "Panadol",
      dosage: "500 mg",
      frequency: "3 times a day",
      quantity: 10,
      instructions: "Take after food.",
      collectionLocation: "Yishun Polyclinic - Level 3",
      collectionPin: "123456"
    });
  }
}

/* Authentication */

app.post("/api/register", async (req, res) => {
  try {
    const {
      fullName,
      email,
      password,
      mobileNumber = "",
      role: requestedRole = "patient",
      specialisation = ""
    } = req.body;

    if (!fullName || !email || !password) {
      return res
        .status(400)
        .json({ error: "Complete all required fields." });
    }

    if (String(password).length < 8) {
      return res.status(400).json({
        error: "Password needs at least 8 characters."
      });
    }

    // Public registration is limited to patients.
    const accountRole =
      requestedRole === "patient" ? "patient" : "patient";

    const normalisedEmail = String(email).trim().toLowerCase();

    if (await Account.exists({ email: normalisedEmail })) {
      return res.status(409).json({
        error: "Email already registered."
      });
    }

    const account = await Account.create({
      fullName: String(fullName).trim(),
      email: normalisedEmail,
      passwordHash: await bcrypt.hash(String(password), 12),
      role: accountRole,
      mobileNumber: String(mobileNumber).trim(),
      specialisation: String(specialisation).trim()
    });

    res.status(201).json({
      message: "Account created.",
      id: account._id.toString()
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: "Could not create account."
    });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const email = String(req.body.email || "")
      .trim()
      .toLowerCase();

    const account = await Account.findOne({
      email,
      isActive: true
    });

    const validPassword =
      account &&
      (await bcrypt.compare(
        String(req.body.password || ""),
        account.passwordHash
      ));

    if (!validPassword) {
      return res.status(401).json({
        error: "Incorrect email or password."
      });
    }

    req.session.userId = account._id.toString();
    req.session.role = account.role;

    res.json({ account: accountView(account) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Unable to sign in." });
  }
});

app.get("/api/me", auth, async (req, res) => {
  const account = await Account.findById(req.session.userId);

  if (!account || !account.isActive) {
    return req.session.destroy(() => {
      res.status(401).json({ error: "Account is unavailable." });
    });
  }

  res.json({ account: accountView(account) });
});

app.post("/api/logout", auth, (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("medisync.sid");
    res.json({ message: "Logged out." });
  });
});

/* Patient APIs */

app.get(
  "/api/patient/doctors",
  auth,
  role("patient"),
  async (req, res) => {
    const doctors = await Account.find({
      role: "doctor",
      isActive: true
    })
      .sort({ fullName: 1 })
      .lean();

    res.json({
      doctors: doctors.map(doctor => ({
        id: doctor._id.toString(),
        fullName: doctor.fullName,
        specialisation: doctor.specialisation
      }))
    });
  }
);

app.get(
  "/api/patient/appointments/availability",
  auth,
  role("patient"),
  async (req, res) => {
    try {
      const { doctorId, date } = req.query;

      if (!doctorId || !date) {
        return res.status(400).json({
          error: "Please select a doctor and date."
        });
      }

      if (!isObjectId(doctorId)) {
        return res.status(400).json({
          error: "Invalid doctor account."
        });
      }

      const appointments = await Appointment.find({
        doctorId,
        appointmentDate: String(date),
        status: "Booked"
      })
        .select("appointmentTime")
        .lean();

      res.json({
        unavailableTimes: appointments.map(appointment =>
          String(appointment.appointmentTime).slice(0, 5)
        )
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({
        error: "Unable to load availability."
      });
    }
  }
);

app.get(
  "/api/patient/appointments",
  auth,
  role("patient"),
  async (req, res) => {
    const appointments = await Appointment.find({
      patientId: req.session.userId
    })
      .populate("doctorId", "fullName specialisation")
      .lean();

    const now = new Date();

    appointments.sort((a, b) => {
      const dateA = appointmentDateTime(a);
      const dateB = appointmentDateTime(b);
      const aUpcoming = dateA >= now;
      const bUpcoming = dateB >= now;

      if (aUpcoming && !bUpcoming) return -1;
      if (!aUpcoming && bUpcoming) return 1;

      return aUpcoming ? dateA - dateB : dateB - dateA;
    });

    res.json({
      appointments: appointments.map(appointment => ({
        id: appointment._id.toString(),
        appointmentDate: appointment.appointmentDate,
        appointmentTime: appointment.appointmentTime,
        location: appointment.location,
        notes: appointment.notes,
        status: appointment.status,
        doctorName:
          appointment.doctorId?.fullName || "Unavailable Doctor",
        specialisation:
          appointment.doctorId?.specialisation || ""
      }))
    });
  }
);

app.post(
  "/api/patient/appointments",
  auth,
  role("patient"),
  async (req, res) => {
    try {
      const {
        doctorId,
        appointmentDate,
        appointmentTime,
        location,
        notes = ""
      } = req.body;

      if (
        !doctorId ||
        !appointmentDate ||
        !appointmentTime ||
        !location
      ) {
        return res.status(400).json({
          error: "Complete the appointment details."
        });
      }

      if (!isObjectId(doctorId)) {
        return res.status(400).json({
          error: "Invalid doctor account."
        });
      }

      const doctor = await Account.findOne({
        _id: doctorId,
        role: "doctor",
        isActive: true
      });

      if (!doctor) {
        return res.status(404).json({
          error: "Doctor is unavailable."
        });
      }

      const existing = await Appointment.exists({
        doctorId,
        appointmentDate,
        appointmentTime,
        status: "Booked"
      });

      if (existing) {
        return res.status(409).json({
          error: "This time slot is already booked."
        });
      }

      await Appointment.create({
        patientId: req.session.userId,
        doctorId,
        appointmentDate,
        appointmentTime,
        location: String(location).trim(),
        notes: String(notes).trim()
      });

      res.status(201).json({
        message: "Appointment booked."
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({
        error: "Unable to book appointment."
      });
    }
  }
);

app.get(
  "/api/patient/prescriptions",
  auth,
  role("patient"),
  async (req, res) => {
    const prescriptions = await Prescription.find({
      patientId: req.session.userId
    })
      .populate("doctorId", "fullName")
      .sort({ createdAt: -1 })
      .lean();

    res.json({
      prescriptions: prescriptions.map(prescription => ({
        id: prescription._id.toString(),
        requestId: prescription.requestId,
        medicationName: prescription.medicationName,
        dosage: prescription.dosage,
        frequency: prescription.frequency,
        quantity: prescription.quantity,
        instructions: prescription.instructions,
        collectionLocation: prescription.collectionLocation,
        collectionPin: prescription.collectionPin,
        status: prescription.status,
        createdAt: prescription.createdAt,
        doctorName:
          prescription.doctorId?.fullName || "Unavailable Doctor"
      }))
    });
  }
);

app.post(
  "/api/patient/prescriptions/:id/collect",
  auth,
  role("patient"),
  async (req, res) => {
    if (!isObjectId(req.params.id)) {
      return res.status(404).json({
        error: "Prescription not found."
      });
    }

    const prescription = await Prescription.findOne({
      _id: req.params.id,
      patientId: req.session.userId
    });

    if (!prescription) {
      return res.status(404).json({
        error: "Prescription not found."
      });
    }

    if (prescription.status === "Collected") {
      return res.status(400).json({
        error: "Already collected."
      });
    }

    if (req.body.doorClosed === false) {
      return res.status(400).json({
        error: "Please close the locker door properly before collecting."
      });
    }

    prescription.status = "Collected";
    prescription.collectedAt = new Date();
    await prescription.save();

    res.json({ message: "Collection confirmed." });
  }
);

/* Doctor APIs */

app.get(
  "/api/doctor/patients",
  auth,
  role("doctor"),
  async (req, res) => {
    const appointments = await Appointment.find({
      doctorId: req.session.userId,
      status: { $ne: "Cancelled" }
    })
      .populate("patientId", "fullName email mobileNumber")
      .sort({ appointmentDate: 1, appointmentTime: 1 })
      .lean();

    const patients = [];
    const seen = new Set();

    for (const appointment of appointments) {
      const patient = appointment.patientId;
      if (!patient || seen.has(patient._id.toString())) {
        continue;
      }

      seen.add(patient._id.toString());
      patients.push({
        id: patient._id.toString(),
        fullName: patient.fullName,
        email: patient.email,
        mobileNumber: patient.mobileNumber
      });
    }

    res.json({ patients });
  }
);

app.get(
  "/api/doctor/appointments",
  auth,
  role("doctor"),
  async (req, res) => {
    const appointments = await Appointment.find({
      doctorId: req.session.userId
    })
      .populate("patientId", "fullName")
      .sort({ appointmentDate: 1, appointmentTime: 1 })
      .lean();

    res.json({
      appointments: appointments.map(appointment => ({
        id: appointment._id.toString(),
        appointmentDate: appointment.appointmentDate,
        appointmentTime: appointment.appointmentTime,
        location: appointment.location,
        status: appointment.status,
        patientName:
          appointment.patientId?.fullName || "Unavailable Patient"
      }))
    });
  }
);

app.get(
  "/api/doctor/prescriptions",
  auth,
  role("doctor"),
  async (req, res) => {
    const prescriptions = await Prescription.find({
      doctorId: req.session.userId
    })
      .populate("patientId", "fullName")
      .sort({ createdAt: -1 })
      .lean();

    res.json({
      prescriptions: prescriptions.map(prescription => ({
        id: prescription._id.toString(),
        requestId: prescription.requestId,
        medicationName: prescription.medicationName,
        dosage: prescription.dosage,
        frequency: prescription.frequency,
        quantity: prescription.quantity,
        collectionLocation: prescription.collectionLocation,
        collectionPin: prescription.collectionPin,
        status: prescription.status,
        createdAt: prescription.createdAt,
        patientName:
          prescription.patientId?.fullName || "Unavailable Patient"
      }))
    });
  }
);

app.post(
  "/api/doctor/prescriptions",
  auth,
  role("doctor"),
  async (req, res) => {
    try {
      const {
        patientId,
        medicationName,
        dosage,
        frequency,
        quantity,
        instructions = "",
        collectionLocation
      } = req.body;

      if (
        !patientId ||
        !medicationName ||
        !dosage ||
        !frequency ||
        !quantity ||
        !collectionLocation
      ) {
        return res.status(400).json({
          error: "Complete all prescription details."
        });
      }

      if (!isObjectId(patientId)) {
        return res.status(400).json({
          error: "Invalid patient account."
        });
      }

      const patient = await Account.findOne({
        _id: patientId,
        role: "patient",
        isActive: true
      });

      if (!patient) {
        return res.status(404).json({
          error: "Patient is unavailable."
        });
      }

      const hasConsultation = await Appointment.exists({
        doctorId: req.session.userId,
        patientId,
        status: { $ne: "Cancelled" }
      });

      if (!hasConsultation) {
        return res.status(400).json({
          error: "Only patients with a consultation can receive a prescription."
        });
      }

      const collectionPin = await generatePin();
      const requestId = await generateRequestId();

      await Prescription.create({
        requestId,
        patientId,
        doctorId: req.session.userId,
        medicationName: String(medicationName).trim(),
        dosage: String(dosage).trim(),
        frequency: String(frequency).trim(),
        quantity: Number(quantity),
        instructions: String(instructions).trim(),
        collectionLocation: String(collectionLocation).trim(),
        collectionPin
      });

      res.status(201).json({
        message: "Prescription sent.",
        requestId,
        collectionPin
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({
        error: "Unable to create prescription."
      });
    }
  }
);

/* Administrator APIs */

app.get(
  "/api/admin/doctors",
  auth,
  role("admin"),
  async (req, res) => {
    const doctors = await Account.find({ role: "doctor" })
      .sort({ createdAt: -1 })
      .lean();

    res.json({
      doctors: doctors.map(doctor => ({
        id: doctor._id.toString(),
        fullName: doctor.fullName,
        email: doctor.email,
        mobileNumber: doctor.mobileNumber,
        specialisation: doctor.specialisation,
        isActive: doctor.isActive,
        createdAt: doctor.createdAt
      }))
    });
  }
);

app.post(
  "/api/admin/doctors",
  auth,
  role("admin"),
  async (req, res) => {
    try {
      const {
        fullName,
        email,
        password,
        mobileNumber = "",
        specialisation = ""
      } = req.body;

      if (!fullName || !email || !password) {
        return res.status(400).json({
          error: "Full name, email and password are required."
        });
      }

      if (String(password).length < 8) {
        return res.status(400).json({
          error: "Password must contain at least 8 characters."
        });
      }

      const normalisedEmail = String(email).trim().toLowerCase();

      if (await Account.exists({ email: normalisedEmail })) {
        return res.status(409).json({
          error: "Email already registered."
        });
      }

      const doctor = await Account.create({
        fullName: String(fullName).trim(),
        email: normalisedEmail,
        passwordHash: await bcrypt.hash(String(password), 12),
        role: "doctor",
        mobileNumber: String(mobileNumber).trim(),
        specialisation: String(specialisation).trim(),
        isActive: true
      });

      res.status(201).json({
        message: "Doctor account created.",
        doctorId: doctor._id.toString()
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({
        error: "Unable to create doctor account."
      });
    }
  }
);

app.patch(
  "/api/admin/doctors/:id/access",
  auth,
  role("admin"),
  async (req, res) => {
    if (!isObjectId(req.params.id)) {
      return res.status(404).json({
        error: "Doctor not found."
      });
    }

    const doctor = await Account.findOneAndUpdate(
      { _id: req.params.id, role: "doctor" },
      { isActive: Boolean(req.body.isActive) },
      { new: true }
    );

    if (!doctor) {
      return res.status(404).json({
        error: "Doctor not found."
      });
    }

    res.json({
      message: doctor.isActive
        ? "Doctor access enabled."
        : "Doctor access disabled."
    });
  }
);

app.get(
  "/api/admin/availability",
  auth,
  role("admin"),
  async (req, res) => {
    const doctors = await Account.find({ role: "doctor" })
      .sort({ fullName: 1 })
      .lean();

    const appointments = await Appointment.find({ status: "Booked" })
      .populate("doctorId", "fullName")
      .sort({ appointmentDate: 1, appointmentTime: 1 })
      .lean();

    const now = new Date();

    const availability = doctors.map(doctor => {
      const doctorAppointments = appointments.filter(
        appointment =>
          appointment.doctorId &&
          appointment.doctorId._id.toString() === doctor._id.toString()
      );

      const nextAppointment = doctorAppointments.find(appointment => {
        const appointmentTime = new Date(
          `${appointment.appointmentDate}T${appointment.appointmentTime}:00`
        );
        return appointmentTime >= now;
      });

      return {
        id: doctor._id.toString(),
        fullName: doctor.fullName,
        specialisation: doctor.specialisation,
        status: nextAppointment ? "Booked" : "Open",
        nextAppointment: nextAppointment
          ? `${nextAppointment.appointmentDate} ${nextAppointment.appointmentTime}`
          : "No upcoming consultation"
      };
    });

    res.json({ availability });
  }
);

app.post(
  "/api/admin/doctors/:id/reset-password",
  auth,
  role("admin"),
  async (req, res) => {
    const password = String(req.body.password || "password");

    if (password.length < 8) {
      return res.status(400).json({
        error: "Password must contain at least 8 characters."
      });
    }

    if (!isObjectId(req.params.id)) {
      return res.status(404).json({
        error: "Doctor not found."
      });
    }

    const doctor = await Account.findOneAndUpdate(
      { _id: req.params.id, role: "doctor" },
      { passwordHash: await bcrypt.hash(password, 12) }
    );

    if (!doctor) {
      return res.status(404).json({
        error: "Doctor not found."
      });
    }

    res.json({ message: "Password reset." });
  }
);

app.delete(
  "/api/admin/doctors/:id",
  auth,
  role("admin"),
  async (req, res) => {
    if (!isObjectId(req.params.id)) {
      return res.status(404).json({
        error: "Doctor not found."
      });
    }

    const doctor = await Account.findOneAndDelete({
      _id: req.params.id,
      role: "doctor"
    });

    if (!doctor) {
      return res.status(404).json({
        error: "Doctor not found."
      });
    }

    await Promise.all([
      Appointment.deleteMany({ doctorId: req.params.id }),
      Prescription.deleteMany({ doctorId: req.params.id })
    ]);

    res.json({ message: "Doctor account removed." });
  }
);


/* Existing ESP8266-compatible dispense endpoint */

app.post("/api/iot/dispense", async (req, res) => {
  try {
    const {
      collectionPin,
      temp,
      humidity,
      doorClosed
    } = req.body;

    const pin = String(collectionPin || "").trim();
    const temperature = Number(temp);
    const humidityValue = Number(humidity);
    const isDoorClosed = Boolean(doorClosed);
    const deviceAddress = req.ip || "unknown-device";

    if (!/^\d{6}$/.test(pin)) {
      return res.status(400).json({
        status: "INVALID_PIN",
        message: "A six-digit PIN is required."
      });
    }

    if (!isDoorClosed) {
      return res.status(400).json({
        status: "DOOR_OPEN",
        message: "Close the locker door before dispensing."
      });
    }

    if (
      !Number.isFinite(temperature) ||
      !Number.isFinite(humidityValue) ||
      temperature < 15 ||
      temperature > 30 ||
      humidityValue > 70
    ) {
      return res.status(400).json({
        status: "ENVIRONMENT_ERROR",
        message: "Temperature or humidity is outside the safe range."
      });
    }

    const prescription = await Prescription.findOne({
      collectionPin: pin,
      status: "Ready"
    })
      .populate("patientId", "fullName")
      .populate("doctorId", "fullName");

    if (!prescription) {
      const failedAttempt =
        await FailedAttempt.findOneAndUpdate(
          {
            collectionPin: pin,
            deviceAddress
          },
          {
            $inc: { attemptCount: 1 },
            $set: { lastAttemptAt: new Date() }
          },
          {
            upsert: true,
            new: true,
            setDefaultsOnInsert: true
          }
        );

      if (failedAttempt.attemptCount > 2) {
        return res.status(403).json({
          status: "STAFF_INTERVENTION",
          message: "More than two failed attempts. Staff assistance is required.",
          attempts: failedAttempt.attemptCount
        });
      }

      return res.status(401).json({
        status: "INVALID_PIN",
        message: "Incorrect or already-used PIN.",
        attempts: failedAttempt.attemptCount
      });
    }

    await FailedAttempt.deleteMany({
      deviceAddress
    });

    prescription.status = "Collected";
    prescription.collectedAt = new Date();
    await prescription.save();

    return res.status(200).json({
      status: "SUCCESS",
      message: "PIN verified and medication collection recorded.",
      prescriptionId: prescription._id.toString(),
      requestId: prescription.requestId,
      patientName:
        prescription.patientId?.fullName || "Unknown patient",
      doctorName:
        prescription.doctorId?.fullName || "Unknown doctor",
      medicationName: prescription.medicationName,
      dosage: prescription.dosage,
      frequency: prescription.frequency,
      quantity: prescription.quantity,
      collectionLocation: prescription.collectionLocation,
      collectedAt: prescription.collectedAt
    });
  } catch (error) {
    console.error("IoT dispense error:", error);

    return res.status(500).json({
      status: "SERVER_ERROR",
      message: "Unable to process medication collection."
    });
  }
});


app.get("/api/health", (req, res) => {
  res.status(mongoose.connection.readyState === 1 ? 200 : 503).json({
    status: mongoose.connection.readyState === 1 ? "ok" : "database-disconnected",
    service: "medisync",
    timestamp: new Date().toISOString()
  });
});

app.use("/admin", express.static(path.join(__dirname, "admin")));
app.use("/patient", express.static(path.join(__dirname, "patient")));
app.use("/doctor", express.static(path.join(__dirname, "doctor")));

app.get("/", (req, res) => {
  res.redirect("/patient");
});

async function startServer() {
  try {
    await mongoose.connect(MONGODB_URI, {
      serverSelectionTimeoutMS: 15000
    });
    console.log("Connected to MongoDB.");

    await Promise.all([
      Account.init(),
      Appointment.init(),
      Prescription.init()
    ]);

    await seedDatabase();

    app.listen(PORT, () => {
      console.log(`Medisync running at http://localhost:${PORT}`);
      console.log(`Patient: http://localhost:${PORT}/patient`);
      console.log(`Doctor: http://localhost:${PORT}/doctor`);
      console.log(`Admin: http://localhost:${PORT}/admin`);
    });
  } catch (error) {
    console.error("Unable to start Medisync:", error.message);
    console.error(
      "Check MONGODB_URI in your .env file and confirm MongoDB is running."
    );
    process.exit(1);
  }
}

startServer();
