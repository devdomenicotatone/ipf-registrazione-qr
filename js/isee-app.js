/**
 * IPF Aggiornamento ISEE — App Logic
 * =====================================
 * Form dedicato per aggiornare l'ISEE dei tesserati esistenti.
 * Riusa validator.js per il checksum CF.
 * Include upload PDF via Base64 → Apps Script → Google Drive.
 * Supporta upload foto multiple con merge automatico in PDF (jsPDF).
 */

// ============================================================
// CONFIGURAZIONE
// ============================================================
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzAVR1693co5hEWW9lQIRY2ZkIUeXE8OCOBet5M8EelAge-uFOdCAF0vCY5CH8rOm-g/exec';

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB per file
const MAX_PHOTOS = 10;
const PHOTO_MAX_WIDTH = 1200; // px per resize

// Stato
let selectedFile = null;
let fileBase64 = null;
let uploadMode = 'pdf'; // 'pdf' | 'photo'
let photoFiles = []; // Array di { file, dataUrl }
let lookupData = null; // Dati tesserato trovato dal lookup

// ============================================================
// INIZIALIZZAZIONE
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
    const annoField = document.getElementById('isee_anno');
    if (annoField && !annoField.value) {
        annoField.value = new Date().getFullYear();
    }

    setupLookup();
    setupIseeValidation();
    setupFileUpload();
    setupModeSelector();

    document.getElementById('isee-form').addEventListener('submit', handleIseeSubmit);
    console.log('✅ ISEE App inizializzata');
});

// ============================================================
// LOOKUP TESSERATO
// ============================================================
function setupLookup() {
    const lookupBtn = document.getElementById('lookup-btn');
    const tesseraInput = document.getElementById('n_tessera');
    const changeBtn = document.getElementById('lookup-change-btn');

    if (lookupBtn) {
        lookupBtn.addEventListener('click', () => lookupTesserato());
    }

    // Cerca anche premendo Enter nel campo
    if (tesseraInput) {
        tesseraInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                lookupTesserato();
            }
        });
    }

    // Pulsante "Cambia tesserato"
    if (changeBtn) {
        changeBtn.addEventListener('click', () => resetLookup());
    }
}

async function lookupTesserato() {
    const tesseraInput = document.getElementById('n_tessera');
    const nTessera = tesseraInput?.value?.trim();

    if (!nTessera) {
        showToast('⚠️ Inserisci un numero tessera', 'error');
        tesseraInput?.focus();
        return;
    }

    const lookupBtn = document.getElementById('lookup-btn');
    const loading = document.getElementById('lookup-loading');
    const result = document.getElementById('lookup-result');

    // UI: loading
    if (lookupBtn) lookupBtn.disabled = true;
    if (loading) loading.style.display = 'flex';
    if (result) result.style.display = 'none';

    try {
        const url = APPS_SCRIPT_URL + '?action=lookup&n_tessera=' + encodeURIComponent(nTessera);
        const response = await fetch(url);
        const json = await response.json();

        if (json.status === 'error') {
            showToast('❌ ' + json.message, 'error');
            return;
        }

        // Successo: mostra i dati
        lookupData = json.data;

        document.getElementById('lookup-cognome').textContent = lookupData.cognome;
        document.getElementById('lookup-nome').textContent = lookupData.nome;
        document.getElementById('lookup-cf').textContent = lookupData.codice_fiscale;
        document.getElementById('codice_fiscale').value = lookupData.codice_fiscale;

        // Nascondi input, mostra card risultato
        const inputRow = document.querySelector('.lookup-input-row');
        const helperText = inputRow?.closest('.field-group')?.querySelector('.helper-text');
        if (inputRow) inputRow.style.display = 'none';
        if (helperText) helperText.style.display = 'none';
        if (result) result.style.display = 'block';

        // Mostra sezioni ISEE
        const sections = document.getElementById('isee-sections');
        if (sections) sections.style.display = 'block';

        showToast(`✅ Tesserato trovato: ${lookupData.cognome} ${lookupData.nome}`, 'success');
        console.log('🔍 Lookup OK:', lookupData);

    } catch (err) {
        console.error('Errore lookup:', err);
        showToast('❌ Errore di connessione. Riprova.', 'error');
    } finally {
        if (lookupBtn) lookupBtn.disabled = false;
        if (loading) loading.style.display = 'none';
    }
}

