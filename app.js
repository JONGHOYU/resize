/**
 * PicResize Pro - 100% Client-side Batch Image Resizer
 * Runs entirely in the browser memory using HTML5 Canvas & Blob API
 */

// State
const state = {
  files: [], // Array of item objects
  resizeMode: 'long', // 'long' | 'short' | 'x' | 'y'
  targetDimension: 1200,
  outputFormat: 'image/webp',
  quality: 0.92,
  isProcessing: false
};

// DOM Elements
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const itemsContainer = document.getElementById('itemsContainer');
const emptyState = document.getElementById('emptyState');
const listToolbar = document.getElementById('listToolbar');
const fileCountBadge = document.getElementById('fileCountBadge');
const statusSummary = document.getElementById('statusSummary');
const btnClearAll = document.getElementById('btnClearAll');

const modeCards = document.querySelectorAll('.mode-card');
const targetDimensionInput = document.getElementById('targetDimension');
const dimensionLabel = document.getElementById('dimensionLabel');
const presetChips = document.querySelectorAll('.chip');
const outputFormatSelect = document.getElementById('outputFormat');
const qualityRange = document.getElementById('qualityRange');
const qualityValue = document.getElementById('qualityValue');
const qualityGroup = document.getElementById('qualityGroup');

const btnProcessAll = document.getElementById('btnProcessAll');
const btnDownloadZip = document.getElementById('btnDownloadZip');

// Mode Titles
const modeLabels = {
  long: '목표 긴축 크기 (px)',
  short: '목표 짧은축 크기 (px)',
  x: '목표 X축(가로 너비) 크기 (px)',
  y: '목표 Y축(세로 높이) 크기 (px)'
};

// Initialize Event Listeners
function init() {
  setupDragAndDrop();
  setupSettingsListeners();
  setupActionListeners();
}

// Mode Selection & Inputs
function setupSettingsListeners() {
  modeCards.forEach(card => {
    card.addEventListener('click', () => {
      modeCards.forEach(c => c.classList.remove('active'));
      card.classList.add('active');
      const radio = card.querySelector('input');
      radio.checked = true;
      state.resizeMode = radio.value;
      dimensionLabel.textContent = modeLabels[state.resizeMode];
      updateAllItemCalculations();
    });
  });

  targetDimensionInput.addEventListener('input', (e) => {
    const val = parseInt(e.target.value, 10);
    if (!isNaN(val) && val > 0) {
      state.targetDimension = val;
      // Sync preset chips active state
      presetChips.forEach(chip => {
        chip.classList.toggle('active', parseInt(chip.dataset.size, 10) === val);
      });
      updateAllItemCalculations();
    }
  });

  presetChips.forEach(chip => {
    chip.addEventListener('click', () => {
      const size = parseInt(chip.dataset.size, 10);
      targetDimensionInput.value = size;
      state.targetDimension = size;
      presetChips.forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      updateAllItemCalculations();
    });
  });

  outputFormatSelect.addEventListener('change', (e) => {
    state.outputFormat = e.target.value;
    if (state.outputFormat === 'image/png') {
      qualityGroup.style.opacity = '0.4';
      qualityRange.disabled = true;
    } else {
      qualityGroup.style.opacity = '1';
      qualityRange.disabled = false;
    }
    markProcessedItemsPending();
  });

  qualityRange.addEventListener('input', (e) => {
    const val = parseInt(e.target.value, 10);
    qualityValue.textContent = `${val}%`;
    state.quality = val / 100;
    markProcessedItemsPending();
  });
}

// Drag & Drop
function setupDragAndDrop() {
  ['dragenter', 'dragover'].forEach(eventName => {
    dropZone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.add('dragover');
    }, false);
  });

  ['dragleave', 'drop'].forEach(eventName => {
    dropZone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.remove('dragover');
    }, false);
  });

  dropZone.addEventListener('drop', (e) => {
    const dt = e.dataTransfer;
    const files = dt.files;
    handleFiles(files);
  });

  fileInput.addEventListener('change', (e) => {
    handleFiles(e.target.files);
    fileInput.value = ''; // Reset input to allow re-uploading same files
  });

  btnClearAll.addEventListener('click', () => {
    // Revoke object URLs to free memory
    state.files.forEach(item => {
      if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      if (item.resultBlobUrl) URL.revokeObjectURL(item.resultBlobUrl);
    });
    state.files = [];
    renderFileList();
    updateUIState();
  });
}

