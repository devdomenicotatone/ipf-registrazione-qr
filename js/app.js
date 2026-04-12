/**
 * IPF Auto-Registrazione — App Logic
 * ====================================
 * Gestione form, validazione real-time, submit a Google Apps Script.
 * 
 * Audit fix applicate:
 * - B3: Sanitizzazione HTML autocomplete (XSS)
 * - R3: Debounce condiviso per validazione CF
 * - R4: Event delegation per suggestions (memory leak fix)
 * - R5: Feedback visivo se DB comuni non si carica
 * - U1: Toast container statico
 * - S2: Anti-doppio-click sul submit
 */

// ============================================================
// CONFIGURAZIONE
// ============================================================
// Questo URL va sostituito dopo il deploy di Google Apps Script
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzAVR1693co5hEWW9lQIRY2ZkIUeXE8OCOBet5M8EelAge-uFOdCAF0vCY5CH8rOm-g/exec';

const comuniDB = new ComuniDB();
let dbReady = false;

// Stato file ISEE
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
let selectedFile = null;
let fileBase64 = null;

// Debounce condiviso per la validazione CF (fix R3)
const debouncedValidation = debounce(() => runValidation(), 400);

// ============================================================
// INIZIALIZZAZIONE
// ============================================================
document.addEventListener('DOMContentLoaded', async () => {
    // Carica DB Comuni
    showLoadingState(true);
    await comuniDB.load();
    dbReady = comuniDB.loaded;
    showLoadingState(false);

    // Feedback se DB non caricato (fix R5)
    if (!dbReady) {
        showToast('⚠️ Database comuni non disponibile. La validazione avanzata è disattivata.', 'info');
    }

    // Pre-compila anno iscrizione
    const annoField = document.getElementById('anno_iscrizione');
    if (annoField && !annoField.value) {
        annoField.value = new Date().getFullYear();
    }

    // Setup validazione real-time
    setupRealTimeValidation();

    // Setup form submit
    document.getElementById('registration-form').addEventListener('submit', handleSubmit);

    // Setup autocomplete comuni
    setupComuniAutocomplete('luogo_nascita', 'luogo_nascita_suggestions');
    setupComuniAutocomplete('comune_residenza', 'comune_residenza_suggestions');

    // Setup file upload ISEE
    setupFileUpload();

    console.log('✅ App inizializzata' + (dbReady ? '' : ' (senza DB comuni)'));
});

// ============================================================
// LOADING STATE
// ============================================================
function showLoadingState(loading) {
    const overlay = document.getElementById('loading-overlay');
    if (overlay) {
        overlay.style.display = loading ? 'flex' : 'none';
    }
}

// ============================================================
// VALIDAZIONE REAL-TIME
// ============================================================
function setupRealTimeValidation() {
    // Campi che triggerano la validazione CF (usano debounce condiviso — fix R3)
    const cfRelatedFields = ['codice_fiscale', 'cognome', 'nome', 'data_nascita', 'luogo_nascita'];
    cfRelatedFields.forEach(fieldId => {
        const el = document.getElementById(fieldId);
        if (el) {
            el.addEventListener('input', debouncedValidation);
            el.addEventListener('blur', () => runValidation());
        }
    });

    // Maiuscolo automatico per cognome/nome
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

    // Maiuscolo per CF
    const cfEl = document.getElementById('codice_fiscale');
    if (cfEl) {
        cfEl.addEventListener('input', () => {
            const pos = cfEl.selectionStart;
            cfEl.value = cfEl.value.toUpperCase().replace(/\s/g, '');
            cfEl.setSelectionRange(pos, pos);
        });
    }

    // Telefono (con debounce proprio, non condiviso)
    const phoneEl = document.getElementById('cellulare');
    if (phoneEl) {
        phoneEl.addEventListener('input', debounce(() => {
            const result = validatePhone(phoneEl.value);
            showFieldValidation('cellulare', result);
        }, 300));
    }

    // Comune residenza
    const resEl = document.getElementById('comune_residenza');
    if (resEl) {
        resEl.addEventListener('blur', () => runValidation());
    }

    // Documento
    ['documento', 'numero_doc', 'scadenza'].forEach(fieldId => {
        const el = document.getElementById(fieldId);
        if (el) el.addEventListener('blur', () => runValidation());
    });
}

