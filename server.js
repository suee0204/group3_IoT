require("dotenv").config();

const path = require("path");
const express = require("express");
const session = require("express-session");
const MongoStore = require("connect-mongo");
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const rateLimit = require("express-rate-limit");
const helmet = require("helmet");
const crypto = require("crypto");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const MONGODB_URI =
  process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/medisync";

const { Schema } = mongoose;


/* =========================================================
   Email OTP for patient appointment booking (Resend HTTPS API)
   ========================================================= */
function generateOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function sendResendEmail({ to, subject, text }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM;

  if (!apiKey) {
    throw new Error("RESEND_API_KEY is not configured.");
  }

  if (!from) {
    throw new Error("RESEND_FROM is not configured.");
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject,
      text
    })
  });

  const result = await response.json().catch(() => ({}));

  if (!response.ok) {
    const detail = result?.message || result?.name || `HTTP ${response.status}`;
    throw new Error(`Resend email failed: ${detail}`);
  }

  return result;
}

async function sendAppointmentOtp({
  toEmail,
  otp,
  doctorName,
  appointmentDate,
  appointmentTime
}) {
  await sendResendEmail({
    to: toEmail,
    subject: "Your Medisync appointment verification code",
    text:
      `You are booking an appointment with ${doctorName}.\n\n` +
      `Date: ${appointmentDate}\n` +
      `Time: ${appointmentTime}\n\n` +
      `Your 6-digit verification code is: ${otp}\n\n` +
      `This code expires in 5 minutes.\n\n` +
      `If you did not request this appointment, you can ignore this email.`
  });
}

async function sendAppointmentConfirmedEmail({
  toEmail,
  doctorName,
  appointmentDate,
  appointmentTime,
  location
}) {
  await sendResendEmail({
    to: toEmail,
    subject: "Your Medisync appointment is confirmed",
    text:
      `Your appointment has been confirmed.\n\n` +
      `Doctor: ${doctorName}\n` +
      `Date: ${appointmentDate}\n` +
      `Time: ${appointmentTime}\n` +
      `Location: ${location}\n\n` +
      `Thank you for using Medisync.`
  });
}

if (process.env.NODE_ENV === "production") app.set("trust proxy", 1);
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));

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
    isActive: { type: Boolean, default: true },
    mustChangePassword: { type: Boolean, default: false },
    passwordChangedAt: { type: Date, default: null },
    isOnline: { type: Boolean, default: false },
    lastSeenAt: { type: Date, default: null },
    // RFID UID linked to doctor accounts.
    rfidUid: {
      type: String,
      default: null,
      unique: true,
      sparse: true,
      uppercase: true,
      trim: true
    }
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
    appointmentId: {
      type: Schema.Types.ObjectId,
      ref: "Appointment",
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
    collectedAt: { type: Date, default: null },
    lockerId: { type: String, default: "" },
    doorConfirmedAt: { type: Date, default: null },
    collectionConfirmedByDevice: { type: Boolean, default: false },
    followUpRequired: { type: Boolean, default: false },
    followUpReason: { type: String, default: "", trim: true },
    followUpBooked: { type: Boolean, default: false },
    followUpAppointmentId: {
      type: Schema.Types.ObjectId,
      ref: "Appointment",
      default: null
    }
  },
  { timestamps: true }
);

const Account = mongoose.model("Account", accountSchema);
const Appointment = mongoose.model("Appointment", appointmentSchema);
const Prescription = mongoose.model("Prescription", prescriptionSchema);

