require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
const AdmZip = require('adm-zip');
const cron = require('node-cron');

const app = express();
const PORT = process.env.PORT || 10000;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS inscriptions (
        id SERIAL PRIMARY KEY, date_garde DATE NOT NULL,
        praticien_nom VARCHAR(100) NOT NULL, praticien_prenom VARCHAR(100) NOT NULL,
        praticien_email VARCHAR(100) NOT NULL, praticien_telephone VARCHAR(20) NOT NULL,
        praticien_rpps VARCHAR(20) NOT NULL, praticien_numero VARCHAR(10) NOT NULL,
        praticien_voie VARCHAR(200) NOT NULL, praticien_code_postal VARCHAR(10) NOT NULL,
        praticien_ville VARCHAR(100) NOT NULL, praticien_etage VARCHAR(50),
        praticien_code_entree VARCHAR(50),
        email_confirmation_envoi_at TIMESTAMP, email_confirmation_statut VARCHAR(20) DEFAULT 'non_envoye',
        email_binome_envoi_at TIMESTAMP, email_binome_statut VARCHAR(20) DEFAULT 'non_envoye',
        email_rappel_j7_envoi_at TIMESTAMP, email_rappel_j7_statut VARCHAR(20) DEFAULT 'non_envoye',
        email_rappel_j1_envoi_at TIMESTAMP, email_rappel_j1_statut VARCHAR(20) DEFAULT 'non_envoye',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_date_garde ON inscriptions(date_garde);
      CREATE INDEX IF NOT EXISTS idx_praticien_email ON inscriptions(praticien_email);
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS dates_garde (
        id SERIAL PRIMARY KEY, date DATE NOT NULL UNIQUE, type VARCHAR(50) NOT NULL,
        nom_jour_ferie VARCHAR(100), active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_date_garde_date ON dates_garde(date);
      CREATE INDEX IF NOT EXISTS idx_date_garde_active ON dates_garde(active);
    `);
    // Migration : ajouter les colonnes rappel si elles n'existent pas
    await pool.query(`
      ALTER TABLE inscriptions ADD COLUMN IF NOT EXISTS email_rappel_j7_envoi_at TIMESTAMP;
      ALTER TABLE inscriptions ADD COLUMN IF NOT EXISTS email_rappel_j7_statut VARCHAR(20) DEFAULT 'non_envoye';
      ALTER TABLE inscriptions ADD COLUMN IF NOT EXISTS email_rappel_j1_envoi_at TIMESTAMP;
      ALTER TABLE inscriptions ADD COLUMN IF NOT EXISTS email_rappel_j1_statut VARCHAR(20) DEFAULT 'non_envoye';
    `);
    console.log('✅ Tables vérifiées/créées (inscriptions + rappels + dates)');
  } catch (err) { console.error('Erreur init DB:', err); }
})();

const BREVO_API_KEY = process.env.BREVO_API_KEY;
const EMAIL_FROM = process.env.EMAIL_FROM || 'doc.cdo94@gmail.com';
const EMAIL_FROM_NAME = process.env.EMAIL_FROM_NAME || 'CDO 94 - Gardes Médicales';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'doc.cdo94@gmail.com';
const ACCESS_TOKEN = process.env.ACCESS_TOKEN || 'garde2027cdo94';

const DOCUMENTS_DIR = path.join(__dirname, 'Documents');
const DOCUMENTS_GARDE = [
  { fichier: 'fiche retour .pdf', nomEmail: 'Fiche-retour-indemnites.pdf' },
  { fichier: 'Cadre-reglementaire v2 à valider.pdf', nomEmail: 'Cadre-reglementaire.pdf' },
  { fichier: 'attestation de participation.pdf', nomEmail: 'Attestation-participation.pdf' }
];
const DOCX_TEMPLATE = { fichier: 'doc prat de garde.docx', nomEmail: 'Document-praticien-de-garde.docx' };
let DOCUMENTS_STATIQUES = [];
let DOCX_TEMPLATE_BUFFER = null;

function chargerDocuments() {
  DOCUMENTS_STATIQUES = []; DOCX_TEMPLATE_BUFFER = null;
  console.log(`📂 Dossier documents : ${DOCUMENTS_DIR}`);
  if (!fs.existsSync(DOCUMENTS_DIR)) {
    console.error(`❌ Dossier "${DOCUMENTS_DIR}" introuvable !`);
    try { console.log('📁 Contenu racine :', fs.readdirSync(__dirname).join(', ')); } catch(e){}
    return;
  }
  const fichiersReels = fs.readdirSync(DOCUMENTS_DIR);
  console.log(`📁 Fichiers dans Documents/ : ${fichiersReels.join(', ')}`);
  function trouverFichier(nom) {
    let f = fichiersReels.find(f => f.normalize('NFC') === nom.normalize('NFC'));
    if (!f) f = fichiersReels.find(f => f.normalize('NFD') === nom.normalize('NFD'));
    if (!f) { const sa = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase(); f = fichiersReels.find(fi => sa(fi) === sa(nom)); }
    return f;
  }
  for (const doc of DOCUMENTS_GARDE) {
    try {
      const ft = trouverFichier(doc.fichier);
      if (ft) { const c = fs.readFileSync(path.join(DOCUMENTS_DIR, ft)); DOCUMENTS_STATIQUES.push({name:doc.nomEmail, content:c.toString('base64')}); console.log(`✅ Statique : "${ft}" → ${doc.nomEmail} (${(c.length/1024).toFixed(1)} KB)`); }
      else console.error(`❌ Introuvable : "${doc.fichier}"`);
    } catch(e) { console.error(`❌ Erreur "${doc.fichier}" :`, e.message); }
  }
  try {
    const ft = trouverFichier(DOCX_TEMPLATE.fichier);
    if (ft) { DOCX_TEMPLATE_BUFFER = fs.readFileSync(path.join(DOCUMENTS_DIR, ft)); console.log(`✅ Template docx : "${ft}" (${(DOCX_TEMPLATE_BUFFER.length/1024).toFixed(1)} KB)`); }
    else console.error(`❌ Template docx introuvable : "${DOCX_TEMPLATE.fichier}"`);
  } catch(e) { console.error(`❌ Erreur template docx :`, e.message); }
  console.log(`📎 ${DOCUMENTS_STATIQUES.length + (DOCX_TEMPLATE_BUFFER?1:0)}/${DOCUMENTS_GARDE.length+1} documents chargés`);
}
chargerDocuments();

function genererDocxPersonnalise(nom, prenom, dateGarde) {
  if (!DOCX_TEMPLATE_BUFFER) { console.error('⚠️ Template docx non chargé'); return null; }
  try {
    const zip = new AdmZip(DOCX_TEMPLATE_BUFFER);
    const xml = zip.readAsText('word/document.xml');
    const xmlModifie = xml.replace(/\{\{NOM_PRATICIEN\}\}/g, `${prenom} ${nom}`).replace(/\{\{DATE_GARDE\}\}/g, dateGarde);
    zip.updateFile('word/document.xml', Buffer.from(xmlModifie, 'utf-8'));
    console.log(`📝 Docx personnalisé pour Dr ${nom} - ${dateGarde}`);
    return { name: DOCX_TEMPLATE.nomEmail, content: zip.toBuffer().toString('base64') };
  } catch(e) { console.error('❌ Erreur docx :', e.message); return null; }
}

async function envoyerEmailViaAPI(to, subject, html, praticienInfo = null) {
  if (!BREVO_API_KEY) { console.log('BREVO_API_KEY manquant'); return false; }
  try {
    const emailData = { sender:{name:EMAIL_FROM_NAME,email:EMAIL_FROM}, to:[{email:to}], cc:[{email:ADMIN_EMAIL}], subject, htmlContent:html };
    const attachments = [...DOCUMENTS_STATIQUES];
    if (praticienInfo) { const d = genererDocxPersonnalise(praticienInfo.nom, praticienInfo.prenom, praticienInfo.dateGarde); if(d) attachments.push(d); }
    if (attachments.length > 0) { emailData.attachment = attachments; console.log(`📎 ${attachments.length} PJ (docx perso: ${praticienInfo?'oui':'non'})`); }
    const response = await fetch('https://api.brevo.com/v3/smtp/email', { method:'POST', headers:{'Content-Type':'application/json','api-key':BREVO_API_KEY}, body:JSON.stringify(emailData) });
    if (response.ok) { const r = await response.json(); console.log(`✅ Email envoyé à ${to} - ${attachments.length} PJ - ${r.messageId}`); return true; }
    else { console.error('❌ Brevo:', response.status, await response.text()); return false; }
  } catch(e) { console.error('❌ Email:', e); return false; }
}

// Envoi d'email rappel SANS pièces jointes (plus léger)
async function envoyerEmailRappelViaAPI(to, subject, html) {
  if (!BREVO_API_KEY) { console.log('BREVO_API_KEY manquant'); return false; }
  try {
    const emailData = { sender:{name:EMAIL_FROM_NAME,email:EMAIL_FROM}, to:[{email:to}], cc:[{email:ADMIN_EMAIL}], subject, htmlContent:html };
    const response = await fetch('https://api.brevo.com/v3/smtp/email', { method:'POST', headers:{'Content-Type':'application/json','api-key':BREVO_API_KEY}, body:JSON.stringify(emailData) });
    if (response.ok) { const r = await response.json(); console.log(`✅ Email rappel envoyé à ${to} - ${r.messageId}`); return true; }
    else { console.error('❌ Brevo:', response.status, await response.text()); return false; }
  } catch(e) { console.error('❌ Email rappel:', e); return false; }
}

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));

// ========== VALIDATION ==========
function validerEmail(e) { return /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(e); }
function validerTelephone(t) { const c=t.replace(/[\s.\-]/g,''); return /^0[1-9]\d{8}$/.test(c)||/^\+33[1-9]\d{8}$/.test(c); }
function validerRPPS(r) { return /^\d{11}$/.test(r); }

app.get('/api/verify-token', (req, res) => {
  if (req.query.token === ACCESS_TOKEN) res.json({valid:true});
  else res.status(403).json({valid:false, error:'Token invalide'});
});

function verifierToken(req, res, next) {
  const token = req.query.token || req.body.token || req.headers['x-access-token'];
  if (token === ACCESS_TOKEN) next();
  else res.status(403).json({error:'Accès non autorisé'});
}

// ========== ROUTES API ==========

app.get('/api/dates-disponibles', verifierToken, async (req, res) => {
  try {
    const insc = await pool.query('SELECT date_garde, COUNT(*) as nb FROM inscriptions GROUP BY date_garde');
    const map = {}; insc.rows.forEach(r => { map[r.date_garde.toISOString().split('T')[0]] = parseInt(r.nb); });
    const dates = await pool.query('SELECT date, type, nom_jour_ferie FROM dates_garde WHERE active=true AND date>=CURRENT_DATE ORDER BY date ASC');
    const result = dates.rows.map(r => {
      const ds = r.date.toISOString().split('T')[0];
      let label = formatDateFr(new Date(r.date));
      if (r.type==='jour_ferie' && r.nom_jour_ferie) label += ` (${r.nom_jour_ferie})`;
      const nb = map[ds]||0;
      return { label, value:ds, nb_inscrits:nb, places_restantes:2-nb };
    }).filter(d => d.places_restantes > 0);
    res.json(result);
  } catch(e) { console.error('Erreur:', e); res.status(500).json({error:'Erreur serveur'}); }
});

app.get('/api/dates/:date/statut', async (req, res) => {
  try {
    const r = await pool.query('SELECT COUNT(*) as nb FROM inscriptions WHERE date_garde=$1', [req.params.date]);
    const nb = parseInt(r.rows[0].nb);
    res.json({date:req.params.date, nb_inscrits:nb, places_restantes:2-nb, disponible:nb<2});
  } catch(e) { res.status(500).json({error:'Erreur serveur'}); }
});

app.get('/api/dates/:date/praticiens', async (req, res) => {
  try {
    const r = await pool.query('SELECT praticien_nom, praticien_prenom, praticien_email FROM inscriptions WHERE date_garde=$1', [req.params.date]);
    res.json(r.rows);
  } catch(e) { res.status(500).json({error:'Erreur serveur'}); }
});

app.post('/api/inscriptions', verifierToken, async (req, res) => {
  const { dateGarde, praticien } = req.body;
  if (!praticien||!praticien.email||!praticien.nom||!praticien.prenom) return res.status(400).json({error:'Informations incomplètes'});
  if (!validerEmail(praticien.email)) return res.status(400).json({error:'Adresse email invalide'});
  if (!validerTelephone(praticien.telephone)) return res.status(400).json({error:'Téléphone invalide (format: 0X XX XX XX XX)'});
  if (!validerRPPS(praticien.rpps)) return res.status(400).json({error:'RPPS invalide (11 chiffres requis)'});
  try {
    const check = await pool.query('SELECT COUNT(*) as nb FROM inscriptions WHERE date_garde=$1', [dateGarde]);
    const nbInscrits = parseInt(check.rows[0].nb);
    if (nbInscrits >= 2) return res.status(400).json({error:'Date complète (2 praticiens inscrits)'});
    const dup = await pool.query('SELECT * FROM inscriptions WHERE date_garde=$1 AND praticien_email=$2', [dateGarde, praticien.email]);
    if (dup.rows.length > 0) return res.status(400).json({error:'Vous êtes déjà inscrit pour cette date'});
    const result = await pool.query(`INSERT INTO inscriptions (date_garde, praticien_nom, praticien_prenom, praticien_email, praticien_telephone, praticien_rpps, praticien_numero, praticien_voie, praticien_code_postal, praticien_ville, praticien_etage, praticien_code_entree) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [dateGarde, praticien.nom, praticien.prenom, praticien.email, praticien.telephone, praticien.rpps, praticien.numero, praticien.voie, praticien.codePostal, praticien.ville, praticien.etage, praticien.codeEntree]);
    const nouv = result.rows[0];
    const estPremier = nbInscrits===0, estComplet = nbInscrits===1;
    let binome = null;
    if (estComplet) { const br = await pool.query('SELECT * FROM inscriptions WHERE date_garde=$1 AND id!=$2', [dateGarde, nouv.id]); binome = br.rows[0]; }
    try { await envoyerEmailsConfirmation(nouv, binome, estPremier, estComplet); } catch(e) { console.error('Email non bloquant:', e.message); }
    res.json({ success:true, inscription:nouv, statut:estComplet?'complete':'partielle', message:estComplet?'Garde complète avec 2 praticiens.':'Inscription enregistrée.' });
  } catch(e) { console.error('Erreur:', e); res.status(500).json({error:"Erreur lors de l'inscription"}); }
});

