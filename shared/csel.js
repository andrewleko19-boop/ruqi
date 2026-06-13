// Shared CustomSelect component — themed in-app dropdown replacing the OS-native
// <select> popup. Exported as an ES module so directorate and admin portals can
// import it. school/script.js and teacher/script.js still carry local copies.
//
// API:
//   CustomSelect.enhance(idOrElement)  — wrap a native <select> once
//   CustomSelect.refresh(idOrElement)  — rebuild after options / value change

export const CustomSelect = (() => {
  const registry = new WeakMap();   // native <select> -> instance

  class Instance {
    constructor(select) {
      this.select = select;
      this.open = false;

      // If the select sits in a .select-wrap (it has its own SVG arrow), hide
      // that arrow — the custom trigger draws its own.
      const wrapArrow = select.parentElement?.querySelector?.('.select-arrow');
      if (wrapArrow) wrapArrow.style.display = 'none';

      // Build trigger + menu.
      this.root = document.createElement('div');
      this.root.className = 'csel';

      this.trigger = document.createElement('button');
      this.trigger.type = 'button';
      this.trigger.className = 'csel-trigger';
      this.trigger.setAttribute('aria-haspopup', 'listbox');
      this.trigger.setAttribute('aria-expanded', 'false');
      if (select.id) this.trigger.setAttribute('aria-labelledby', `${select.id}-label`);

      this.label = document.createElement('span');
      this.label.className = 'csel-label';

      const chev = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      chev.setAttribute('class', 'csel-chevron');
      chev.setAttribute('viewBox', '0 0 24 24');
      chev.innerHTML = '<polyline points="6 9 12 15 18 9" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>';

      this.trigger.append(this.label, chev);

      this.menu = document.createElement('div');
      this.menu.className = 'csel-menu';
      this.menu.setAttribute('role', 'listbox');
      this.menu.hidden = true;

      this.root.append(this.trigger, this.menu);

      // Insert custom UI right after the (hidden) native select.
      select.classList.add('csel-native');
      select.parentElement.insertBefore(this.root, select.nextSibling);

      // Events.
      this.trigger.addEventListener('click', (e) => { e.preventDefault(); this.toggle(); });
      this.onDocClick = (e) => { if (!this.root.contains(e.target)) this.close(); };
      this.trigger.addEventListener('keydown', (e) => this.onKeydown(e));

      this.refresh();
    }

    buildMenu() {
      this.menu.innerHTML = '';
      const opts = Array.from(this.select.options);
      opts.forEach((opt) => {
        const item = document.createElement('div');
        item.className = 'csel-option';
        item.setAttribute('role', 'option');
        item.textContent = opt.textContent;
        item.dataset.value = opt.value;
        if (opt.disabled) item.classList.add('is-disabled');
        if (opt.value === this.select.value) {
          item.classList.add('is-selected');
          item.setAttribute('aria-selected', 'true');
        }
        if (!opt.disabled) {
          item.addEventListener('click', () => this.choose(opt.value));
        }
        this.menu.appendChild(item);
      });
    }

    syncLabel() {
      const sel = this.select.options[this.select.selectedIndex];
      this.label.textContent = sel ? sel.textContent : '';
      // Dim the label when the placeholder (empty value) is selected.
      this.label.classList.toggle('is-placeholder', !sel || sel.value === '');
    }

    choose(value) {
      if (this.select.value !== value) {
        this.select.value = value;
        // Fire the same events a real user selection would.
        this.select.dispatchEvent(new Event('input',  { bubbles: true }));
        this.select.dispatchEvent(new Event('change', { bubbles: true }));
      }
      this.syncLabel();
      this.buildMenu();
      this.close();
      this.trigger.focus();
    }

    toggle() { this.open ? this.close() : this.openMenu(); }

    openMenu() {
      if (this.select.disabled) return;
      this.buildMenu();
      this.menu.hidden = false;
      this.open = true;
      this.trigger.setAttribute('aria-expanded', 'true');
      this.root.classList.add('is-open');
      document.addEventListener('click', this.onDocClick);
      // Scroll selected option into view, then scroll the menu itself into view
      // so it's visible when opened near the bottom of a scrollable modal.
      const sel = this.menu.querySelector('.is-selected');
      if (sel) sel.scrollIntoView({ block: 'nearest' });
      requestAnimationFrame(() =>
        this.menu.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
    }

    close() {
      if (!this.open) return;
      this.menu.hidden = true;
      this.open = false;
      this.trigger.setAttribute('aria-expanded', 'false');
      this.root.classList.remove('is-open');
      document.removeEventListener('click', this.onDocClick);
    }

    onKeydown(e) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
        e.preventDefault();
        if (!this.open) { this.openMenu(); return; }
      }
      if (e.key === 'Escape' && this.open) { e.preventDefault(); this.close(); this.trigger.focus(); }
    }

    // Rebuild after the native <select>'s options or value changed externally.
    refresh() {
      this.syncLabel();
      this.buildMenu();
      // Reflect disabled state on the trigger.
      this.trigger.disabled = this.select.disabled;
      this.trigger.classList.toggle('is-disabled', this.select.disabled);
    }
  }

  function enhance(selectOrId) {
    const select = typeof selectOrId === 'string' ? document.getElementById(selectOrId) : selectOrId;
    if (!select) return null;
    if (registry.has(select)) return registry.get(select);
    const inst = new Instance(select);
    registry.set(select, inst);
    return inst;
  }

  function refresh(selectOrId) {
    const select = typeof selectOrId === 'string' ? document.getElementById(selectOrId) : selectOrId;
    const inst = select && registry.get(select);
    if (inst) inst.refresh();
  }

  return { enhance, refresh };
})();
