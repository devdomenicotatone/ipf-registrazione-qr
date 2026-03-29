/**
 * IPF Auto-Registrazione — App Logic
 * ====================================
 * Gestione form, validazione real-time, submit a Google Apps Script.
 */

// ============================================================
// CONFIGURAZIONE
// ============================================================
// Questo URL va sostituito dopo il deploy di Google Apps Script
const APPS_SCRIPT_URL = 'YOUR_APPS_SCRIPT_URL_HERE';

const comuniDB = new ComuniDB();
let dbReady = false;

// ============================================================
// INIZIALIZZAZIONE
// ============================================================
document.addEventListener('DOMContentLoaded', async () => {
    // Carica DB Comuni
    showLoadingState(true);
    await comuniDB.load();
    dbReady = comuniDB.loaded;
    showLoadingState(false);

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

    console.log('✅ App inizializzata');
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
    // Campi che triggerano la validazione CF
    const cfRelatedFields = ['codice_fiscale', 'cognome', 'nome', 'data_nascita', 'luogo_nascita'];
    cfRelatedFields.forEach(fieldId => {
        const el = document.getElementById(fieldId);
        if (el) {
            el.addEventListener('input', debounce(() => runValidation(), 500));
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

    // Telefono
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
    if (!dbReady) return;

    const data = getFormData();
    const validation = validateDataVsCf(data, comuniDB);
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
// AUTOCOMPLETE COMUNI
// ============================================================
function setupComuniAutocomplete(inputId, suggestionsId) {
    const input = document.getElementById(inputId);
    const suggestions = document.getElementById(suggestionsId);
    if (!input || !suggestions) return;

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

        suggestions.innerHTML = matches.map(m => `
            <div class="suggestion-item" data-value="${m.name}">
                <span class="suggestion-name">${m.name}</span>
                <span class="suggestion-score">${Math.round(m.score * 100)}%</span>
            </div>
        `).join('');
        suggestions.style.display = 'block';

        // Click su suggerimento
        suggestions.querySelectorAll('.suggestion-item').forEach(item => {
            item.addEventListener('click', () => {
                input.value = item.dataset.value;
                suggestions.style.display = 'none';
                runValidation();
            });
        });
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
// SUBMIT
// ============================================================
async function handleSubmit(e) {
    e.preventDefault();

    // Validazione finale
    let data = getFormData();
    data = normalizeData(data);

    // Campi obbligatori
    const required = ['cognome', 'nome', 'codice_fiscale'];
    const missing = required.filter(f => !data[f]);
    if (missing.length > 0) {
        showToast(`Campi obbligatori mancanti: ${missing.join(', ')}`, 'error');
        return;
    }

    // Validazione CF
    const validation = validateDataVsCf(data, comuniDB);
    const overall = getOverallStatus(validation);

    if (overall === 'error') {
        const errors = Object.entries(validation)
            .filter(([, v]) => v.status === 'error')
            .map(([field, v]) => `${field}: ${v.detail}`);
        
        const proceed = confirm(
            `⚠️ Ci sono errori di validazione:\n\n${errors.join('\n')}\n\nVuoi inviare comunque?`
        );
        if (!proceed) return;
    }

    // Componi note di validazione (come webapp.py)
    const notes = Object.entries(validation)
        .filter(([, v]) => v.status === 'error' || v.status === 'warning')
        .map(([, v]) => v.detail)
        .join(' | ');

    data.validation_notes = notes;
    data.source = 'QR_FORM'; // Per distinguere da OCR

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

        const response = await fetch(APPS_SCRIPT_URL, {
            method: 'POST',
            mode: 'no-cors',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });

        // no-cors non permette di leggere la risposta, ma il POST va a buon fine
        showToast('✅ Registrazione inviata con successo!', 'success');
        showSuccessScreen(data);

    } catch (error) {
        console.error('Errore invio:', error);
        showToast(`❌ Errore: ${error.message}`, 'error');
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = originalText;
        submitBtn.classList.remove('loading');
    }
}

// ============================================================
// SUCCESS SCREEN
// ============================================================
function showSuccessScreen(data) {
    const form = document.getElementById('registration-form');
    const success = document.getElementById('success-screen');
    
    if (form && success) {
        form.style.display = 'none';
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
// TOAST NOTIFICATIONS
// ============================================================
function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container') || createToastContainer();
    
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

function createToastContainer() {
    const container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
    return container;
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
