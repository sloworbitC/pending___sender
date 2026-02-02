// --- Navigation ---
function showSection(sectionId) {
    // Hide all sections
    document.getElementById('compose-section').classList.add('hidden');
    document.getElementById('email-list-section').classList.add('hidden');

    // Show requested section
    if (sectionId === 'compose') {
        document.getElementById('compose-section').classList.remove('hidden');
    } else if (['inbox', 'sent', 'trash', 'spam'].includes(sectionId)) {
        document.getElementById('email-list-section').classList.remove('hidden');
    }
}

function toggleBottomNav() {
    const nav = document.getElementById('bottom-nav');
    nav.classList.toggle('collapsed');

    // Optional: save preference in localStorage
    localStorage.setItem('bottomNavCollapsed', nav.classList.contains('collapsed'));
}

// Optional: restore state on load
window.addEventListener('load', () => {
    if (localStorage.getItem('bottomNavCollapsed') === 'true') {
        document.getElementById('bottom-nav').classList.add('collapsed');
    }
});

//--------upload

const dropZone = document.querySelector('.upload-zone');

// Highlight when dragging over
['dragover', 'dragenter'].forEach(eventName => {
    dropZone.addEventListener(eventName, e => {
        e.preventDefault();
        dropZone.classList.add('drag-over');
    });
});

// Remove highlight when leaving
['dragleave', 'drop'].forEach(eventName => {
    dropZone.addEventListener(eventName, () => {
        dropZone.classList.remove('drag-over');
    });
});

// Handle dropped files (same as selected files)
dropZone.addEventListener('drop', e => {
    e.preventDefault();
    const droppedFiles = Array.from(e.dataTransfer.files);
    if (droppedFiles.length > 0) {
        // Reuse your existing file handling logic
        handleNewFiles(droppedFiles); // ← rename your upload handler to this
    }
});



// Global state
let attachedFiles = [];
let scanResults = [];

// UI elements
const fileInput = document.getElementById('fileInput');
const previewBgLayer = document.getElementById('preview-bg-layer');
const warningBox = document.getElementById('warning-box');
const warningDetails = document.getElementById('warning-details');
const attachmentList = document.getElementById('attachment-list');

// Create dropdown + status badge
const attachmentControls = document.createElement('div');
attachmentControls.style.margin = '10px 0';
fileInput.parentNode.insertBefore(attachmentControls, fileInput.nextSibling);

const fileCountBadge = document.getElementById('file-count-badge');

fileInput.addEventListener('change', () => {
    handleNewFiles(fileInput.files);
});

// When files are selected (can happen multiple times)
async function handleNewFiles(files) {

    
    const newFiles = Array.from(files);
    if (newFiles.length === 0) return;

    attachedFiles.push(...newFiles);
    fileInput.value = '';

    // Null check + fallback message
    if (previewBgLayer) {
        previewBgLayer.textContent = `Scanning ${newFiles.length} file(s)...`;
    } else {
        console.warn("previewBgLayer element not found in DOM");
    }

    const formData = new FormData();
    newFiles.forEach(f => formData.append('files', f));

    try {
        const res = await fetch('/api/scan', { method: 'POST', body: formData });
        if (!res.ok) throw new Error('Scan failed');

        const newResults = await res.json();
        scanResults.push(...newResults);

        updateAttachmentList();           // This should now show the list
        if (scanResults.length > 0) {
            displayResult(scanResults.length - 1);
        }

        if (previewBgLayer) {
            previewBgLayer.textContent = scanResults[scanResults.length - 1]?.content || '';
        }

    } catch (err) {
        console.error("Upload error:", err);
        if (previewBgLayer) previewBgLayer.textContent = `Error: ${err.message}`;
    }

    updateAttachmentList();
    displayResult(scanResults.length - 1);
}

// Update dropdown options + badge
function updateDropdownAndBadge() {

    if (attachedFiles.length === 0) {
        fileCountBadge.textContent = '0 files';
        fileCountBadge.style.background = '#444';
        return;
    }

    attachedFiles.forEach((file, i) => {
        const opt = document.createElement('option');
        opt.value = i;

        const hasWarning = scanResults[i]?.sensitive_terms?.length > 0 ||
            Object.keys(scanResults[i]?.sensitive_patterns || {}).length > 0;

        opt.textContent = `${file.name}${hasWarning ? ' ⚠️' : ''}`;
        opt.style.color = hasWarning ? '#ff4b4b' : '#0f0';
    });

    fileCountBadge.textContent = `${attachedFiles.length} file${attachedFiles.length === 1 ? '' : 's'}`;
    fileCountBadge.style.background = attachedFiles.length > 0 ? '#C78E3A' : '#444';
}