const auditLogSchema = new Schema({
  actorType:{type:String,required:true}, actorId:{type:String,default:""},
  action:{type:String,required:true,index:true}, targetType:{type:String,default:""},
  targetId:{type:String,default:""}, lockerId:{type:String,default:"",index:true},
  success:{type:Boolean,default:true}, ipAddress:{type:String,default:""},
  metadata:{type:Schema.Types.Mixed,default:{}}, occurredAt:{type:Date,default:Date.now,index:true}
},{timestamps:true});
const deviceSchema = new Schema({
  deviceId:{type:String,required:true,unique:true,index:true},
  lockerId:{type:String,required:true,unique:true,index:true},
  apiKeyHash:{type:String,required:true}, displayName:{type:String,default:""},
  enabled:{type:Boolean,default:true}, lastSeenAt:{type:Date,default:null},
  firmwareVersion:{type:String,default:""}
},{timestamps:true});
const sensorRecordSchema = new Schema({
  deviceId:{type:String,required:true,index:true}, lockerId:{type:String,required:true,index:true},
  temperature:{type:Number,required:true}, humidity:{type:Number,required:true},
  doorClosed:{type:Boolean,required:true}, temperatureAlert:{type:Boolean,default:false},
  recordedAt:{type:Date,default:Date.now,index:true}
},{timestamps:true});
const temperatureAlertSchema = new Schema({
  deviceId:{type:String,required:true,index:true}, lockerId:{type:String,required:true,index:true},
  temperature:Number, humidity:Number, threshold:{type:String,required:true},
  status:{type:String,enum:["Open","Acknowledged","Resolved"],default:"Open"},
  raisedAt:{type:Date,default:Date.now,index:true}, resolvedAt:{type:Date,default:null}
},{timestamps:true});
const collectionSessionSchema = new Schema({
  prescriptionId:{type:Schema.Types.ObjectId,ref:"Prescription",required:true,index:true},
  deviceId:{type:String,required:true,index:true}, lockerId:{type:String,required:true,index:true},
  status:{type:String,enum:["PIN_VERIFIED","AWAITING_DOOR_CLOSE","COMPLETED"],default:"PIN_VERIFIED"},
  verifiedAt:{type:Date,default:Date.now}, completedAt:{type:Date,default:null},
  expiresAt:{type:Date,required:true}
},{timestamps:true});
collectionSessionSchema.index({expiresAt:1},{expireAfterSeconds:0});
const AuditLog=mongoose.model("AuditLog",auditLogSchema);
const Device=mongoose.model("Device",deviceSchema);
const SensorRecord=mongoose.model("SensorRecord",sensorRecordSchema);
const TemperatureAlert=mongoose.model("TemperatureAlert",temperatureAlertSchema);
const CollectionSession=mongoose.model("CollectionSession",collectionSessionSchema);


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


const loginLimiter=rateLimit({windowMs:15*60*1000,limit:8,standardHeaders:"draft-7",legacyHeaders:false,message:{error:"Too many login attempts. Try again in 15 minutes."}});
const pinLimiter=rateLimit({windowMs:10*60*1000,limit:12,standardHeaders:"draft-7",legacyHeaders:false,message:{status:"RATE_LIMITED",error:"Too many PIN attempts. Staff assistance is required."}});
const hashDeviceKey=key=>crypto.createHash("sha256").update(String(key)).digest("hex");
async function audit(req,data){try{await AuditLog.create({...data,actorId:String(data.actorId||""),targetId:String(data.targetId||""),ipAddress:req?.ip||"",occurredAt:new Date()});}catch(e){console.error("Audit log error:",e.message)}}
async function authenticateDevice(req,res,next){
  const deviceId=String(req.get("x-device-id")||req.body?.deviceId||"").trim();
  const key=String(req.get("x-device-key")||req.body?.deviceApiKey||"").trim();
  const device=await Device.findOne({deviceId,enabled:true});
  if(!device||device.apiKeyHash!==hashDeviceKey(key)){
    await audit(req,{actorType:"device",actorId:deviceId,action:"DEVICE_AUTH_FAILED",success:false});
    return res.status(401).json({status:"DEVICE_AUTH_FAILED",error:"Device authentication failed."});
  }
  device.lastSeenAt=new Date(); await device.save(); req.device=device; next();
}
function requirePasswordChanged(req,res,next){if(req.session.mustChangePassword)return res.status(403).json({error:"Password change required.",code:"PASSWORD_CHANGE_REQUIRED"});next();}

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
    specialisation: account.specialisation,
    rfidUid: account.rfidUid || null
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

