/**
 * Feed Editor — CMS Upselling
 * Vanilla JS editor for managing the upselling feed JSON.
 */

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let items = [];
let editingIndex = -1; // -1 = adding new
let currentStep = 0;
const TOTAL_STEPS = 5;
const LOCATIONS = ['dashboard', 'pages-sidebar', 'pages-editor', 'media-manager'];

// Chip state (managed outside the DOM for cleanliness)
let chipTags = [];
let chipExclude = [];

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const dom = {
  itemList: $('#item-list'),
  emptyState: $('#empty-state'),
  wizardModal: $('#wizard-modal'),
  wizardTitle: $('#wizard-title'),
  importModal: $('#import-modal'),
  deleteDialog: $('#delete-dialog'),
  deleteItemName: $('#delete-item-name'),
  toastContainer: $('#toast-container'),
  // Wizard fields
  fieldTitle: $('#field-title'),
  fieldDesc: $('#field-description'),
  fieldId: $('#field-id'),
  fieldCtaLabel: $('#field-cta-label'),
  fieldCtaUrl: $('#field-cta-url'),
  utmPreview: $('#utm-preview'),
  locationsGroup: $('#locations-group'),
  tagsWrapper: $('#tags-wrapper'),
  tagsInput: $('#tags-input'),
  excludeWrapper: $('#exclude-wrapper'),
  excludeInput: $('#exclude-input'),
  fieldStartDate: $('#field-start-date'),
  fieldEndDate: $('#field-end-date'),
  fieldImage: $('#field-image'),
  imagePreview: $('#image-preview'),
  // Preview
  previewImage: $('#preview-image'),
  previewTitle: $('#preview-title'),
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

function toast(message, type = '') {
  const el = document.createElement('div');
  el.className = `toast ${type ? `toast-${type}` : ''}`;
  el.textContent = message;
  dom.toastContainer.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

// ---------------------------------------------------------------------------
// Render Item List
// ---------------------------------------------------------------------------
function render() {
  const hasItems = items.length > 0;
  dom.itemList.hidden = !hasItems;
  dom.emptyState.hidden = hasItems;

  if (!hasItems) {
    dom.itemList.innerHTML = '';
    return;
  }

  dom.itemList.innerHTML = items.map((item, i) => {
    const status = getStatus(item);
    const locationBadges = (item.locations || [])
      .map((loc) => `<span class="badge badge-location">${loc}</span>`)
      .join('');

    return `
      <div class="item-row" draggable="true" data-index="${i}">
        <span class="drag-handle" title="Drag to reorder">&#9776;</span>
        <div class="item-info">
          <div class="item-title">${escapeHtml(item.title)}</div>
          <div class="item-meta">
            ${locationBadges}
          </div>
        </div>
        <span class="badge badge-status badge-${status}">${statusLabel(status)}</span>
        <span class="item-priority" title="Priority">#${item.priority}</span>
        <div class="item-actions">
          <button type="button" class="btn btn-sm btn-secondary" data-action="edit" data-index="${i}">Edit</button>
          <button type="button" class="btn btn-sm btn-danger" data-action="delete" data-index="${i}">Delete</button>
        </div>
      </div>`;
  }).join('');

  bindDragAndDrop();
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ---------------------------------------------------------------------------
// Drag & Drop
// ---------------------------------------------------------------------------
let dragIndex = null;

function bindDragAndDrop() {
  const rows = $$('.item-row');
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

  // Reorder items
  const [moved] = items.splice(dragIndex, 1);
  items.splice(dropIndex, 0, moved);

  // Recalculate priorities
  items.forEach((item, i) => (item.priority = i + 1));
  render();
  toast('Priority updated');
}

function onDragEnd(e) {
  e.currentTarget.classList.remove('dragging');
  $$('.item-row').forEach((r) => r.classList.remove('drag-over'));
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
  dom.wizardModal.hidden = false;
}

function closeWizard() {
  dom.wizardModal.hidden = true;
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
// Wizard: Populate / Reset / Collect
// ---------------------------------------------------------------------------
function resetWizard() {
  dom.fieldTitle.value = '';
  dom.fieldDesc.value = '';
  dom.fieldId.value = '';
  dom.fieldCtaLabel.value = '';
  dom.fieldCtaUrl.value = '';
  dom.fieldStartDate.value = '';
  dom.fieldEndDate.value = '';
  dom.fieldImage.value = '';

  // Locations
  dom.locationsGroup.querySelectorAll('input').forEach((cb) => (cb.checked = false));

  // Chips
  chipTags = [];
  chipExclude = [];
  renderChips(dom.tagsWrapper, dom.tagsInput, chipTags);
  renderChips(dom.excludeWrapper, dom.excludeInput, chipExclude);

  clearValidation();
  updateImagePreview('');
}

function populateWizard(item) {
  dom.fieldTitle.value = item.title || '';
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

  // Chips
  chipTags = [...(item.tags || [])];
  chipExclude = [...(item.exclude_if_plugin || [])];
  renderChips(dom.tagsWrapper, dom.tagsInput, chipTags);
  renderChips(dom.excludeWrapper, dom.excludeInput, chipExclude);

  clearValidation();
  updateImagePreview(item.image || '');
}

function collectItem() {
  const id = dom.fieldId.value.trim() || slugify(dom.fieldTitle.value.trim());
  return {
    id,
    title: dom.fieldTitle.value.trim(),
    description: dom.fieldDesc.value.trim(),
    cta_label: dom.fieldCtaLabel.value.trim(),
    cta_url: dom.fieldCtaUrl.value.trim(),
    image: dom.fieldImage.value.trim(),
    priority: editingIndex >= 0 ? items[editingIndex].priority : items.length + 1,
    tags: [...chipTags],
    locations: [...dom.locationsGroup.querySelectorAll('input:checked')].map((cb) => cb.value),
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
// Save
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
// Delete
// ---------------------------------------------------------------------------
let deleteTarget = -1;

function confirmDelete(index) {
  deleteTarget = index;
  dom.deleteItemName.textContent = items[index]?.title || '';
  dom.deleteDialog.showModal();
}

function executeDelete() {
  if (deleteTarget < 0) return;
  items.splice(deleteTarget, 1);
  // Recalculate priorities
  items.forEach((item, i) => (item.priority = i + 1));
  deleteTarget = -1;
  render();
  toast('Item deleted');
}

// ---------------------------------------------------------------------------
// Chips
// ---------------------------------------------------------------------------
function renderChips(wrapper, input, chipArray) {
  // Remove existing chips
  wrapper.querySelectorAll('.chip').forEach((c) => c.remove());

  // Insert chips before the input
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

  // Split by comma for pasting multiple at once
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
  const desc = dom.fieldDesc.value.trim() || 'Item description will appear here.';
  const ctaLabel = dom.fieldCtaLabel.value.trim() || 'CTA';
  const imageUrl = dom.fieldImage.value.trim();

  dom.previewTitle.textContent = title;
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
  dom.importModal.hidden = false;
}

function closeImportModal() {
  dom.importModal.hidden = true;
}

function executeImport() {
  // Try file first
  const file = dom.importFile.files?.[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      parseAndLoadFeed(e.target.result);
    };
    reader.readAsText(file);
    return;
  }

  // Fall back to textarea
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
    items = data.items;
    // Ensure all items have required fields
    items.forEach((item, i) => {
      item.priority = item.priority ?? i + 1;
      item.tags = item.tags ?? [];
      item.locations = item.locations ?? [];
      item.exclude_if_plugin = item.exclude_if_plugin ?? [];
      item.start_date = item.start_date ?? null;
      item.end_date = item.end_date ?? null;
    });
    // Sort by priority
    items.sort((a, b) => a.priority - b.priority);
    render();
    closeImportModal();
    toast(`Imported ${items.length} item(s)`, 'success');
  } catch (err) {
    toast(`Invalid JSON: ${err.message}`, 'error');
  }
}

function exportFeed() {
  const feed = {
    version: 1,
    items: items
      .slice()
      .sort((a, b) => a.priority - b.priority)
      .map((item) => ({
        id: item.id,
        title: item.title,
        description: item.description,
        cta_label: item.cta_label,
        cta_url: item.cta_url,
        image: item.image,
        priority: item.priority,
        tags: item.tags,
        locations: item.locations,
        exclude_if_plugin: item.exclude_if_plugin,
        start_date: item.start_date,
        end_date: item.end_date,
      })),
  };

  const json = JSON.stringify(feed, null, 2);

  // Copy to clipboard
  navigator.clipboard.writeText(json).then(
    () => toast('JSON copied to clipboard', 'success'),
    () => toast('Could not copy to clipboard', 'error')
  );

  // Also download as file
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
  // Add item buttons
  $('#btn-add').addEventListener('click', () => openWizard());
  $('#btn-add-empty').addEventListener('click', () => openWizard());

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
      // Only allow going to steps we've passed (or current), or validate first
      if (target <= currentStep) {
        currentStep = target;
        updateStepUI();
      } else {
        // Try to advance step by step
        for (let s = currentStep; s < target; s++) {
          if (!validateStep(s)) return;
        }
        currentStep = target;
        updateStepUI();
      }
    });
  });

  // Live preview updates
  dom.fieldTitle.addEventListener('input', handleTitleInput);
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
    // Backspace removes last chip when input is empty
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
    if (btn.dataset.action === 'delete') confirmDelete(index);
  });

  // Delete dialog
  dom.deleteDialog.addEventListener('close', () => {
    if (dom.deleteDialog.returnValue === 'confirm') {
      executeDelete();
    }
  });
  $('#delete-cancel').addEventListener('click', () => dom.deleteDialog.close());

  // Close modals on backdrop click
  dom.wizardModal.addEventListener('click', (e) => {
    if (e.target === dom.wizardModal) closeWizard();
  });
  dom.importModal.addEventListener('click', (e) => {
    if (e.target === dom.importModal) closeImportModal();
  });

  // Escape key closes modals
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!dom.wizardModal.hidden) closeWizard();
      if (!dom.importModal.hidden) closeImportModal();
    }
  });

  // Wizard open resets the manual-edit flag
  const origOpen = openWizard;

  // Initial render
  render();
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', init);
