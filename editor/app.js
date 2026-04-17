/**
 * Feed Editor — CMS Upselling
 * Vanilla JS editor for managing the upselling feed JSON.
 */

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let items = [];
let sites = [];
let editingIndex = -1; // -1 = adding new
let currentStep = 0;
const TOTAL_STEPS = 5;
const LOCATIONS = ['dashboard', 'pages-sidebar', 'pages-editor', 'media-manager'];

// Chip state (managed outside the DOM for cleanliness)
let chipTags = [];
let chipExclude = [];

// Site editing state
let editingSiteIndex = -1;

// Current active view
let activeView = 'items';

// Site filter
let activeSiteFilter = '';

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const dom = {
  // Views
  viewItems: $('#view-items'),
  viewSites: $('#view-sites'),
  // Item list
  itemList: $('#item-list'),
  emptyState: $('#empty-state'),
  filterEmptyState: $('#filter-empty-state'),
  // Site list
  siteList: $('#site-list'),
  sitesEmptyState: $('#sites-empty-state'),
  // Filter
  siteFilter: $('#site-filter'),
  // Wizard modal
  wizardModal: $('#wizard-modal'),
  wizardTitle: $('#wizard-title'),
  // Site modal
  siteModal: $('#site-modal'),
  siteModalTitle: $('#site-modal-title'),
  fieldSiteName: $('#field-site-name'),
  fieldSiteId: $('#field-site-id'),
  errorSiteName: $('#error-site-name'),
  errorSiteId: $('#error-site-id'),
  // Import modal
  importModal: $('#import-modal'),
  // Delete dialog
  deleteDialog: $('#delete-dialog'),
  deleteDialogHeading: $('#delete-dialog-heading'),
  deleteItemName: $('#delete-item-name'),
  toastContainer: $('#toast-container'),
  // Wizard fields
  fieldTitle: $('#field-title'),
  fieldSubtitle: $('#field-subtitle'),
  fieldDesc: $('#field-description'),
  fieldId: $('#field-id'),
  fieldCtaLabel: $('#field-cta-label'),
  fieldCtaUrl: $('#field-cta-url'),
  utmPreview: $('#utm-preview'),
  locationsGroup: $('#locations-group'),
  // Site targeting
  siteTargetingMode: $('#site-targeting-mode'),
  siteCheckboxesField: $('#site-checkboxes-field'),
  siteCheckboxes: $('#site-checkboxes'),
  siteCheckboxesLabel: $('#site-checkboxes-label'),
  siteNoSitesHint: $('#site-no-sites-hint'),
  // Chips
  tagsWrapper: $('#tags-wrapper'),
  tagsInput: $('#tags-input'),
  excludeWrapper: $('#exclude-wrapper'),
  excludeInput: $('#exclude-input'),
  // Planning
  fieldStartDate: $('#field-start-date'),
  fieldEndDate: $('#field-end-date'),
  // Media
  fieldImage: $('#field-image'),
  imagePreview: $('#image-preview'),
  // Preview
  previewImage: $('#preview-image'),
  previewTitle: $('#preview-title'),
  previewSubtitle: $('#preview-subtitle'),
  previewDesc: $('#preview-desc'),
  previewCta: $('#preview-cta'),
  // Buttons
  btnPrev: $('#btn-prev'),
  btnNext: $('#btn-next'),
  btnSave: $('#btn-save'),
  // Import
  importFile: $('#import-file'),
  importTextarea: $('#import-textarea'),
  // Error messages
  errorTitle: $('#error-title'),
  errorDesc: $('#error-description'),
};

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------
function slugify(text) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function getStatus(item) {
  const now = new Date().toISOString().slice(0, 10);
  if (item.end_date && item.end_date < now) return 'expired';
  if (item.start_date && item.start_date > now) return 'scheduled';
  if (!item.start_date && !item.end_date) return 'always';
  return 'active';
}

function statusLabel(status) {
  const map = { active: 'Active', scheduled: 'Scheduled', expired: 'Expired', always: 'Always' };
  return map[status] || status;
}