app.get('/api/inscriptions', async (req, res) => {
  try { const r = await pool.query('SELECT i.*, (SELECT COUNT(*) FROM inscriptions i2 WHERE i2.date_garde=i.date_garde) as nb_praticiens_total FROM inscriptions i ORDER BY date_garde DESC, created_at ASC'); res.json(r.rows); }
  catch(e) { res.status(500).json({error:'Erreur serveur'}); }
});

app.delete('/api/inscriptions/:id', async (req, res) => {
  try { await pool.query('DELETE FROM inscriptions WHERE id=$1', [req.params.id]); res.json({success:true}); }
  catch(e) { res.status(500).json({error:'Erreur serveur'}); }
});

app.post('/api/inscriptions/:id/renvoyer-email', async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM inscriptions WHERE id=$1', [req.params.id]);
    if (r.rows.length===0) return res.status(404).json({error:'Non trouvée'});
    const insc = r.rows[0];
    const cnt = await pool.query('SELECT COUNT(*) as nb FROM inscriptions WHERE date_garde=$1 AND id<$2', [insc.date_garde, insc.id]);
    const estPremier = parseInt(cnt.rows[0].nb)===0;
    const br = await pool.query('SELECT * FROM inscriptions WHERE date_garde=$1 AND id!=$2', [insc.date_garde, insc.id]);
    const binome = br.rows.length>0 ? br.rows[0] : null;
    const dateF = formatDateFr(new Date(insc.date_garde));
    const html = genererHtmlEmail(insc, dateF);
    const pInfo = {nom:insc.praticien_nom, prenom:insc.praticien_prenom, dateGarde:dateF};
    const ok = await envoyerEmailViaAPI(insc.praticien_email, `[RENVOI] Confirmation garde - ${dateF}`, html, pInfo);
    await pool.query('UPDATE inscriptions SET email_confirmation_envoi_at=NOW(), email_confirmation_statut=$1 WHERE id=$2', [ok?'envoye':'erreur', insc.id]);
    if (ok) res.json({success:true, message:'Email renvoyé'}); else res.status(500).json({error:"Erreur envoi"});
  } catch(e) { console.error('Erreur:', e); res.status(500).json({error:"Erreur envoi"}); }
});