app.post("/api/login", loginLimiter, async (req, res) => {
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
      await audit(req,{actorType:"system",action:"LOGIN_FAILED",success:false,metadata:{email}});
      return res.status(401).json({error:"Incorrect email or password."});
    }

    req.session.userId=account._id.toString(); req.session.role=account.role;
    req.session.mustChangePassword=account.mustChangePassword===true;
    await audit(req,{actorType:account.role,actorId:account._id,action:"LOGIN_SUCCESS",targetType:"Account",targetId:account._id,success:true});
    res.json({account:{...accountView(account),mustChangePassword:account.mustChangePassword===true}});
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


app.post("/api/change-password",auth,async(req,res)=>{
  const newPassword=String(req.body.newPassword||"");
  if(newPassword.length<10||!/[A-Z]/.test(newPassword)||!/[a-z]/.test(newPassword)||!/\d/.test(newPassword))
    return res.status(400).json({error:"Use at least 10 characters with uppercase, lowercase and numbers."});
  const account=await Account.findById(req.session.userId); if(!account)return res.status(404).json({error:"Account not found."});
  account.passwordHash=await bcrypt.hash(newPassword,12); account.mustChangePassword=false; account.passwordChangedAt=new Date(); await account.save();
  req.session.mustChangePassword=false; await audit(req,{actorType:account.role,actorId:account._id,action:"PASSWORD_CHANGED",targetType:"Account",targetId:account._id,success:true});
  res.json({message:"Password changed successfully."});
});

app.post("/api/logout", auth, async (req, res) => {
  try {
    if (req.session.role === "doctor") {
      await Account.findByIdAndUpdate(
        req.session.userId,
        {
          isOnline: false,
          lastSeenAt: new Date()
        }
      );
    }

    req.session.destroy(() => {
      res.clearCookie("medisync.sid");
      res.json({ message: "Logged out." });
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: "Unable to log out."
    });
  }
});

/* Patient APIs */

app.get(
  "/api/patient/doctors",
  auth,
  requirePasswordChanged,
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
  requirePasswordChanged,
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
  "/api/patient/follow-ups",
  auth,
  requirePasswordChanged,
  role("patient"),
  async (req, res) => {
    const reminders = await Prescription.find({
      patientId: req.session.userId,
      followUpRequired: true,
      followUpBooked: false
    })
      .populate("doctorId", "fullName specialisation")
      .sort({ createdAt: -1 })
      .lean();

    res.json({
      followUps: reminders.map(reminder => ({
        id: reminder._id.toString(),
        doctorId: reminder.doctorId?._id?.toString() || "",
        doctorName:
          reminder.doctorId?.fullName || "Unavailable Doctor",
        specialisation:
          reminder.doctorId?.specialisation || "",
        reason:
          reminder.followUpReason ||
          "A follow-up consultation is recommended.",
        medicationName: reminder.medicationName,
        createdAt: reminder.createdAt
      }))
    });
  }
);

app.get(
  "/api/patient/appointments",
  auth,
  requirePasswordChanged,
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
  "/api/patient/appointments/request-otp",
  auth,
  requirePasswordChanged,
  role("patient"),
  async (req, res) => {
    try {
      const {
        doctorId,
        appointmentDate,
        appointmentTime,
        location,
        notes = "",
        followUpPrescriptionId = ""
      } = req.body;

      const validAppointmentTimes = new Set([
        "08:00",
        "08:30",
        "09:00",
        "09:30",
        "10:00",
        "10:30",
        "11:00",
        "11:30",
        "12:00",
        "12:30",
        "13:00",
        "13:30",
        "14:00",
        "14:30",
        "15:00",
        "15:30",
        "16:00",
        "16:30",
        "17:00",
        "17:30"
      ]);

      if (!doctorId || !appointmentDate || !appointmentTime || !location) {
        return res.status(400).json({
          error: "Complete the appointment details."
        });
      }

      if (!validAppointmentTimes.has(String(appointmentTime).slice(0, 5))) {
        return res.status(400).json({
          error: "Select a valid 30-minute appointment slot."
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

      const patient = await Account.findById(req.session.userId);

      if (!patient || !patient.isActive) {
        return res.status(401).json({
          error: "Patient account is unavailable."
        });
      }

      const otp = generateOtp();

      req.session.pendingAppointment = {
        doctorId: String(doctorId),
        doctorName: doctor.fullName,
        appointmentDate,
        appointmentTime,
        location: String(location).trim(),
        notes: String(notes).trim(),
        followUpPrescriptionId: String(followUpPrescriptionId || ""),
        otp,
        expiresAt: Date.now() + 5 * 60 * 1000
      };

      try {
        await sendAppointmentOtp({
          toEmail: patient.email,
          otp,
          doctorName: doctor.fullName,
          appointmentDate,
          appointmentTime
        });
      } catch (mailError) {
        console.error("Failed to send OTP email:", mailError);
        delete req.session.pendingAppointment;
        return res.status(502).json({
          error: "Could not send verification email. Please try again."
        });
      }

      res.json({
        message: `A 6-digit verification code has been sent to ${patient.email}.`
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({
        error: "Unable to send appointment verification code."
      });
    }
  }
);

app.post(
  "/api/patient/appointments/confirm-otp",
  auth,
  requirePasswordChanged,
  role("patient"),
  async (req, res) => {
    try {
      const pending = req.session.pendingAppointment;
      const submittedOtp = String(req.body.otp || "").trim();

      if (!pending) {
        return res.status(400).json({
          error: "No pending appointment found. Please book again."
        });
      }

      if (Date.now() > pending.expiresAt) {
        delete req.session.pendingAppointment;
        return res.status(400).json({
          error: "Verification code has expired. Please request a new one."
        });
      }

      if (!/^\d{6}$/.test(submittedOtp) || submittedOtp !== pending.otp) {
        return res.status(400).json({
          error: "Incorrect verification code."
        });
      }

      const existing = await Appointment.exists({
        doctorId: pending.doctorId,
        appointmentDate: pending.appointmentDate,
        appointmentTime: pending.appointmentTime,
        status: "Booked"
      });

      if (existing) {
        delete req.session.pendingAppointment;
        return res.status(409).json({
          error: "This appointment slot was just booked by another patient."
        });
      }

      const appointment = await Appointment.create({
        patientId: req.session.userId,
        doctorId: pending.doctorId,
        appointmentDate: pending.appointmentDate,
        appointmentTime: pending.appointmentTime,
        location: pending.location,
        notes: pending.notes
      });

      if (
        pending.followUpPrescriptionId &&
        mongoose.Types.ObjectId.isValid(pending.followUpPrescriptionId)
      ) {
        await Prescription.findOneAndUpdate(
          {
            _id: pending.followUpPrescriptionId,
            patientId: req.session.userId,
            doctorId: pending.doctorId,
            followUpRequired: true,
            followUpBooked: false
          },
          {
            followUpBooked: true,
            followUpAppointmentId: appointment._id
          }
        );

        await audit(req, {
          actorType: "patient",
          actorId: req.session.userId,
          action: "FOLLOW_UP_APPOINTMENT_BOOKED",
          targetType: "Appointment",
          targetId: appointment._id,
          success: true,
          metadata: {
            prescriptionId: pending.followUpPrescriptionId,
            doctorId: String(pending.doctorId)
          }
        });
      }

      const patient = await Account.findById(req.session.userId);
      const confirmation = {
        doctorName: pending.doctorName,
        appointmentDate: pending.appointmentDate,
        appointmentTime: pending.appointmentTime,
        location: pending.location
      };

      delete req.session.pendingAppointment;

      if (patient) {
        sendAppointmentConfirmedEmail({
          toEmail: patient.email,
          ...confirmation
        }).catch(mailError => {
          console.error("Unable to send confirmation email:", mailError);
        });
      }

      res.status(201).json({
        message: "Email verified. Appointment booked successfully.",
        appointmentId: appointment._id.toString()
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({
        error: "Unable to verify appointment."
      });
    }
  }
);

app.get(
  "/api/patient/prescriptions",
  auth,
  requirePasswordChanged,
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
        followUpRequired: prescription.followUpRequired,
        followUpReason: prescription.followUpReason,
        followUpBooked: prescription.followUpBooked,
        followUpAppointmentId:
          prescription.followUpAppointmentId?.toString() || null,
        doctorName:
          prescription.doctorId?.fullName || "Unavailable Doctor"
      }))
    });
  }
);

app.post(
  "/api/patient/prescriptions/:id/collect",
  auth,
  requirePasswordChanged,
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


app.post(
  "/api/doctor/heartbeat",
  auth,
  requirePasswordChanged,
  role("doctor"),
  async (req, res) => {
    await Account.findByIdAndUpdate(
      req.session.userId,
      {
        isOnline: true,
        lastSeenAt: new Date()
      }
    );

    res.json({
      success: true,
      timestamp: new Date().toISOString()
    });
  }
);

/* Doctor APIs */

app.get(
  "/api/doctor/patients",
  auth,
  requirePasswordChanged,
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
  "/api/doctor/appointments/:id",
  auth,
  requirePasswordChanged,
  role("doctor"),
  async (req, res) => {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(404).json({ error: "Appointment not found." });
    }

    const appointment = await Appointment.findOne({
      _id: req.params.id,
      doctorId: req.session.userId
    })
      .populate("patientId", "fullName email mobileNumber")
      .lean();

    if (!appointment || !appointment.patientId) {
      return res.status(404).json({ error: "Appointment not found." });
    }

    const prescriptions = await Prescription.find({
      appointmentId: appointment._id,
      doctorId: req.session.userId
    })
      .sort({ createdAt: -1 })
      .lean();

    res.json({
      appointment: {
        id: appointment._id.toString(),
        patientId: appointment.patientId._id.toString(),
        patientName: appointment.patientId.fullName,
        patientEmail: appointment.patientId.email,
        patientMobile: appointment.patientId.mobileNumber,
        appointmentDate: appointment.appointmentDate,
        appointmentTime: appointment.appointmentTime,
        location: appointment.location,
        notes: appointment.notes,
        status: appointment.status
      },
      prescriptions: prescriptions.map(prescription => ({
        id: prescription._id.toString(),
        requestId: prescription.requestId,
        medicationName: prescription.medicationName,
        dosage: prescription.dosage,
        frequency: prescription.frequency,
        quantity: prescription.quantity,
        status: prescription.status,
        createdAt: prescription.createdAt
      }))
    });
  }
);

app.get(
  "/api/doctor/appointments",
  auth,
  requirePasswordChanged,
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
        notes: appointment.notes,
        status: appointment.status,
        patientId: appointment.patientId?._id?.toString() || "",
        patientName:
          appointment.patientId?.fullName || "Unavailable Patient"
      }))
    });
  }
);