// Action Handlers
function setupActionListeners() {
  btnProcessAll.addEventListener('click', async () => {
    await processAllImages();
  });

  btnDownloadZip.addEventListener('click', async () => {
    await downloadAllAsZip();
  });
}

// Add uploaded files to state
async function handleFiles(fileList) {
  const validFiles = Array.from(fileList).filter(file => file.type.startsWith('image/'));
  if (validFiles.length === 0) return;

  for (const file of validFiles) {
    const id = 'img_' + Math.random().toString(36).substring(2, 9);
    const previewUrl = URL.createObjectURL(file);
    
    // Load metadata (dimensions)
    const dimensions = await getImageDimensions(previewUrl);

    const item = {
      id,
      file,
      name: file.name,
      originalSize: file.size,
      originalWidth: dimensions.width,
      originalHeight: dimensions.height,
      previewUrl,
      targetWidth: 0,
      targetHeight: 0,
      status: 'ready', // 'ready' | 'processing' | 'done' | 'error'
      resultBlob: null,
      resultBlobUrl: null,
      resultSize: 0,
      resultFormatExt: ''
    };

    calculateTargetSize(item);
    state.files.push(item);
  }

  renderFileList();
  updateUIState();
}

// Read image dimensions
function getImageDimensions(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      resolve({ width: 0, height: 0 });
    };
    img.src = url;
  });
}

/**
 * Core Algorithm:
 * 1. 긴축 기준: 가로/세로 중 긴 쪽을 targetDimension으로 맞추고 비율 유지
 * 2. 짧은축 기준: 가로/세로 중 짧은 쪽을 targetDimension으로 맞추고 비율 유지
 * 3. X축 기준: 너비(Width)를 targetDimension으로 고정하고 높이를 비율 계산
 * 4. Y축 기준: 높이(Height)를 targetDimension으로 고정하고 너비를 비율 계산
 */
function calculateTargetSize(item) {
  const { originalWidth: w, originalHeight: h } = item;
  if (!w || !h) {
    item.targetWidth = state.targetDimension;
    item.targetHeight = state.targetDimension;
    return;
  }

  const target = state.targetDimension;
  let newW = w;
  let newH = h;

  switch (state.resizeMode) {
    case 'long': {
      // 긴축 기준
      if (w >= h) {
        newW = target;
        newH = Math.round((h / w) * target);
      } else {
        newH = target;
        newW = Math.round((w / h) * target);
      }
      break;
    }
    case 'short': {
      // 짧은축 기준
      if (w <= h) {
        newW = target;
        newH = Math.round((h / w) * target);
      } else {
        newH = target;
        newW = Math.round((w / h) * target);
      }
      break;
    }
    case 'x': {
      // X축 (가로) 고정
      newW = target;
      newH = Math.round((h / w) * target);
      break;
    }
    case 'y': {
      // Y축 (세로) 고정
      newH = target;
      newW = Math.round((w / h) * target);
      break;
    }
  }

  item.targetWidth = Math.max(1, newW);
  item.targetHeight = Math.max(1, newH);
}

// Re-calculate target sizes for all items
function updateAllItemCalculations() {
  state.files.forEach(item => {
    calculateTargetSize(item);
    updateItemCardDOM(item);
  });
  markProcessedItemsPending();
}

// Mark completed items as pending re-process when settings change
function markProcessedItemsPending() {
  let hasDone = false;
  state.files.forEach(item => {
    if (item.status === 'done') {
      item.status = 'ready';
      if (item.resultBlobUrl) {
        URL.revokeObjectURL(item.resultBlobUrl);
        item.resultBlobUrl = null;
      }
      item.resultBlob = null;
      updateItemCardDOM(item);
      hasDone = true;
    }
  });
  if (hasDone) updateUIState();
}

// Render the entire file list
function renderFileList() {
  if (state.files.length === 0) {
    emptyState.style.display = 'block';
    listToolbar.style.display = 'none';
    itemsContainer.innerHTML = '';
    itemsContainer.appendChild(emptyState);
    return;
  }

  emptyState.style.display = 'none';
  listToolbar.style.display = 'flex';
  
  // Render cards
  itemsContainer.innerHTML = '';
  state.files.forEach(item => {
    const card = createItemCard(item);
    itemsContainer.appendChild(card);
  });
}

