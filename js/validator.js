/**
 * Validatore Codice Fiscale Italiano — Port JavaScript
 * =====================================================
 * Port fedele di validator.py (Python) per uso client-side.
 * Livello 1: Validazione deterministica (checksum, date, belfiore)
 * Livello 2: Cross-validation (CF vs dati anagrafici)
 * 
 * Nessuna AI — tutto deterministico.
 */

// ============================================================
// COSTANTI CF
// ============================================================
const CF_MONTH_MAP = {
    'A': 1, 'B': 2, 'C': 3, 'D': 4, 'E': 5, 'H': 6,
    'L': 7, 'M': 8, 'P': 9, 'R': 10, 'S': 11, 'T': 12
};
const CF_MONTH_REVERSE = {};
Object.entries(CF_MONTH_MAP).forEach(([k, v]) => CF_MONTH_REVERSE[v] = k);

const CF_ODD_MAP = {
    '0': 1, '1': 0, '2': 5, '3': 7, '4': 9, '5': 13, '6': 15, '7': 17, '8': 19, '9': 21,
    'A': 1, 'B': 0, 'C': 5, 'D': 7, 'E': 9, 'F': 13, 'G': 15, 'H': 17, 'I': 19, 'J': 21,
    'K': 2, 'L': 4, 'M': 18, 'N': 20, 'O': 11, 'P': 3, 'Q': 6, 'R': 8, 'S': 12, 'T': 14,
    'U': 16, 'V': 10, 'W': 22, 'X': 25, 'Y': 24, 'Z': 23
};

const CF_EVEN_MAP = {
    '0': 0, '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
    'A': 0, 'B': 1, 'C': 2, 'D': 3, 'E': 4, 'F': 5, 'G': 6, 'H': 7, 'I': 8, 'J': 9,
    'K': 10, 'L': 11, 'M': 12, 'N': 13, 'O': 14, 'P': 15, 'Q': 16, 'R': 17, 'S': 18, 'T': 19,
    'U': 20, 'V': 21, 'W': 22, 'X': 23, 'Y': 24, 'Z': 25
};

const VOWELS = new Set('AEIOU'.split(''));
const CONSONANTS = new Set('BCDFGHJKLMNPQRSTVWXYZ'.split(''));

// Omocodia
const OMOCODIA_ENCODE = { '0': 'L', '1': 'M', '2': 'N', '3': 'P', '4': 'Q', '5': 'R', '6': 'S', '7': 'T', '8': 'U', '9': 'V' };
const OMOCODIA_DECODE = {};
Object.entries(OMOCODIA_ENCODE).forEach(([k, v]) => OMOCODIA_DECODE[v] = k);
const OMOCODIA_POSITIONS = [14, 13, 12, 10, 9, 7, 6];

// Frazioni → Comune
const FRAZIONI_MAP = {
    'VISERBA': 'RIMINI', 'VISERBELLA': 'RIMINI', 'TORRE PEDRERA': 'RIMINI',
    'RIVAZZURRA': 'RIMINI', 'MIRAMARE': 'RIMINI', 'MAREBELLO': 'RIMINI',
    'BELLARIVA': 'RIMINI', 'SAN GIULIANO': 'RIMINI', 'SPADAROLO': 'RIMINI',
    'SANTA GIUSTINA': 'RIMINI', 'CORPOLÒ': 'RIMINI', 'CORPOLO': 'RIMINI',
    'VERGIANO': 'RIMINI', 'VILLAGGIO PRIMO MAGGIO': 'RIMINI',
    'SAN MARTINO IN RIPAROTTA': 'RIMINI', 'GAIOFANA': 'RIMINI',
    'FONTANELLE': 'RICCIONE', 'ABISSINIA': 'RICCIONE',
    'BELLARIA': 'BELLARIA-IGEA MARINA', 'IGEA MARINA': 'BELLARIA-IGEA MARINA',
    'IGEA': 'BELLARIA-IGEA MARINA',
    "SANT ARCANGELO": "SANTARCANGELO DI ROMAGNA", "SANTARCANGELO": "SANTARCANGELO DI ROMAGNA",
    'PORTOVERDE': 'MISANO ADRIATICO',
    'CERASOLO': 'CORIANO', 'OSPEDALETTO': 'CORIANO',
    'VILLA VERUCCHIO': 'VERUCCHIO'
};