// ========== ROUTES RAPPELS INDIVIDUELS ==========

// Envoyer un rappel J-7 pour une inscription spécifique
app.post('/api/inscriptions/:id/envoyer-rappel-j7', async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM inscriptions WHERE id=$1', [req.params.id]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Inscription non trouvée' });
    const insc = r.rows[0];
    const dateF = formatDateFr(new Date(insc.date_garde));
    const html = genererHtmlEmailRappel(insc, dateF, 7);
    const ok = await envoyerEmailRappelViaAPI(insc.praticien_email, `🟡 Rappel garde dans 7 jours - ${dateF}`, html);
    await pool.query('UPDATE inscriptions SET email_rappel_j7_envoi_at=NOW(), email_rappel_j7_statut=$1 WHERE id=$2', [ok ? 'envoye' : 'erreur', insc.id]);
    if (ok) {
      console.log(`✅ Rappel J-7 manuel envoyé à Dr ${insc.praticien_nom} pour ${dateF}`);
      res.json({ success: true, message: `Rappel J-7 envoyé à Dr ${insc.praticien_nom}` });
    } else {
      res.status(500).json({ error: "Erreur lors de l'envoi du rappel J-7" });
    }
  } catch (e) { console.error('Erreur rappel J-7:', e); res.status(500).json({ error: "Erreur serveur" }); }
});