function runValidation() {
    const data = getFormData();

    // Validazione telefono anche senza DB
    if (data.cellulare) {
        const phoneResult = validatePhone(data.cellulare);
        showFieldValidation('cellulare', phoneResult);
    }

    // Validazione CF richiede DB o almeno un CF da controllare
    const cf = (data.codice_fiscale || '').trim();
    if (cf.length >= 16 || dbReady) {
        const validation = validateDataVsCf(data, dbReady ? comuniDB : null);
        const overall = getOverallStatus(validation);

        // Mostra risultati per ogni campo
        Object.entries(validation).forEach(([field, result]) => {
            if (result.status !== 'skip') {
                showFieldValidation(field, result);
            }
        });

        // Aggiorna badge complessivo
        updateOverallBadge(overall, validation);
    }
}

function showFieldValidation(fieldId, result) {
    const field = document.getElementById(fieldId);
    if (!field) return;

    const wrapper = field.closest('.field-group');
    if (!wrapper) return;

    // Rimuovi classi precedenti
    wrapper.classList.remove('valid', 'warning', 'error');

    // Aggiungi nuova classe
    if (result.status === 'ok') wrapper.classList.add('valid');
    else if (result.status === 'warning') wrapper.classList.add('warning');
    else if (result.status === 'error') wrapper.classList.add('error');

    // Aggiorna messaggio
    let feedback = wrapper.querySelector('.field-feedback');
    if (!feedback) {
        feedback = document.createElement('div');
        feedback.className = 'field-feedback';
        wrapper.appendChild(feedback);
    }
    feedback.textContent = result.detail;
    feedback.className = `field-feedback ${result.status}`;
}

function updateOverallBadge(overall, validation) {
    const badge = document.getElementById('validation-badge');
    if (!badge) return;

    const counts = { ok: 0, warning: 0, error: 0, skip: 0 };
    Object.values(validation).forEach(v => {
        counts[v.status] = (counts[v.status] || 0) + 1;
    });

    badge.className = `validation-badge ${overall}`;

    if (overall === 'ok') {
        badge.innerHTML = '✅ Tutti i campi validati correttamente';
    } else if (overall === 'warning') {
        badge.innerHTML = `⚠️ ${counts.warning} avvisi — controlla i campi evidenziati`;
    } else {
        badge.innerHTML = `❌ ${counts.error} errori — correggi prima di inviare`;
    }

    badge.style.display = 'block';
}

// ============================================================
// AUTOCOMPLETE COMUNI (con sanitizzazione XSS — fix B3 e event delegation — fix R4)
// ============================================================
function setupComuniAutocomplete(inputId, suggestionsId) {
    const input = document.getElementById(inputId);
    const suggestions = document.getElementById(suggestionsId);
    if (!input || !suggestions) return;

    // Event delegation: un solo listener per tutti i click sui suggerimenti (fix R4)
    suggestions.addEventListener('click', (e) => {
        const item = e.target.closest('.suggestion-item');
        if (item) {
            input.value = item.dataset.value;
            suggestions.style.display = 'none';
            runValidation();
        }
    });

    input.addEventListener('input', debounce(() => {
        const value = input.value.trim();
        if (value.length < 2 || !dbReady) {
            suggestions.style.display = 'none';
            return;
        }

        const matches = comuniDB.fuzzySearch(value, 5, 0.4);
        if (matches.length === 0) {
            suggestions.style.display = 'none';
            return;
        }

        // Sanitizzazione XSS: usa DOM API anziché innerHTML (fix B3)
        suggestions.innerHTML = '';
        matches.forEach(m => {
            const div = document.createElement('div');
            div.className = 'suggestion-item';
            div.dataset.value = m.name;

            const nameSpan = document.createElement('span');
            nameSpan.className = 'suggestion-name';
            nameSpan.textContent = m.name;

            const scoreSpan = document.createElement('span');
            scoreSpan.className = 'suggestion-score';
            scoreSpan.textContent = `${Math.round(m.score * 100)}%`;

            div.appendChild(nameSpan);
            div.appendChild(scoreSpan);
            suggestions.appendChild(div);
        });
        suggestions.style.display = 'block';
    }, 300));

    // Chiudi suggerimenti quando si clicca fuori
    document.addEventListener('click', (e) => {
        if (!input.contains(e.target) && !suggestions.contains(e.target)) {
            suggestions.style.display = 'none';
        }
    });
}