// Alias paesi esteri
const COUNTRY_ALIASES = {
    'UKR': 'UCRAINA', 'UKRAINA': 'UCRAINA', 'UKRAINE': 'UCRAINA',
    'UCRAÌNA': 'UCRAINA', 'UCRANIA': 'UCRAINA',
    'MOLDOVA': 'MOLDAVIA', 'MOLDÀVIA': 'MOLDAVIA', 'REPUBLIC OF MOLDOVA': 'MOLDAVIA',
    'ROUMANIE': 'ROMANIA', 'RUMENIA': 'ROMANIA',
    'SHQIPËRIA': 'ALBANIA', 'SHQIPERIA': 'ALBANIA',
    'MAROC': 'MAROCCO', 'MOROCCO': 'MAROCCO', 'MARRUECOS': 'MAROCCO',
    'JUGOSLAVIA': 'EX-JUGOSLAVIA', 'SERBIA': 'SERBIA'
};

// ============================================================
// DATABASE COMUNI (caricato da JSON)
// ============================================================
class ComuniDB {
    constructor() {
        this.belfioreToName = {};  // codice → nome
        this.nameToBelfiore = {};  // NOME → codice
        this.allNames = [];
        this.loaded = false;
    }

    async load(jsonUrl = 'data/comuni.json') {
        try {
            const response = await fetch(jsonUrl);
            const data = await response.json();
            this.belfioreToName = data.b2n;
            this.nameToBelfiore = data.n2b;
            this.allNames = Object.keys(this.nameToBelfiore);
            this.loaded = true;
            console.log(`📦 DB Comuni caricato: ${Object.keys(this.belfioreToName).length} codici, ${this.allNames.length} nomi`);
        } catch (e) {
            console.error('⚠️ Errore caricamento DB Comuni:', e);
        }
    }

    getComuneByBelfiore(codice) {
        return this.belfioreToName[codice.toUpperCase()] || null;
    }

    getBelfioreByComuneNome(nome) {
        return this.nameToBelfiore[nome.toUpperCase().trim()] || null;
    }

    fuzzySearch(nome, n = 3, cutoff = 0.6) {
        const nomeUpper = nome.toUpperCase().trim();
        
        // Match esatto
        if (this.nameToBelfiore[nomeUpper]) {
            return [{ name: nomeUpper, score: 1.0, belfiore: this.nameToBelfiore[nomeUpper] }];
        }

        // Fuzzy matching
        const results = [];
        for (const candidateName of this.allNames) {
            const score = similarity(nomeUpper, candidateName);
            if (score >= cutoff) {
                results.push({ name: candidateName, score: Math.round(score * 1000) / 1000, belfiore: this.nameToBelfiore[candidateName] });
            }
        }

        results.sort((a, b) => b.score - a.score);
        return results.slice(0, n);
    }
}

// ============================================================
// FUZZY MATCHING (Levenshtein-based similarity)
// ============================================================
function levenshtein(a, b) {
    const m = a.length, n = b.length;
    if (m === 0) return n;
    if (n === 0) return m;

    // Ottimizzazione: usa solo 2 righe
    let prev = new Array(n + 1);
    let curr = new Array(n + 1);

    for (let j = 0; j <= n; j++) prev[j] = j;

    for (let i = 1; i <= m; i++) {
        curr[0] = i;
        for (let j = 1; j <= n; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            curr[j] = Math.min(
                prev[j] + 1,      // inserimento
                curr[j - 1] + 1,   // cancellazione
                prev[j - 1] + cost // sostituzione
            );
        }
        [prev, curr] = [curr, prev];
    }
    return prev[n];
}

function similarity(a, b) {
    const maxLen = Math.max(a.length, b.length);
    if (maxLen === 0) return 1.0;
    return 1.0 - levenshtein(a, b) / maxLen;
}