let currentPreviewIndex = -1;

function displayResult(index) {
    if (index < 0 || !previewBgLayer) {
        if (previewBgLayer) previewBgLayer.textContent = '';
        currentPreviewIndex = -1;
        updateActiveRow();
        return;
    }

    const result = scanResults[index];
    if (!result) return;

    previewBgLayer.innerHTML = (result.content || '').replace(/\n/g, "<br>");
    currentPreviewIndex = index;
    updateActiveRow();

    const container = document.querySelector('.sensitive-tags-container');
    if (!container) {
        console.warn("sensitive-tags-container not found");
        return;
    }

    // Clear old tags
    container.innerHTML = '';

    // Collect detections
    const detections = new Map();

    if (result.sensitive_terms?.length > 0) {
        detections.set('keywords', result.sensitive_terms.join(', '));
    }

    if (result.sensitive_patterns) {
        Object.entries(result.sensitive_patterns).forEach(([key, arr]) => {
            if (Array.isArray(arr) && arr.length > 0) {
                const cleanKey = key.toUpperCase().replace(/_/g, ' ').toLowerCase();
                detections.set(cleanKey, arr.join(', '));
            }
        });
    }

    // Show/hide the whole warning panel
    const panel = document.getElementById('warning-panel');
    if (panel) {
        panel.classList.toggle('hidden', detections.size === 0);
    }

    if (detections.size === 0) return;

    // ─── CREATE TAGS WITH PREDEFINED POSITIONS ───
    detections.forEach((values, type) => {
        const tag = document.createElement('div');
        tag.className = 'sensitive-type-tag';

        let displayText = type.toUpperCase();

        if (type.toLowerCase() === 'keywords') {
            displayText = 'CONTAINS';          // ← your custom text
            console.log("Renamed keywords to:", displayText); // debug confirmation
        }

        tag.textContent = displayText;
        tag.setAttribute('data-type', type.toLowerCase());
        tag.setAttribute('data-values', values || '(no details)');

        container.appendChild(tag);
    });
}


function displayWarnings(terms, patterns) {
    // Reusing the logic for Body text scanning
    warningDetails.innerHTML = '';
    let hasIssues = false;

    if (terms.length > 0) {
        warningDetails.innerHTML += `<div><strong>Keywords:</strong> ${terms.join(', ')}</div>`;
        hasIssues = true;
    }
    if (Object.keys(patterns).length > 0) {
        for (const [key, matches] of Object.entries(patterns)) {
            warningDetails.innerHTML += `<div><strong>${key}:</strong> ${matches.join(', ')}</div>`;
        }
        hasIssues = true;
    }

    if (hasIssues) warningBox.classList.remove('hidden');
    else warningBox.classList.add('hidden');
}

// New helper function
function updateActiveRow() {
    document.querySelectorAll('.file-row').forEach(row => {
        row.classList.remove('active');
    });

    if (currentPreviewIndex >= 0) {
        const activeRow = document.querySelector(
            `.file-row[data-index="${currentPreviewIndex}"]`
        );
        if (activeRow) {
            activeRow.classList.add('active');
            console.log("Activated row for index:", currentPreviewIndex);
        } else {
            console.warn("No row found for index:", currentPreviewIndex);
        }
    }
}

// --- Send Email ---
document.getElementById('emailForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    // Clear previous errors (keep your validation)
    document.querySelectorAll('.field-error').forEach(el => {
        el.classList.remove('visible');
        el.textContent = '';
    });

    let isValid = true;

    const recipientInput = document.getElementById('recipient');
    const email = recipientInput.value.trim();
    const emailError = document.getElementById('email-error');

    if (!email) {
        emailError.textContent = "Recipient email is required.";
        emailError.classList.add('visible');
        recipientInput.focus();
        isValid = false;
    } else if (!email.includes('@') || !email.includes('.')) {
        emailError.textContent = "Please enter a valid email address.";
        emailError.classList.add('visible');
        recipientInput.focus();
        isValid = false;
    }

    const subjectInput = document.getElementById('subject');
    const subject = subjectInput.value.trim();
    const subjectError = document.getElementById('subject-error');

    if (!subject) {
        subjectError.textContent = "Subject is required.";
        subjectError.classList.add('visible');
        subjectInput.focus();
        isValid = false;
    }

    if (!isValid) return;

    const statusDiv = document.getElementById('send-status');
    statusDiv.textContent = "✔  Compose & scan complete (demo mode)";
    statusDiv.style.color = "rgb(45, 170, 149)";

    // Reset form & state
    e.target.reset();
    attachedFiles = [];
    scanResults = [];
    updateAttachmentList();
    clearPreview();  // ← this already clears preview + warnings
});