function buildUtmUrl(url, itemId) {
  if (!url) return '—';
  try {
    const u = new URL(url);
    u.searchParams.set('utm_source', 'cms');
    u.searchParams.set('utm_medium', 'widget');
    u.searchParams.set('utm_campaign', itemId || 'unknown');
    return u.toString();
  } catch {
    return url;
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function toast(message, type = '') {
  const el = document.createElement('div');
  el.className = `toast ${type ? `toast-${type}` : ''}`;
  el.textContent = message;
  dom.toastContainer.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

// ---------------------------------------------------------------------------
// Site Targeting Logic
// ---------------------------------------------------------------------------

/**
 * Parse a sites array from an item into { mode, selected }.
 * - ["*"] → { mode: "all", selected: [] }
 * - ["ibalo", "hh"] → { mode: "include", selected: ["ibalo", "hh"] }
 * - ["*", "!ibalo"] → { mode: "exclude", selected: ["ibalo"] }
 */
function parseSiteTargeting(sitesArray) {
  if (!sitesArray || sitesArray.length === 0) return { mode: 'all', selected: [] };

  const hasWildcard = sitesArray.includes('*');
  const excludes = sitesArray.filter((s) => s.startsWith('!')).map((s) => s.slice(1));

  if (hasWildcard && excludes.length > 0) {
    return { mode: 'exclude', selected: excludes };
  }
  if (hasWildcard) {
    return { mode: 'all', selected: [] };
  }
  return { mode: 'include', selected: sitesArray.filter((s) => !s.startsWith('!')) };
}

/**
 * Build a sites array from mode + selected site IDs.
 */
function buildSiteTargeting(mode, selectedIds) {
  if (mode === 'all') return ['*'];
  if (mode === 'exclude') return ['*', ...selectedIds.map((id) => `!${id}`)];
  return [...selectedIds]; // include
}

/**
 * Check if an item is visible on a specific site.
 */
function isItemVisibleOnSite(item, siteId) {
  const { mode, selected } = parseSiteTargeting(item.sites);
  if (mode === 'all') return true;
  if (mode === 'include') return selected.includes(siteId);
  if (mode === 'exclude') return !selected.includes(siteId);
  return true;
}

/**
 * Get filtered items for the current site filter, considering status.
 */
function getFilteredItems() {
  if (!activeSiteFilter) return items;
  return items.filter((item) => {
    const status = getStatus(item);
    if (status === 'expired') return false;
    return isItemVisibleOnSite(item, activeSiteFilter);
  });
}

// ---------------------------------------------------------------------------
// View Switching
// ---------------------------------------------------------------------------
function switchView(view) {
  activeView = view;
  $$('.main-tab').forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.view === view);
  });
  dom.viewItems.hidden = view !== 'items';
  dom.viewSites.hidden = view !== 'sites';
}

// ---------------------------------------------------------------------------
// Render Item List
// ---------------------------------------------------------------------------
function render() {
  renderItems();
  renderSiteFilter();
}

function renderItems() {
  const filtered = getFilteredItems();
  const hasAnyItems = items.length > 0;
  const hasFilteredItems = filtered.length > 0;
  const isFiltering = activeSiteFilter !== '';

  dom.itemList.hidden = !hasFilteredItems;
  dom.emptyState.hidden = hasAnyItems || isFiltering;
  dom.filterEmptyState.hidden = !isFiltering || hasFilteredItems || !hasAnyItems;

  if (!hasFilteredItems) {
    dom.itemList.innerHTML = '';
    return;
  }

  dom.itemList.innerHTML = filtered.map((item) => {
    // Find original index for edit/delete operations
    const originalIndex = items.indexOf(item);
    const status = getStatus(item);
    const locationBadges = (item.locations || [])
      .map((loc) => `<span class="badge badge-location">${escapeHtml(loc)}</span>`)
      .join('');

    const siteTargeting = parseSiteTargeting(item.sites);
    let siteLabel = 'All sites';
    if (siteTargeting.mode === 'include') {
      siteLabel = siteTargeting.selected.join(', ');
    } else if (siteTargeting.mode === 'exclude') {
      siteLabel = `All except ${siteTargeting.selected.join(', ')}`;
    }

    return `
      <div class="item-row" draggable="true" data-index="${originalIndex}">
        <span class="drag-handle" title="Drag to reorder">&#9776;</span>
        <div class="item-info">
          <div class="item-title">${escapeHtml(item.title)}</div>
          <div class="item-meta">
            ${locationBadges}
            <span class="badge badge-location" title="Site targeting">${escapeHtml(siteLabel)}</span>
          </div>
        </div>
        <span class="badge badge-status badge-${status}">${statusLabel(status)}</span>
        <span class="item-priority" title="Priority">#${item.priority}</span>
        <div class="item-actions">
          <button type="button" class="btn btn-sm btn-secondary" data-action="edit" data-index="${originalIndex}">Edit</button>
          <button type="button" class="btn btn-sm btn-danger" data-action="delete" data-index="${originalIndex}">Delete</button>
        </div>
      </div>`;
  }).join('');

  bindDragAndDrop();
}