function resetLookup() {
    lookupData = null;

    // Resetta UI
    const inputRow = document.querySelector('.lookup-input-row');
    const helperText = inputRow?.closest('.field-group')?.querySelector('.helper-text');
    const result = document.getElementById('lookup-result');
    const sections = document.getElementById('isee-sections');
    const tesseraInput = document.getElementById('n_tessera');

    if (inputRow) inputRow.style.display = 'flex';
    if (helperText) helperText.style.display = '';
    if (result) result.style.display = 'none';
    if (sections) sections.style.display = 'none';
    if (tesseraInput) {
        tesseraInput.value = '';
        tesseraInput.focus();
    }

    document.getElementById('codice_fiscale').value = '';
}

// ============================================================
// MODE SELECTOR
// ============================================================
function setupModeSelector() {
    const btns = document.querySelectorAll('.upload-mode-btn');
    btns.forEach(btn => {
        btn.addEventListener('click', () => {
            const mode = btn.dataset.mode;
            if (mode === uploadMode) return;

            uploadMode = mode;

            // Toggle active class
            btns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            // Toggle panels
            document.getElementById('panel-pdf').classList.toggle('active', mode === 'pdf');
            document.getElementById('panel-photo').classList.toggle('active', mode === 'photo');

            // Reset stato dell'altra modalità
            if (mode === 'pdf') {
                resetPhotos();
            } else {
                removeFile();
            }
        });
    });
}

// ============================================================
// VALIDAZIONE REAL-TIME
// ============================================================
function setupIseeValidation() {
    // CF ora è un campo hidden popolato dal lookup

    const importoEl = document.getElementById('isee_importo');
    if (importoEl) {
        importoEl.addEventListener('blur', () => {
            const val = importoEl.value.trim();
            if (val) {
                const result = validateIseeImporto(val);
                showFieldValidation('isee_importo', result);
            }
        });
    }

    const annoEl = document.getElementById('isee_anno');
    if (annoEl) {
        annoEl.addEventListener('blur', () => {
            const val = annoEl.value.trim();
            if (val) {
                const year = parseInt(val);
                const currentYear = new Date().getFullYear();
                if (isNaN(year) || year < 2020 || year > currentYear + 1) {
                    showFieldValidation('isee_anno', {
                        status: 'error',
                        detail: `Anno non valido (2020-${currentYear})`
                    });
                } else {
                    showFieldValidation('isee_anno', {
                        status: 'ok',
                        detail: `Anno ${year} ✓`
                    });
                }
            }
        });
    }

    const nucleoEl = document.getElementById('nucleo_familiare');
    if (nucleoEl) {
        nucleoEl.addEventListener('blur', () => {
            const val = nucleoEl.value.trim();
            if (val) {
                const num = parseInt(val);
                if (isNaN(num) || num < 1 || num > 20) {
                    showFieldValidation('nucleo_familiare', {
                        status: 'error',
                        detail: 'Inserisci un numero tra 1 e 20'
                    });
                } else {
                    showFieldValidation('nucleo_familiare', {
                        status: 'ok',
                        detail: `${num} componenti ✓`
                    });
                }
            }
        });
    }
}

function validateCfField() {
    const cfEl = document.getElementById('codice_fiscale');
    if (!cfEl) return;
    const cf = cfEl.value.trim();
    if (cf.length === 0) return;

    if (cf.length !== 16) {
        showFieldValidation('codice_fiscale', {
            status: 'error',
            detail: `Il CF deve essere di 16 caratteri (hai inserito ${cf.length})`
        });
        return;
    }

    if (typeof verifyCfChecksum === 'function') {
        const valid = verifyCfChecksum(cf);
        if (valid) {
            showFieldValidation('codice_fiscale', {
                status: 'ok',
                detail: 'Codice Fiscale valido ✓'
            });
        } else {
            showFieldValidation('codice_fiscale', {
                status: 'error',
                detail: 'Checksum CF non valido — controlla i caratteri'
            });
        }
    }
}

