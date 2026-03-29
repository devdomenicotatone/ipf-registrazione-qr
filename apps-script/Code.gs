/**
 * IPF Auto-Registrazione — Google Apps Script
 * =============================================
 * Backend serverless per scrivere i dati del form nel Google Sheet.
 * 
 * ISTRUZIONI DEPLOY:
 * 1. Apri Google Sheets: https://docs.google.com/spreadsheets/d/1zp60MFIoLNZng8GdeMSaYfUPceLb2Yr273fYjSlu8VM
 * 2. Vai su Estensioni → Apps Script
 * 3. Incolla questo codice nel file Code.gs
 * 4. Fai clic su "Esegui" → seleziona doPost → Autorizza l'accesso
 * 5. Vai su Deploy → Nuova distribuzione → Tipo: App Web
 *    - Esegui come: "Me" (il tuo account)
 *    - Chi ha accesso: "Chiunque"
 * 6. Copia l'URL e incollalo in js/app.js alla riga APPS_SCRIPT_URL
 */

// ID del foglio Google Sheets (lo stesso usato dall'app OCR)
const SPREADSHEET_ID = '1zp60MFIoLNZng8GdeMSaYfUPceLb2Yr273fYjSlu8VM';
const SHEET_NAME = 'ELENCO TESSERATI.csv';

/**
 * Gestisce le richieste POST dal form.
 */
function doPost(e) {
  try {
    // Rate limiting basico (anti-spam): max 1 invio ogni 10 secondi
    const props = PropertiesService.getScriptProperties();
    const lastSub = parseInt(props.getProperty('lastSubmission') || '0');
    const now = Date.now();
    if (now - lastSub < 10000) {
      return ContentService.createTextOutput(JSON.stringify({
        status: 'error',
        message: 'Troppi invii ravvicinati. Riprova tra qualche secondo.'
      })).setMimeType(ContentService.MimeType.JSON);
    }
    props.setProperty('lastSubmission', String(now));

    // Accetta sia JSON che form-encoded
    let data;
    try {
      data = JSON.parse(e.postData.contents);
    } catch {
      // Fallback: dati da form HTML (e.parameter)
      data = e.parameter || {};
    }
    
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(SHEET_NAME);
    
    if (!sheet) {
      return ContentService.createTextOutput(JSON.stringify({
        status: 'error',
        message: 'Foglio non trovato: ' + SHEET_NAME
      })).setMimeType(ContentService.MimeType.JSON);
    }
    
    // Costruisci la riga (stessa struttura dell'app OCR: webapp.py _build_row)
    const row = [
      data.n_tessera || '',
      data.anno_iscrizione || '',
      data.cognome || '',
      data.nome || '',
      data.codice_fiscale || '',
      data.data_nascita || '',
      data.luogo_nascita || '',
      data.cellulare || '',
      data.comune_residenza || '',
      data.indirizzo || '',
      data.nucleo_familiare || '',
      data.documento || '',
      data.numero_doc || '',
      data.scadenza || '',
      data.isee_anno || '',
      data.isee_importo || '',
      (data.validation_notes || '') + (data.source ? ' [' + data.source + ']' : '')
    ];
    
    // Aggiungi la riga al foglio
    sheet.appendRow(row);
    
    // Log
    Logger.log('Nuova registrazione QR: ' + data.cognome + ' ' + data.nome);
    
    return ContentService.createTextOutput(JSON.stringify({
      status: 'ok',
      message: 'Registrazione salvata',
      row: sheet.getLastRow()
    })).setMimeType(ContentService.MimeType.JSON);
    
  } catch (error) {
    Logger.log('Errore: ' + error.toString());
    return ContentService.createTextOutput(JSON.stringify({
      status: 'error',
      message: error.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * Gestisce le richieste GET (per test).
 */
function doGet(e) {
  return ContentService.createTextOutput(JSON.stringify({
    status: 'ok',
    message: 'IPF Auto-Registrazione API attiva',
    timestamp: new Date().toISOString()
  })).setMimeType(ContentService.MimeType.JSON);
}

/**
 * Test locale: simula un POST.
 */
function testDoPost() {
  const testData = {
    postData: {
      contents: JSON.stringify({
        n_tessera: '999',
        anno_iscrizione: '2026',
        cognome: 'TEST',
        nome: 'UTENTE',
        codice_fiscale: 'TSTTNT80A01H294Z',
        data_nascita: '01/01/1980',
        luogo_nascita: 'RIMINI',
        cellulare: '3331234567',
        comune_residenza: 'RIMINI',
        indirizzo: 'Via Test 1',
        nucleo_familiare: '3',
        documento: 'C.I.',
        numero_doc: 'AU1234567',
        scadenza: '01/01/2030',
        isee_anno: '2025',
        isee_importo: '3600.00',
        validation_notes: '',
        source: 'QR_FORM'
      })
    }
  };
  
  const result = doPost(testData);
  Logger.log(result.getContent());
}
