
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
let account=null, selectedTime="11:00", selectedPrescription=null, consultationMode=false;
let availableTimes=[];
let sliderActive=false;
let sliderStarted=false;

async function api(url,options={}){const r=await fetch(url,{credentials:"same-origin",headers:{"Content-Type":"application/json",...(options.headers||{})},...options});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||"Request failed");return d}
function panel(id){document.querySelectorAll(".auth-page").forEach(x=>x.classList.add("hidden"));document.getElementById(id).classList.remove("hidden")}
function msg(el,text,type){el.textContent=text;el.className=`msg ${type}`}
function initials(n){return n.split(/\s+/).filter(Boolean).map(x=>x[0]).join("").slice(0,2).toUpperCase()}
function apply(a){account=a;["avatar","profileAvatar"].forEach(id=>document.getElementById(id).textContent=initials(a.fullName));document.getElementById("welcomeName").textContent=a.fullName;document.getElementById("profileName").textContent=a.fullName;document.getElementById("profileEmail").textContent=a.email;document.getElementById("profileMobile").textContent=a.mobileNumber||""}
async function enter(a){if(a.role!="patient")throw new Error("Use a patient account.");apply(a);document.getElementById("authScreen").classList.add("hidden");document.getElementById("app").classList.remove("hidden");await Promise.all([
    loadDoctors(),
    loadAppointments(),
    loadPrescriptions(),
    loadFollowUps()
  ])}
function page(id){
  document.querySelectorAll(".page").forEach(x=>x.classList.remove("active"));
  document.querySelectorAll(".nav").forEach(x=>x.classList.remove("active"));
  document.getElementById(id).classList.add("active");

  const n=document.querySelector(`.nav[data-page="${id}"]`);
  if(n)n.classList.add("active");

  if(id==="appointmentsPage"){
    document.getElementById("doctorField").classList.toggle("hidden",consultationMode);
    loadAppointments();
  }

  if(id==="medicinePage")loadPrescriptions();
}
document.getElementById("startBtn").onclick=()=>panel("login");document.getElementById("toRegister").onclick=()=>panel("register");document.getElementById("toLogin").onclick=()=>panel("login");
document.getElementById("loginForm").onsubmit=async e=>{e.preventDefault();const box=document.getElementById("loginMsg");box.classList.add("hidden");try{const d=await api("/api/login",{method:"POST",body:JSON.stringify({email:loginEmail.value,password:loginPassword.value})});await enter(d.account)}catch(err){msg(box,err.message,"error")}};
document.getElementById("registerForm").onsubmit=async e=>{e.preventDefault();const box=document.getElementById("registerMsg");try{await api("/api/register",{method:"POST",body:JSON.stringify({fullName:regName.value,email:regEmail.value,password:regPassword.value,mobileNumber:regMobile.value,role:"patient"})});msg(box,"Account created. Sign in now.","success");loginEmail.value=regEmail.value;setTimeout(()=>panel("login"),900)}catch(err){msg(box,err.message,"error")}};
document.querySelectorAll("[data-page]").forEach(b=>{b.onclick=()=>{if(b.dataset.page==="appointmentsPage")consultationMode=false;page(b.dataset.page);};});
bookShortcut.onclick=()=>{consultationMode=true;page("appointmentsPage");};
function renderTimeSlots(){
  document.querySelectorAll("#timeSlots button").forEach(button=>{
    const time=button.dataset.time;
    const disabled=availableTimes.includes(time);
    button.disabled=disabled;
    button.classList.toggle("disabled",disabled);
    if(selectedTime===time&&disabled){selectedTime="";}
    button.classList.toggle("selected",selectedTime===time);
  });
}
function attachTimeSlotListeners(){
  document.querySelectorAll("#timeSlots button").forEach(button=>{button.onclick=()=>{if(button.disabled)return;selectedTime=button.dataset.time;renderTimeSlots();};});
}
attachTimeSlotListeners();
async function loadDoctors(){const d=await api("/api/patient/doctors");doctorSelect.innerHTML=d.doctors.map(x=>`<option value="${x.id}">${x.fullName} - ${x.specialisation}</option>`).join("");if(d.doctors.length){doctorSelect.value=d.doctors[0].id;}await refreshAvailability();}
async function refreshAvailability(){const doctorId=document.getElementById("doctorSelect").value;const date=document.getElementById("appointmentDate").value;if(!doctorId||!date){availableTimes=[];renderTimeSlots();return;}try{const d=await api(`/api/patient/appointments/availability?doctorId=${encodeURIComponent(doctorId)}&date=${encodeURIComponent(date)}`);availableTimes=d.unavailableTimes||[];renderTimeSlots();}catch{availableTimes=[];renderTimeSlots();}}
document.getElementById("doctorSelect").onchange=refreshAvailability;document.getElementById("appointmentDate").onchange=refreshAvailability;
async function loadAppointments(){const d=await api("/api/patient/appointments");const now=new Date();d.appointments.sort((a,b)=>{const dateA=new Date(`${a.appointmentDate}T${a.appointmentTime}`);const dateB=new Date(`${b.appointmentDate}T${b.appointmentTime}`);const aUpcoming=dateA>=now;const bUpcoming=dateB>=now;if(aUpcoming&&!bUpcoming)return-1;if(!aUpcoming&&bUpcoming)return 1;return aUpcoming?dateA-dateB:dateB-dateA;});const cards=d.appointments.length?d.appointments.map(x=>`<article class="card"><h3>${x.doctorName} · ${x.specialisation||"Doctor"}</h3><div class="meta"><span>▣ ${x.appointmentDate}</span><span>◷ ${formatAppointmentRange(x.appointmentTime)}</span><span>⌖ ${x.location}</span></div><span class="status">${x.status}</span></article>`).join(""):`<div class="empty">No appointments yet.</div>`;appointmentsList.innerHTML=cards;homeAppointments.innerHTML=d.appointments.length?cards.split("</article>")[0]+"</article>":cards}
function currentBookingDraft(){
  return {
    doctorId:document.getElementById("doctorSelect").value,
    appointmentDate:document.getElementById("appointmentDate").value,
    appointmentTime:selectedTime,
    location:document.getElementById("location").value,
    notes:document.getElementById("notes").value,
    followUpPrescriptionId:selectedFollowUpPrescriptionId||""
  };
}