// ============================================================
// FORM DATA
// ============================================================
function getFormData() {
    return {
        n_tessera: document.getElementById('n_tessera')?.value?.trim() || '',
        anno_iscrizione: document.getElementById('anno_iscrizione')?.value?.trim() || '',
        cognome: document.getElementById('cognome')?.value?.trim() || '',
        nome: document.getElementById('nome')?.value?.trim() || '',
        codice_fiscale: document.getElementById('codice_fiscale')?.value?.trim() || '',
        data_nascita: document.getElementById('data_nascita')?.value?.trim() || '',
        luogo_nascita: document.getElementById('luogo_nascita')?.value?.trim() || '',
        cellulare: document.getElementById('cellulare')?.value?.trim() || '',
        comune_residenza: document.getElementById('comune_residenza')?.value?.trim() || '',
        indirizzo: document.getElementById('indirizzo')?.value?.trim() || '',
        nucleo_familiare: document.getElementById('nucleo_familiare')?.value?.trim() || '',
        documento: document.getElementById('documento')?.value?.trim() || '',
        numero_doc: document.getElementById('numero_doc')?.value?.trim() || '',
        scadenza: document.getElementById('scadenza')?.value?.trim() || '',
        isee_anno: document.getElementById('isee_anno')?.value?.trim() || '',
        isee_importo: document.getElementById('isee_importo')?.value?.trim() || ''
    };
}

// ============================================================
// NORMALIZZAZIONE (come webapp.py)
// ============================================================
function normalizeData(data) {
    // Data nascita: converti da input date a GG/MM/AAAA
    if (data.data_nascita && data.data_nascita.includes('-')) {
        const [y, m, d] = data.data_nascita.split('-');
        data.data_nascita = `${d}/${m}/${y}`;
    }

    // Scadenza: converti da input date
    if (data.scadenza && data.scadenza.includes('-')) {
        const [y, m, d] = data.scadenza.split('-');
        data.scadenza = `${d}/${m}/${y}`;
    }

    // Maiuscolo
    if (data.cognome) data.cognome = data.cognome.toUpperCase();
    if (data.nome) data.nome = data.nome.toUpperCase();

    // Cellulare: rimuovi spazi
    if (data.cellulare) data.cellulare = data.cellulare.replace(/[\s\/]/g, '');

    // Numero documento
    if (data.numero_doc) data.numero_doc = data.numero_doc.replace(/\s/g, '');

    // ISEE: normalizza
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
// SUBMIT (con anti-doppio-click — fix S2)
// ============================================================
let isSubmitting = false;

async function handleSubmit(e) {
    e.preventDefault();

    // Anti-doppio-click (fix S2)
    if (isSubmitting) return;
    isSubmitting = true;

    // Validazione finale
    let data = getFormData();
    data = normalizeData(data);

    // Campi obbligatori
    const required = ['cognome', 'nome', 'codice_fiscale'];
    const missing = required.filter(f => !data[f]);
    if (missing.length > 0) {
        showToast(`Campi obbligatori mancanti: ${missing.join(', ')}`, 'error');
        isSubmitting = false;
        return;
    }

    // Validazione CF
    const validation = validateDataVsCf(data, dbReady ? comuniDB : null);
    const overall = getOverallStatus(validation);

    if (overall === 'error') {
        const errors = Object.entries(validation)
            .filter(([, v]) => v.status === 'error')
            .map(([field, v]) => `${field}: ${v.detail}`);

        const proceed = confirm(
            `⚠️ Ci sono errori di validazione:\n\n${errors.join('\n')}\n\nVuoi inviare comunque?`
        );
        if (!proceed) {
            isSubmitting = false;
            return;
        }
    }

    // Componi note di validazione (come webapp.py)
    const notes = Object.entries(validation)
        .filter(([, v]) => v.status === 'error' || v.status === 'warning')
        .map(([, v]) => v.detail)
        .join(' | ');

    data.validation_notes = notes;
    data.source = 'QR_FORM'; // Per distinguere da OCR

    // Aggiungi file ISEE se presente
    if (fileBase64) {
        data.file_base64 = fileBase64;
        data.file_name = selectedFile ? selectedFile.name : 'attestazione_isee.pdf';
    }

    // Invia
    const submitBtn = document.getElementById('submit-btn');
    const originalText = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Invio in corso...';
    submitBtn.classList.add('loading');

    try {
        if (APPS_SCRIPT_URL === 'YOUR_APPS_SCRIPT_URL_HERE') {
            throw new Error('Apps Script URL non configurato. Segui le istruzioni nel README.');
        }

        // Usa form nascosto + iframe per evitare CORS/401
        await submitViaForm(APPS_SCRIPT_URL, data);

        showToast('✅ Registrazione inviata con successo!', 'success');
        showSuccessScreen(data);

    } catch (error) {
        console.error('Errore invio:', error);
        showToast(`❌ Errore: ${error.message}`, 'error');
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = originalText;
        submitBtn.classList.remove('loading');
        isSubmitting = false;
    }
}

// ============================================================
// SUCCESS SCREEN
// ============================================================
function showSuccessScreen(data) {
    const form = document.getElementById('registration-form');
    const success = document.getElementById('success-screen');
    const badge = document.getElementById('validation-badge');

    if (form && success) {
        form.style.display = 'none';
        if (badge) badge.style.display = 'none';
        success.style.display = 'flex';

        const nameEl = success.querySelector('.success-name');
        if (nameEl) nameEl.textContent = `${data.cognome} ${data.nome}`;
    }
}

function resetForm() {
    const form = document.getElementById('registration-form');
    const success = document.getElementById('success-screen');

    if (form && success) {
        form.style.display = 'block';
        success.style.display = 'none';
        form.reset();

        // Ri-popola anno
        const annoField = document.getElementById('anno_iscrizione');
        if (annoField) annoField.value = new Date().getFullYear();

        // Reset file upload
        removeFile();

        // Resetta validazione
        document.querySelectorAll('.field-group').forEach(g => {
            g.classList.remove('valid', 'warning', 'error');
        });
        document.querySelectorAll('.field-feedback').forEach(f => f.remove());

        const badge = document.getElementById('validation-badge');
        if (badge) badge.style.display = 'none';
    }
}

// ============================================================
// FILE UPLOAD ISEE
// ============================================================
function setupFileUpload() {
    const uploadArea = document.getElementById('upload-area');
    const fileInput = document.getElementById('isee_file');
    const fileRemove = document.getElementById('file-remove');

    if (!uploadArea || !fileInput) return;

    // Impedisci che il click sull'input bubblizzi all'area
    fileInput.addEventListener('click', (e) => e.stopPropagation());

    // Click to upload
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
        if (files.length > 0) handleFileSelect(files[0]);
    });

    // File input change
    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) handleFileSelect(e.target.files[0]);
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
    if (uploadArea) uploadArea.style.display = '';
    if (filePreview) filePreview.style.display = 'none';
}