// Envoyer un rappel J-1 pour une inscription spécifique
app.post('/api/inscriptions/:id/envoyer-rappel-j1', async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM inscriptions WHERE id=$1', [req.params.id]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Inscription non trouvée' });
    const insc = r.rows[0];
    const dateF = formatDateFr(new Date(insc.date_garde));
    const html = genererHtmlEmailRappel(insc, dateF, 1);
    const ok = await envoyerEmailRappelViaAPI(insc.praticien_email, `🔴 Rappel garde DEMAIN - ${dateF}`, html);
    await pool.query('UPDATE inscriptions SET email_rappel_j1_envoi_at=NOW(), email_rappel_j1_statut=$1 WHERE id=$2', [ok ? 'envoye' : 'erreur', insc.id]);
    if (ok) {
      console.log(`✅ Rappel J-1 manuel envoyé à Dr ${insc.praticien_nom} pour ${dateF}`);
      res.json({ success: true, message: `Rappel J-1 envoyé à Dr ${insc.praticien_nom}` });
    } else {
      res.status(500).json({ error: "Erreur lors de l'envoi du rappel J-1" });
    }
  } catch (e) { console.error('Erreur rappel J-1:', e); res.status(500).json({ error: "Erreur serveur" }); }
});

// ========== STATS & DATES ==========

