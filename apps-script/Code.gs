/**
 * IPF Auto-Registrazione — Google Apps Script
 * =============================================
 * Backend serverless per:
 * 1. Registrare nuovi tesserati (form QR)
 * 2. Aggiornare ISEE di tesserati esistenti (form ISEE)
 * 
 * ISTRUZIONI DEPLOY:
 * 1. Apri Google Sheets: https://docs.google.com/spreadsheets/d/1zp60MFIoLNZng8GdeMSaYfUPceLb2Yr273fYjSlu8VM
 * 2. Vai su Estensioni → Apps Script
 * 3. Incolla questo codice nel file Code.gs
 * 4. Fai clic su "Esegui" → seleziona doPost → Autorizza l'accesso
 * 5. Vai su Deploy → Nuova distribuzione → Tipo: App Web
 *    - Esegui come: "Me" (il tuo account)
 *    - Chi ha accesso: "Chiunque"
 * 6. Copia l'URL e incollalo in js/app.js e js/isee-app.js alla riga APPS_SCRIPT_URL
 * 
 * ⚠️ IMPORTANTE: Dopo aver aggiornato il codice, devi creare un NUOVO deploy
 *    (non basta "Salva"). Vai su Deploy → Gestisci distribuzione → Nuova versione.
 */

// ID del foglio Google Sheets (lo stesso usato dall'app OCR)
const SPREADSHEET_ID = '1zp60MFIoLNZng8GdeMSaYfUPceLb2Yr273fYjSlu8VM';
const SHEET_NAME = 'ELENCO TESSERATI';

// Cartella Google Drive per le attestazioni ISEE
const DRIVE_FOLDER_NAME = 'IPF_Attestazioni_ISEE';

/**
 * Gestisce le richieste POST dal form.
 * Smista tra registrazione e aggiornamento ISEE in base al campo "source".
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

    // Smista in base alla sorgente
    if (data.source === 'ISEE_UPDATE') {
      return handleIseeUpdate(data);
    } else {
      return handleRegistration(data);
    }
    
  } catch (error) {
    Logger.log('Errore: ' + error.toString());
    return ContentService.createTextOutput(JSON.stringify({
      status: 'error',
      message: error.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * Gestisce la registrazione di un nuovo tesserato.
 */
function handleRegistration(data) {
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
}

/**
 * Gestisce l'aggiornamento ISEE di un tesserato esistente.
 * Cerca la riga per Codice Fiscale e aggiorna le colonne ISEE.
 */