app.get(
  "/api/doctor/prescriptions",
  auth,
  requirePasswordChanged,
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
  requirePasswordChanged,
  role("doctor"),
  async (req, res) => {
    try {
      const {
        appointmentId,
        patientId,
        medicationName,
        dosage,
        frequency,
        quantity,
        instructions = "",
        followUpRequired = false,
        followUpReason = ""
      } = req.body;

      if (
        !appointmentId ||
        !patientId ||
        !medicationName ||
        !dosage ||
        !frequency ||
        !quantity
      ) {
        return res.status(400).json({
          error: "Complete all prescription details."
        });
      }

      if (!isObjectId(patientId) || !isObjectId(appointmentId)) {
        return res.status(400).json({
          error: "Invalid appointment or patient account."
        });
      }

      const appointment = await Appointment.findOne({
        _id: appointmentId,
        doctorId: req.session.userId,
        patientId,
        status: { $ne: "Cancelled" }
      });

      if (!appointment) {
        return res.status(403).json({
          error: "Open one of your appointments before creating a prescription."
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

      const appointmentDateTime = new Date(
        `${appointment.appointmentDate}T${String(appointment.appointmentTime).slice(0, 5)}:00`
      );

      if (appointment.status !== "Completed" && appointmentDateTime > new Date()) {
        return res.status(403).json({
          error: "A prescription can only be issued during or after the consultation."
        });
      }

      const collectionPin = await generatePin();
      const requestId = await generateRequestId();

      const createdPrescription = await Prescription.create({
        requestId,
        patientId,
        doctorId: req.session.userId,
        appointmentId,
        medicationName: String(medicationName).trim(),
        dosage: String(dosage).trim(),
        frequency: String(frequency).trim(),
        quantity: Number(quantity),
        instructions: String(instructions).trim(),
        collectionLocation: appointment.location,
        collectionPin,
        followUpRequired: Boolean(followUpRequired),
        followUpReason: Boolean(followUpRequired)
          ? String(followUpReason || "").trim()
          : "",
        followUpBooked: false
      });

      await audit(req,{actorType:"doctor",actorId:req.session.userId,action:"PRESCRIPTION_CREATED",targetType:"Prescription",targetId:createdPrescription._id,success:true,metadata:{requestId,patientId:String(patientId),appointmentId:String(appointmentId),medicationName:createdPrescription.medicationName}});

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
  "/api/admin/room-availability",
  auth,
  requirePasswordChanged,
  role("admin"),
  async (req, res) => {
    const selectedDate =
      String(req.query.date || "") ||
      new Date().toISOString().slice(0, 10);

    if (!/^\d{4}-\d{2}-\d{2}$/.test(selectedDate)) {
      return res.status(400).json({
        error: "Invalid date."
      });
    }

    const slotTimes = [
      "08:00", "08:30", "09:00", "09:30",
      "10:00", "10:30", "11:00", "11:30",
      "12:00", "12:30", "13:00", "13:30",
      "14:00", "14:30", "15:00", "15:30",
      "16:00", "16:30", "17:00", "17:30"
    ];

    const configuredRooms = [
      "Consultation Room 1",
      "Consultation Room 2",
      "Consultation Room 3",
      "Consultation Room 4"
    ];

    const appointments = await Appointment.find({
      appointmentDate: selectedDate,
      status: { $ne: "Cancelled" }
    })
      .populate("doctorId", "fullName")
      .populate("patientId", "fullName")
      .lean();

    const roomBookings = new Map();

    appointments.forEach(appointment => {
      const roomName =
        String(appointment.location || "").trim() ||
        "Unassigned Room";

      if (!roomBookings.has(roomName)) {
        roomBookings.set(roomName, new Map());
      }

      roomBookings
        .get(roomName)
        .set(
          String(appointment.appointmentTime).slice(0, 5),
          {
            appointmentId: appointment._id.toString(),
            doctorName:
              appointment.doctorId?.fullName || "Unknown Doctor",
            patientName:
              appointment.patientId?.fullName || "Unknown Patient"
          }
        );
    });

    const allRooms = [
      ...new Set([
        ...configuredRooms,
        ...roomBookings.keys()
      ])
    ];

    res.json({
      date: selectedDate,
      rooms: allRooms.map(roomName => {
        const bookings =
          roomBookings.get(roomName) || new Map();

        return {
          roomName,
          slots: slotTimes.map(time => {
            const booking = bookings.get(time);

            return {
              time,
              available: !booking,
              appointmentId:
                booking?.appointmentId || null,
              doctorName:
                booking?.doctorName || "",
              patientName:
                booking?.patientName || ""
            };
          })
        };
      })
    });
  }
);


app.get(
  "/api/admin/medication-usage",
  auth,
  requirePasswordChanged,
  role("admin"),
  async (req, res) => {
    const selectedDate =
      String(req.query.date || "") ||
      new Date().toISOString().slice(0, 10);

    if (!/^\d{4}-\d{2}-\d{2}$/.test(selectedDate)) {
      return res.status(400).json({
        error: "Invalid date."
      });
    }

    const startOfDay = new Date(`${selectedDate}T00:00:00.000`);
    const endOfDay = new Date(`${selectedDate}T23:59:59.999`);

    const prescriptions = await Prescription.find({
      status: "Collected",
      collectedAt: {
        $gte: startOfDay,
        $lte: endOfDay
      }
    })
      .populate("patientId", "fullName")
      .populate("doctorId", "fullName")
      .sort({ collectedAt: 1 })
      .lean();

    const medicationMap = new Map();

    prescriptions.forEach(prescription => {
      const medicationName =
        String(prescription.medicationName || "Unknown Medication").trim();

      if (!medicationMap.has(medicationName)) {
        medicationMap.set(medicationName, {
          medicationName,
          totalQuantity: 0,
          collectionCount: 0,
          details: []
        });
      }

      const group = medicationMap.get(medicationName);
      const quantity = Number(prescription.quantity) || 0;

      group.totalQuantity += quantity;
      group.collectionCount += 1;
      group.details.push({
        prescriptionId: prescription._id.toString(),
        requestId: prescription.requestId,
        patientName:
          prescription.patientId?.fullName || "Unknown Patient",
        doctorName:
          prescription.doctorId?.fullName || "Unknown Doctor",
        dosage: prescription.dosage,
        frequency: prescription.frequency,
        quantity,
        collectedAt: prescription.collectedAt,
        lockerId: prescription.lockerId || ""
      });
    });

    const medications = [...medicationMap.values()]
      .sort((a, b) =>
        a.medicationName.localeCompare(b.medicationName)
      );

    const totalMedicationQuantity = medications.reduce(
      (sum, medication) => sum + medication.totalQuantity,
      0
    );

    res.json({
      date: selectedDate,
      summary: {
        totalMedicationQuantity,
        totalCollections: prescriptions.length,
        uniqueMedicationTypes: medications.length
      },
      medications
    });
  }
);

app.get(
  "/api/admin/doctors",
  auth,
  requirePasswordChanged,
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
        loginStatus:
          doctor.isOnline &&
          doctor.lastSeenAt &&
          doctor.lastSeenAt >= new Date(Date.now() - 45000)
            ? "Online"
            : "Offline",
        lastSeenAt: doctor.lastSeenAt,
        createdAt: doctor.createdAt
      }))
    });
  }
);

