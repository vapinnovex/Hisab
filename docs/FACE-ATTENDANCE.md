# Face attendance

Face attendance extends the existing daily attendance register. It supports one paired browser station per shop, up to 200 enrolled staff, and the existing check-in-only or check-in/out rules. There are no breaks, overtime calculations, or multiple shifts per day.

## Set up

1. Install the backend requirements and restart the API. Startup creates the new indexes automatically.
2. In production, set `FACE_ENCRYPTION_KEY` to a stable Fernet key. Generate it with `python -c 'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())'`. Back up the key separately from the database; never commit it. The main app remains usable without this key, but face attendance cannot be enabled. Development/tests derive a separate face-storage key from the development JWT secret if no key is supplied.
3. Open **Shop settings → Manage face attendance**, or **Account → Face attendance**. Acknowledge supervised operation and enable the feature. Manager enrollment of workers and manager face attendance have independent controls, both off by default.
4. Select **Show station QR** and scan it with the dedicated device’s camera, or use **Open attendance station**. The QR is hidden initially and can be hidden again. It contains the station URL and shop ID, never credentials or a pairing code; approval is still required. Production uses `https://<app-domain>/api/face-station/?shop=<shop-id>`, which works through the existing `/api` proxy. Local development uses `http://localhost:8000/api/face-station/?shop=<shop-id>` on the server computer. Camera access on another physical device requires HTTPS; a plain LAN HTTP address will not work.
5. Create a pairing code, enter it on the station and give the device a name. The code is single use and expires in five minutes. Match the confirmation number on both screens before approving the device in the owner app. Only one pending/active device is allowed; revoke it before replacing it.
6. Use a dedicated device/browser profile without an owner or manager account signed in. The station page does not lock down the operating system; use the device’s kiosk or guided-access controls where appropriate. Start the camera on the station. A supported browser can request a screen wake lock. Keep the page foregrounded, powered and online during attendance hours. Switching away stops the camera; returning requires starting it again.
7. Add employees through the existing Team workflow. Select **Enroll face**, explain biometric processing and the manual alternative, check identity, and start supervised enrollment. The station receives authorization for this employee only. Capture three guided samples; confirm the correct employee in the owner/approving manager app before enrollment becomes active. Authorization expires after five minutes. A manager may enroll workers only when allowed; never themselves or other managers.
8. Employees select **IN** or **OUT** and look at the camera. Success appears only after the backend confirms the attendance write. An uncertain save offers a retry of the same request, with images held only in page memory. Keep the page open until resolved. Owner-recorded manual attendance remains available during camera failure. Saving still requires a working API connection.

Owners and managers can open **Home → Face attendance**, as well as the Account shortcut. Managers see their current enrollment and personal face-attendance permissions; only owners manage devices/settings and enroll managers. The enrollment list uses a compact name search with a clear button and an empty-result message.

The management UI is available in English, Hindi and Marathi. The dedicated station currently uses English. Verify a specific camera/browser/device before recommending it to customers; no universal device compatibility claim is made.

## Recognition and its limits

YuNet finds faces and landmarks, OpenCV aligns/crops the image, and SFace produces normalized 128-dimensional embeddings. The two downloaded ONNX files are loaded lazily with hash verification against their OpenCV Zoo Git LFS pointers:

| Model | SHA-256 |
| --- | --- |
| `face_detection_yunet_2023mar.onnx` | `8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4` |
| `face_recognition_sface_2021dec.onnx` | `0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79` |