function validateIseeImporto(val) {
    let cleaned = val.replace(/[€$\s]/g, '');
    if (cleaned.includes(',') && cleaned.includes('.')) {
        cleaned = cleaned.replace(/\./g, '').replace(',', '.');
    } else if (cleaned.includes(',')) {
        cleaned = cleaned.replace(',', '.');
    }
    const num = parseFloat(cleaned);
    if (isNaN(num) || num < 0) {
        return { status: 'error', detail: 'Importo non valido' };
    }
    if (num > 100000) {
        return { status: 'warning', detail: `€ ${num.toLocaleString('it-IT')} — importo molto alto, controlla` };
    }
    return { status: 'ok', detail: `€ ${num.toLocaleString('it-IT', { minimumFractionDigits: 2 })} ✓` };
}

// ============================================================
// FILE UPLOAD — PDF
// ============================================================
function setupFileUpload() {
    const uploadArea = document.getElementById('upload-area');
    const fileInput = document.getElementById('isee_file');
    const fileRemove = document.getElementById('file-remove');

    if (!uploadArea || !fileInput) return;

    fileInput.addEventListener('click', (e) => e.stopPropagation());

    uploadArea.addEventListener('click', () => {
        fileInput.value = '';
        fileInput.click();
    });

    uploadArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadArea.classList.add('drag-over');
    });
    uploadArea.addEventListener('dragleave', () => uploadArea.classList.remove('drag-over'));
    uploadArea.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadArea.classList.remove('drag-over');
        if (e.dataTransfer.files.length > 0) handleFileSelect(e.dataTransfer.files[0]);
    });

    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) handleFileSelect(e.target.files[0]);
    });

    if (fileRemove) {
        fileRemove.addEventListener('click', (e) => {
            e.stopPropagation();
            removeFile();
        });
    }

    // --- PHOTO UPLOAD ---
    setupPhotoUpload();
}

function handleFileSelect(file) {
    const uploadArea = document.getElementById('upload-area');
    const filePreview = document.getElementById('file-preview');

    if (file.type !== 'application/pdf') {
        showToast('❌ Solo file PDF sono accettati', 'error');
        uploadArea.classList.add('error');
        setTimeout(() => uploadArea.classList.remove('error'), 2000);
        return;
    }
    if (file.size > MAX_FILE_SIZE) {
        const sizeMB = (file.size / 1024 / 1024).toFixed(1);
        showToast(`❌ File troppo grande (${sizeMB} MB). Max 5 MB.`, 'error');
        uploadArea.classList.add('error');
        setTimeout(() => uploadArea.classList.remove('error'), 2000);
        return;
    }

    selectedFile = file;
    document.getElementById('file-name').textContent = file.name;
    document.getElementById('file-size').textContent = formatFileSize(file.size);
    uploadArea.style.display = 'none';
    filePreview.style.display = 'flex';

    const reader = new FileReader();
    reader.onload = (e) => {
        fileBase64 = e.target.result.split(',')[1];
        console.log(`📎 PDF caricato: ${file.name} (${formatFileSize(file.size)})`);
    };
    reader.readAsDataURL(file);
}

function removeFile() {
    const uploadArea = document.getElementById('upload-area');
    const filePreview = document.getElementById('file-preview');
    const fileInput = document.getElementById('isee_file');

    selectedFile = null;
    fileBase64 = null;
    if (fileInput) fileInput.value = '';
    if (uploadArea) uploadArea.style.display = '';
    if (filePreview) filePreview.style.display = 'none';
}

// ============================================================
// PHOTO UPLOAD — MULTI-PAGINA
// ============================================================
function setupPhotoUpload() {
    const photoArea = document.getElementById('photo-upload-area');
    const photoInput = document.getElementById('photo_file');
    if (!photoArea || !photoInput) return;

    photoInput.addEventListener('click', (e) => e.stopPropagation());

    photoArea.addEventListener('click', () => {
        photoInput.value = '';
        photoInput.click();
    });

    photoInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            handlePhotoSelect(Array.from(e.target.files));
        }
    });
}

function handlePhotoSelect(files) {
    for (const file of files) {
        if (photoFiles.length >= MAX_PHOTOS) {
            showToast(`⚠️ Massimo ${MAX_PHOTOS} foto consentite`, 'error');
            break;
        }
        if (!file.type.startsWith('image/')) {
            showToast(`❌ "${file.name}" non è un'immagine`, 'error');
            continue;
        }
        if (file.size > MAX_FILE_SIZE) {
            const sizeMB = (file.size / 1024 / 1024).toFixed(1);
            showToast(`❌ "${file.name}" troppo grande (${sizeMB} MB)`, 'error');
            continue;
        }

        // Crea data URL per l'anteprima
        const reader = new FileReader();
        reader.onload = (e) => {
            photoFiles.push({ file, dataUrl: e.target.result });
            renderPhotoGrid();
        };
        reader.readAsDataURL(file);
    }
}