app.post(
  "/api/admin/doctors",
  auth,
  requirePasswordChanged,
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

app.delete(
  "/api/admin/doctors/:id",
  auth,
  requirePasswordChanged,
  role("admin"),
  async (req, res) => {
    try {
      if (!isObjectId(req.params.id)) {
        return res.status(404).json({
          error: "Doctor not found."
        });
      }

      const doctor = await Account.findOne({
        _id: req.params.id,
        role: "doctor"
      });

      if (!doctor) {
        return res.status(404).json({
          error: "Doctor not found."
        });
      }

      // Keep historical appointment and prescription records intact.
      // Removing the account only removes the doctor's login/account record.
      await Account.deleteOne({ _id: doctor._id });

      await audit(req, {
        actorType: "admin",
        actorId: req.session.userId,
        action: "DOCTOR_ACCOUNT_REMOVED",
        targetType: "Account",
        targetId: doctor._id,
        success: true,
        metadata: {
          fullName: doctor.fullName,
          email: doctor.email
        }
      });

      return res.json({
        message: "Doctor account removed."
      });
    } catch (error) {
      console.error(error);
      return res.status(500).json({
        error: "Unable to remove doctor account."
      });
    }
  }
);

app.patch(
  "/api/admin/doctors/:id/access",
  auth,
  requirePasswordChanged,
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

app.patch(
  "/api/admin/doctors/:id/rfid",
  auth,
  requirePasswordChanged,
  role("admin"),
  async (req, res) => {
    try {
      if (!isObjectId(req.params.id)) {
        return res.status(404).json({ error: "Doctor not found." });
      }

      const rfidUid = String(req.body.rfidUid || "").trim().toUpperCase();

      if (!/^[A-F0-9]{8}$/.test(rfidUid)) {
        return res.status(400).json({
          error: "RFID UID must be exactly 8 hexadecimal characters."
        });
      }

      const clash = await Account.exists({
        rfidUid,
        _id: { $ne: req.params.id }
      });

      if (clash) {
        return res.status(409).json({
          error: "That RFID tag is already linked to another doctor."
        });
      }

      const doctor = await Account.findOneAndUpdate(
        { _id: req.params.id, role: "doctor" },
        { rfidUid },
        { new: true }
      );

      if (!doctor) {
        return res.status(404).json({ error: "Doctor not found." });
      }

      await audit(req, {
        actorType: "admin",
        actorId: req.session.userId,
        action: "DOCTOR_RFID_LINKED",
        targetType: "Account",
        targetId: doctor._id,
        success: true,
        metadata: { rfidUid }
      });

      return res.json({
        message: "RFID tag linked to doctor.",
        rfidUid
      });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: "Unable to link RFID tag." });
    }
  }
);

