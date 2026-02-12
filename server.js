require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
const AdmZip = require('adm-zip');
const cron = require('node-cron');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 10000;

// ========== BASE DE DONNÉES ==========
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// ========== SUPABASE STORAGE ==========
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const BUCKET_NAME = 'documents-garde';
let supabase = null;

if (SUPABASE_URL && SUPABASE_SERVICE_KEY) {
  supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  console.log('✅ Supabase Storage configuré');
} else {
  console.log('⚠️ Supabase non configuré (variables SUPABASE_URL / SUPABASE_SERVICE_KEY manquantes)');
}

// ========== MULTER (upload fichiers en mémoire) ==========
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB max
  fileFilter: (req, file, cb) => {
    const ok = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/msword'
    ];
    if (ok.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Type non autorisé. Seuls PDF et DOCX sont acceptés.'));
  }
});

// ========== CONFIG EMAIL ==========
const BREVO_API_KEY = process.env.BREVO_API_KEY;
const EMAIL_FROM = process.env.EMAIL_FROM || 'doc.cdo94@gmail.com';
const EMAIL_FROM_NAME = process.env.EMAIL_FROM_NAME || 'CDO 94 - Gardes Médicales';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'doc.cdo94@gmail.com';
const ACCESS_TOKEN = process.env.ACCESS_TOKEN || 'garde2027cdo94';

// ========== INIT DB ==========
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
      ALTER TABLE inscriptions ADD COLUMN IF NOT EXISTS email_rappel_j7_envoi_at TIMESTAMP;
      ALTER TABLE inscriptions ADD COLUMN IF NOT EXISTS email_rappel_j7_statut VARCHAR(20) DEFAULT 'non_envoye';
      ALTER TABLE inscriptions ADD COLUMN IF NOT EXISTS email_rappel_j1_envoi_at TIMESTAMP;
      ALTER TABLE inscriptions ADD COLUMN IF NOT EXISTS email_rappel_j1_statut VARCHAR(20) DEFAULT 'non_envoye';
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
    // Table métadonnées des documents (Supabase Storage)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS documents_garde (
        id SERIAL PRIMARY KEY,
        nom_original VARCHAR(255) NOT NULL,
        nom_email VARCHAR(255) NOT NULL,
        supabase_path VARCHAR(500) NOT NULL,
        taille INTEGER DEFAULT 0,
        type_mime VARCHAR(100),
        est_template_docx BOOLEAN DEFAULT false,
        actif BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ Tables vérifiées/créées');

    // Créer le bucket Supabase si nécessaire
    if (supabase) {
      try {
        const { data: buckets } = await supabase.storage.listBuckets();
        const existe = buckets && buckets.some(b => b.name === BUCKET_NAME);
        if (!existe) {
          const { error } = await supabase.storage.createBucket(BUCKET_NAME, { public: false });
          if (error && !error.message.includes('already exists')) console.error('❌ Bucket:', error.message);
          else console.log(`✅ Bucket "${BUCKET_NAME}" créé`);
        } else {
          console.log(`✅ Bucket "${BUCKET_NAME}" OK`);
        }
      } catch (e) { console.error('⚠️ Vérif bucket:', e.message); }
    }
  } catch (err) { console.error('Erreur init DB:', err); }
})();

// ========== FALLBACK : DOCUMENTS LOCAUX ==========
const DOCUMENTS_DIR = path.join(__dirname, 'Documents');
const DOCUMENTS_GARDE_LOCAL = [
  { fichier: 'fiche retour .pdf', nomEmail: 'Fiche-retour-indemnites.pdf' },
  { fichier: 'Cadre-reglementaire v2 à valider.pdf', nomEmail: 'Cadre-reglementaire.pdf' },
  { fichier: 'attestation de participation.pdf', nomEmail: 'Attestation-participation.pdf' }
];
const DOCX_TEMPLATE_LOCAL = { fichier: 'doc prat de garde.docx', nomEmail: 'Document-praticien-de-garde.docx' };
let DOCUMENTS_STATIQUES_LOCAL = [];
let DOCX_TEMPLATE_BUFFER_LOCAL = null;