// ---------------------------------------------------------------------------
// Render Site Filter Dropdown
// ---------------------------------------------------------------------------
function renderSiteFilter() {
  const current = dom.siteFilter.value;
  dom.siteFilter.innerHTML = '<option value="">All items</option>';
  sites.forEach((site) => {
    const opt = document.createElement('option');
    opt.value = site.id;
    opt.textContent = `${site.name} (${site.id})`;
    dom.siteFilter.appendChild(opt);
  });
  // Restore selection if still valid
  if (sites.some((s) => s.id === current)) {
    dom.siteFilter.value = current;
  } else {
    dom.siteFilter.value = '';
    activeSiteFilter = '';
  }
}

// ---------------------------------------------------------------------------
// Render Sites List
// ---------------------------------------------------------------------------
function renderSites() {
  const hasSites = sites.length > 0;
  dom.siteList.hidden = !hasSites;
  dom.sitesEmptyState.hidden = hasSites;

  if (!hasSites) {
    dom.siteList.innerHTML = '';
    return;
  }

  dom.siteList.innerHTML = sites.map((site, i) => `
    <div class="site-row" data-index="${i}">
      <div class="site-info">
        <div class="site-name">${escapeHtml(site.name)}</div>
        <div class="site-id">${escapeHtml(site.id)}</div>
      </div>
      <button type="button" class="btn btn-sm btn-secondary" data-action="edit-site" data-index="${i}">Edit</button>
      <button type="button" class="btn btn-sm btn-danger" data-action="delete-site" data-index="${i}">Delete</button>
    </div>
  `).join('');
}

// ---------------------------------------------------------------------------
// Drag & Drop
// ---------------------------------------------------------------------------
let dragIndex = null;

function bindDragAndDrop() {
  const rows = dom.itemList.querySelectorAll('.item-row');
  rows.forEach((row) => {
    row.addEventListener('dragstart', onDragStart);
    row.addEventListener('dragover', onDragOver);
    row.addEventListener('dragleave', onDragLeave);
    row.addEventListener('drop', onDrop);
    row.addEventListener('dragend', onDragEnd);
  });
}

function onDragStart(e) {
  dragIndex = +e.currentTarget.dataset.index;
  e.currentTarget.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
}

function onDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  e.currentTarget.classList.add('drag-over');
}

function onDragLeave(e) {
  e.currentTarget.classList.remove('drag-over');
}

function onDrop(e) {
  e.preventDefault();
  e.currentTarget.classList.remove('drag-over');
  const dropIndex = +e.currentTarget.dataset.index;
  if (dragIndex === null || dragIndex === dropIndex) return;

  const [moved] = items.splice(dragIndex, 1);
  items.splice(dropIndex, 0, moved);

  // Recalculate priorities
  items.forEach((item, i) => (item.priority = i + 1));
  renderItems();
  toast('Priority updated');
}

function onDragEnd(e) {
  e.currentTarget.classList.remove('dragging');
  dom.itemList.querySelectorAll('.item-row').forEach((r) => r.classList.remove('drag-over'));
  dragIndex = null;
}

// ---------------------------------------------------------------------------
// Wizard: Open / Close / Navigate
// ---------------------------------------------------------------------------
function openWizard(index = -1) {
  editingIndex = index;
  currentStep = 0;

  if (index >= 0) {
    dom.wizardTitle.textContent = 'Edit Item';
    populateWizard(items[index]);
  } else {
    dom.wizardTitle.textContent = 'Add Item';
    resetWizard();
  }

  updateStepUI();
  updatePreview();
  dom.wizardModal.showModal();
}

function closeWizard() {
  dom.wizardModal.close();
  clearValidation();
}

function goToStep(step) {
  if (step < 0 || step >= TOTAL_STEPS) return;

  // Validate current step before moving forward
  if (step > currentStep && !validateStep(currentStep)) return;

  currentStep = step;
  updateStepUI();
}