function openOtpModal(){
  const input=document.getElementById("otpInput");
  const box=document.getElementById("otpMsg");
  const button=document.getElementById("otpConfirmBtn");
  input.value="";
  box.classList.add("hidden");
  button.disabled=false;
  button.textContent="Verify & Confirm Appointment";
  document.getElementById("otpModal").classList.remove("hidden");
  input.focus();
}

function closeOtpModal(){
  document.getElementById("otpModal").classList.add("hidden");
}

document.getElementById("bookBtn").onclick=async()=>{
  const box=document.getElementById("bookingMsg");
  box.classList.add("hidden");
  const draft=currentBookingDraft();

  if(!draft.doctorId){msg(box,"Please select a doctor.","error");return;}
  if(!draft.appointmentDate){msg(box,"Please select an appointment date.","error");return;}
  if(!draft.appointmentTime){msg(box,"Please select an appointment time.","error");return;}
  if(!draft.location){msg(box,"Please select a location.","error");return;}

  const button=document.getElementById("bookBtn");
  const originalLabel=button.textContent;
  button.disabled=true;
  button.textContent="Sending verification code...";

  try{
    const data=await api("/api/patient/appointments/request-otp",{
      method:"POST",
      body:JSON.stringify(draft)
    });
    // The OTP modal already tells the patient that the code was sent.
    // Keep the booking message hidden so it cannot overlap the booking button.
    box.textContent="";
    box.classList.add("hidden");
    openOtpModal();
  }catch(err){
    msg(box,err.message,"error");
  }finally{
    button.disabled=false;
    button.textContent=originalLabel;
  }
};

document.getElementById("otpConfirmBtn").onclick=async()=>{
  const otp=document.getElementById("otpInput").value.trim();
  const box=document.getElementById("otpMsg");
  const button=document.getElementById("otpConfirmBtn");
  box.classList.add("hidden");

  if(!/^\d{6}$/.test(otp)){
    msg(box,"Please enter the 6-digit code from your email.","error");
    return;
  }

  button.disabled=true;
  button.textContent="Verifying...";

  try{
    await api("/api/patient/appointments/confirm-otp",{
      method:"POST",
      body:JSON.stringify({otp})
    });
    closeOtpModal();
    selectedFollowUpPrescriptionId="";
    selectedFollowUpDoctorId="";
    document.getElementById("successModal").classList.remove("hidden");
    await Promise.all([loadAppointments(),loadFollowUps()]);
    await refreshAvailability();
  }catch(err){
    msg(box,err.message,"error");
    button.disabled=false;
    button.textContent="Verify & Confirm Appointment";
  }
};

