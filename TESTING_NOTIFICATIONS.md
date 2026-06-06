# Offline Sync & Submission Testing Guide

NSAMS has no push-notification feature yet; what actually needs careful testing is
the **offline-first submission + sync** path and the **in-app feedback** users get
when they record attendance or file a report. This guide is the manual test plan
for that surface. (When real push notifications land, extend this file.)

## Prerequisites

- ✅ Service Worker registered and active (`nsams-v1`)
- ✅ Browser: Chrome/Firefox with DevTools (to toggle the network)
- ✅ A test account for the relevant portal (teacher / school)

---

## Test Cases

### Test 1: Online status indicator

**Steps:**

1. Open a portal while online
2. DevTools → Network → set to **Offline**
3. **Expected:** the app reflects offline state (status dot / banner) without crashing
4. **Bilingual:** check RTL layout in Arabic

**Result:** ******\_\_\_******

---

### Test 2: Record attendance OFFLINE → queue

**Steps:**

1. Go offline (Test 1)
2. As a teacher, mark a class's student attendance and submit
3. **Expected:**
   - The UI confirms the submission (optimistic) — no error
   - A pending entry is added to `localStorage` key `nsams_pending_stu_att`

**Result:** ******\_\_\_******

---

### Test 3: Reconnect → automatic drain

**Steps:**

1. From Test 2 (item queued), set Network back to **Online**
2. Wait for the `online` event / trigger a sync
3. **Expected:**
   - `syncPendingV2()` drains the queue to Supabase
   - `nsams_pending_stu_att` becomes empty (`[]`)
   - Re-opening the class shows the attendance persisted server-side

**Result:** ******\_\_\_******

---

### Test 4: School daily attendance offline

**Steps:**

1. Go offline
2. As a school admin, save the school's daily attendance
3. **Expected:** entry queued in `nsams_pending_attendance`; drains on reconnect

**Result:** ******\_\_\_******

---

### Test 5: Submit a field report OFFLINE (with photo)

**Steps:**

1. Go offline
2. Submit an emergency/field report including a photo
3. **Expected:**
   - A **receipt number** (`RPT-…`) is shown immediately
   - Entry queued in `nsams_pending_reports` (photo kept as data URI)

**Result:** ******\_\_\_******

---

### Test 6: Report photo upload on reconnect

**Steps:**

1. From Test 5, go back online and let the queue drain
2. **Expected:**
   - The report row is created in Supabase
   - The photo is uploaded to the `report-photos` bucket and the row stores the public URL
   - **Fallback:** if the bucket/upload fails, the data URI is kept (photo not lost)

**Result:** ******\_\_\_******

---

### Test 7: No duplicate submissions

**Steps:**

1. Queue a submission, then trigger sync **twice** in quick succession
2. **Expected:** the row appears in Supabase **once**; the queue is emptied, not replayed

**Result:** ******\_\_\_******

---

### Test 8: Partial-failure isolation

**Steps:**

1. Queue two items; arrange for one to fail (e.g. invalid class)
2. Trigger sync
3. **Expected:** the good item drains and is removed; the failing item **stays** queued for the next drain — it does not block the good one

**Result:** ******\_\_\_******

---

### Test 9: Report status workflow (directorate)

**Steps:**

1. As a directorate user, open the regional report inbox
2. Move a report open → acknowledged → resolved
3. **Expected:** status updates persist and reflect on reload

**Result:** ******\_\_\_******

---

### Test 10: Service Worker offline shell

**Steps:**

1. Go offline and reload the teacher portal
2. **Expected:** the precached shell loads (no browser dino page); cross-origin Supabase calls fail gracefully and queue as above

**Result:** ******\_\_\_******

---

## Debug Commands (Console)

```javascript
// Inspect the offline queues
JSON.parse(localStorage.getItem("nsams_pending_attendance"));
JSON.parse(localStorage.getItem("nsams_pending_reports"));
JSON.parse(localStorage.getItem("nsams_pending_stu_att"));

// Online status
navigator.onLine; // true / false

// Service Worker status
navigator.serviceWorker.controller; // should exist once controlled

// Clear a queue (to re-run a test)
localStorage.removeItem("nsams_pending_stu_att");
```

> `syncPendingV2()` and the other helpers live inside the `shared/db.js` module, so
> call them through whatever the portal exposes rather than from the global scope.

---

## Known Limitations (v1)

- ⚠️ Retry is "on next connectivity event," not timed backoff — a deterministically
  failing op retries forever (no dead-letter path yet).
- ⚠️ No rate limiting on submissions.
- ⚠️ Attendance upserts are last-write-wins.

---

## Success Criteria

✅ All 10 tests pass
✅ No console errors
✅ Offline submissions are never lost — they queue and drain
✅ A single sync produces exactly one server row per submission
✅ RTL layout works throughout