// Live validation for email
const recipientInput = document.getElementById('recipient');
const emailError = document.getElementById('email-error');

recipientInput.addEventListener('input', () => {
    const email = recipientInput.value.trim();
    emailError.classList.remove('visible');
    emailError.textContent = '';

    // Optional: show error only if user has typed something invalid
    if (email.length > 0 && (!email.includes('@') || !email.includes('.'))) {
        emailError.textContent = "Please enter a valid email address.";
        emailError.classList.add('visible');
    }
});

// Live validation for subject
const subjectInput = document.getElementById('subject');
const subjectError = document.getElementById('subject-error');

subjectInput.addEventListener('input', () => {
    const subject = subjectInput.value.trim();
    subjectError.classList.remove('visible');
    subjectError.textContent = '';

    if (subject.length === 0) {
        subjectError.textContent = "Subject is required.";
        subjectError.classList.add('visible');
    }
});

async function loadEmails(folder) {
    showSection(folder);
    document.getElementById('folder-title').textContent = folder.charAt(0).toUpperCase() + folder.slice(1);

    const container = document.getElementById('email-container');
    container.innerHTML = '<p>(Demo mode: no real emails loaded)</p>';

    // Optional: fake some static cards so it looks alive
    const mockEmails = [
        { subject: "Welcome to Demo", sender: "demo@example.com", body: "This is just placeholder content." },
        { subject: "Mock Enail", sender: "boss@company.hk", body: "demo content" }
    ];

    mockEmails.forEach(email => {
        const card = document.createElement('div');
        card.className = 'email-card';
        card.innerHTML = `
            <h4>${email.subject}</h4>
            <small>From: ${email.sender}</small>
            <p>${email.body}</p>
        `;
        container.appendChild(card);
    });
}

// Render scrolling list
function updateAttachmentList() {
    if (!attachmentList) {
        console.error("attachment-list element missing!");
        return;
    }

    attachmentList.innerHTML = '';
    attachmentList.classList.toggle('hidden', attachedFiles.length === 0);

    if (attachedFiles.length === 0) return;

    console.log("Rendering", attachedFiles.length, "files");

    attachedFiles.forEach((file, idx) => {
        const row = document.createElement('div');
        row.className = 'file-row';
        row.dataset.index = idx;                    // ← crucial: store the index

        const hasWarning = scanResults[idx]?.sensitive_terms?.length > 0 ||
            Object.keys(scanResults[idx]?.sensitive_patterns || {}).length > 0;

        if (hasWarning) row.classList.add('warning');

        const nameSpan = document.createElement('span');
        nameSpan.className = 'name';
        nameSpan.textContent = `${file.name}${hasWarning ? ' ⚠️' : ''}`;
        nameSpan.style.cursor = 'pointer';
        nameSpan.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            displayResult(idx);
        });
        row.appendChild(nameSpan);

        const removeBtn = document.createElement('button');
        removeBtn.className = 'remove';
        removeBtn.textContent = '×';
        removeBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            removeFile(idx);
        });
        row.appendChild(removeBtn);

        attachmentList.appendChild(row);
    });

    // Show/hide Clear Preview button
    const clearBtn = document.getElementById('clear-preview-btn');
    if (clearBtn) {
        clearBtn.classList.toggle('visible', attachedFiles.length > 0);
    }

    updateClearButton();
    updateActiveRow();
}

// Remove file
window.removeFile = function (idx) {
    attachedFiles.splice(idx, 1);
    scanResults.splice(idx, 1);
    updateAttachmentList();
    if (scanResults.length > 0) {
        displayResult(0);
    } else {
        previewBgLayer.textContent = '';
        clear();
    }

    updateClearButton();
    updateActiveRow();
};

// Display result in foreground + background



function updateClearButton() {
    const clearBtn = document.getElementById('clear--btn');
    if (clearBtn) {
        clearBtn.classList.toggle('visible', attachedFiles.length > 0);
        clearBtn.classList.toggle('hidden', attachedFiles.length === 0);
    }
}

function clear() {
    if (previewBgLayer) {
        previewBgLayer.textContent = '';
    }

    // Clear warning panel & tags
    const panel = document.getElementById('warning-panel');
    if (panel) {
        panel.classList.add('hidden');
    }

    const container = document.querySelector('.sensitive-tags-container');
    if (container) {
        container.innerHTML = '';  // remove all tags
    }

    // Optional: reset preview index if it affects anything
    currentPreviewIndex = -1;
}