app.get('/api/stats', async (req, res) => {
  try {
    const r = await pool.query(`SELECT COUNT(DISTINCT date_garde) as dates_avec_inscriptions, COUNT(*) as total_inscriptions, COUNT(DISTINCT date_garde) FILTER (WHERE date_garde>=CURRENT_DATE AND (SELECT COUNT(*) FROM inscriptions i2 WHERE i2.date_garde=inscriptions.date_garde)=2) as gardes_futures_completes, COUNT(DISTINCT date_garde) FILTER (WHERE date_garde>=CURRENT_DATE AND (SELECT COUNT(*) FROM inscriptions i2 WHERE i2.date_garde=inscriptions.date_garde)=1) as gardes_futures_partielles FROM inscriptions`);
    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({error:'Erreur serveur'}); }
});

app.get('/api/dates-garde', async (req, res) => {
  try { const r = await pool.query('SELECT d.*, COUNT(i.id) as nb_inscriptions FROM dates_garde d LEFT JOIN inscriptions i ON d.date=i.date_garde GROUP BY d.id,d.date,d.type,d.nom_jour_ferie,d.active,d.created_at ORDER BY d.date ASC'); res.json(r.rows); }
  catch(e) { res.status(500).json({error:'Erreur serveur'}); }
});

app.post('/api/dates-garde', async (req, res) => {
  try { const r = await pool.query('INSERT INTO dates_garde (date,type,nom_jour_ferie,active) VALUES ($1,$2,$3,true) RETURNING *', [req.body.date, req.body.type, req.body.nom_jour_ferie||null]); res.json({success:true, date:r.rows[0]}); }
  catch(e) { if(e.code==='23505') res.status(400).json({error:'Date existe déjà'}); else res.status(500).json({error:'Erreur'}); }
});

