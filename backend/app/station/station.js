/* Dedicated cookie-authenticated station. No staff credentials or biometric templates in browser storage. */
"use strict";
const el = (id) => document.getElementById(id);
let boundShop = new URLSearchParams(location.search).get("shop");
const initialTitle = el("title").textContent;
let disconnecting = false;
function bindShop(shop) {
  boundShop = shop;
  history.replaceState(
    null,
    "",
    `/api/face-station/?shop=${encodeURIComponent(shop)}`,
  );
}
let state = null,
  stream = null,
  busy = false,
  polling = false,
  pendingScan = null,
  wake = null;
let cameraState = "UNKNOWN",
  clearTimer = null;
const show = (id, visible) => {
  el(id).hidden = !visible;
};
function message(text, kind = "", retry = false) {
  clearTimeout(clearTimer);
  el("result").textContent = text;
  el("result-box").className = `card ${kind}`;
  show("result-box", true);
  show("retry", retry);
  show("dismiss", !retry);
  if (kind === "success")
    clearTimer = setTimeout(() => show("result-box", false), 9000);
}
async function api(path, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const response = await fetch(`/api/face-station/${path}`, {
      method: body === undefined ? "GET" : "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        "X-Hishob-Client": "web",
        ...(boundShop ? { "X-Hishob-Shop": boundShop } : {}),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: controller.signal,
    });
    const data = await response.json();
    if (!response.ok) {
      const error = new Error(
        typeof data.detail === "string"
          ? data.detail
          : "Please check the information and try again.",
      );
      error.status = response.status;
      throw error;
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}
function stopCamera() {
  stream?.getTracks().forEach((track) => track.stop());
  stream = null;
  el("video").srcObject = null;
  cameraState = "UNKNOWN";
  wake?.release().catch(() => {});
  wake = null;
}
async function keepAwake() {
  if (!navigator.wakeLock || document.hidden) {
    el("wake-status").textContent =
      "Set this device to stay awake while the station is open.";
    return;
  }
  try {
    wake = await navigator.wakeLock.request("screen");
    el("wake-status").textContent =
      "Screen wake lock is active. Keep this page open.";
    wake.addEventListener("release", () => {
      el("wake-status").textContent =
        "Wake lock released. Keep the device awake.";
    });
  } catch {
    el("wake-status").textContent =
      "Set this device to stay awake while the station is open.";
  }
}
async function startCamera() {
  if (
    stream ||
    !boundShop ||
    state?.shop_id !== boundShop ||
    state?.status !== "ACTIVE"
  )
    return;
  try {
    if (!navigator.mediaDevices?.getUserMedia)
      throw new Error(
        "Camera access requires HTTPS or localhost. Open the secure station address.",
      );
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: "user",
        width: { ideal: 640 },
        height: { ideal: 480 },
      },
      audio: false,
    });
    el("video").srcObject = stream;
    await el("video").play();
    cameraState = "READY";
    stream.getVideoTracks()[0].addEventListener("ended", () => {
      stopCamera();
      render();
    });
    await keepAwake();
  } catch (error) {
    cameraState = "BLOCKED";
    message(
      error.name === "NotAllowedError"
        ? "Camera permission is blocked. Allow camera access in browser settings, then start the camera."
        : error.message,
      "error",
    );
  }
  render();
}
function render() {
  const correctShop = !!state && !!boundShop && state.shop_id === boundShop;
  const conflict = !!state && !!boundShop && !correctShop;
  const active = correctShop && state?.status === "ACTIVE";
  if (conflict) el("connection").textContent = "Wrong shop";
  else if (state && !boundShop) el("connection").textContent = "Confirm shop";
  show("shop-conflict", conflict);
  show("shop-choice", !!state && !boundShop);
  show("connection-controls", !!state);
  show("disconnect-confirm", disconnecting);
  el("disconnect-start").disabled = busy || !!pendingScan;
  el("disconnect-confirm-button").disabled = busy || !!pendingScan;
  if (state) {
    el("shop-conflict-help").textContent =
      `You opened ${initialTitle}, but this browser is paired to ${state.shop_name}. Attendance cannot be recorded here until this shop is paired.`;
    el("shop-choice-help").textContent =
      `This browser is paired to ${state.shop_name}. Confirm that this is the shop where you are recording attendance.`;
    el("disconnect-help").textContent =
      `Disconnect ${state.device_name} from ${state.shop_name}? The owner will need to approve a new pairing before this device can record attendance again.`;
  }
  show("pairing", !state);
  show("pending", correctShop && state?.status === "PENDING");
  show("disabled", active && !state.enabled);
  show("station", active && state.enabled);
  if (correctShop) {
    el("title").textContent = state.shop_name;
    el("subtitle").textContent = state.device_name;
    el("confirmation").textContent = state.confirmation;
  }
  if (!active || !state?.enabled) stopCamera();
  const grant = correctShop ? state?.enrollment : null;
  show("enrollment", !!grant);
  show("attendance-actions", !grant);
  if (grant) {
    el("enrollment-name").textContent = `Enroll ${grant.name}`;
    el("enrollment-help").textContent =
      grant.status === "READY"
        ? "Samples captured. Ask the owner or approving manager to confirm this employee in the main app."
        : "Keep one person in view. Hold still, then turn slightly when prompted. Approval expires in five minutes.";
  }
  show("capture", grant?.status === "WAITING");
  show("check-out", !!state?.allow_out);
  show("camera-start", !stream);
  ["check-in", "check-out", "capture"].forEach((id) => {
    el(id).disabled =
      !active || busy || !!pendingScan || !stream || !navigator.onLine;
  });
  el("retry").disabled = busy || !navigator.onLine;
}
async function refresh() {
  if (polling || busy || document.hidden) return;
  polling = true;
  try {
    state = await api(`status?camera=${cameraState}`);
    el("connection").textContent = "Connected";
    render();
  } catch (error) {
    if (error.status === 401) {
      state = null;
      pendingScan = null;
      render();
      el("connection").textContent = "Not paired";
    } else {
      el("connection").textContent = "Connection unavailable";
      ["check-in", "check-out", "capture"].forEach((id) => {
        el(id).disabled = true;
      });
    }
  } finally {
    polling = false;
  }
}
async function samples(enrolling) {
  const video = el("video");
  if (!stream || video.readyState < 2)
    throw new Error("Start the camera and wait for its preview.");
  const canvas = document.createElement("canvas");
  const scale = Math.min(
    1,
    640 / Math.max(video.videoWidth, video.videoHeight),
  );
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  const context = canvas.getContext("2d");
  const frames = [];
  for (let i = 0; i < 3; i++) {
    el("camera-help").textContent = enrolling
      ? [
          "Look straight ahead",
          "Turn slightly to your left",
          "Turn slightly to your right",
        ][i]
      : "Hold still · Reading your face";
    await new Promise((resolve) => setTimeout(resolve, enrolling ? 1600 : 350));
    if (document.hidden || !stream)
      throw new Error("Keep the station open during capture. Try again.");
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    frames.push(canvas.toDataURL("image/jpeg", 0.82).split(",")[1]);
  }
  el("camera-help").textContent = "Position one face inside the guide";
  return frames;
}
async function runScan(action, retry = false) {
  if (busy || !boundShop || state?.shop_id !== boundShop) return;
  busy = true;
  render();
  try {
    if (!retry)
      pendingScan = {
        request_id: crypto.randomUUID(),
        action,
        frames: await samples(false),
      };
    message("Saving attendance…");
    const result = await api("scan", pendingScan);
    pendingScan = null;
    const time = new Date(result.recorded_at).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: state?.timezone,
    });
    message(
      `${result.name} · ${result.action === "IN" ? "Check-in" : "Check-out"} ${result.already_recorded ? "already recorded" : "recorded"} at ${time} · ${result.shop_name || state.shop_name}`,
      "success",
    );
  } catch (error) {
    const uncertain =
      pendingScan &&
      (!error.status || error.status >= 500 || error.status === 429);
    if (!uncertain) pendingScan = null;
    message(
      uncertain
        ? "Attendance was not confirmed. Keep this page open and retry the same request to check its result."
        : error.message,
      "error",
      !!uncertain,
    );
  } finally {
    busy = false;
    render();
  }
}
el("pair-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (busy) return;
  busy = true;
  const button = event.currentTarget.querySelector("button");
  button.disabled = true;
  try {
    const paired = await api("pair", {
      code: el("code").value.trim(),
      name: el("device-name").value.trim(),
    });
    bindShop(paired.shop_id);
    el("code").value = "";
    show("result-box", false);
  } catch (error) {
    message(
      error.status
        ? error.message
        : "Connection interrupted. Wait for the station to reconnect before generating another code.",
      "error",
    );
  } finally {
    busy = false;
    button.disabled = false;
    await refresh();
  }
});
el("continue-shop").addEventListener("click", () => {
  if (!state || busy) return;
  bindShop(state.shop_id);
  render();
  void refresh();
});
el("disconnect-start").addEventListener("click", () => {
  disconnecting = true;
  render();
});
el("disconnect-cancel").addEventListener("click", () => {
  disconnecting = false;
  render();
});
el("disconnect-confirm-button").addEventListener("click", async () => {
  if (busy || pendingScan || !state) return;
  busy = true;
  stopCamera();
  render();
  try {
    await api("disconnect", { device_id: state.device_id });
    state = null;
    disconnecting = false;
    el("title").textContent = initialTitle;
    el("subtitle").textContent =
      "Enter the pairing code for the shop you opened.";
    show("result-box", false);
  } catch (error) {
    message(error.message, "error");
  } finally {
    busy = false;
    await refresh();
    render();
  }
});
el("camera-start").addEventListener("click", () => void startCamera());
el("check-in").addEventListener("click", () => void runScan("IN"));
el("check-out").addEventListener("click", () => void runScan("OUT"));
el("retry").addEventListener("click", () => void runScan(null, true));
el("dismiss").addEventListener("click", () => show("result-box", false));
el("capture").addEventListener("click", async () => {
  if (busy || !state?.enrollment) return;
  busy = true;
  render();
  const id = state.enrollment.id;
  try {
    const frames = await samples(true);
    await api(`enrollments/${id}/capture`, { frames });
    message("Samples captured. Confirm enrollment in the main app.", "success");
  } catch (error) {
    message(
      error.status
        ? error.message
        : "Capture was not confirmed. Check enrollment status before trying again.",
      "error",
    );
  } finally {
    busy = false;
    await refresh();
    render();
  }
});
window.addEventListener("offline", () => {
  el("connection").textContent = "Offline";
  render();
});
window.addEventListener("online", () => void refresh());
window.addEventListener("beforeunload", (event) => {
  if (pendingScan || busy) {
    event.preventDefault();
    event.returnValue = "";
  }
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) stopCamera();
  else {
    void refresh();
    render();
  }
});
window.addEventListener("pagehide", stopCamera);
setInterval(() => void refresh(), 5000);
void refresh();
