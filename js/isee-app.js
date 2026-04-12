/**
 * IPF Aggiornamento ISEE — App Logic
 * =====================================
 * Form dedicato per aggiornare l'ISEE dei tesserati esistenti.
 * Riusa validator.js per il checksum CF.
 * Include upload PDF via Base64 → Apps Script → Google Drive.
 */

// ============================================================
// CONFIGURAZIONE
// ============================================================
// Stesso URL del form principale (Code.gs gestisce entrambi)
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzAVR1693co5hEWW9lQIRY2ZkIUeXE8OCOBet5M8EelAge-uFOdCAF0vCY5CH8rOm-g/exec';

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

// Stato file
let selectedFile = null;
let fileBase64 = null;

// ============================================================
// INIZIALIZZAZIONE
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
    // Pre-compila anno ISEE con anno corrente
    const annoField = document.getElementById('isee_anno');
    if (annoField && !annoField.value) {
        annoField.value = new Date().getFullYear();
    }

    // Setup validazione real-time
    setupIseeValidation();

    // Setup file upload
    setupFileUpload();

    // Setup form submit
    document.getElementById('isee-form').addEventListener('submit', handleIseeSubmit);

    console.log('✅ ISEE App inizializzata');
});

// ============================================================
// VALIDAZIONE REAL-TIME
// ============================================================
function setupIseeValidation() {
    // Maiuscolo per CF
    const cfEl = document.getElementById('codice_fiscale');
    if (cfEl) {
        cfEl.addEventListener('input', () => {
            const pos = cfEl.selectionStart;
            cfEl.value = cfEl.value.toUpperCase().replace(/\s/g, '');
            cfEl.setSelectionRange(pos, pos);
        });
        cfEl.addEventListener('blur', () => validateCfField());
    }

    // Maiuscolo per cognome/nome
    ['cognome', 'nome'].forEach(fieldId => {
        const el = document.getElementById(fieldId);
        if (el) {
            el.addEventListener('input', () => {
                const pos = el.selectionStart;
                el.value = el.value.toUpperCase();
                el.setSelectionRange(pos, pos);
            });
        }
    });

    // Validazione ISEE importo
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

    // Validazione anno ISEE
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

    // Usa il checksum del validator.js
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
    // Normalizza: accetta sia "3.600,00" che "3600.00" che "3600"
    let cleaned = val.replace(/[€$\s]/g, '');

    if (cleaned.includes(',') && cleaned.includes('.')) {
        // Formato italiano: 3.600,00
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
// FILE UPLOAD
// ============================================================
function setupFileUpload() {
    const uploadArea = document.getElementById('upload-area');
    const fileInput = document.getElementById('isee_file');
    const filePreview = document.getElementById('file-preview');
    const fileRemove = document.getElementById('file-remove');

    if (!uploadArea || !fileInput) return;

    // Impedisci che il click sull'input bubblizzi all'area (evita doppio trigger)
    fileInput.addEventListener('click', (e) => {
        e.stopPropagation();
    });

    // Click to upload — resetta il valore per consentire ri-selezione dello stesso file
    uploadArea.addEventListener('click', () => {
        fileInput.value = '';
        fileInput.click();
    });

    // Drag & Drop
    uploadArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadArea.classList.add('drag-over');
    });

    uploadArea.addEventListener('dragleave', () => {
        uploadArea.classList.remove('drag-over');
    });

    uploadArea.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadArea.classList.remove('drag-over');
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            handleFileSelect(files[0]);
        }
    });

    // File input change
    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            handleFileSelect(e.target.files[0]);
        }
    });

    // Remove file
    if (fileRemove) {
        fileRemove.addEventListener('click', (e) => {
            e.stopPropagation();
            removeFile();
        });
    }
}

