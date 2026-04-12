# IPF Auto-Registrazione — Form QR 📱

Modulo di auto-registrazione per l'**Istituto per la Famiglia di Rimini**.  
Gli utenti scansionano un QR code in ufficio e compilano i propri dati direttamente dal telefono.  
I dati vengono validati in tempo reale e salvati automaticamente nel Google Sheet esistente.

## 🏗️ Architettura

```
QR Code (in ufficio) → GitHub Pages (form HTML/JS) → Google Apps Script → Google Sheets
                                                                        → Google Drive (PDF ISEE)
```

- **Frontend**: HTML/CSS/JS statico su GitHub Pages
- **Validazione**: JavaScript client-side (port di `validator.py`)
- **Backend**: Google Apps Script (serverless, gratuito)
- **Storage**: Stesso Google Sheet dell'app OCR + Google Drive per PDF
- **AI**: Nessuna — tutto deterministico

## 📁 Struttura File

```
QR/
├── index.html              # Form registrazione principale
├── isee.html               # Form aggiornamento ISEE (dedicato)
├── css/
│   ├── style.css           # Design system (palette IPF, mobile-first)
│   └── isee.css            # Stili aggiuntivi pagina ISEE
├── js/
│   ├── validator.js         # Port di validator.py (checksum CF, fuzzy matching, ecc.)
│   ├── app.js              # Logica form registrazione
│   └── isee-app.js         # Logica form ISEE (validazione, upload PDF, submit)
├── data/
│   └── comuni.json         # DB Comuni compatto (432 KB, da DB_Comuni.csv)
├── apps-script/
│   └── Code.gs             # Backend Google Apps Script (da copiare manualmente)
└── README.md
```

## 🚀 Setup (3 Passaggi)

### 1. Deploy Google Apps Script

1. Apri il Google Sheet: [Link Sheet](https://docs.google.com/spreadsheets/d/1zp60MFIoLNZng8GdeMSaYfUPceLb2Yr273fYjSlu8VM)
2. Vai su **Estensioni → Apps Script**
3. Elimina il contenuto di `Code.gs` e incolla il contenuto di `apps-script/Code.gs`
4. Clicca **Esegui** → seleziona `doPost` → **Autorizza** l'accesso al tuo account
5. Vai su **Deploy → Nuova distribuzione**:
   - Tipo: **App Web**
   - Esegui come: **Me**
   - Chi ha accesso: **Chiunque**
6. Copia l'**URL** generato

> ⚠️ **IMPORTANTE**: L'autorizzazione deve includere anche l'accesso a **Google Drive** per il salvataggio dei PDF ISEE. Se richiesto, accetta i permessi per Drive.

### 2. Configura l'URL nel Form

Apri `js/app.js` e `js/isee-app.js` e sostituisci:

```javascript
const APPS_SCRIPT_URL = 'YOUR_APPS_SCRIPT_URL_HERE';
```

con l'URL copiato al passaggio precedente:

```javascript
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/XXXXXXX/exec';
```

### 3. Deploy su GitHub Pages

```bash
cd QR
git init
git add .
git commit -m "IPF Auto-Registrazione v1.0"
git remote add origin https://github.com/TUO_USERNAME/ipf-registrazione.git
git push -u origin main
```

Poi su GitHub:
1. Vai su **Settings → Pages**
2. Source: **Deploy from a branch**
3. Branch: **main** → **/root**
4. Salva → il sito sarà live su `https://TUO_USERNAME.github.io/ipf-registrazione/`

### 4. Genera QR Code

Genera **due QR Code** distinti:

| QR Code | URL | Scopo |
|---|---|---|
| 🟠 **Registrazione** | `https://....github.io/ipf-registrazione-qr/` | Nuovi tesserati |
| 🟢 **Aggiornamento ISEE** | `https://....github.io/ipf-registrazione-qr/isee.html` | Tesserati esistenti — aggiornamento ISEE |

Usa [qr-code-generator.com](https://www.qr-code-generator.com/) e stampa entrambi in ufficio.

## ✅ Validazione Integrata

Il form riutilizza le **stesse regole** di `validator.py` dell'app OCR:

| Validazione | Dettaglio |
|---|---|
| **Checksum CF** | Algoritmo standard Agenzia delle Entrate |
| **Cross-check CF** | CF vs cognome, nome, data nascita, luogo |
| **Omocodia** | Decodifica automatica |
| **Telefono** | Formato italiano (cellulare 10 cifre, fisso) |
| **Comuni** | Fuzzy matching su 10.903 comuni (DB ISTAT) |
| **Frazioni** | Risoluzione frazioni zona Rimini |
| **Documento** | Formato CI, CIE, Passaporto, Permesso |
| **Scadenza** | Controllo documento scaduto |

## 📊 Pagina Aggiornamento ISEE

La pagina `isee.html` è dedicata ai **tesserati già registrati** che devono aggiornare il proprio ISEE.

### Funzionalità:
- **Identificazione** per Codice Fiscale (cerca nel foglio)
- **Verifica** cognome/nome corrispondono alla registrazione
- **Upload PDF** dell'attestazione ISEE (salvato su Google Drive)
- **Aggiornamento in-place** delle colonne ISEE nel foglio

### Flusso:
1. L'utente scansiona il QR Code ISEE
2. Inserisce CF + cognome + nome + dati ISEE
3. Carica il PDF dell'attestazione (max 5 MB)
4. Il backend cerca il CF nel foglio, verifica i dati, aggiorna ISEE
5. Il PDF viene salvato nella cartella Drive `IPF_Attestazioni_ISEE`

### Se il CF non viene trovato:
L'utente riceve un messaggio di errore con l'invito a usare il form di registrazione principale.

## 📂 Google Drive — Attestazioni ISEE

I PDF caricati vengono salvati automaticamente in una cartella Google Drive:
- **Cartella**: `IPF_Attestazioni_ISEE` (creata automaticamente al primo upload)
- **Naming**: `COGNOME_NOME_CF_DATA.pdf`
- **Accesso**: I file sono accessibili tramite link diretto

## 📊 Compatibilità Google Sheet

La riga scritta dal form ha **esattamente la stessa struttura** dell'app OCR:

```
N.tessera | Anno | Cognome | Nome | CF | Data Nascita | Luogo | Cell | Comune | Indirizzo | Nucleo | Doc | N.Doc | Scadenza | ISEE Anno | ISEE Importo | Note
```

L'ultima colonna (Note) include:
- `[QR_FORM]` — registrazioni self-service
- `[ISEE_UPDATE DD/MM/YYYY HH:MM]` — aggiornamenti ISEE con timestamp

## 🔄 Migrazione Futura

Il progetto è progettato per una facile migrazione:

- **→ Render**: Converti in Flask app, `validator.js` ha un export Node.js compatibile
- **→ Server casalingo** (RPi 5 / Mini PC N100): Stessa app Flask, accesso via rete locale o Tailscale
- **→ Server dedicato** (Jetson Orin): Solo se serve anche AI/ML, overkill per questo use case