app.post(
  "/api/admin/doctors/:id/reset-password",
  auth,
  requirePasswordChanged,
  role("admin"),
  async (req, res) => {
    try {
      if (!isObjectId(req.params.id)) {
        return res.status(404).json({ error: "Doctor not found." });
      }

      const temporaryPassword = String(req.body.password || "");

      if (temporaryPassword.length < 8) {
        return res.status(400).json({
          error: "Password must contain at least 8 characters."
        });
      }

      const doctor = await Account.findOneAndUpdate(
        { _id: req.params.id, role: "doctor" },
        {
          passwordHash: await bcrypt.hash(temporaryPassword, 12),
          mustChangePassword: true,
          passwordChangedAt: new Date()
        },
        { new: true }
      );

      if (!doctor) {
        return res.status(404).json({ error: "Doctor not found." });
      }

      await audit(req, {
        actorType: "admin",
        actorId: req.session.userId,
        action: "DOCTOR_PASSWORD_RESET",
        targetType: "Account",
        targetId: doctor._id,
        success: true,
        metadata: { email: doctor.email }
      });

      return res.json({
        message: "Doctor password reset successfully. The doctor must change it after signing in."
      });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: "Unable to reset doctor password." });
    }
  }
);

/* Existing ESP8266-compatible dispense endpoint */