function chargerDocumentsLocaux() {
  DOCUMENTS_STATIQUES_LOCAL = []; DOCX_TEMPLATE_BUFFER_LOCAL = null;
  if (!fs.existsSync(DOCUMENTS_DIR)) { console.log('📂 Dossier Documents/ absent (normal si Supabase actif)'); return; }
  const fichiers = fs.readdirSync(DOCUMENTS_DIR);
  function trouver(nom) {
    let f = fichiers.find(f => f.normalize('NFC') === nom.normalize('NFC'));
    if (!f) f = fichiers.find(f => f.normalize('NFD') === nom.normalize('NFD'));
    if (!f) { const n = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase(); f = fichiers.find(fi => n(fi) === n(nom)); }
    return f;
  }
  for (const doc of DOCUMENTS_GARDE_LOCAL) {
    try {
      const ft = trouver(doc.fichier);
      if (ft) { const c = fs.readFileSync(path.join(DOCUMENTS_DIR, ft)); DOCUMENTS_STATIQUES_LOCAL.push({name:doc.nomEmail, content:c.toString('base64')}); }
    } catch(e) { /* silencieux */ }
  }
  try {
    const ft = trouver(DOCX_TEMPLATE_LOCAL.fichier);
    if (ft) DOCX_TEMPLATE_BUFFER_LOCAL = fs.readFileSync(path.join(DOCUMENTS_DIR, ft));
  } catch(e) { /* silencieux */ }
  console.log(`📎 ${DOCUMENTS_STATIQUES_LOCAL.length + (DOCX_TEMPLATE_BUFFER_LOCAL?1:0)} documents locaux (fallback)`);
}
chargerDocumentsLocaux();

// ========== CHARGEMENT DOCUMENTS DEPUIS SUPABASE ==========

async function chargerPiecesJointes() {
  // Tente de charger depuis Supabase, sinon fallback local
  if (!supabase) return { statiques: DOCUMENTS_STATIQUES_LOCAL, templateBuffer: DOCX_TEMPLATE_BUFFER_LOCAL };

  try {
    const docs = await pool.query('SELECT * FROM documents_garde WHERE actif = true ORDER BY est_template_docx ASC, nom_email ASC');
    if (docs.rows.length === 0) {
      console.log('⚠️ Aucun document en Supabase → fallback local');
      return { statiques: DOCUMENTS_STATIQUES_LOCAL, templateBuffer: DOCX_TEMPLATE_BUFFER_LOCAL };
    }

    const statiques = [];
    let templateBuffer = null;

    for (const doc of docs.rows) {
      try {
        const { data, error } = await supabase.storage.from(BUCKET_NAME).download(doc.supabase_path);
        if (error) { console.error(`❌ DL "${doc.nom_email}":`, error.message); continue; }
        const buffer = Buffer.from(await data.arrayBuffer());
        if (doc.est_template_docx) {
          templateBuffer = buffer;
        } else {
          statiques.push({ name: doc.nom_email, content: buffer.toString('base64') });
        }
      } catch (e) { console.error(`❌ Doc "${doc.nom_email}":`, e.message); }
    }

    // Fallback template local si absent en Supabase
    if (!templateBuffer && DOCX_TEMPLATE_BUFFER_LOCAL) templateBuffer = DOCX_TEMPLATE_BUFFER_LOCAL;

    console.log(`📎 Supabase : ${statiques.length} docs + ${templateBuffer ? 1 : 0} template`);
    return { statiques, templateBuffer };
  } catch (e) {
    console.error('❌ Supabase erreur → fallback local:', e.message);
    return { statiques: DOCUMENTS_STATIQUES_LOCAL, templateBuffer: DOCX_TEMPLATE_BUFFER_LOCAL };
  }
}

function genererDocxPersonnalise(templateBuffer, nom, prenom, dateGarde) {
  if (!templateBuffer) { console.error('⚠️ Template docx indisponible'); return null; }
  try {
    const zip = new AdmZip(templateBuffer);
    const xml = zip.readAsText('word/document.xml');
    const xmlMod = xml.replace(/\{\{NOM_PRATICIEN\}\}/g, `${prenom} ${nom}`).replace(/\{\{DATE_GARDE\}\}/g, dateGarde);
    zip.updateFile('word/document.xml', Buffer.from(xmlMod, 'utf-8'));
    return { name: 'Document-praticien-de-garde.docx', content: zip.toBuffer().toString('base64') };
  } catch(e) { console.error('❌ Docx:', e.message); return null; }
}

// ========== ENVOI EMAILS ==========