// Create DOM element for an item
function createItemCard(item) {
  const div = document.createElement('div');
  div.className = 'image-item-card';
  div.id = `card-${item.id}`;

  const extName = getExtension(item.name);

  div.innerHTML = `
    <div class="item-thumb-wrapper">
      <img src="${item.previewUrl}" alt="${item.name}" class="item-thumb">
    </div>
    <div class="item-details">
      <div class="item-name" title="${item.name}">${item.name}</div>
      <div class="item-meta">
        <span class="meta-original">${item.originalWidth}×${item.originalHeight}px</span>
        <span class="arrow-divider">→</span>
        <span class="meta-resized" id="resized-dim-${item.id}">${item.targetWidth}×${item.targetHeight}px</span>
        <span class="item-size" id="size-info-${item.id}">${formatBytes(item.originalSize)}</span>
        <span class="badge-status ${item.status}" id="status-badge-${item.id}">${getStatusText(item.status)}</span>
      </div>
    </div>
    <div class="item-actions">
      <button class="btn-item-download" id="btn-dl-${item.id}" ${item.status !== 'done' ? 'disabled' : ''}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>
        </svg>
        <span>다운로드</span>
      </button>
      <button class="btn-item-remove" id="btn-rm-${item.id}" title="제거">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M18 6 6 18M6 6l12 12"/>
        </svg>
      </button>
    </div>
  `;

  // Item download single
  const dlBtn = div.querySelector(`#btn-dl-${item.id}`);
  dlBtn.addEventListener('click', () => {
    downloadSingleItem(item);
  });

  // Remove single
  const rmBtn = div.querySelector(`#btn-rm-${item.id}`);
  rmBtn.addEventListener('click', () => {
    removeItem(item.id);
  });

  return div;
}

// Update single item DOM
function updateItemCardDOM(item) {
  const card = document.getElementById(`card-${item.id}`);
  if (!card) return;

  const dimEl = card.querySelector(`#resized-dim-${item.id}`);
  if (dimEl) dimEl.textContent = `${item.targetWidth}×${item.targetHeight}px`;

  const statusBadge = card.querySelector(`#status-badge-${item.id}`);
  if (statusBadge) {
    statusBadge.className = `badge-status ${item.status}`;
    statusBadge.textContent = getStatusText(item.status);
  }

  const sizeInfo = card.querySelector(`#size-info-${item.id}`);
  if (sizeInfo) {
    if (item.status === 'done' && item.resultSize) {
      sizeInfo.textContent = `${formatBytes(item.originalSize)} → ${formatBytes(item.resultSize)}`;
    } else {
      sizeInfo.textContent = formatBytes(item.originalSize);
    }
  }

  const dlBtn = card.querySelector(`#btn-dl-${item.id}`);
  if (dlBtn) {
    dlBtn.disabled = item.status !== 'done';
  }
}

function removeItem(id) {
  const idx = state.files.findIndex(f => f.id === id);
  if (idx !== -1) {
    const item = state.files[idx];
    if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    if (item.resultBlobUrl) URL.revokeObjectURL(item.resultBlobUrl);
    state.files.splice(idx, 1);
  }
  renderFileList();
  updateUIState();
}

function updateUIState() {
  const total = state.files.length;
  const doneCount = state.files.filter(f => f.status === 'done').length;

  fileCountBadge.textContent = `${total}개 이미지`;
  
  if (total === 0) {
    btnProcessAll.disabled = true;
    btnDownloadZip.disabled = true;
    statusSummary.textContent = '이미지를 업로드해주세요';
  } else {
    btnProcessAll.disabled = state.isProcessing;
    btnDownloadZip.disabled = doneCount === 0 || state.isProcessing;
    if (doneCount === total) {
      statusSummary.textContent = `전체 ${total}개 변환 완료`;
    } else if (doneCount > 0) {
      statusSummary.textContent = `${doneCount}/${total}개 완료됨`;
    } else {
      statusSummary.textContent = '리사이즈 대기 중';
    }
  }
}