app.post("/api/iot/sensor",authenticateDevice,async(req,res)=>{
  const temperature=Number(req.body.temp),humidity=Number(req.body.humidity),doorClosed=Boolean(req.body.doorClosed);
  if(!Number.isFinite(temperature)||!Number.isFinite(humidity))return res.status(400).json({status:"INVALID_SENSOR_DATA"});
  const min=Number(process.env.MIN_SAFE_TEMPERATURE||15),max=Number(process.env.MAX_SAFE_TEMPERATURE||30),maxH=Number(process.env.MAX_SAFE_HUMIDITY||70);
  const alert=temperature<min||temperature>max||humidity>maxH;
  const record=await SensorRecord.create({deviceId:req.device.deviceId,lockerId:req.device.lockerId,temperature,humidity,doorClosed,temperatureAlert:alert,recordedAt:new Date()});
  if(alert){const threshold=temperature<min?`Temperature below ${min}C`:temperature>max?`Temperature above ${max}C`:`Humidity above ${maxH}%`;await TemperatureAlert.create({deviceId:req.device.deviceId,lockerId:req.device.lockerId,temperature,humidity,threshold});await audit(req,{actorType:"device",actorId:req.device.deviceId,action:"TEMPERATURE_ALERT_RAISED",targetType:"SensorRecord",targetId:record._id,lockerId:req.device.lockerId,success:false,metadata:{temperature,humidity,threshold}})}
  res.json({status:alert?"TEMPERATURE_ALERT":"SENSOR_RECORDED",recordedAt:record.recordedAt});
});

app.post("/api/iot/dispense",pinLimiter,authenticateDevice,async(req,res)=>{
  try{
    const pin=String(req.body.collectionPin||"").trim(),temperature=Number(req.body.temp),humidity=Number(req.body.humidity),doorClosed=Boolean(req.body.doorClosed);
    if(!/^\d{6}$/.test(pin))return res.status(400).json({status:"INVALID_PIN"});
    const min=Number(process.env.MIN_SAFE_TEMPERATURE||15),max=Number(process.env.MAX_SAFE_TEMPERATURE||30),maxH=Number(process.env.MAX_SAFE_HUMIDITY||70);
    const unsafe=!Number.isFinite(temperature)||!Number.isFinite(humidity)||temperature<min||temperature>max||humidity>maxH;
    await SensorRecord.create({deviceId:req.device.deviceId,lockerId:req.device.lockerId,temperature:Number.isFinite(temperature)?temperature:-999,humidity:Number.isFinite(humidity)?humidity:-999,doorClosed,temperatureAlert:unsafe,recordedAt:new Date()});
    if(unsafe){await TemperatureAlert.create({deviceId:req.device.deviceId,lockerId:req.device.lockerId,temperature:Number.isFinite(temperature)?temperature:-999,humidity:Number.isFinite(humidity)?humidity:-999,threshold:"Unsafe medication storage environment"});return res.status(409).json({status:"ENVIRONMENT_ERROR",message:"Dispensing blocked due to unsafe storage conditions."})}
    if(!doorClosed)return res.status(409).json({status:"DOOR_OPEN",message:"Close locker before PIN verification."});
    const prescription=await Prescription.findOne({collectionPin:pin,status:"Ready"});
    if(!prescription){await audit(req,{actorType:"device",actorId:req.device.deviceId,action:"COLLECTION_PIN_REJECTED",lockerId:req.device.lockerId,success:false});return res.status(401).json({status:"INVALID_PIN"})}
    const session=await CollectionSession.create({prescriptionId:prescription._id,deviceId:req.device.deviceId,lockerId:req.device.lockerId,expiresAt:new Date(Date.now()+10*60*1000)});
    prescription.lockerId=req.device.lockerId;await prescription.save();
    await audit(req,{actorType:"device",actorId:req.device.deviceId,action:"COLLECTION_PIN_VERIFIED",targetType:"Prescription",targetId:prescription._id,lockerId:req.device.lockerId,success:true});
    res.json({status:"SUCCESS",collectionSessionId:session._id.toString(),prescriptionId:prescription._id.toString(),lockerId:req.device.lockerId,medicationName:prescription.medicationName,quantity:prescription.quantity});
  }catch(e){console.error(e);res.status(500).json({status:"SERVER_ERROR"})}
});