// ============================================================
// LIVELLO 1: VALIDAZIONE DETERMINISTICA CF
// ============================================================
function cfChecksum(cf15) {
    cf15 = cf15.toUpperCase();
    let total = 0;
    for (let i = 0; i < cf15.length; i++) {
        const ch = cf15[i];
        if ((i + 1) % 2 === 1) {
            total += CF_ODD_MAP[ch] || 0;
        } else {
            total += CF_EVEN_MAP[ch] || 0;
        }
    }
    return String.fromCharCode(65 + (total % 26));
}

function cfExtractSurnameCode(cognome) {
    cognome = cognome.toUpperCase().replace(/[\s']/g, '');
    const cons = [...cognome].filter(c => CONSONANTS.has(c));
    const vow = [...cognome].filter(c => VOWELS.has(c));
    const code = [...cons, ...vow, 'X', 'X', 'X'];
    return code.slice(0, 3).join('');
}

function cfExtractNameCode(nome) {
    nome = nome.toUpperCase().replace(/[\s']/g, '');
    const cons = [...nome].filter(c => CONSONANTS.has(c));
    const vow = [...nome].filter(c => VOWELS.has(c));
    let code;
    if (cons.length >= 4) {
        code = [cons[0], cons[2], cons[3]];
    } else {
        code = [...cons, ...vow, 'X', 'X', 'X'];
    }
    return code.slice(0, 3).join('');
}

function cfExtractBirthdate(cf) {
    try {
        const yearCode = parseInt(cf.substring(6, 8));
        const monthLetter = cf[8].toUpperCase();
        const dayCode = parseInt(cf.substring(9, 11));

        const month = CF_MONTH_MAP[monthLetter];
        if (month === undefined) return { data: null, error: 'Lettera mese non valida' };

        let gender = 'M';
        let day = dayCode;
        if (dayCode > 40) {
            gender = 'F';
            day = dayCode - 40;
        }

        const year = yearCode > 26 ? 1900 + yearCode : 2000 + yearCode;

        return {
            data: { year, month, day, gender, formatted: `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}` },
            error: null
        };
    } catch (e) {
        return { data: null, error: e.message };
    }
}

function cfExtractBelfiore(cf) {
    return cf.substring(11, 15).toUpperCase();
}

function validateCfChecksum(cf) {
    cf = cf.toUpperCase().replace(/\s/g, '');
    if (cf.length !== 16) return { ok: false, error: `Lunghezza ${cf.length} invece di 16` };
    const expected = cfChecksum(cf.substring(0, 15));
    if (cf[15] === expected) return { ok: true, error: null };
    return { ok: false, error: `Checksum atteso '${expected}', trovato '${cf[15]}'` };
}

function decodeOmocodia(cf) {
    cf = cf.toUpperCase().replace(/\s/g, '');
    if (cf.length !== 16) return { cf, isOmocode: false };

    const cfList = [...cf];
    let wasOmocode = false;

    for (const pos of OMOCODIA_POSITIONS) {
        const ch = cfList[pos];
        if (OMOCODIA_DECODE[ch] !== undefined) {
            cfList[pos] = OMOCODIA_DECODE[ch];
            wasOmocode = true;
        }
    }

    if (wasOmocode) {
        const decoded15 = cfList.slice(0, 15).join('');
        const newChecksum = cfChecksum(decoded15);
        return { cf: decoded15 + newChecksum, isOmocode: true };
    }

    return { cf, isOmocode: false };
}

function buildCfFromData(cognome, nome, day, month, year, gender, belfiore) {
    const surnameCode = cfExtractSurnameCode(cognome);
    const nameCode = cfExtractNameCode(nome);
    const yearCode = String(year % 100).padStart(2, '0');
    const monthLetter = CF_MONTH_REVERSE[month] || 'A';
    const dayCode = gender === 'F' ? day + 40 : day;

    const cf15 = `${surnameCode}${nameCode}${yearCode}${monthLetter}${String(dayCode).padStart(2, '0')}${belfiore}`;
    const checksum = cfChecksum(cf15);
    return cf15 + checksum;
}

// ============================================================
// VALIDAZIONE TELEFONO
// ============================================================
function validatePhone(phoneStr) {
    let phone = (phoneStr || '').replace(/[\s\-\/]/g, '');
    if (!phone) return { status: 'skip', detail: '' };

    if (phone.startsWith('+39')) phone = phone.substring(3);
    else if (phone.startsWith('0039')) phone = phone.substring(4);

    if (!/^\d+$/.test(phone)) return { status: 'warning', detail: `Numero "${phoneStr}" contiene caratteri non numerici` };

    if (phone.startsWith('3')) {
        if (phone.length === 10) return { status: 'ok', detail: `Cellulare valido (${phone.substring(0, 3)} ${phone.substring(3, 6)} ${phone.substring(6)}) ✓` };
        if (phone.length < 10) return { status: 'warning', detail: `Cellulare troppo corto: ${phone.length} cifre (attese 10)` };
        return { status: 'warning', detail: `Cellulare troppo lungo: ${phone.length} cifre (attese 10)` };
    }
    if (phone.startsWith('0')) return { status: 'ok', detail: `Numero fisso (${phone}) ✓` };
    return { status: 'warning', detail: `Numero "${phone}" non inizia con 3 (mobile) né 0 (fisso)` };
}

// ============================================================
// FRAZIONI
// ============================================================
function resolveFrazione(nomeLuogo) {
    return FRAZIONI_MAP[nomeLuogo.toUpperCase().trim()] || null;
}

// ============================================================
// LIVELLO 2: CROSS-VALIDATION COMPLETA
// ============================================================
function validateDataVsCf(data, db) {
    const results = {
        checksum: { status: 'skip', detail: '' },
        cognome: { status: 'skip', detail: '' },
        nome: { status: 'skip', detail: '' },
        data_nascita: { status: 'skip', detail: '' },
        luogo_nascita: { status: 'skip', detail: '' },
        comune_residenza: { status: 'skip', detail: '' },
        codice_fiscale: { status: 'skip', detail: '' },
    };

    let cf = (data.codice_fiscale || '').toUpperCase().replace(/\s/g, '');

    // CF vuoto o incompleto
    if (!cf || cf.length < 16) {
        results.codice_fiscale = {
            status: 'error',
            detail: cf ? `CF incompleto (${cf.length} caratteri)` : 'CF mancante'
        };
        // Valida telefono e frazioni anche senza CF
        const phoneResult = validatePhone(data.cellulare);
        if (phoneResult.status !== 'skip') results.cellulare = phoneResult;
        const residenza = (data.comune_residenza || '').toUpperCase().trim();
        if (residenza) {
            const comuneReale = resolveFrazione(residenza);
            if (comuneReale) {
                results.comune_residenza = { status: 'ok', detail: `Frazione "${residenza}" → Comune "${comuneReale}" ✓` };
            }
        }
        return results;
    }

    // Omocodia
    const omoResult = decodeOmocodia(cf);
    if (omoResult.isOmocode) {
        results.omocodia = { status: 'ok', detail: `CF con omocodia rilevata. Decodificato: ${omoResult.cf}` };
        cf = omoResult.cf;
    }

    // Checksum
    const checksumResult = validateCfChecksum(cf);
    results.checksum = checksumResult.ok
        ? { status: 'ok', detail: 'Checksum valido ✓' }
        : { status: 'error', detail: checksumResult.error };

    // Cognome
    const cognome = (data.cognome || '').toUpperCase().trim();
    if (cognome) {
        const expectedCode = cfExtractSurnameCode(cognome);
        const cfCode = cf.substring(0, 3);
        if (expectedCode === cfCode) {
            results.cognome = { status: 'ok', detail: `Codice CF "${cfCode}" corrisponde ✓` };
        } else {
            results.cognome = { status: 'warning', detail: `CF dice "${cfCode}", cognome "${cognome}" genera "${expectedCode}"` };
        }
    }

    // Nome
    const nome = (data.nome || '').toUpperCase().trim();
    if (nome) {
        const expectedCode = cfExtractNameCode(nome);
        const cfCode = cf.substring(3, 6);
        if (expectedCode === cfCode) {
            results.nome = { status: 'ok', detail: `Codice CF "${cfCode}" corrisponde ✓` };
        } else {
            results.nome = { status: 'warning', detail: `CF dice "${cfCode}", nome "${nome}" genera "${expectedCode}"` };
        }
    }

    // Data di nascita
    const dataNascitaStr = (data.data_nascita || '').trim();
    if (dataNascitaStr) {
        const { data: cfBirth } = cfExtractBirthdate(cf);
        if (cfBirth) {
            const match = dataNascitaStr.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/);
            if (match) {
                const [, ocrDay, ocrMonth, ocrYear] = match.map(Number);
                const mismatches = [];
                if (ocrYear !== cfBirth.year) mismatches.push(`anno: inserito=${ocrYear}, CF=${cfBirth.year}`);
                if (ocrMonth !== cfBirth.month) mismatches.push(`mese: inserito=${ocrMonth}, CF=${cfBirth.month}`);
                if (ocrDay !== cfBirth.day) mismatches.push(`giorno: inserito=${ocrDay}, CF=${cfBirth.day}`);

                if (mismatches.length === 0) {
                    results.data_nascita = { status: 'ok', detail: `${dataNascitaStr} corrisponde al CF ✓ (Genere: ${cfBirth.gender})` };
                } else {
                    results.data_nascita = {
                        status: 'error',
                        detail: `Conflitto: ${mismatches.join(', ')}. Data dal CF: ${cfBirth.formatted}`,
                        cfValue: cfBirth.formatted
                    };
                }
            } else {
                results.data_nascita = {
                    status: 'warning',
                    detail: `Formato data non riconosciuto: "${dataNascitaStr}". Usa GG/MM/AAAA`
                };
            }
        }
    }

    // Luogo di nascita
    const luogo = (data.luogo_nascita || '').toUpperCase().trim();
    const belfiore = cfExtractBelfiore(cf);
    const cfComune = db ? db.getComuneByBelfiore(belfiore) : null;

    if (cfComune) {
        results.codice_fiscale = { status: 'ok', detail: `CF valido, Belfiore ${belfiore} = ${cfComune}` };

        if (luogo) {
            const luogoResolved = COUNTRY_ALIASES[luogo] || luogo;
            if (luogoResolved === cfComune || luogoResolved.includes(cfComune) || cfComune.includes(luogoResolved)) {
                let detail = `"${luogo}" corrisponde al Belfiore ${belfiore} ✓`;
                if (luogo !== luogoResolved) detail = `"${luogo}" = "${luogoResolved}" corrisponde al Belfiore ${belfiore} ✓`;
                results.luogo_nascita = { status: 'ok', detail };
            } else {
                const score = similarity(luogoResolved, cfComune);
                if (score >= 0.75) {
                    results.luogo_nascita = {
                        status: 'warning',
                        detail: `Simile: "${luogo}" ≈ CF "${cfComune}" (score ${Math.round(score * 100)}%)`,
                        suggestion: cfComune
                    };
                } else {
                    results.luogo_nascita = {
                        status: 'error',
                        detail: `Conflitto: "${luogo}" ≠ CF "${cfComune}" (Belfiore ${belfiore})`,
                        suggestion: cfComune
                    };
                }
            }
        }
    } else if (belfiore) {
        results.luogo_nascita = { status: 'warning', detail: `Belfiore "${belfiore}" non trovato nel DB` };
    }

    // Comune di residenza
    const residenza = (data.comune_residenza || '').toUpperCase().trim();
    if (residenza && db) {
        const comuneReale = resolveFrazione(residenza);
        if (comuneReale) {
            results.comune_residenza = { status: 'ok', detail: `Frazione "${residenza}" → Comune "${comuneReale}" ✓` };
        } else {
            const matches = db.fuzzySearch(residenza, 1, 0.6);
            if (matches.length > 0) {
                const best = matches[0];
                if (best.score >= 0.95) {
                    results.comune_residenza = { status: 'ok', detail: `Comune "${residenza}" trovato nel DB ✓` };
                } else if (best.score >= 0.7) {
                    results.comune_residenza = {
                        status: 'warning',
                        detail: `Simile a "${best.name}" (score ${Math.round(best.score * 100)}%). Corretto: ${best.name}?`,
                        suggestion: best.name
                    };
                } else {
                    results.comune_residenza = {
                        status: 'warning',
                        detail: `Comune "${residenza}" non trovato. Intendevi "${best.name}"?`,
                        suggestion: best.name
                    };
                }
            } else {
                results.comune_residenza = { status: 'warning', detail: `Comune "${residenza}" non trovato nel DB` };
            }
        }
    }

    // Documento
    const numeroDoc = (data.numero_doc || '').toUpperCase().replace(/[\s\-]/g, '');
    if (numeroDoc) {
        const oldFormat = /^[A-Z]{2}\d{7}$/.test(numeroDoc);
        const cieFormat = /^C[A-Z]\d{5}[A-Z]{2}$/.test(numeroDoc);
        const cieExtended = /^C[A-Z]\d{4,6}[A-Z0-9]{1,3}$/.test(numeroDoc);
        const permessoFormat = /^[A-Z]\d{7,9}$/.test(numeroDoc);
        const passportFormat = /^[A-Z]{2}\d{5,7}$/.test(numeroDoc);
        const genericFormat = /^[A-Z0-9]{6,}$/.test(numeroDoc);
        const tipoDoc = (data.documento || '').toUpperCase();

        let docType = null;
        if (oldFormat) docType = 'CI cartacea';
        else if (cieFormat || cieExtended) docType = 'CIE';
        else if (permessoFormat && tipoDoc.includes('PERMESSO')) docType = 'Permesso di soggiorno';
        else if (passportFormat) docType = 'Passaporto';
        else if (permessoFormat) docType = 'Permesso/Documento';
        else if (genericFormat) docType = 'Documento';

        results.documento = docType
            ? { status: 'ok', detail: `Formato valido (${docType}): ${numeroDoc} ✓` }
            : { status: 'warning', detail: `Formato "${numeroDoc}" non riconosciuto` };
    }

    // Scadenza documento
    const scadenzaStr = (data.scadenza || '').trim();
    if (scadenzaStr) {
        const matchScad = scadenzaStr.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/);
        if (matchScad) {
            try {
                const [, sDay, sMonth, sYear] = matchScad.map(Number);
                const scadDate = new Date(sYear, sMonth - 1, sDay);
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                if (scadDate < today) {
                    results.scadenza = { status: 'warning', detail: `⏰ Documento SCADUTO il ${scadenzaStr}` };
                } else {
                    results.scadenza = { status: 'ok', detail: `Documento valido fino al ${scadenzaStr} ✓` };
                }
            } catch {
                results.scadenza = { status: 'warning', detail: `Data scadenza non valida: "${scadenzaStr}"` };
            }
        }
    }

    // Telefono
    const phoneResult = validatePhone(data.cellulare);
    if (phoneResult.status !== 'skip') results.cellulare = phoneResult;

    return results;
}

// ============================================================
// OVERALL STATUS
// ============================================================
function getOverallStatus(validation) {
    const statuses = Object.values(validation).map(v => v.status);
    if (statuses.includes('error')) return 'error';
    if (statuses.includes('warning')) return 'warning';
    return 'ok';
}

// ============================================================
// ESPORTA (compatibile browser e Node.js)
// ============================================================
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        ComuniDB, cfChecksum, cfExtractSurnameCode, cfExtractNameCode,
        cfExtractBirthdate, cfExtractBelfiore, validateCfChecksum,
        decodeOmocodia, buildCfFromData, validatePhone, resolveFrazione,
        validateDataVsCf, getOverallStatus, similarity
    };
}