function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
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

    // Animazione
    requestAnimationFrame(() => toast.classList.add('show'));

    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

// ============================================================
// SUBMIT VIA FORM (bypassa CORS/401)
// ============================================================
function submitViaForm(url, data) {
    return new Promise((resolve, reject) => {
        try {
            // Crea iframe nascosto
            const iframeName = 'submit_iframe_' + Date.now();
            const iframe = document.createElement('iframe');
            iframe.name = iframeName;
            iframe.style.display = 'none';
            document.body.appendChild(iframe);

            // Crea form nascosto
            const form = document.createElement('form');
            form.method = 'POST';
            form.action = url;
            form.target = iframeName;
            form.style.display = 'none';

            // Aggiungi tutti i campi come input hidden
            Object.entries(data).forEach(([key, value]) => {
                const input = document.createElement('input');
                input.type = 'hidden';
                input.name = key;
                input.value = value || '';
                form.appendChild(input);
            });

            document.body.appendChild(form);

            // Risolvi quando l'iframe ha caricato
            iframe.onload = () => {
                // Cleanup dopo un breve delay
                setTimeout(() => {
                    form.remove();
                    iframe.remove();
                }, 2000);
                resolve();
            };

            iframe.onerror = () => {
                form.remove();
                iframe.remove();
                reject(new Error('Errore di rete durante l\'invio'));
            };

            // Timeout di sicurezza (10 secondi)
            setTimeout(() => {
                if (document.body.contains(iframe)) {
                    form.remove();
                    iframe.remove();
                    resolve(); // Risolvi comunque — il submit è partito
                }
            }, 10000);

            // Invia!
            form.submit();
        } catch (err) {
            reject(err);
        }
    });
}

// ============================================================
// UTILITÀ
// ============================================================
function debounce(fn, delay) {
    let timer;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), delay);
    };
}