async function envoyerEmailViaAPI(to, subject, html, praticienInfo = null) {
  if (!BREVO_API_KEY) { console.log('BREVO_API_KEY manquant'); return false; }
  try {
    const { statiques, templateBuffer } = await chargerPiecesJointes();
    const emailData = { sender:{name:EMAIL_FROM_NAME,email:EMAIL_FROM}, to:[{email:to}], cc:[{email:ADMIN_EMAIL}], subject, htmlContent:html };
    const attachments = [...statiques];
    if (praticienInfo) {
      const d = genererDocxPersonnalise(templateBuffer, praticienInfo.nom, praticienInfo.prenom, praticienInfo.dateGarde);
      if (d) attachments.push(d);
    }
    if (attachments.length > 0) emailData.attachment = attachments;
    const response = await fetch('https://api.brevo.com/v3/smtp/email', { method:'POST', headers:{'Content-Type':'application/json','api-key':BREVO_API_KEY}, body:JSON.stringify(emailData) });
    if (response.ok) { const r = await response.json(); console.log(`✅ Email → ${to} (${attachments.length} PJ) ${r.messageId}`); return true; }
    else { console.error('❌ Brevo:', response.status, await response.text()); return false; }
  } catch(e) { console.error('❌ Email:', e); return false; }
}

async function envoyerEmailRappelViaAPI(to, subject, html) {
  if (!BREVO_API_KEY) { console.log('BREVO_API_KEY manquant'); return false; }
  try {
    const emailData = { sender:{name:EMAIL_FROM_NAME,email:EMAIL_FROM}, to:[{email:to}], cc:[{email:ADMIN_EMAIL}], subject, htmlContent:html };
    const response = await fetch('https://api.brevo.com/v3/smtp/email', { method:'POST', headers:{'Content-Type':'application/json','api-key':BREVO_API_KEY}, body:JSON.stringify(emailData) });
    if (response.ok) { const r = await response.json(); console.log(`✅ Rappel → ${to} ${r.messageId}`); return true; }
    else { console.error('❌ Brevo:', response.status, await response.text()); return false; }
  } catch(e) { console.error('❌ Rappel:', e); return false; }
}

// ========== MIDDLEWARE ==========
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

// ========== ROUTES INSCRIPTIONS ==========

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
  } catch(e) { res.status(500).json({error:'Erreur serveur'}); }
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
    const dateF = formatDateFr(new Date(insc.date_garde));
    const html = genererHtmlEmail(insc, dateF);
    const pInfo = {nom:insc.praticien_nom, prenom:insc.praticien_prenom, dateGarde:dateF};
    const ok = await envoyerEmailViaAPI(insc.praticien_email, `[RENVOI] Confirmation garde - ${dateF}`, html, pInfo);
    await pool.query('UPDATE inscriptions SET email_confirmation_envoi_at=NOW(), email_confirmation_statut=$1 WHERE id=$2', [ok?'envoye':'erreur', insc.id]);
    if (ok) res.json({success:true, message:'Email renvoyé'}); else res.status(500).json({error:"Erreur envoi"});
  } catch(e) { res.status(500).json({error:"Erreur envoi"}); }
});

// ========== ROUTES RAPPELS ==========

app.post('/api/inscriptions/:id/envoyer-rappel-j7', async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM inscriptions WHERE id=$1', [req.params.id]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Non trouvée' });
    const insc = r.rows[0];
    const dateF = formatDateFr(new Date(insc.date_garde));
    const html = genererHtmlEmailRappel(insc, dateF, 7);
    const ok = await envoyerEmailRappelViaAPI(insc.praticien_email, `🟡 Rappel garde dans 7 jours - ${dateF}`, html);
    await pool.query('UPDATE inscriptions SET email_rappel_j7_envoi_at=NOW(), email_rappel_j7_statut=$1 WHERE id=$2', [ok ? 'envoye' : 'erreur', insc.id]);
    if (ok) res.json({ success: true, message: `Rappel J-7 envoyé à Dr ${insc.praticien_nom}` });
    else res.status(500).json({ error: "Erreur envoi rappel J-7" });
  } catch (e) { res.status(500).json({ error: "Erreur serveur" }); }
});

app.post('/api/inscriptions/:id/envoyer-rappel-j1', async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM inscriptions WHERE id=$1', [req.params.id]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Non trouvée' });
    const insc = r.rows[0];
    const dateF = formatDateFr(new Date(insc.date_garde));
    const html = genererHtmlEmailRappel(insc, dateF, 1);
    const ok = await envoyerEmailRappelViaAPI(insc.praticien_email, `🔴 Rappel garde DEMAIN - ${dateF}`, html);
    await pool.query('UPDATE inscriptions SET email_rappel_j1_envoi_at=NOW(), email_rappel_j1_statut=$1 WHERE id=$2', [ok ? 'envoye' : 'erreur', insc.id]);
    if (ok) res.json({ success: true, message: `Rappel J-1 envoyé à Dr ${insc.praticien_nom}` });
    else res.status(500).json({ error: "Erreur envoi rappel J-1" });
  } catch (e) { res.status(500).json({ error: "Erreur serveur" }); }
});