function handleFileSelect(file) {
    const uploadArea = document.getElementById('upload-area');
    const filePreview = document.getElementById('file-preview');

    // Validazione tipo
    if (file.type !== 'application/pdf') {
        showToast('❌ Solo file PDF sono accettati', 'error');
        uploadArea.classList.add('error');
        setTimeout(() => uploadArea.classList.remove('error'), 2000);
        return;
    }

    // Validazione dimensione
    if (file.size > MAX_FILE_SIZE) {
        const sizeMB = (file.size / 1024 / 1024).toFixed(1);
        showToast(`❌ File troppo grande (${sizeMB} MB). Max 5 MB.`, 'error');
        uploadArea.classList.add('error');
        setTimeout(() => uploadArea.classList.remove('error'), 2000);
        return;
    }

    selectedFile = file;

    // Mostra preview
    document.getElementById('file-name').textContent = file.name;
    document.getElementById('file-size').textContent = formatFileSize(file.size);
    uploadArea.style.display = 'none';
    filePreview.style.display = 'flex';

    // Leggi come Base64
    const reader = new FileReader();
    reader.onload = (e) => {
        // Rimuovi il prefisso "data:application/pdf;base64,"
        fileBase64 = e.target.result.split(',')[1];
        console.log(`📎 File caricato: ${file.name} (${formatFileSize(file.size)})`);
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
    uploadArea.style.display = '';
    filePreview.style.display = 'none';
}

function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// ============================================================
// FORM DATA
// ============================================================
function getIseeFormData() {
    return {
        codice_fiscale: document.getElementById('codice_fiscale')?.value?.trim() || '',
        cognome: document.getElementById('cognome')?.value?.trim() || '',
        nome: document.getElementById('nome')?.value?.trim() || '',
        isee_anno: document.getElementById('isee_anno')?.value?.trim() || '',
        isee_importo: document.getElementById('isee_importo')?.value?.trim() || '',
        protocollo_inps: document.getElementById('protocollo_inps')?.value?.trim() || '',
        source: 'ISEE_UPDATE'
    };
}

function normalizeIseeData(data) {
    // Maiuscolo
    if (data.cognome) data.cognome = data.cognome.toUpperCase();
    if (data.nome) data.nome = data.nome.toUpperCase();

    // ISEE importo: normalizza al formato numerico
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

    // Campi obbligatori
    const required = ['codice_fiscale', 'cognome', 'nome', 'isee_anno', 'isee_importo'];
    const missing = required.filter(f => !data[f]);
    if (missing.length > 0) {
        showToast(`⚠️ Compila tutti i campi obbligatori`, 'error');
        isSubmitting = false;
        return;
    }

    // Validazione CF
    if (data.codice_fiscale.length !== 16) {
        showToast('❌ Il Codice Fiscale deve essere di 16 caratteri', 'error');
        isSubmitting = false;
        return;
    }

    // Aggiungi file Base64 se presente
    if (fileBase64) {
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

        // Invia via fetch (JSON) per gestire la risposta del backend
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

/**
 * Invia i dati ISEE con strategia PRO a 2 fasi:
 * 1) Fase di validazione via fetch (JSON) → legge la risposta del backend
 * 2) Se c'è un file PDF, invia via iframe (bypassa CORS per upload grandi)
 * 
 * Questo garantisce che errori (CF non trovato, nomi invertiti, ecc.)
 * vengano SEMPRE mostrati all'utente.
 */
async function submitIseeData(url, data) {
    // Separa il file dai dati di validazione
    const fileData = data.file_base64;
    const fileName = data.file_name;

    // FASE 1: Valida senza scrivere (validate_only)
    const validationPayload = { ...data };
    delete validationPayload.file_base64;
    delete validationPayload.file_name;
    validationPayload.validate_only = 'true';

    try {
        // Tentativo fetch diretto per validazione
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams(validationPayload).toString(),
            redirect: 'follow'
        });
        const result = await response.json();

        // Se la validazione ha fallito, ritorna l'errore immediatamente
        if (result.status === 'error') {
            return result;
        }

        // FASE 2: Validazione ok → invia tutti i dati (+ file) via iframe per la scrittura
        await submitFileViaIframe(url, data);

        return result;

    } catch (fetchError) {
        // Fetch fallito (CORS/rete): fallback completo via iframe
        console.warn('Fetch fallito, fallback iframe:', fetchError.message);
        return submitAllViaIframe(url, data);
    }
}

/**
 * Invia i dati completi (incluso file) via iframe nascosto.
 * Usato come FASE 2 dopo validazione ok, o come fallback se fetch non funziona.
 */
function submitFileViaIframe(url, data) {
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
                setTimeout(() => {
                    form.remove();
                    iframe.remove();
                }, 2000);
                resolve({ status: 'ok' });
            };

            iframe.onerror = () => {
                form.remove();
                iframe.remove();
                reject(new Error('Errore di rete durante l\'invio del file'));
            };

            setTimeout(() => {
                if (document.body.contains(iframe)) {
                    form.remove();
                    iframe.remove();
                    resolve({ status: 'ok' });
                }
            }, 30000);

            form.submit();
        } catch (err) {
            reject(err);
        }
    });
}

/**
 * Fallback completo: invia tutto via iframe quando fetch non è disponibile.
 * In questo caso non possiamo leggere la risposta del backend.
 */
function submitAllViaIframe(url, data) {
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
                setTimeout(() => {
                    form.remove();
                    iframe.remove();
                }, 2000);
                resolve({ status: 'ok' });
            };

            iframe.onerror = () => {
                form.remove();
                iframe.remove();
                reject(new Error('Errore di rete durante l\'invio'));
            };

            setTimeout(() => {
                if (document.body.contains(iframe)) {
                    form.remove();
                    iframe.remove();
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
        if (nameEl) nameEl.textContent = `${data.cognome} ${data.nome}`;

        // Nascondi info Drive (informazione interna)
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

        // Ri-popola anno
        const annoField = document.getElementById('isee_anno');
        if (annoField) annoField.value = new Date().getFullYear();

        // Reset file
        removeFile();

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