function handleIseeUpdate(data) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEET_NAME);
  
  if (!sheet) {
    return ContentService.createTextOutput(JSON.stringify({
      status: 'error',
      message: 'Foglio non trovato: ' + SHEET_NAME
    })).setMimeType(ContentService.MimeType.JSON);
  }

  const cf = (data.codice_fiscale || '').toUpperCase().trim();
  if (!cf || cf.length !== 16) {
    return ContentService.createTextOutput(JSON.stringify({
      status: 'error',
      message: 'Codice Fiscale non valido.'
    })).setMimeType(ContentService.MimeType.JSON);
  }

  // Cerca la riga con il CF corrispondente (colonna E = indice 5)
  const allData = sheet.getDataRange().getValues();
  let targetRow = -1;

  for (let i = 1; i < allData.length; i++) { // Salta l'header (riga 0)
    const rowCf = String(allData[i][4] || '').toUpperCase().trim(); // Colonna E (indice 4)
    if (rowCf === cf) {
      targetRow = i + 1; // Sheet è 1-indexed
      break;
    }
  }

  if (targetRow === -1) {
    return ContentService.createTextOutput(JSON.stringify({
      status: 'error',
      message: 'Codice Fiscale non trovato nel nostro archivio. Se non sei ancora registrato, usa il modulo di registrazione principale.'
    })).setMimeType(ContentService.MimeType.JSON);
  }

  // Verifica cognome e nome (sicurezza extra)
  const rowData = allData[targetRow - 1];
  const savedCognome = String(rowData[2] || '').toUpperCase().trim();
  const savedNome = String(rowData[3] || '').toUpperCase().trim();
  const inputCognome = (data.cognome || '').toUpperCase().trim();
  const inputNome = (data.nome || '').toUpperCase().trim();

  if (savedCognome && inputCognome && savedCognome !== inputCognome) {
    return ContentService.createTextOutput(JSON.stringify({
      status: 'error',
      message: 'Il cognome non corrisponde a quello registrato per questo CF.'
    })).setMimeType(ContentService.MimeType.JSON);
  }

  if (savedNome && inputNome && savedNome !== inputNome) {
    return ContentService.createTextOutput(JSON.stringify({
      status: 'error',
      message: 'Il nome non corrisponde a quello registrato per questo CF.'
    })).setMimeType(ContentService.MimeType.JSON);
  }

  // Aggiorna colonne ISEE: colonna O (15) = ISEE Anno, colonna P (16) = ISEE Importo
  if (data.isee_anno) {
    sheet.getRange(targetRow, 15).setValue(data.isee_anno);
  }
  if (data.isee_importo) {
    sheet.getRange(targetRow, 16).setValue(data.isee_importo);
  }

  // Aggiungi nota di aggiornamento nella colonna Note (colonna Q = 17)
  const existingNotes = String(sheet.getRange(targetRow, 17).getValue() || '');
  const timestamp = Utilities.formatDate(new Date(), 'Europe/Rome', 'dd/MM/yyyy HH:mm');
  const protocollo = data.protocollo_inps ? ' Prot: ' + data.protocollo_inps : '';
  const updateNote = '[ISEE_UPDATE ' + timestamp + protocollo + ']';
  
  const newNotes = existingNotes ? existingNotes + ' | ' + updateNote : updateNote;
  sheet.getRange(targetRow, 17).setValue(newNotes);

  // Se c'è un file PDF, salvalo su Google Drive
  let driveLink = '';
  const b64length = data.file_base64 ? data.file_base64.length : 0;
  Logger.log('file_base64 presente: ' + !!data.file_base64 + ', lunghezza: ' + b64length + ', file_name: ' + (data.file_name || 'N/A'));
  
  if (data.file_base64 && data.file_base64.length > 100) {
    try {
      driveLink = saveIseeFile(data.file_base64, data.file_name || 'attestazione_isee.pdf', cf, data.cognome, data.nome);
      Logger.log('File ISEE salvato su Drive: ' + driveLink);
      
      // Salva il link al file nella colonna Note
      const currentNotes = String(sheet.getRange(targetRow, 17).getValue() || '');
      const noteWithLink = currentNotes + ' | 📎 ' + driveLink;
      sheet.getRange(targetRow, 17).setValue(noteWithLink);
    } catch (fileError) {
      Logger.log('Errore salvataggio file: ' + fileError.toString());
      // Scrivi l'errore nelle note per diagnostica
      const currentNotes = String(sheet.getRange(targetRow, 17).getValue() || '');
      sheet.getRange(targetRow, 17).setValue(currentNotes + ' | ⚠️ FILE_ERROR: ' + fileError.toString().substring(0, 200));
    }
  } else {
    // Log diagnostico: il file non è arrivato
    const currentNotes = String(sheet.getRange(targetRow, 17).getValue() || '');
    sheet.getRange(targetRow, 17).setValue(currentNotes + ' | ⚠️ NO_FILE (b64len=' + b64length + ')');
  }

  Logger.log('ISEE aggiornato per ' + cf + ' (riga ' + targetRow + ')' + (driveLink ? ' — File: ' + driveLink : ''));

  return ContentService.createTextOutput(JSON.stringify({
    status: 'ok',
    message: 'ISEE aggiornato con successo',
    row: targetRow,
    driveLink: driveLink
  })).setMimeType(ContentService.MimeType.JSON);
}