function updateStepUI() {
  // Tabs
  $$('.step-tab').forEach((tab) => {
    tab.classList.toggle('active', +tab.dataset.step === currentStep);
  });

  // Panels
  $$('.step-panel').forEach((panel) => {
    panel.classList.toggle('active', +panel.dataset.step === currentStep);
  });

  // Buttons
  dom.btnPrev.hidden = currentStep === 0;
  dom.btnNext.hidden = currentStep === TOTAL_STEPS - 1;
  dom.btnSave.hidden = currentStep !== TOTAL_STEPS - 1;
}

// ---------------------------------------------------------------------------
// Wizard: Site Targeting UI
// ---------------------------------------------------------------------------
function renderSiteCheckboxes() {
  dom.siteCheckboxes.innerHTML = '';

  if (sites.length === 0) {
    dom.siteNoSitesHint.hidden = false;
    return;
  }

  dom.siteNoSitesHint.hidden = true;
  sites.forEach((site) => {
    const label = document.createElement('label');
    label.className = 'checkbox-pill';
    label.innerHTML = `
      <input type="checkbox" value="${escapeHtml(site.id)}">
      <span>${escapeHtml(site.name)}</span>
    `;
    dom.siteCheckboxes.appendChild(label);
  });
}

function updateSiteTargetingUI() {
  const mode = document.querySelector('input[name="site-mode"]:checked')?.value || 'all';

  if (mode === 'all') {
    dom.siteCheckboxesField.hidden = true;
  } else {
    dom.siteCheckboxesField.hidden = false;
    dom.siteCheckboxesLabel.textContent =
      mode === 'include' ? 'Select sites to include' : 'Select sites to exclude';
  }
}

function getSiteTargetingFromUI() {
  const mode = document.querySelector('input[name="site-mode"]:checked')?.value || 'all';
  const selected = [...dom.siteCheckboxes.querySelectorAll('input:checked')].map((cb) => cb.value);
  return buildSiteTargeting(mode, selected);
}

function setSiteTargetingUI(sitesArray) {
  const { mode, selected } = parseSiteTargeting(sitesArray);

  // Set radio
  const radio = document.querySelector(`input[name="site-mode"][value="${mode}"]`);
  if (radio) radio.checked = true;

  updateSiteTargetingUI();

  // Set checkboxes
  dom.siteCheckboxes.querySelectorAll('input').forEach((cb) => {
    cb.checked = selected.includes(cb.value);
  });
}

// ---------------------------------------------------------------------------
// Wizard: Populate / Reset / Collect
// ---------------------------------------------------------------------------
function resetWizard() {
  dom.fieldTitle.value = '';
  dom.fieldSubtitle.value = '';
  dom.fieldDesc.value = '';
  dom.fieldId.value = '';
  dom.fieldCtaLabel.value = '';
  dom.fieldCtaUrl.value = '';
  dom.fieldStartDate.value = '';
  dom.fieldEndDate.value = '';
  dom.fieldImage.value = '';

  // Locations
  dom.locationsGroup.querySelectorAll('input').forEach((cb) => (cb.checked = false));

  // Site targeting
  renderSiteCheckboxes();
  setSiteTargetingUI(['*']);

  // Chips
  chipTags = [];
  chipExclude = [];
  renderChips(dom.tagsWrapper, dom.tagsInput, chipTags);
  renderChips(dom.excludeWrapper, dom.excludeInput, chipExclude);

  clearValidation();
  updateImagePreview('');
  idManuallyEdited = false;
}

function populateWizard(item) {
  dom.fieldTitle.value = item.title || '';
  dom.fieldSubtitle.value = item.subtitle || '';
  dom.fieldDesc.value = item.description || '';
  dom.fieldId.value = item.id || '';
  dom.fieldCtaLabel.value = item.cta_label || '';
  dom.fieldCtaUrl.value = item.cta_url || '';
  dom.fieldStartDate.value = item.start_date || '';
  dom.fieldEndDate.value = item.end_date || '';
  dom.fieldImage.value = item.image || '';

  // Locations
  const locs = item.locations || [];
  dom.locationsGroup.querySelectorAll('input').forEach((cb) => {
    cb.checked = locs.includes(cb.value);
  });

  // Site targeting
  renderSiteCheckboxes();
  setSiteTargetingUI(item.sites || ['*']);

  // Chips
  chipTags = [...(item.tags || [])];
  chipExclude = [...(item.exclude_if_plugin || [])];
  renderChips(dom.tagsWrapper, dom.tagsInput, chipTags);
  renderChips(dom.excludeWrapper, dom.excludeInput, chipExclude);

  clearValidation();
  updateImagePreview(item.image || '');
  idManuallyEdited = !!item.id;
}