app.post('/api/rappels/envoyer', async (req, res) => {
  try { const result = await envoyerRappels(); res.json({success:true, message:'Rappels vérifiés', detail: result}); }
  catch(e) { res.status(500).json({error:'Erreur rappels'}); }
});

// ========== ROUTES DOCUMENTS ==========

// Lister les documents
app.get('/api/documents', async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM documents_garde ORDER BY est_template_docx DESC, nom_email ASC');
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: 'Erreur serveur' }); }
});

// Uploader un document
app.post('/api/documents/upload', upload.single('fichier'), async (req, res) => {
  if (!supabase) return res.status(400).json({ error: 'Supabase Storage non configuré. Ajoutez SUPABASE_URL et SUPABASE_SERVICE_KEY.' });
  if (!req.file) return res.status(400).json({ error: 'Aucun fichier' });

  const nomEmail = req.body.nom_email || req.file.originalname;
  const estTemplate = req.body.est_template_docx === 'true';

  // Si template, supprimer l'ancien
  if (estTemplate) {
    try {
      const anciens = await pool.query('SELECT * FROM documents_garde WHERE est_template_docx = true');
      for (const a of anciens.rows) {
        await supabase.storage.from(BUCKET_NAME).remove([a.supabase_path]);
        await pool.query('DELETE FROM documents_garde WHERE id = $1', [a.id]);
        console.log(`🗑️ Ancien template supprimé: ${a.nom_email}`);
      }
    } catch (e) { console.error('⚠️ Suppression ancien template:', e.message); }
  }

  const supabasePath = `${Date.now()}-${req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`;

  try {
    const { error: upErr } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(supabasePath, req.file.buffer, { contentType: req.file.mimetype, upsert: false });
    if (upErr) return res.status(500).json({ error: 'Upload Supabase: ' + upErr.message });

    const r = await pool.query(
      `INSERT INTO documents_garde (nom_original, nom_email, supabase_path, taille, type_mime, est_template_docx)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [req.file.originalname, nomEmail, supabasePath, req.file.size, req.file.mimetype, estTemplate]
    );

    console.log(`✅ Upload: ${nomEmail} (${(req.file.size/1024).toFixed(1)} KB) ${estTemplate ? '[TEMPLATE]' : ''}`);
    res.json({ success: true, document: r.rows[0] });
  } catch (e) {
    try { await supabase.storage.from(BUCKET_NAME).remove([supabasePath]); } catch(ce) {}
    console.error('❌ Upload:', e);
    res.status(500).json({ error: "Erreur lors de l'upload" });
  }
});

// Supprimer un document
app.delete('/api/documents/:id', async (req, res) => {
  if (!supabase) return res.status(400).json({ error: 'Supabase non configuré' });
  try {
    const r = await pool.query('SELECT * FROM documents_garde WHERE id = $1', [req.params.id]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Non trouvé' });
    const doc = r.rows[0];
    await supabase.storage.from(BUCKET_NAME).remove([doc.supabase_path]);
    await pool.query('DELETE FROM documents_garde WHERE id = $1', [req.params.id]);
    console.log(`🗑️ Doc supprimé: ${doc.nom_email}`);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: 'Erreur suppression' }); }
});

// Modifier les métadonnées
app.put('/api/documents/:id', async (req, res) => {
  try {
    const { nom_email, est_template_docx, actif } = req.body;
    const r = await pool.query(
      `UPDATE documents_garde SET nom_email=COALESCE($1,nom_email), est_template_docx=COALESCE($2,est_template_docx), actif=COALESCE($3,actif), updated_at=NOW() WHERE id=$4 RETURNING *`,
      [nom_email, est_template_docx, actif, req.params.id]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Non trouvé' });
    res.json({ success: true, document: r.rows[0] });
  } catch (e) { res.status(500).json({ error: 'Erreur serveur' }); }
});

// ========== ROUTES STATS & DATES ==========

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
  const p = {nom:inscription.praticien_nom, tel:inscription.praticien_telephone, adresse:`${inscription.praticien_numero} ${inscription.praticien_voie}, ${inscription.praticien_code_postal} ${inscription.praticien_ville}`};
  const urgence = joursAvant === 1 ? 'demain' : 'dans 7 jours';
  const couleur = joursAvant === 1 ? '#dc2626' : '#f59e0b';
  const couleurFonce = joursAvant === 1 ? '#b91c1c' : '#d97706';
  const emoji = joursAvant === 1 ? '🔴' : '🟡';
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="font-family:Arial,sans-serif;line-height:1.6;color:#333"><div style="max-width:600px;margin:0 auto;padding:20px"><div style="background:linear-gradient(135deg,${couleur} 0%,${couleurFonce} 100%);color:white;padding:30px;text-align:center;border-radius:10px 10px 0 0"><h1 style="margin:0;font-size:24px">${emoji} Rappel : garde ${urgence}</h1><p style="margin:10px 0 0 0;font-size:18px">${dateFormatee}</p></div><div style="background:#f9f9f9;padding:30px;border-radius:0 0 10px 10px"><p>Bonjour Dr ${p.nom},</p><p>Nous vous rappelons que vous êtes inscrit(e) à la garde du <strong style="color:${couleur}">${dateFormatee}</strong> (${urgence}).</p><div style="background:white;padding:20px;margin:20px 0;border-left:4px solid ${couleur};border-radius:5px"><h2 style="color:${couleur};font-size:18px;margin-top:0">📋 Rappel de vos informations</h2><p><strong>Tél :</strong> ${p.tel}</p><p><strong>Cabinet :</strong> ${p.adresse}</p></div><p>En cas d'empêchement, contactez-nous <strong>au plus vite</strong> à <a href="mailto:${ADMIN_EMAIL}">${ADMIN_EMAIL}</a></p></div><div style="text-align:center;margin-top:30px;color:#666;font-size:12px"><p>CDO 94 - Conseil Départemental de l'Ordre des Chirurgiens-Dentistes du Val-de-Marne</p></div></div></body></html>`;
}

async function envoyerRappels() {
  console.log('⏰ Vérification rappels...');
  let nbJ7 = 0, nbJ1 = 0;
  try {
    const j7 = await pool.query(`SELECT * FROM inscriptions WHERE date_garde = CURRENT_DATE + INTERVAL '7 days' AND (email_rappel_j7_statut IS NULL OR email_rappel_j7_statut = 'non_envoye')`);
    for (const insc of j7.rows) {
      const dateF = formatDateFr(new Date(insc.date_garde));
      const html = genererHtmlEmailRappel(insc, dateF, 7);
      const ok = await envoyerEmailRappelViaAPI(insc.praticien_email, `🟡 Rappel garde dans 7 jours - ${dateF}`, html);
      await pool.query('UPDATE inscriptions SET email_rappel_j7_envoi_at=NOW(), email_rappel_j7_statut=$1 WHERE id=$2', [ok?'envoye':'erreur', insc.id]);
      if (ok) nbJ7++;
    }
    const j1 = await pool.query(`SELECT * FROM inscriptions WHERE date_garde = CURRENT_DATE + INTERVAL '1 day' AND (email_rappel_j1_statut IS NULL OR email_rappel_j1_statut = 'non_envoye')`);
    for (const insc of j1.rows) {
      const dateF = formatDateFr(new Date(insc.date_garde));
      const html = genererHtmlEmailRappel(insc, dateF, 1);
      const ok = await envoyerEmailRappelViaAPI(insc.praticien_email, `🔴 Rappel garde DEMAIN - ${dateF}`, html);
      await pool.query('UPDATE inscriptions SET email_rappel_j1_envoi_at=NOW(), email_rappel_j1_statut=$1 WHERE id=$2', [ok?'envoye':'erreur', insc.id]);
      if (ok) nbJ1++;
    }
    console.log(`⏰ Rappels : ${nbJ7} J-7, ${nbJ1} J-1`);
    return { j7_traites: j7.rows.length, j7_envoyes: nbJ7, j1_traites: j1.rows.length, j1_envoyes: nbJ1 };
  } catch(e) { console.error('❌ Rappels:', e); throw e; }
}

cron.schedule('0 8 * * *', () => { console.log('⏰ Cron rappels'); envoyerRappels(); });
setTimeout(() => { envoyerRappels(); }, 10000);

app.listen(PORT, () => { console.log(`🚀 Serveur sur http://localhost:${PORT}`); });