document.getElementById("otpCancelBtn").onclick=closeOtpModal;
document.getElementById("otpInput").addEventListener("keydown",event=>{
  if(event.key==="Enter")document.getElementById("otpConfirmBtn").click();
});
successBack.onclick=()=>{successModal.classList.add("hidden");page("homePage")};
async function loadPrescriptions(){const d=await api("/api/patient/prescriptions");const make=(x,full)=>`<article class="card"><h3>${x.collectionLocation}</h3><div class="meta"><span>▣ ${new Date(x.createdAt).toLocaleDateString()}</span><span>⌖ ${x.doctorName}</span></div>${full?`<div class="details"><b>Prescription:</b><br>${x.medicationName}<br>${x.dosage} · ${x.frequency}<br>Quantity: ${x.quantity}${x.instructions?`<br><br><b>Instructions:</b><br>${x.instructions}`:""}</div><span class="status">${x.status}</span>${x.status==="Ready"?`<button class="primary full collect" data-id="${x.id}">Confirm Collection</button>`:""}`:""}</article>`;prescriptionsList.innerHTML=d.prescriptions.length?d.prescriptions.map(x=>make(x,true)).join(""):`<div class="empty">No prescriptions yet.</div>`;homeMedicine.innerHTML=d.prescriptions.length?make(d.prescriptions[0],false):`<div class="empty">No prescriptions yet.</div>`;document.querySelectorAll(".collect").forEach(b=>b.onclick=()=>{selectedPrescription=b.dataset.id;collectionMsg.classList.add("hidden");collectionModal.classList.remove("hidden");resetSlider();})}
function resetSlider(){const handle=document.getElementById("slideHandle");handle.style.transform="translateX(0px)";handle.dataset.completed="false";handle.textContent="Swipe →";sliderActive=false;sliderStarted=false;}
function completeSlide(){const handle=document.getElementById("slideHandle");handle.dataset.completed="true";handle.textContent="Confirmed";collectionModal.classList.add("hidden");lockerModal.classList.remove("hidden");lockerClosed.checked=false;lockerTitle.textContent="Locker Check";lockerBody.textContent="Please confirm that the locker door is closed properly before you continue.";lockerMsg.classList.add("hidden");lockerConfirm.textContent="Continue";}
document.getElementById("slideHandle").addEventListener("pointerdown",event=>{sliderStarted=true;sliderActive=true;event.currentTarget.setPointerCapture(event.pointerId);});document.getElementById("slideTrack").addEventListener("pointermove",event=>{if(!sliderActive)return;const track=event.currentTarget.getBoundingClientRect();const handle=document.getElementById("slideHandle");const max=track.width-handle.offsetWidth-12;const x=Math.min(max,Math.max(0,event.clientX-track.left-handle.offsetWidth/2));handle.style.transform=`translateX(${x}px)`;if(x/max>0.75)completeSlide();});document.addEventListener("pointerup",()=>{if(!sliderStarted||sliderActive){const handle=document.getElementById("slideHandle");if(handle.dataset.completed!=="true"){handle.style.transform="translateX(0px)";}sliderActive=false;sliderStarted=false;}});
closeCollection.onclick=()=>{collectionModal.classList.add("hidden");resetSlider();};closeLocker.onclick=()=>{lockerModal.classList.add("hidden");resetSlider();};
async function handleLockerConfirm(){try{if(!lockerClosed.checked){msg(lockerMsg,"Please close the locker door properly until it clicks shut.","error");lockerMsg.classList.remove("hidden");return;}await api(`/api/patient/prescriptions/${selectedPrescription}/collect`,{method:"POST",body:JSON.stringify({doorClosed:true})});lockerTitle.textContent="Get well soon!";lockerBody.textContent="Your medicine collection has been confirmed.";lockerMsg.textContent="Get well soon!";lockerMsg.className="msg success";lockerMsg.classList.remove("hidden");lockerConfirm.textContent="Done";lockerConfirm.onclick=async()=>{lockerModal.classList.add("hidden");await loadPrescriptions();resetSlider();};}catch(err){msg(lockerMsg,err.message,"error");lockerMsg.classList.remove("hidden");}}
lockerConfirm.onclick=handleLockerConfirm;
logoutBtn.onclick=async()=>{await api("/api/logout",{method:"POST"}).catch(()=>{});app.classList.add("hidden");authScreen.classList.remove("hidden");panel("login")};
const appointmentDateInput=document.getElementById("appointmentDate");appointmentDateInput.min=new Date().toISOString().split("T")[0];appointmentDateInput.value=new Date(Date.now()+86400000).toISOString().split("T")[0];
(async()=>{try{const d=await api("/api/me");await enter(d.account)}catch{}})();


let selectedFollowUpPrescriptionId = "";
let selectedFollowUpDoctorId = "";

async function loadFollowUps() {
  try {
    const data = await api("/api/patient/follow-ups");

    if (!document.getElementById("homeFollowUps")) return;

    homeFollowUps.innerHTML = data.followUps.length
      ? data.followUps.map(followUp => `
          <article
            class="card follow-up-reminder-card"
            data-follow-up-id="${followUp.id}"
            data-doctor-id="${followUp.doctorId}"
          >
            <h3>Book Your Follow-Up</h3>
            <div class="meta">
              <span>⌖ ${followUp.doctorName}</span>
              <span>${followUp.specialisation || ""}</span>
            </div>
            <p>${followUp.reason}</p>
            <p class="muted">
              Click this reminder to choose an appointment slot.
            </p>
          </article>
        `).join("")
      : `<div class="empty">No follow-up appointment required.</div>`;

    document
      .querySelectorAll(".follow-up-reminder-card")
      .forEach(card => {
        card.onclick = async () => {
          selectedFollowUpPrescriptionId =
            card.dataset.followUpId;

          selectedFollowUpDoctorId =
            card.dataset.doctorId;

          showPage("appointmentsPage");

          if (selectedFollowUpDoctorId) {
            doctorSelect.value =
              selectedFollowUpDoctorId;
          }

          await loadTimeSlotAvailability();

          appointmentDateInput.scrollIntoView({
            behavior: "smooth",
            block: "start"
          });
        };
      });
  } catch (error) {
    console.error("Unable to load follow-ups:", error);
  }
}