app.put('/api/dates-garde/:id', async (req, res) => {
  try { const r = await pool.query('UPDATE dates_garde SET active=COALESCE($1,active), nom_jour_ferie=COALESCE($2,nom_jour_ferie) WHERE id=$3 RETURNING *', [req.body.active, req.body.nom_jour_ferie, req.params.id]); if(r.rows.length===0) return res.status(404).json({error:'Non trouvée'}); res.json({success:true, date:r.rows[0]}); }
  catch(e) { res.status(500).json({error:'Erreur'}); }
});

app.delete('/api/dates-garde/:id', async (req, res) => {
  try {
    const dc = await pool.query('SELECT date FROM dates_garde WHERE id=$1', [req.params.id]);
    if(dc.rows.length===0) return res.status(404).json({error:'Non trouvée'});
    const ic = await pool.query('SELECT COUNT(*) as nb FROM inscriptions WHERE date_garde=$1', [dc.rows[0].date]);
    if(parseInt(ic.rows[0].nb)>0) return res.status(400).json({error:'Des inscriptions existent'});
    await pool.query('DELETE FROM dates_garde WHERE id=$1', [req.params.id]); res.json({success:true});
  } catch(e) { res.status(500).json({error:'Erreur'}); }
});

// Route admin : déclencher TOUS les rappels manuellement (ceux qui sont dus)
app.post('/api/rappels/envoyer', async (req, res) => {
  try { const result = await envoyerRappels(); res.json({success:true, message:'Rappels vérifiés et envoyés', detail: result}); }
  catch(e) { res.status(500).json({error:'Erreur rappels'}); }
});

// ========== FONCTIONS UTILITAIRES ==========
function formatDateFr(date) {
  const j = ['dimanche','lundi','mardi','mercredi','jeudi','vendredi','samedi'];
  const m = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];
  return `${j[date.getDay()]} ${date.getDate()} ${m[date.getMonth()]} ${date.getFullYear()}`;
}

async function envoyerEmailsConfirmation(inscription, binome, estPremier, estComplet) {
  const dateF = formatDateFr(new Date(inscription.date_garde));
  const html = genererHtmlEmail(inscription, dateF);
  const pInfo = {nom:inscription.praticien_nom, prenom:inscription.praticien_prenom, dateGarde:dateF};
  try {
    const ok = await envoyerEmailViaAPI(inscription.praticien_email, `Confirmation inscription garde - ${dateF}`, html, pInfo);
    await pool.query('UPDATE inscriptions SET email_confirmation_envoi_at=NOW(), email_confirmation_statut=$1 WHERE id=$2', [ok?'envoye':'erreur', inscription.id]);
    if (!ok) throw new Error('Échec envoi');
  } catch(e) { await pool.query('UPDATE inscriptions SET email_confirmation_statut=$1 WHERE id=$2', ['erreur', inscription.id]); throw e; }
  if (estComplet && binome) {
    const htmlB = genererHtmlEmailGardeComplete(binome, inscription, dateF);
    const pInfoB = {nom:binome.praticien_nom, prenom:binome.praticien_prenom, dateGarde:dateF};
    try {
      const ok = await envoyerEmailViaAPI(binome.praticien_email, `Garde complète - ${dateF}`, htmlB, pInfoB);
      await pool.query('UPDATE inscriptions SET email_binome_envoi_at=NOW(), email_binome_statut=$1 WHERE id=$2', [ok?'envoye':'erreur', binome.id]);
    } catch(e) { await pool.query('UPDATE inscriptions SET email_binome_statut=$1 WHERE id=$2', ['erreur', binome.id]); }
  }
}