function collectItem() {
  const id = dom.fieldId.value.trim() || slugify(dom.fieldTitle.value.trim());
  return {
    id,
    title: dom.fieldTitle.value.trim(),
    subtitle: dom.fieldSubtitle.value.trim(),
    description: dom.fieldDesc.value.trim(),
    cta_label: dom.fieldCtaLabel.value.trim(),
    cta_url: dom.fieldCtaUrl.value.trim(),
    image: dom.fieldImage.value.trim(),
    priority: editingIndex >= 0 ? items[editingIndex].priority : items.length + 1,
    tags: [...chipTags],
    locations: [...dom.locationsGroup.querySelectorAll('input:checked')].map((cb) => cb.value),
    sites: getSiteTargetingFromUI(),
    exclude_if_plugin: [...chipExclude],
    start_date: dom.fieldStartDate.value || null,
    end_date: dom.fieldEndDate.value || null,
  };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------
function validateStep(step) {
  clearValidation();
  if (step === 0) {
    let valid = true;
    if (!dom.fieldTitle.value.trim()) {
      dom.fieldTitle.classList.add('error');
      dom.errorTitle.hidden = false;
      valid = false;
    }
    if (!dom.fieldDesc.value.trim()) {
      dom.fieldDesc.classList.add('error');
      dom.errorDesc.hidden = false;
      valid = false;
    }
    return valid;
  }
  return true;
}

function clearValidation() {
  dom.fieldTitle.classList.remove('error');
  dom.fieldDesc.classList.remove('error');
  dom.errorTitle.hidden = true;
  dom.errorDesc.hidden = true;
}

// ---------------------------------------------------------------------------
// Save Item
// ---------------------------------------------------------------------------
function saveItem() {
  if (!validateStep(currentStep)) return;

  const item = collectItem();

  if (editingIndex >= 0) {
    items[editingIndex] = item;
    toast('Item updated', 'success');
  } else {
    items.push(item);
    toast('Item added', 'success');
  }

  closeWizard();
  render();
}

// ---------------------------------------------------------------------------
// Delete (shared for items and sites)
// ---------------------------------------------------------------------------
let deleteTarget = -1;
let deleteType = 'item'; // 'item' or 'site'

function confirmDelete(index, type = 'item') {
  deleteTarget = index;
  deleteType = type;

  if (type === 'site') {
    dom.deleteDialogHeading.textContent = 'Delete this site?';
    dom.deleteItemName.textContent = sites[index]?.name || '';
  } else {
    dom.deleteDialogHeading.textContent = 'Delete this item?';
    dom.deleteItemName.textContent = items[index]?.title || '';
  }

  dom.deleteDialog.showModal();
}

function executeDelete() {
  if (deleteTarget < 0) return;

  if (deleteType === 'site') {
    sites.splice(deleteTarget, 1);
    renderSites();
    renderSiteFilter();
    renderItems();
    toast('Site deleted');
  } else {
    items.splice(deleteTarget, 1);
    items.forEach((item, i) => (item.priority = i + 1));
    render();
    toast('Item deleted');
  }

  deleteTarget = -1;
}

// ---------------------------------------------------------------------------
// Site Modal
// ---------------------------------------------------------------------------
let siteIdManuallyEdited = false;

function openSiteModal(index = -1) {
  editingSiteIndex = index;
  siteIdManuallyEdited = false;

  dom.errorSiteName.hidden = true;
  dom.errorSiteId.hidden = true;
  dom.fieldSiteName.classList.remove('error');
  dom.fieldSiteId.classList.remove('error');

  if (index >= 0) {
    dom.siteModalTitle.textContent = 'Edit Site';
    dom.fieldSiteName.value = sites[index].name;
    dom.fieldSiteId.value = sites[index].id;
    siteIdManuallyEdited = true;
  } else {
    dom.siteModalTitle.textContent = 'Add Site';
    dom.fieldSiteName.value = '';
    dom.fieldSiteId.value = '';
  }

  dom.siteModal.showModal();
}

function closeSiteModal() {
  dom.siteModal.close();
}

function saveSite() {
  const name = dom.fieldSiteName.value.trim();
  const id = dom.fieldSiteId.value.trim() || slugify(name);

  // Validate
  let valid = true;
  dom.errorSiteName.hidden = true;
  dom.errorSiteId.hidden = true;
  dom.fieldSiteName.classList.remove('error');
  dom.fieldSiteId.classList.remove('error');

  if (!name) {
    dom.errorSiteName.hidden = false;
    dom.fieldSiteName.classList.add('error');
    valid = false;
  }

  // Check duplicate ID (allow same ID when editing same site)
  const duplicate = sites.findIndex((s) => s.id === id);
  if (duplicate >= 0 && duplicate !== editingSiteIndex) {
    dom.errorSiteId.hidden = false;
    dom.fieldSiteId.classList.add('error');
    valid = false;
  }

  if (!valid) return;

  if (editingSiteIndex >= 0) {
    const oldId = sites[editingSiteIndex].id;
    sites[editingSiteIndex] = { id, name };

    // Update item site references if ID changed
    if (oldId !== id) {
      items.forEach((item) => {
        if (!item.sites) return;
        item.sites = item.sites.map((s) => {
          if (s === oldId) return id;
          if (s === `!${oldId}`) return `!${id}`;
          return s;
        });
      });
    }

    toast('Site updated', 'success');
  } else {
    sites.push({ id, name });
    toast('Site added', 'success');
  }

  closeSiteModal();
  renderSites();
  renderSiteFilter();
  renderItems();
}

// ---------------------------------------------------------------------------
// Chips
// ---------------------------------------------------------------------------
function renderChips(wrapper, input, chipArray) {
  wrapper.querySelectorAll('.chip').forEach((c) => c.remove());

  chipArray.forEach((value, i) => {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.innerHTML = `${escapeHtml(value)}<button type="button" class="chip-remove" data-chip-index="${i}">&times;</button>`;
    wrapper.insertBefore(chip, input);
  });
}

function addChip(input, chipArray, wrapper) {
  const raw = input.value.trim().replace(/,+$/, '').trim();
  if (!raw) return;

  const values = raw.split(',').map((v) => v.trim()).filter(Boolean);
  values.forEach((v) => {
    if (!chipArray.includes(v)) chipArray.push(v);
  });

  input.value = '';
  renderChips(wrapper, input, chipArray);
}

function removeChip(index, chipArray, wrapper, input) {
  chipArray.splice(index, 1);
  renderChips(wrapper, input, chipArray);
}

// ---------------------------------------------------------------------------
// Live Preview
// ---------------------------------------------------------------------------
function updatePreview() {
  const title = dom.fieldTitle.value.trim() || 'Item title';
  const subtitle = dom.fieldSubtitle.value.trim();
  const desc = dom.fieldDesc.value.trim() || 'Item description will appear here.';
  const ctaLabel = dom.fieldCtaLabel.value.trim() || 'CTA';
  const imageUrl = dom.fieldImage.value.trim();

  dom.previewTitle.textContent = title;
  dom.previewSubtitle.textContent = subtitle;
  dom.previewDesc.textContent = desc;
  dom.previewCta.textContent = ctaLabel;

  if (imageUrl) {
    dom.previewImage.innerHTML = `<img src="${escapeHtml(imageUrl)}" alt="Preview" onerror="this.parentNode.innerHTML='<span class=\\'placeholder\\'>Image not found</span>'">`;
  } else {
    dom.previewImage.innerHTML = '<span class="placeholder">No image</span>';
  }
}

function updateUtmPreview() {
  const url = dom.fieldCtaUrl.value.trim();
  const itemId = dom.fieldId.value.trim() || slugify(dom.fieldTitle.value.trim());
  dom.utmPreview.textContent = buildUtmUrl(url, itemId);
}

function updateImagePreview(url) {
  if (url) {
    dom.imagePreview.innerHTML = `<img src="${escapeHtml(url)}" alt="Preview" onerror="this.parentNode.innerHTML='<span class=\\'placeholder\\'>Image not found</span>'">`;
  } else {
    dom.imagePreview.innerHTML = '<span class="placeholder">No image</span>';
  }
}

// ---------------------------------------------------------------------------
// Import / Export
// ---------------------------------------------------------------------------
function openImportModal() {
  dom.importTextarea.value = '';
  dom.importFile.value = '';
  dom.importModal.showModal();
}

function closeImportModal() {
  dom.importModal.close();
}

function executeImport() {
  const file = dom.importFile.files?.[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = (e) => parseAndLoadFeed(e.target.result);
    reader.readAsText(file);
    return;
  }

  const text = dom.importTextarea.value.trim();
  if (!text) {
    toast('No JSON provided', 'error');
    return;
  }
  parseAndLoadFeed(text);
}

function parseAndLoadFeed(jsonString) {
  try {
    const data = JSON.parse(jsonString);
    if (!data.items || !Array.isArray(data.items)) {
      throw new Error('Missing "items" array');
    }

    // Confirm overwrite when there is existing data
    if (items.length > 0 || sites.length > 0) {
      const confirmed = confirm(
        `This will replace all current data (${items.length} item(s), ${sites.length} site(s)). Continue?`
      );
      if (!confirmed) return;
    }

    // Load sites
    if (Array.isArray(data.sites)) {
      sites = data.sites.map((s) => ({
        id: s.id || slugify(s.name || ''),
        name: s.name || s.id || '',
      }));
    }

    // Load items
    items = data.items;
    items.forEach((item, i) => {
      item.priority = item.priority ?? i + 1;
      item.subtitle = item.subtitle ?? '';
      item.tags = item.tags ?? [];
      item.locations = item.locations ?? [];
      item.sites = item.sites ?? ['*'];
      item.exclude_if_plugin = item.exclude_if_plugin ?? [];
      item.start_date = item.start_date ?? null;
      item.end_date = item.end_date ?? null;
    });
    items.sort((a, b) => a.priority - b.priority);

    render();
    renderSites();
    closeImportModal();
    toast(`Imported ${items.length} item(s) and ${sites.length} site(s)`, 'success');
  } catch (err) {
    toast(`Invalid JSON: ${err.message}`, 'error');
  }
}

function exportFeed() {
  const feed = {
    version: 1,
    sites: sites.map((s) => ({ id: s.id, name: s.name })),
    items: items
      .slice()
      .sort((a, b) => a.priority - b.priority)
      .map((item) => ({
        id: item.id,
        title: item.title,
        subtitle: item.subtitle || '',
        description: item.description,
        cta_label: item.cta_label,
        cta_url: item.cta_url,
        image: item.image,
        priority: item.priority,
        tags: item.tags,
        locations: item.locations,
        sites: item.sites,
        exclude_if_plugin: item.exclude_if_plugin,
        start_date: item.start_date,
        end_date: item.end_date,
      })),
  };

  const json = JSON.stringify(feed, null, 2);

  navigator.clipboard.writeText(json).then(
    () => toast('JSON copied to clipboard', 'success'),
    () => toast('Could not copy to clipboard', 'error')
  );

  const blob = new Blob([json + '\n'], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'feed.json';
  a.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Auto-generate ID from title
// ---------------------------------------------------------------------------
let idManuallyEdited = false;

function handleTitleInput() {
  if (!idManuallyEdited || !dom.fieldId.value.trim()) {
    dom.fieldId.value = slugify(dom.fieldTitle.value);
  }
  updatePreview();
  updateUtmPreview();
}

// ---------------------------------------------------------------------------
// Event Listeners
// ---------------------------------------------------------------------------
function init() {
  // Main tabs
  $$('.main-tab').forEach((tab) => {
    tab.addEventListener('click', () => switchView(tab.dataset.view));
  });

  // Add item buttons
  $('#btn-add').addEventListener('click', () => openWizard());
  $('#btn-add-empty').addEventListener('click', () => openWizard());

  // Site filter
  dom.siteFilter.addEventListener('change', () => {
    activeSiteFilter = dom.siteFilter.value;
    renderItems();
  });

  // Import / Export
  $('#btn-import').addEventListener('click', openImportModal);
  $('#btn-export').addEventListener('click', exportFeed);
  $('#import-close').addEventListener('click', closeImportModal);
  $('#import-cancel').addEventListener('click', closeImportModal);
  $('#import-confirm').addEventListener('click', executeImport);

  // Wizard navigation
  $('#btn-prev').addEventListener('click', () => goToStep(currentStep - 1));
  $('#btn-next').addEventListener('click', () => goToStep(currentStep + 1));
  $('#btn-save').addEventListener('click', saveItem);
  $('#btn-cancel').addEventListener('click', closeWizard);
  $('#wizard-close').addEventListener('click', closeWizard);

  // Step tabs (direct click)
  $$('.step-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      const target = +tab.dataset.step;
      if (target <= currentStep) {
        currentStep = target;
        updateStepUI();
      } else {
        for (let s = currentStep; s < target; s++) {
          if (!validateStep(s)) return;
        }
        currentStep = target;
        updateStepUI();
      }
    });
  });

  // Site targeting radio change
  dom.siteTargetingMode.addEventListener('change', updateSiteTargetingUI);

  // Live preview updates
  dom.fieldTitle.addEventListener('input', handleTitleInput);
  dom.fieldSubtitle.addEventListener('input', updatePreview);
  dom.fieldDesc.addEventListener('input', updatePreview);
  dom.fieldCtaLabel.addEventListener('input', updatePreview);
  dom.fieldCtaUrl.addEventListener('input', () => {
    updatePreview();
    updateUtmPreview();
  });
  dom.fieldImage.addEventListener('input', () => {
    const url = dom.fieldImage.value.trim();
    updateImagePreview(url);
    updatePreview();
  });

  // ID field: mark as manually edited
  dom.fieldId.addEventListener('input', () => {
    idManuallyEdited = dom.fieldId.value.trim() !== '';
    updateUtmPreview();
  });

  // Chip inputs: Tags
  dom.tagsInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addChip(dom.tagsInput, chipTags, dom.tagsWrapper);
    }
    if (e.key === 'Backspace' && !dom.tagsInput.value && chipTags.length) {
      chipTags.pop();
      renderChips(dom.tagsWrapper, dom.tagsInput, chipTags);
    }
  });

  // Chip inputs: Exclude
  dom.excludeInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addChip(dom.excludeInput, chipExclude, dom.excludeWrapper);
    }
    if (e.key === 'Backspace' && !dom.excludeInput.value && chipExclude.length) {
      chipExclude.pop();
      renderChips(dom.excludeWrapper, dom.excludeInput, chipExclude);
    }
  });

  // Chip click-to-focus
  dom.tagsWrapper.addEventListener('click', () => dom.tagsInput.focus());
  dom.excludeWrapper.addEventListener('click', () => dom.excludeInput.focus());

  // Chip remove buttons (delegated)
  dom.tagsWrapper.addEventListener('click', (e) => {
    const btn = e.target.closest('.chip-remove');
    if (!btn) return;
    removeChip(+btn.dataset.chipIndex, chipTags, dom.tagsWrapper, dom.tagsInput);
  });

  dom.excludeWrapper.addEventListener('click', (e) => {
    const btn = e.target.closest('.chip-remove');
    if (!btn) return;
    removeChip(+btn.dataset.chipIndex, chipExclude, dom.excludeWrapper, dom.excludeInput);
  });

  // Item list: edit/delete (delegated)
  dom.itemList.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const index = +btn.dataset.index;
    if (btn.dataset.action === 'edit') openWizard(index);
    if (btn.dataset.action === 'delete') confirmDelete(index, 'item');
  });

  // Site list: edit/delete (delegated)
  dom.siteList.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const index = +btn.dataset.index;
    if (btn.dataset.action === 'edit-site') openSiteModal(index);
    if (btn.dataset.action === 'delete-site') confirmDelete(index, 'site');
  });

  // Add site buttons
  $('#btn-add-site').addEventListener('click', () => openSiteModal());
  $('#btn-add-site-empty').addEventListener('click', () => openSiteModal());

  // Site modal
  $('#site-modal-close').addEventListener('click', closeSiteModal);
  $('#site-modal-cancel').addEventListener('click', closeSiteModal);
  $('#site-modal-save').addEventListener('click', saveSite);

  // Auto-generate site ID from name
  dom.fieldSiteName.addEventListener('input', () => {
    if (!siteIdManuallyEdited || !dom.fieldSiteId.value.trim()) {
      dom.fieldSiteId.value = slugify(dom.fieldSiteName.value);
    }
  });

  dom.fieldSiteId.addEventListener('input', () => {
    siteIdManuallyEdited = dom.fieldSiteId.value.trim() !== '';
  });

  // Delete dialog
  dom.deleteDialog.addEventListener('close', () => {
    if (dom.deleteDialog.returnValue === 'confirm') {
      executeDelete();
    }
  });
  $('#delete-cancel').addEventListener('click', () => dom.deleteDialog.close('cancel'));

  // Close dialogs on backdrop click (click on the <dialog> element itself = backdrop)
  [dom.wizardModal, dom.importModal, dom.siteModal].forEach((dialog) => {
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) dialog.close();
    });
  });

  // Warn before leaving when there is unsaved data
  window.addEventListener('beforeunload', (e) => {
    if (items.length > 0 || sites.length > 0) {
      e.preventDefault();
    }
  });

  // Initial render
  render();
  renderSites();
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', init);