function removePhoto(index) {
    photoFiles.splice(index, 1);
    renderPhotoGrid();
}

function resetPhotos() {
    photoFiles = [];
    const grid = document.getElementById('photo-grid');
    const counter = document.getElementById('photo-counter');
    const photoInput = document.getElementById('photo_file');
    if (grid) grid.style.display = 'none';
    if (counter) counter.style.display = 'none';
    if (photoInput) photoInput.value = '';
}

function renderPhotoGrid() {
    const grid = document.getElementById('photo-grid');
    const counter = document.getElementById('photo-counter');
    const counterText = document.getElementById('photo-counter-text');

    if (!grid) return;

    grid.innerHTML = '';

    if (photoFiles.length === 0) {
        grid.style.display = 'none';
        if (counter) counter.style.display = 'none';
        // Rimostra l'area upload iniziale
        const area = document.getElementById('photo-upload-area');
        if (area) area.style.display = '';
        return;
    }

    grid.style.display = 'grid';
    if (counter) counter.style.display = 'flex';
    if (counterText) counterText.textContent = `${photoFiles.length}/${MAX_PHOTOS} pagine`;

    // Nascondi l'area upload iniziale quando ci sono foto
    const area = document.getElementById('photo-upload-area');
    if (area) area.style.display = 'none';

    // Miniature foto
    photoFiles.forEach((photo, i) => {
        const thumb = document.createElement('div');
        thumb.className = 'photo-thumb';

        const img = document.createElement('img');
        img.src = photo.dataUrl;
        img.alt = `Pagina ${i + 1}`;

        const badge = document.createElement('div');
        badge.className = 'photo-thumb-badge';
        badge.textContent = `Pag. ${i + 1}`;

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'photo-thumb-remove';
        removeBtn.textContent = '✕';
        removeBtn.title = 'Rimuovi';
        removeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            removePhoto(i);
        });

        thumb.appendChild(img);
        thumb.appendChild(badge);
        thumb.appendChild(removeBtn);
        grid.appendChild(thumb);
    });

    // Pulsante "Aggiungi pagina" (se non al massimo)
    if (photoFiles.length < MAX_PHOTOS) {
        const addBtn = document.createElement('div');
        addBtn.className = 'add-photo-item';
        addBtn.innerHTML = `
            <span class="add-photo-icon">+</span>
            <span class="add-photo-label">Aggiungi<br>pagina</span>
        `;
        addBtn.addEventListener('click', () => {
            const photoInput = document.getElementById('photo_file');
            if (photoInput) {
                photoInput.value = '';
                photoInput.click();
            }
        });
        grid.appendChild(addBtn);
    }
}

/**
 * Merge delle foto in un PDF unico usando jsPDF.
 * Ogni foto viene ridimensionata e posizionata su una pagina A4.
 * @returns {Promise<string>} Base64 del PDF generato
 */
async function mergePhotosIntoPdf() {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

    const pageW = 210; // A4 width mm
    const pageH = 297; // A4 height mm
    const margin = 10;
    const maxW = pageW - margin * 2;
    const maxH = pageH - margin * 2;

    for (let i = 0; i < photoFiles.length; i++) {
        if (i > 0) doc.addPage();

        const imgData = await resizeImage(photoFiles[i].dataUrl, PHOTO_MAX_WIDTH);

        // Calcola dimensioni per centrare l'immagine nella pagina
        const img = new Image();
        await new Promise((resolve) => {
            img.onload = resolve;
            img.src = imgData;
        });

        let w = img.naturalWidth;
        let h = img.naturalHeight;

        // Converti pixel → mm (ipotizzando 96 DPI come base per il layout)
        const pxToMm = 0.2646; // 1px = 0.2646mm
        let wMm = w * pxToMm;
        let hMm = h * pxToMm;

        // Scale per stare nella pagina
        const scaleW = maxW / wMm;
        const scaleH = maxH / hMm;
        const scale = Math.min(scaleW, scaleH, 1);

        wMm *= scale;
        hMm *= scale;

        const x = (pageW - wMm) / 2;
        const y = (pageH - hMm) / 2;

        doc.addImage(imgData, 'JPEG', x, y, wMm, hMm);
    }

    // Ritorna Base64 senza prefisso data:
    const pdfOutput = doc.output('datauristring');
    return pdfOutput.split(',')[1];
}

