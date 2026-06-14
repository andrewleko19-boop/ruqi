---
name: modal-lifecycle
description: >
  Build and edit modal dialogs / bottom-sheets / popups in web apps the right
  way. Use whenever creating a new modal, adding an add-vs-edit form dialog,
  wiring open/close handlers, or fixing modal bugs (stale fields from a previous
  open, wrong scroll position, page scrolling behind the modal, custom dropdowns
  showing old values, dialog not closing on overlay/Escape, focus problems).
  Framework-agnostic; vanilla-JS reference included.
---

# Modal / Dialog Lifecycle

A modal is **shared, reused DOM**. The #1 source of modal bugs is *leftover
state from the previous time it was opened*. Treat every open as a full reset,
and every close as a clean teardown. This skill is the checklist + reference
implementation that prevents the recurring class of bugs.

## The two modes: add vs edit

One opener function, one argument. The argument's presence decides the mode:

```js
openThingModal(null);   // ADD  — blank form, "New …" title
openThingModal(record); // EDIT — fields prefilled from record, "Edit …" title
```

Never write two near-identical openers. Branch inside one function on
`record ? edit : add`. Keep the edited id in a single module-level variable
(`let _editId = null`) so the save handler knows insert vs update.

## Open sequence — do these IN ORDER, every time

1. **Set mode + title.** `_editId = record?.id ?? null;` then set the title text.
2. **Populate dynamic option lists FIRST** (selects whose `<option>`s come from
   data). Fill them before assigning values, or the value won't "stick".
3. **Fill or clear every field.**
   - Edit: assign each field from the record.
   - Add: blank every field. Maintain ONE array of inputs and loop it — a field
     you forget keeps the previous entry's value. This is the classic
     "I added one person, opened the form again, and the old data was still
     there" bug.
4. **Sync custom UI to the underlying inputs.** If you wrap native `<select>`s
   in a custom dropdown (e.g. `CustomSelect.refresh(el)`), refresh each one
   AFTER setting its `.value`, or the trigger shows the old label.
5. **Hide stale errors / spinners** from a prior failed submit.
6. **Show the modal.** `show(modal)` / remove `hidden`.
7. **Reset scroll to top — in add mode especially.**
   `modal.querySelector('.scroll-body').scrollTop = 0;`
   A reused modal keeps the last scroll offset; a fresh "add" must start at the
   top of the form.
8. **Lock background scroll.** `document.body.style.overflow = 'hidden';`
9. **(A11y) Move focus in** and remember the opener to restore focus on close.

## Close sequence — mirror the open

```js
function closeThingModal() {
  hide(modal);                          // 1. hide
  document.body.style.overflow = '';    // 2. ALWAYS restore scroll lock
  _editId = null;                       // 3. clear mode state
  // 4. (a11y) restore focus to the element that opened the modal
}
```

The scroll-lock restore is non-negotiable: if an early `return` (validation
error, network failure) skips it, the page stays frozen. Restore it in a
`finally` if the close can be bypassed.

## Wire all the close paths

A modal must be dismissable every expected way:

```js
btnClose?.addEventListener('click', closeThingModal);
modal?.addEventListener('click', e => { if (e.target === modal) closeThingModal(); }); // overlay click
document.addEventListener('keydown', e => { if (e.key === 'Escape' && isOpen(modal)) closeThingModal(); });
```

Overlay-click guard `e.target === modal`: only the backdrop closes, not clicks
that bubble up from inside the sheet.

## Reference skeleton (vanilla JS)

```js
let _editId = null;

// One array — loop it to clear. Forgetting a field = stale-value bug.
const fields = [fName, fNatId, fPhone, fDay, fMonth, fYear /* … */];
const selects = [selRole, selZone /* native <select>s wrapped by a custom UI */];

async function openThingModal(rec) {
  _editId = rec?.id ?? null;
  title.textContent = rec ? 'تعديل …' : 'إضافة … جديد';

  // 2. dynamic options first
  fillSelect(selRole, await getRoles());

  if (rec) {                                   // 3a. edit: prefill
    fName.value = rec.name || '';
    selRole.value = rec.role || '';
    // date split → 3 boxes (see date-field note below)
  } else {                                     // 3b. add: blank everything
    fields.forEach(i => { if (i) i.value = ''; });
    selects.forEach(s => { if (s) s.value = ''; });
  }

  selects.forEach(s => refreshCustomSelect(s)); // 4. sync custom UI
  hideError(err);                               // 5.
  show(modal);                                  // 6.
  if (!rec) modal.querySelector('.scroll-body').scrollTop = 0; // 7.
  document.body.style.overflow = 'hidden';      // 8.
}

function closeThingModal() {
  hide(modal);
  document.body.style.overflow = '';
  _editId = null;
}
```

## Date fields inside modals

Avoid `<input type="date">` (inconsistent native picker, locale/RTL issues).
Use three numeric text boxes day / month / year:

- **Write to form (edit):** `const [y,m,d] = rec.date.split('-'); year.value=y; month.value=String(+m); day.value=String(+d);`
- **Read from form (save):** build `YYYY-MM-DD` with zero-pad:
  `` `${String(year.value).padStart(4,'0')}-${String(month.value).padStart(2,'0')}-${String(day.value).padStart(2,'0')}` `` — or `null` when any box is empty.
- Include all three boxes in the clear-array so add-mode resets them.

## Accessibility baseline

- Container: `role="dialog" aria-modal="true"` + a label (`aria-label` or
  `aria-labelledby` pointing at the title).
- Move focus into the dialog on open; restore to the trigger on close.
- Trap Tab within the dialog while open; close on `Escape`.

## Pre-ship checklist

- [ ] One opener, `null` = add / record = edit.
- [ ] Dynamic option lists filled before values are set.
- [ ] Every field cleared in add mode (loop an array — none forgotten).
- [ ] Custom dropdowns refreshed after `.value` is set.
- [ ] Errors/spinners reset on open.
- [ ] Scroll reset to top on add.
- [ ] Background scroll locked on open, restored on EVERY close path.
- [ ] Close works via button, overlay click, and Escape.
- [ ] `role="dialog"`, `aria-modal`, label, focus handling.
- [ ] If you cache an app shell (service worker), bump its cache version after shipping markup/JS changes.