app.post("/api/iot/confirm-door",authenticateDevice,async(req,res)=>{
  const id=String(req.body.collectionSessionId||""),doorClosed=Boolean(req.body.doorClosed),temperature=Number(req.body.temp),humidity=Number(req.body.humidity);
  if(!mongoose.Types.ObjectId.isValid(id))return res.status(400).json({status:"INVALID_SESSION"});
  const session=await CollectionSession.findOne({_id:id,deviceId:req.device.deviceId,lockerId:req.device.lockerId,status:{$ne:"COMPLETED"}});
  if(!session)return res.status(404).json({status:"SESSION_NOT_FOUND"});
  await SensorRecord.create({deviceId:req.device.deviceId,lockerId:req.device.lockerId,temperature:Number.isFinite(temperature)?temperature:-999,humidity:Number.isFinite(humidity)?humidity:-999,doorClosed,temperatureAlert:false,recordedAt:new Date()});
  if(!doorClosed){session.status="AWAITING_DOOR_CLOSE";await session.save();return res.status(409).json({status:"DOOR_OPEN",message:"Close locker door."})}
  const prescription=await Prescription.findOneAndUpdate({_id:session.prescriptionId,status:"Ready"},{status:"Collected",collectedAt:new Date(),doorConfirmedAt:new Date(),collectionConfirmedByDevice:true,lockerId:req.device.lockerId},{new:true});
  if(!prescription)return res.status(404).json({status:"PRESCRIPTION_NOT_FOUND"});
  session.status="COMPLETED";session.completedAt=new Date();await session.save();
  await audit(req,{actorType:"device",actorId:req.device.deviceId,action:"COLLECTION_COMPLETED",targetType:"Prescription",targetId:prescription._id,lockerId:req.device.lockerId,success:true});
  res.json({status:"COLLECTION_COMPLETED",collectedAt:prescription.collectedAt});
});

app.post("/api/admin/devices",auth,requirePasswordChanged,role("admin"),async(req,res)=>{
  try{const deviceId=String(req.body.deviceId||"").trim(),lockerId=String(req.body.lockerId||"").trim();if(!deviceId||!lockerId)return res.status(400).json({error:"Device ID and locker ID required."});const apiKey=crypto.randomBytes(32).toString("hex");const device=await Device.create({deviceId,lockerId,displayName:String(req.body.displayName||""),firmwareVersion:String(req.body.firmwareVersion||""),apiKeyHash:hashDeviceKey(apiKey)});await audit(req,{actorType:"admin",actorId:req.session.userId,action:"DEVICE_REGISTERED",targetType:"Device",targetId:device._id,lockerId,success:true});res.status(201).json({deviceId,lockerId,apiKey,warning:"Copy this key now. Only its hash is stored."})}catch(e){if(e.code===11000)return res.status(409).json({error:"Device ID or locker ID already exists."});res.status(500).json({error:"Unable to register device."})}
});
app.get("/api/admin/audit-logs",auth,requirePasswordChanged,role("admin"),async(req,res)=>res.json({logs:await AuditLog.find().sort({occurredAt:-1}).limit(250).lean()}));
app.get("/api/admin/sensor-records",auth,requirePasswordChanged,role("admin"),async(req,res)=>res.json({records:await SensorRecord.find().sort({recordedAt:-1}).limit(250).lean()}));
app.get("/api/admin/temperature-alerts",auth,requirePasswordChanged,role("admin"),async(req,res)=>res.json({alerts:await TemperatureAlert.find().sort({raisedAt:-1}).limit(250).lean()}));
app.get("/api/health",(req,res)=>res.status(mongoose.connection.readyState===1?200:503).json({status:mongoose.connection.readyState===1?"ok":"database-disconnected",timestamp:new Date().toISOString()}));

app.use("/admin", express.static(path.join(__dirname, "admin")));
app.use("/patient", express.static(path.join(__dirname, "patient")));
app.use("/doctor", express.static(path.join(__dirname, "doctor")));

app.get("/", (req, res) => {
  res.redirect("/patient");
});

async function startServer() {
  try {
    await mongoose.connect(MONGODB_URI,{serverSelectionTimeoutMS:15000});
    console.log("Connected to MongoDB.");

    await Promise.all([
      Account.init(), Appointment.init(), Prescription.init(), AuditLog.init(), Device.init(), SensorRecord.init(), TemperatureAlert.init(), CollectionSession.init()
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