/**
 * Ridimensiona un'immagine a maxWidth mantenendo le proporzioni.
 * Comprime come JPEG quality 0.85.
 */
function resizeImage(dataUrl, maxWidth) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            let w = img.naturalWidth;
            let h = img.naturalHeight;

            if (w > maxWidth) {
                h = Math.round(h * (maxWidth / w));
                w = maxWidth;
            }

            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, w, h);

            resolve(canvas.toDataURL('image/jpeg', 0.85));
        };
        img.src = dataUrl;
    });
}

// ============================================================
// FORM DATA
// ============================================================
function getIseeFormData() {
    return {
        codice_fiscale: document.getElementById('codice_fiscale')?.value?.trim() || '',
        isee_anno: document.getElementById('isee_anno')?.value?.trim() || '',
        isee_importo: document.getElementById('isee_importo')?.value?.trim() || '',
        nucleo_familiare: document.getElementById('nucleo_familiare')?.value?.trim() || '',
        source: 'ISEE_UPDATE'
    };
}

function normalizeIseeData(data) {
    if (data.isee_importo) {
        let isee = data.isee_importo.replace(/[€$\s]/g, '');
        if (isee.includes(',') && isee.includes('.')) {
            isee = isee.replace(/\./g, '').replace(',', '.');
        } else if (isee.includes(',')) {
            isee = isee.replace(',', '.');
        }
        data.isee_importo = isee;
    }
    return data;
}

function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// ============================================================
// SUBMIT
// ============================================================
let isSubmitting = false;

async function handleIseeSubmit(e) {
    e.preventDefault();
    if (isSubmitting) return;
    isSubmitting = true;

    let data = getIseeFormData();
    data = normalizeIseeData(data);

    // Verifica che il lookup sia stato completato
    if (!lookupData) {
        showToast('⚠️ Cerca prima il tesserato con il numero tessera', 'error');
        isSubmitting = false;
        return;
    }

    const required = ['codice_fiscale', 'isee_anno', 'isee_importo', 'nucleo_familiare'];
    const missing = required.filter(f => !data[f]);
    if (missing.length > 0) {
        showToast('⚠️ Compila tutti i campi obbligatori', 'error');
        isSubmitting = false;
        return;
    }

    // --- GESTIONE FILE in base alla modalità ---
    if (uploadMode === 'photo' && photoFiles.length > 0) {
        // Merge foto → PDF
        const processing = document.getElementById('photo-processing');
        if (processing) processing.classList.add('active');

        try {
            fileBase64 = await mergePhotosIntoPdf();
            data.file_base64 = fileBase64;
            data.file_name = 'attestazione_isee_foto.pdf';
            console.log(`📷 PDF generato da ${photoFiles.length} foto`);
        } catch (err) {
            console.error('Errore merge foto:', err);
            showToast('❌ Errore nella creazione del PDF dalle foto', 'error');
            if (processing) processing.classList.remove('active');
            isSubmitting = false;
            return;
        } finally {
            if (processing) processing.classList.remove('active');
        }
    } else if (uploadMode === 'pdf' && fileBase64) {
        data.file_base64 = fileBase64;
        data.file_name = selectedFile ? selectedFile.name : 'attestazione_isee.pdf';
    }

    // UI Loading
    const submitBtn = document.getElementById('submit-btn');
    const overlay = document.getElementById('loading-overlay');
    const originalText = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Invio in corso...';
    submitBtn.classList.add('loading');
    if (overlay) overlay.style.display = 'flex';

    try {
        if (APPS_SCRIPT_URL.includes('YOUR_APPS_SCRIPT_URL')) {
            throw new Error('Apps Script URL non configurato.');
        }

        const response = await submitIseeData(APPS_SCRIPT_URL, data);

        if (response && response.status === 'error') {
            throw new Error(response.message || 'Errore sconosciuto');
        }

        showToast('✅ ISEE aggiornato con successo!', 'success');
        showIseeSuccessScreen(data);

    } catch (error) {
        console.error('Errore invio ISEE:', error);
        showToast(`❌ ${error.message}`, 'error');
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = originalText;
        submitBtn.classList.remove('loading');
        if (overlay) overlay.style.display = 'none';
        isSubmitting = false;
    }
}

