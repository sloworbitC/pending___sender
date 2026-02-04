// --- Navigation ---
function showSection(sectionId) {
    const compose = document.getElementById('compose-section');
    const list = document.getElementById('email-list-section');
    
    // Safety check for elements
    if (compose) compose.classList.add('hidden');
    if (list) list.classList.add('hidden');

    if (sectionId === 'compose' && compose) {
        compose.classList.remove('hidden');
    } else if (list && ['inbox', 'sent', 'trash', 'spam'].includes(sectionId)) {
        list.classList.remove('hidden');
    }
}

function toggleBottomNav() {
    const nav = document.getElementById('bottom-nav');
    if (!nav) return;
    nav.classList.toggle('collapsed');
    localStorage.setItem('bottomNavCollapsed', nav.classList.contains('collapsed'));
}

// Global state
let attachedFiles = [];
let scanResults = [];

// UI Elements
const fileInput = document.getElementById('fileInput');
const previewBgLayer = document.getElementById('preview-bg-layer');
const attachmentList = document.getElementById('attachment-list');

// --- File Handling ---
async function handleNewFiles(files) {
    const newFiles = Array.from(files);
    
    // Size Validation
    if (newFiles.some(f => f.size > 4 * 1024 * 1024)) {
        if (previewBgLayer) {
            previewBgLayer.innerHTML = '<span style="color:red; font-weight:bold; font-size: 2rem">FILE TOO LARGE<br>Max 4MB per file.</span>';
        }
        return;
    }
    
    if (newFiles.length === 0) return;

    attachedFiles.push(...newFiles);
    fileInput.value = ''; // Reset input so same file can be picked again

    if (previewBgLayer) previewBgLayer.textContent = `Scanning ${newFiles.length} file(s)...`;

    const formData = new FormData();
    newFiles.forEach(f => formData.append('files', f));

    try {
        const res = await fetch('/api/scan', { method: 'POST', body: formData });
        if (!res.ok) throw new Error('Scan failed: ' + res.status);

        const newResults = await res.json();
        scanResults.push(...newResults);

        updateAttachmentList();
        
        // Auto-preview the most recently added file
        if (scanResults.length > 0) {
            displayResult(scanResults.length - 1);
        }
    } catch (err) {
        console.error("Upload error:", err);
        if (previewBgLayer) previewBgLayer.textContent = "Error scanning files.";
    }
}

function displayResult(index) {
    if (index < 0 || !scanResults[index]) {
        clearPreview();
        return;
    }

    const result = scanResults[index];
    
    // Update Background Text Preview
    if (previewBgLayer) {
        const normalized = (result.content || '')
            .replace(/\n/g, '<br>')
            .replace(/  /g, ' &nbsp;');
        previewBgLayer.innerHTML = normalized;
    }

    // Update Warning Tags
    const container = document.querySelector('.sensitive-tags-container');
    const panel = document.getElementById('warning-panel');
    if (!container || !panel) return;

    container.innerHTML = '';
    const detections = new Map();

    if (result.sensitive_terms?.length > 0) {
        detections.set('keywords', result.sensitive_terms.join(', '));
    }
    if (result.sensitive_patterns) {
        Object.entries(result.sensitive_patterns).forEach(([key, arr]) => {
            if (arr.length > 0) detections.set(key, arr.join(', '));
        });
    }

    panel.classList.toggle('hidden', detections.size === 0);

    detections.forEach((values, type) => {
        const tag = document.createElement('div');
        tag.className = 'sensitive-type-tag';
        tag.innerHTML = `<span class="tag-type">${type.toUpperCase()}</span>`;
        tag.title = values; // Tooltip with specific leaked data
        container.appendChild(tag);
    });
}

function updateAttachmentList() {
    if (!attachmentList) return;
    attachmentList.innerHTML = '';
    attachmentList.classList.toggle('hidden', attachedFiles.length === 0);

    attachedFiles.forEach((file, idx) => {
        const row = document.createElement('div');
        row.className = 'file-row';
        
        const hasWarning = scanResults[idx]?.sensitive_terms?.length > 0 || 
                          Object.keys(scanResults[idx]?.sensitive_patterns || {}).length > 0;

        row.innerHTML = `
            <span class="name ${hasWarning ? 'warning-text' : ''}" onclick="displayResult(${idx})">
                ${file.name}${hasWarning ? ' ⚠️' : ''}
            </span>
            <button class="remove" onclick="removeFile(${idx})">×</button>
        `;
        attachmentList.appendChild(row);
    });

    const clearBtn = document.getElementById('clear-preview-btn');
    if (clearBtn) clearBtn.classList.toggle('hidden', attachedFiles.length === 0);
}

window.removeFile = function(idx) {
    attachedFiles.splice(idx, 1);
    scanResults.splice(idx, 1);
    updateAttachmentList();
    
    if (attachedFiles.length > 0) {
        displayResult(Math.max(0, idx - 1));
    } else {
        clearPreview();
    }
};

function clearPreview() {
    if (previewBgLayer) previewBgLayer.innerHTML = '';
    const panel = document.getElementById('warning-panel');
    if (panel) panel.classList.add('hidden');
    
    const container = document.querySelector('.sensitive-tags-container');
    if (container) container.innerHTML = '';
}

// Initialize Listeners
if (fileInput) {
    fileInput.addEventListener('change', () => handleNewFiles(fileInput.files));
}

// Drag & Drop Listeners
const dropZone = document.querySelector('.upload-zone');
if (dropZone) {
    ['dragover', 'dragenter'].forEach(e => {
        dropZone.addEventListener(e, (evt) => {
            evt.preventDefault();
            dropZone.classList.add('drag-over');
        });
    });
    ['dragleave', 'drop'].forEach(e => {
        dropZone.addEventListener(e, () => dropZone.classList.remove('drag-over'));
    });
    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        handleNewFiles(e.dataTransfer.files);
    });
}