Model provenance: [YuNet](https://github.com/opencv/opencv_zoo/tree/main/models/face_detection_yunet), [SFace](https://github.com/opencv/opencv_zoo/tree/main/models/face_recognition_sface), [OpenCV workflow](https://docs.opencv.org/4.13.0/d0/dd4/tutorial_dnn_face.html). Model license copies are in `backend/licenses/`. Docker includes models and licenses; do not omit these directories in another packaging flow.

Images are JPEG only, dimension-limited before OpenCV decode, and request bodies are capped at 1.25 MB. A scan requires exactly three images, one sufficiently large face per image, acceptable brightness/sharpness, and consistent embeddings. Matching is restricted to the station's shop, checks every frame, and requires a score threshold and separation from the next-best employee. Unknown or ambiguous matches fail without marking attendance. A face cannot silently be reassigned to a second employee: enrollment confirmation checks all existing shop templates, including inactive staff.

`FACE_MATCH_THRESHOLD=0.50` and `FACE_MATCH_MARGIN=0.08` are conservative starting values, **not validated operating accuracy guarantees**. Quality thresholds and match thresholds require a representative pilot. Changing model/preprocessing versions requires controlled re-enrollment or migration; incompatible templates are excluded.

**There is no liveness or photo/video anti-spoof model.** Guided turns help enrollment capture; they are not liveness proof. Setup explicitly requires supervised use. Do not sell this as an unattended fraud-proof system. Test false matches, false rejections, photo/video attacks, lighting, camera heights, skin tones, glasses, latency and sustained device operation before customer rollout.

## Security, data and audit

- The station has a separate, opaque, random credential in an HttpOnly, Secure-in-production, SameSite=Strict cookie scoped to `/api/face-station`. It cannot call employee, owner or financial APIs. No bearer tokens or face templates are placed in browser storage.
- Pairing codes and device credentials are hashed in MongoDB. Pairing attempts, code creation, enrollment capture and scans are rate-limited. Station writes require a custom header and a trusted exact origin. Pending pairing expires after five minutes. Active device access renews to 30 days through a heartbeat; owners can revoke immediately.
- `face_shops` stores one revision-checked configuration aggregate per shop: controls, devices, encrypted templates and append-only setup events. An 8 MB guard prevents reaching MongoDB's document limit; a future event-storage migration is needed if a shop approaches it. The UI shows the latest 50 setup events.
- `face_enrollments` contains employee/device/approver-specific temporary grants and encrypted captured features, with a five-minute TTL. Application checks expiry even before MongoDB TTL cleanup runs. Confirm/cancel removes the draft; cancellation, removal, revocation and disabling invalidate device grants. Authorization and active employee identity are rechecked after inference and on confirmation.
- Templates are encrypted with Fernet; they are still personal biometric data. No raw camera images are written to disk or stored in MongoDB. Do not enable request-body logging or image payload capture in proxies/APM tools.
- Inactive staff and memberships reassigned to another user cannot match. Owners can remove one or all enrollments, including inactive employees. Removal deletes active database templates and temporary drafts, while attendance history remains. Database backups may contain prior encrypted templates until the operator's documented backup-retention period expires. Configure and communicate that period before production use.
- Attendance uses the existing atomic arrival/departure writes. Each successful face write stores source `FACE`, device ID, and a request receipt atomically in the attendance document. A unique multikey index and per-document guards prevent reusing a request to write attendance twice. Retry IDs are bound to action and image payload hash. Raw images/embeddings are never included in attendance receipts.
- Owner corrections remain authoritative. Face scans cannot overwrite leave, absence or corrected records. Existing open shifts, including overnight shifts and shifts opened before switching to check-in-only, can still close. Workers' existing personal attendance endpoints remain read-only.

The device receives only shop/device status, a currently authorized enrollment name, and a brief attendance result. It never receives the staff directory, contact numbers or stored face templates.

## Operations and validation

Inference uses pinned `opencv-python-headless`, NumPy and Pillow. One process-local lock serializes OpenCV model use and returns a busy response instead of queuing inference indefinitely. `cv2.setNumThreads(1)` bounds CPU threading. Run/load-test suitable API worker capacity; this implementation shares the API process rather than deploying a separate recognition service. Each process holds its own model instances. Inference and transport time must be measured on the intended hosting plan, especially after cold starts.

An OpenCV sample-image smoke test on the development machine loaded both models and produced 128-dimensional features; this validates wiring, not real-world identity accuracy. Automated backend tests use deterministic vectors for workflow/security and real models for malformed/non-face rejection. The isolated browser test server substitutes camera inference explicitly in its test-only lifespan; there is no production bypass. Browser tests exercise actual pairing cookies, camera capture, enrollment approval, lost-response retry, offline behavior and revocation.

Checks:

```sh
cd backend
.venv/bin/python -m pytest tests -q
.venv/bin/ruff check .
.venv/bin/ruff format --check .
cd ../mobile
npm run typecheck
npm run lint
npm run format:check
npm run test:i18n
npm run test:e2e
```

Do not interpret passing automated tests as biometric accuracy certification. A supervised physical-device pilot remains a release gate.

## Attendance enforcement and searchable activity

While face attendance is enabled, managers cannot manually mark or correct attendance for themselves or any worker, even if their ordinary shop permissions are enabled. The backend checks the live face configuration on every request, including the personal and team routes. Owners retain manual marking/corrections for absence, leave, enrollment problems or camera failure; those entries are explicitly manual. Disabling face mode restores the saved ordinary permissions. Workers have no marking or editing route. Enable manager face attendance and enroll the manager through the owner account to let the manager use the station.

Open **Attendance → Attendance activity** as owner or manager. Search name, mobile, actor, note, action, status, date or station ID; filter face/manual and selected month/all dates, with pagination. Date filters use the attendance day in the shop timezone (an overnight departure stays with its arrival day). New events capture employee/actor identity, source, action, server time, and before/after state atomically with the change. New writes no longer discard older events after 100 entries. Older retained logs remain visible with an incomplete-details label; previously truncated events cannot be reconstructed. There is no activity editing or deletion API. Database administrators can still alter data; this is not an externally tamper-proof audit ledger. Daily documents retain MongoDB's document size limit, so exceptionally large logs eventually need an archival migration; oversized writes fail without changing attendance.

A face scan at a paired station is not proof of geographic location. Keep the approved device supervised at the shop. This implementation does not enforce GPS/geofencing or provide liveness/anti-spoofing verification. Ordinary manual attendance when face mode is off is an explicitly trusted permission and can be used remotely.

## Shop-specific station links and switching

The station link and generated QR include `?shop=<shop-id>`. The page gets the selected shop name from the server. Every scan and enrollment capture must send `X-Hishob-Shop` matching the shop authenticated by the station cookie; requests without that scope or with a different shop are rejected before recognition, and the scope is checked again after recognition. Attendance is independent of the financial day being opened or closed. Selecting a different shop in the main app does not silently move an existing station.

A browser profile has one station connection. Opening Nampali's link while the profile is paired to Lalpotu displays **Different shop connected**, names both shops, and hides the camera/scan controls. Use **Disconnect station → Disconnect and enter a pairing code** to revoke the previous device and cancel its pending enrollment, then enter Nampali's code and obtain owner approval. Pairing cannot silently overwrite an active station cookie, and a shop-specific link rejects another shop's code without consuming it. Other old tabs are blocked when they next scan or refresh. The disconnect request also checks the displayed device ID so a stale tab cannot revoke a newly paired device. Separate devices/browser profiles are needed for simultaneous stations at different shops.

Opening an older generic link with an existing station requires explicitly confirming the connected shop before scanning. New scan results include the recorded shop name and ID. Earlier attendance is not moved automatically: review any suspected wrong-shop records with the owner and make explicit corrections, preserving the audit trail.