function submitIseeData(url, data) {
    return new Promise((resolve, reject) => {
        try {
            const iframeName = 'isee_iframe_' + Date.now();
            const iframe = document.createElement('iframe');
            iframe.name = iframeName;
            iframe.style.display = 'none';
            document.body.appendChild(iframe);

            const form = document.createElement('form');
            form.method = 'POST';
            form.action = url;
            form.target = iframeName;
            form.style.display = 'none';

            Object.entries(data).forEach(([key, value]) => {
                const input = document.createElement('input');
                input.type = 'hidden';
                input.name = key;
                input.value = value || '';
                form.appendChild(input);
            });

            document.body.appendChild(form);

            iframe.onload = () => {
                setTimeout(() => { form.remove(); iframe.remove(); }, 2000);
                resolve({ status: 'ok' });
            };

            iframe.onerror = () => {
                form.remove(); iframe.remove();
                reject(new Error('Errore di rete durante l\'invio'));
            };

            setTimeout(() => {
                if (document.body.contains(iframe)) {
                    form.remove(); iframe.remove();
                    resolve({ status: 'ok' });
                }
            }, 30000);

            form.submit();
        } catch (err) {
            reject(err);
        }
    });
}

// ============================================================
// SUCCESS SCREEN
// ============================================================
function showIseeSuccessScreen(data) {
    const form = document.getElementById('isee-form');
    const success = document.getElementById('success-screen');
    const badge = document.getElementById('validation-badge');

    if (form && success) {
        form.style.display = 'none';
        if (badge) badge.style.display = 'none';
        success.style.display = 'flex';

        const nameEl = success.querySelector('.success-name');
        if (nameEl && lookupData) {
            nameEl.textContent = `${lookupData.cognome} ${lookupData.nome}`;
        } else if (nameEl) {
            nameEl.textContent = `CF: ${data.codice_fiscale}`;
        }

        const driveInfo = success.querySelector('.success-drive-info');
        if (driveInfo) driveInfo.style.display = 'none';
    }
}

function resetIseeForm() {
    const form = document.getElementById('isee-form');
    const success = document.getElementById('success-screen');

    if (form && success) {
        form.style.display = 'block';
        success.style.display = 'none';
        form.reset();

        const annoField = document.getElementById('isee_anno');
        if (annoField) annoField.value = new Date().getFullYear();

        // Reset lookup
        resetLookup();

        // Reset entrambe le modalità
        removeFile();
        resetPhotos();

        // Torna a modalità PDF
        uploadMode = 'pdf';
        document.querySelectorAll('.upload-mode-btn').forEach(b => b.classList.remove('active'));
        document.getElementById('mode-pdf')?.classList.add('active');
        document.getElementById('panel-pdf')?.classList.add('active');
        document.getElementById('panel-photo')?.classList.remove('active');

        // Resetta validazione
        document.querySelectorAll('.field-group').forEach(g => {
            g.classList.remove('valid', 'warning', 'error');
        });
        document.querySelectorAll('.field-feedback').forEach(f => f.remove());
    }
}

// ============================================================
// VALIDAZIONE UI HELPERS
// ============================================================
function showFieldValidation(fieldId, result) {
    const field = document.getElementById(fieldId);
    if (!field) return;
    const wrapper = field.closest('.field-group');
    if (!wrapper) return;

    wrapper.classList.remove('valid', 'warning', 'error');
    if (result.status === 'ok') wrapper.classList.add('valid');
    else if (result.status === 'warning') wrapper.classList.add('warning');
    else if (result.status === 'error') wrapper.classList.add('error');

    let feedback = wrapper.querySelector('.field-feedback');
    if (!feedback) {
        feedback = document.createElement('div');
        feedback.className = 'field-feedback';
        wrapper.appendChild(feedback);
    }
    feedback.textContent = result.detail;
    feedback.className = `field-feedback ${result.status}`;
}

// ============================================================
// TOAST NOTIFICATIONS
// ============================================================
function showToast(message, type = 'info') {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    requestAnimationFrame(() => toast.classList.add('show'));

    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}