function genererHtmlEmail(inscription, dateFormatee) {
  const p = {nom:inscription.praticien_nom, prenom:inscription.praticien_prenom, email:inscription.praticien_email, tel:inscription.praticien_telephone, adresse:`${inscription.praticien_numero} ${inscription.praticien_voie}, ${inscription.praticien_code_postal} ${inscription.praticien_ville}`};
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="font-family:Arial,sans-serif;line-height:1.6;color:#333"><div style="max-width:600px;margin:0 auto;padding:20px"><div style="background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);color:white;padding:30px;text-align:center;border-radius:10px 10px 0 0"><h1 style="margin:0;font-size:24px">✓ Inscription confirmée</h1><p style="margin:10px 0 0 0;font-size:18px">Garde du ${dateFormatee}</p></div><div style="background:#f9f9f9;padding:30px;border-radius:0 0 10px 10px"><p>Bonjour Dr ${p.nom},</p><p>Votre inscription à la garde du <strong style="color:#667eea">${dateFormatee}</strong> a bien été enregistrée.</p><div style="background:white;padding:20px;margin:20px 0;border-left:4px solid #667eea;border-radius:5px"><h2 style="color:#667eea;font-size:18px;margin-top:0">📋 Vos informations</h2><p><strong>Nom :</strong> ${p.nom} ${p.prenom}</p><p><strong>Email :</strong> ${p.email}</p><p><strong>Tél :</strong> ${p.tel}</p><p><strong>Adresse :</strong> ${p.adresse}</p></div><div style="background:#f0fdf4;padding:20px;margin:20px 0;border-left:4px solid #16a34a;border-radius:5px"><h2 style="color:#16a34a;font-size:18px;margin-top:0">📎 Documents joints</h2><p>Pièces jointes : Fiche de retour, Document praticien (personnalisé), Cadre réglementaire, Attestation de participation.</p></div><p>Contact : <a href="mailto:${ADMIN_EMAIL}">${ADMIN_EMAIL}</a></p></div><div style="text-align:center;margin-top:30px;color:#666;font-size:12px"><p>CDO 94 - Conseil Départemental de l'Ordre des Chirurgiens-Dentistes du Val-de-Marne</p></div></div></body></html>`;
}

function genererHtmlEmailGardeComplete(binome, nouveauPraticien, dateFormatee) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="font-family:Arial,sans-serif;line-height:1.6;color:#333"><div style="max-width:600px;margin:0 auto;padding:20px"><div style="background:linear-gradient(135deg,#10b981 0%,#059669 100%);color:white;padding:30px;text-align:center;border-radius:10px 10px 0 0"><h1 style="margin:0;font-size:24px">🎉 Garde complète !</h1><p style="margin:10px 0 0 0;font-size:18px">Garde du ${dateFormatee}</p></div><div style="background:#f9f9f9;padding:30px;border-radius:0 0 10px 10px"><p>Bonjour Dr ${binome.praticien_nom},</p><p>Un second praticien s'est inscrit pour la garde du <strong style="color:#10b981">${dateFormatee}</strong>.</p><p>La garde est <strong style="color:#10b981">complète avec 2 praticiens</strong>.</p><div style="background:white;padding:20px;margin:20px 0;border-left:4px solid #10b981;border-radius:5px"><h2 style="color:#10b981;font-size:18px;margin-top:0">👥 Votre binôme</h2><p><strong>Nom :</strong> ${nouveauPraticien.praticien_nom} ${nouveauPraticien.praticien_prenom}</p><p><strong>Email :</strong> ${nouveauPraticien.praticien_email}</p><p><strong>Tél :</strong> ${nouveauPraticien.praticien_telephone}</p><p><strong>Adresse :</strong> ${nouveauPraticien.praticien_numero} ${nouveauPraticien.praticien_voie}, ${nouveauPraticien.praticien_code_postal} ${nouveauPraticien.praticien_ville}</p></div><p>Contact : <a href="mailto:${ADMIN_EMAIL}">${ADMIN_EMAIL}</a></p></div><div style="text-align:center;margin-top:30px;color:#666;font-size:12px"><p>CDO 94 - Conseil Départemental de l'Ordre des Chirurgiens-Dentistes du Val-de-Marne</p></div></div></body></html>`;
}

function genererHtmlEmailRappel(inscription, dateFormatee, joursAvant) {
  const p = {nom:inscription.praticien_nom, prenom:inscription.praticien_prenom, tel:inscription.praticien_telephone, adresse:`${inscription.praticien_numero} ${inscription.praticien_voie}, ${inscription.praticien_code_postal} ${inscription.praticien_ville}`};
  const urgence = joursAvant === 1 ? 'demain' : 'dans 7 jours';
  const couleur = joursAvant === 1 ? '#dc2626' : '#f59e0b';
  const couleurFonce = joursAvant === 1 ? '#b91c1c' : '#d97706';
  const emoji = joursAvant === 1 ? '🔴' : '🟡';
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="font-family:Arial,sans-serif;line-height:1.6;color:#333"><div style="max-width:600px;margin:0 auto;padding:20px"><div style="background:linear-gradient(135deg,${couleur} 0%,${couleurFonce} 100%);color:white;padding:30px;text-align:center;border-radius:10px 10px 0 0"><h1 style="margin:0;font-size:24px">${emoji} Rappel : garde ${urgence}</h1><p style="margin:10px 0 0 0;font-size:18px">${dateFormatee}</p></div><div style="background:#f9f9f9;padding:30px;border-radius:0 0 10px 10px"><p>Bonjour Dr ${p.nom},</p><p>Nous vous rappelons que vous êtes inscrit(e) à la garde du <strong style="color:${couleur}">${dateFormatee}</strong> (${urgence}).</p><div style="background:white;padding:20px;margin:20px 0;border-left:4px solid ${couleur};border-radius:5px"><h2 style="color:${couleur};font-size:18px;margin-top:0">📋 Rappel de vos informations</h2><p><strong>Tél :</strong> ${p.tel}</p><p><strong>Cabinet :</strong> ${p.adresse}</p></div><p>En cas d'empêchement, contactez-nous <strong>au plus vite</strong> à <a href="mailto:${ADMIN_EMAIL}">${ADMIN_EMAIL}</a></p></div><div style="text-align:center;margin-top:30px;color:#666;font-size:12px"><p>CDO 94 - Conseil Départemental de l'Ordre des Chirurgiens-Dentistes du Val-de-Marne</p></div></div></body></html>`;
}