// Resizing logic for a single image using Canvas
async function resizeImage(item) {
  return new Promise((resolve, reject) => {
    item.status = 'processing';
    updateItemCardDOM(item);

    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = item.targetWidth;
        canvas.height = item.targetHeight;

        const ctx = canvas.getContext('2d');
        // High quality smoothing
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';

        // Draw image resized
        ctx.drawImage(img, 0, 0, item.targetWidth, item.targetHeight);

        // Determine mime type & format
        let mime = state.outputFormat;
        if (mime === 'original') {
          mime = item.file.type || 'image/jpeg';
        }

        let extension = 'jpg';
        if (mime.includes('png')) extension = 'png';
        else if (mime.includes('webp')) extension = 'webp';
        else if (mime.includes('jpeg') || mime.includes('jpg')) extension = 'jpg';

        canvas.toBlob((blob) => {
          if (!blob) {
            item.status = 'error';
            updateItemCardDOM(item);
            reject(new Error('Canvas toBlob failed'));
            return;
          }

          if (item.resultBlobUrl) URL.revokeObjectURL(item.resultBlobUrl);
          item.resultBlob = blob;
          item.resultBlobUrl = URL.createObjectURL(blob);
          item.resultSize = blob.size;
          item.resultFormatExt = extension;
          item.status = 'done';

          updateItemCardDOM(item);
          resolve(item);
        }, mime, state.quality);

      } catch (err) {
        console.error('Resize error:', err);
        item.status = 'error';
        updateItemCardDOM(item);
        reject(err);
      }
    };

    img.onerror = (err) => {
      item.status = 'error';
      updateItemCardDOM(item);
      reject(err);
    };

    img.src = item.previewUrl;
  });
}

// Batch Process All Images
async function processAllImages() {
  if (state.files.length === 0 || state.isProcessing) return;

  state.isProcessing = true;
  btnProcessAll.disabled = true;
  btnDownloadZip.disabled = true;
  statusSummary.textContent = '변환 진행 중...';

  // Process sequentially or with slight concurrency to prevent memory spikes
  for (let i = 0; i < state.files.length; i++) {
    const item = state.files[i];
    statusSummary.textContent = `변환 중 (${i + 1}/${state.files.length})...`;
    try {
      await resizeImage(item);
    } catch (e) {
      console.warn(`Failed resizing ${item.name}`, e);
    }
  }

  state.isProcessing = false;
  updateUIState();
}

// Single item download
function downloadSingleItem(item) {
  if (!item.resultBlobUrl) return;

  const baseName = stripExtension(item.name);
  const fileName = `${baseName}_${item.targetWidth}x${item.targetHeight}.${item.resultFormatExt}`;

  const a = document.createElement('a');
  a.href = item.resultBlobUrl;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// Batch ZIP Download using JSZip
async function downloadAllAsZip() {
  const completedItems = state.files.filter(f => f.status === 'done' && f.resultBlob);
  if (completedItems.length === 0) return;

  btnDownloadZip.disabled = true;
  const originalText = btnDownloadZip.innerHTML;
  btnDownloadZip.innerHTML = `
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="spin">
      <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
    </svg>
    <span>ZIP 압축 생성 중...</span>
  `;

  try {
    const zip = new JSZip();
    const usedNames = new Set();

    completedItems.forEach(item => {
      const baseName = stripExtension(item.name);
      let fileName = `${baseName}_${item.targetWidth}x${item.targetHeight}.${item.resultFormatExt}`;
      
      // Handle duplicated names
      let counter = 1;
      while (usedNames.has(fileName)) {
        fileName = `${baseName}_${item.targetWidth}x${item.targetHeight}_(${counter}).${item.resultFormatExt}`;
        counter++;
      }
      usedNames.add(fileName);

      zip.file(fileName, item.resultBlob);
    });

    const content = await zip.generateAsync({ type: 'blob' });
    const zipUrl = URL.createObjectURL(content);

    const a = document.createElement('a');
    a.href = zipUrl;
    a.download = `resized_images_${getFormattedTimestamp()}.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    setTimeout(() => URL.revokeObjectURL(zipUrl), 2000);
  } catch (err) {
    alert('ZIP 압축 중 오류가 발생했습니다: ' + err.message);
  } finally {
    btnDownloadZip.disabled = false;
    btnDownloadZip.innerHTML = originalText;
  }
}

// Helpers
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function stripExtension(filename) {
  return filename.replace(/\.[^/.]+$/, "");
}

function getExtension(filename) {
  return filename.slice((filename.lastIndexOf(".") - 1 >>> 0) + 2);
}

function getFormattedTimestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function getStatusText(status) {
  switch (status) {
    case 'ready': return '대기';
    case 'processing': return '변환 중...';
    case 'done': return '완료';
    case 'error': return '실패';
    default: return '';
  }
}

// Start
document.addEventListener('DOMContentLoaded', init);