/**
 * Salva il file PDF dell'attestazione ISEE su Google Drive.
 * Crea una cartella dedicata se non esiste.
 * Naming: COGNOME_NOME_CF_ISEE_ANNO.pdf
 */
function saveIseeFile(base64Data, originalName, cf, cognome, nome) {
  // Trova o crea la cartella
  const folders = DriveApp.getFoldersByName(DRIVE_FOLDER_NAME);
  let folder;
  if (folders.hasNext()) {
    folder = folders.next();
  } else {
    folder = DriveApp.createFolder(DRIVE_FOLDER_NAME);
    Logger.log('Cartella creata su Drive: ' + DRIVE_FOLDER_NAME);
  }

  // Genera nome file univoco
  const timestamp = Utilities.formatDate(new Date(), 'Europe/Rome', 'yyyyMMdd_HHmm');
  const safeCognome = (cognome || 'SCONOSCIUTO').replace(/[^A-Za-z]/g, '');
  const safeNome = (nome || '').replace(/[^A-Za-z]/g, '');
  const fileName = safeCognome + '_' + safeNome + '_' + cf + '_' + timestamp + '.pdf';

  // Decodifica Base64 e crea il file
  const decoded = Utilities.base64Decode(base64Data);
  const blob = Utilities.newBlob(decoded, 'application/pdf', fileName);
  const file = folder.createFile(blob);

  // Rendi il file accessibile via link (opzionale)
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  return file.getUrl();
}

/**
 * Gestisce le richieste GET (per test).
 */
function doGet(e) {
  // Modalità diagnostica: ?debug=1
  if (e && e.parameter && e.parameter.debug === '1') {
    try {
      const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
      const allSheets = ss.getSheets().map(s => s.getName());
      const sheet = ss.getSheetByName(SHEET_NAME);
      let headers = [];
      let rowCount = 0;
      if (sheet) {
        const headerRange = sheet.getRange(1, 1, 1, sheet.getLastColumn());
        headers = headerRange.getValues()[0].map((h, i) => ({col: i+1, letter: String.fromCharCode(65+i), header: String(h)}));
        rowCount = sheet.getLastRow();
      }
      return ContentService.createTextOutput(JSON.stringify({
        status: 'ok',
        debug: true,
        spreadsheet_id: SPREADSHEET_ID,
        configured_sheet_name: SHEET_NAME,
        all_sheet_names: allSheets,
        sheet_found: !!sheet,
        headers: headers,
        total_rows: rowCount,
        drive_folder_name: DRIVE_FOLDER_NAME
      }, null, 2)).setMimeType(ContentService.MimeType.JSON);
    } catch (err) {
      return ContentService.createTextOutput(JSON.stringify({
        status: 'error',
        error: err.toString()
      })).setMimeType(ContentService.MimeType.JSON);
    }
  }

  return ContentService.createTextOutput(JSON.stringify({
    status: 'ok',
    message: 'IPF Auto-Registrazione API attiva',
    features: ['registrazione', 'isee_update', 'file_upload'],
    timestamp: new Date().toISOString()
  })).setMimeType(ContentService.MimeType.JSON);
}

/**
 * Test locale: simula un POST di registrazione.
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

/**
 * Test locale: simula un aggiornamento ISEE.
 */
function testIseeUpdate() {
  const testData = {
    postData: {
      contents: JSON.stringify({
        codice_fiscale: 'TSTTNT80A01H294Z',
        cognome: 'TEST',
        nome: 'UTENTE',
        isee_anno: '2026',
        isee_importo: '4200.00',
        protocollo_inps: 'INPS-ISEE-2026-1234567-00',
        source: 'ISEE_UPDATE'
      })
    }
  };
  
  const result = doPost(testData);
  Logger.log(result.getContent());
}