async function envoyerRappels() {
  console.log('⏰ Vérification des rappels à envoyer...');
  let nbJ7 = 0, nbJ1 = 0;
  try {
    // Rappels J-7
    const j7 = await pool.query(`SELECT * FROM inscriptions WHERE date_garde = CURRENT_DATE + INTERVAL '7 days' AND (email_rappel_j7_statut IS NULL OR email_rappel_j7_statut = 'non_envoye')`);
    for (const insc of j7.rows) {
      const dateF = formatDateFr(new Date(insc.date_garde));
      const html = genererHtmlEmailRappel(insc, dateF, 7);
      const ok = await envoyerEmailRappelViaAPI(insc.praticien_email, `🟡 Rappel garde dans 7 jours - ${dateF}`, html);
      await pool.query('UPDATE inscriptions SET email_rappel_j7_envoi_at=NOW(), email_rappel_j7_statut=$1 WHERE id=$2', [ok?'envoye':'erreur', insc.id]);
      console.log(`${ok?'✅':'❌'} Rappel J-7 ${insc.praticien_nom} pour ${dateF}`);
      if (ok) nbJ7++;
    }
    // Rappels J-1
    const j1 = await pool.query(`SELECT * FROM inscriptions WHERE date_garde = CURRENT_DATE + INTERVAL '1 day' AND (email_rappel_j1_statut IS NULL OR email_rappel_j1_statut = 'non_envoye')`);
    for (const insc of j1.rows) {
      const dateF = formatDateFr(new Date(insc.date_garde));
      const html = genererHtmlEmailRappel(insc, dateF, 1);
      const ok = await envoyerEmailRappelViaAPI(insc.praticien_email, `🔴 Rappel garde DEMAIN - ${dateF}`, html);
      await pool.query('UPDATE inscriptions SET email_rappel_j1_envoi_at=NOW(), email_rappel_j1_statut=$1 WHERE id=$2', [ok?'envoye':'erreur', insc.id]);
      console.log(`${ok?'✅':'❌'} Rappel J-1 ${insc.praticien_nom} pour ${dateF}`);
      if (ok) nbJ1++;
    }
    console.log(`⏰ Rappels terminés : ${j7.rows.length} J-7 (${nbJ7} envoyés), ${j1.rows.length} J-1 (${nbJ1} envoyés)`);
    return { j7_traites: j7.rows.length, j7_envoyes: nbJ7, j1_traites: j1.rows.length, j1_envoyes: nbJ1 };
  } catch(e) { console.error('❌ Erreur rappels:', e); throw e; }
}

// Cron : tous les jours à 8h00 (heure serveur UTC, donc 9h heure Paris)
cron.schedule('0 8 * * *', () => { console.log('⏰ Cron rappels déclenché'); envoyerRappels(); });
// Rattrapage au démarrage (10s après boot)
setTimeout(() => { envoyerRappels(); }, 10000);

app.listen(PORT, () => { console.log(`🚀 Serveur démarré sur http://localhost:${PORT}`); });
