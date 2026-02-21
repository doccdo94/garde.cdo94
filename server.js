require('dotenv').config();
const express = require('express');
const session = require('express-session');
const { Pool } = require('pg');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
const AdmZip = require('adm-zip');
const cron = require('node-cron');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');
const ExcelJS = require('exceljs');

const app = express();
const PORT = process.env.PORT || 10000;

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
  console.log('⚠️ Supabase non configuré');
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = ['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/msword'];
    cb(null, ok.includes(file.mimetype));
  }
});

// Upload spécifique pour les fichiers Excel (campagnes)
const uploadExcel = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel', 'text/csv'];
    cb(null, ok.includes(file.mimetype) || file.originalname.match(/\.(xlsx|xls|csv)$/i));
  }
});

// Stockage temporaire des uploads Excel (nettoyé après 30 min)
const tempUploads = new Map();
function cleanTempUploads() { const now = Date.now(); for (const [k,v] of tempUploads) { if (now - v.timestamp > 30*60*1000) tempUploads.delete(k); } }
setInterval(cleanTempUploads, 5*60*1000);

// ========== CONFIG ==========
const BREVO_API_KEY = process.env.BREVO_API_KEY;
const EMAIL_FROM = process.env.EMAIL_FROM || 'doc.cdo94@gmail.com';
const EMAIL_FROM_NAME = process.env.EMAIL_FROM_NAME || 'CDO 94 - Gardes Médicales';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'doc.cdo94@gmail.com';
const ACCESS_TOKEN = process.env.ACCESS_TOKEN || 'garde2027cdo94';

// ========== AUTH CONFIG ==========
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'cdo94admin2025';
const SESSION_SECRET = process.env.SESSION_SECRET || 'cdo94-secret-session-key-change-me';
const MAX_LOGIN_ATTEMPTS = 5;
const LOCK_TIME_MS = 15 * 60 * 1000;
const loginAttempts = new Map();

// ========== SESSION ==========
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production' ? true : false,
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000,
    sameSite: 'lax'
  }
}));

app.set('trust proxy', 1);

// ========== MIDDLEWARE AUTH ==========
function getClientIP(req) {
  return req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress || 'unknown';
}

function isBlocked(ip) {
  const info = loginAttempts.get(ip);
  if (!info) return false;
  if (info.blockedUntil && Date.now() < info.blockedUntil) return true;
  if (info.blockedUntil && Date.now() >= info.blockedUntil) {
    loginAttempts.delete(ip);
    return false;
  }
  return false;
}

function recordFailedAttempt(ip) {
  const info = loginAttempts.get(ip) || { count: 0, blockedUntil: null };
  info.count++;
  if (info.count >= MAX_LOGIN_ATTEMPTS) {
    info.blockedUntil = Date.now() + LOCK_TIME_MS;
    console.log(`🔒 IP ${ip} bloquée pour 15 min (${info.count} tentatives)`);
  }
  loginAttempts.set(ip, info);
  return info;
}

function resetAttempts(ip) {
  loginAttempts.delete(ip);
}

function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated) return next();
  res.status(401).json({ error: 'Non authentifié' });
}

// ========== MIDDLEWARE GENERAL ==========
app.use(bodyParser.json({ limit: '5mb' }));
app.use(bodyParser.urlencoded({ extended: true }));

app.use(express.static('public', {
  index: 'index.html',
  extensions: ['html'],
  setHeaders: (res, filepath) => {
    if (filepath.endsWith('admin.html')) {
      res.setHeader('Cache-Control', 'no-store');
    }
  }
}));

app.get('/admin.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// ========== ROUTES AUTH ==========

app.post('/api/login', (req, res) => {
  const ip = getClientIP(req);
  if (isBlocked(ip)) {
    const info = loginAttempts.get(ip);
    const restant = Math.ceil((info.blockedUntil - Date.now()) / 60000);
    return res.status(429).json({
      error: `Trop de tentatives. Réessayez dans ${restant} minute${restant > 1 ? 's' : ''}.`,
      blocked: true,
      minutes_restantes: restant
    });
  }
  const { username, password } = req.body;
  if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
    resetAttempts(ip);
    req.session.authenticated = true;
    req.session.loginTime = Date.now();
    console.log(`✅ Login admin depuis ${ip}`);
    res.json({ success: true });
  } else {
    const info = recordFailedAttempt(ip);
    const restant = MAX_LOGIN_ATTEMPTS - info.count;
    console.log(`❌ Tentative login échouée depuis ${ip} (${info.count}/${MAX_LOGIN_ATTEMPTS})`);
    if (info.blockedUntil) {
      return res.status(429).json({
        error: `Compte bloqué pour 15 minutes après ${MAX_LOGIN_ATTEMPTS} tentatives.`,
        blocked: true,
        minutes_restantes: 15
      });
    }
    res.status(401).json({
      error: `Identifiants incorrects. ${restant} tentative${restant > 1 ? 's' : ''} restante${restant > 1 ? 's' : ''}.`,
      tentatives_restantes: restant
    });
  }
});

app.get('/api/auth-status', async (req, res) => {
  const auth = !!(req.session && req.session.authenticated);
  let annee_active = new Date().getFullYear();
  try { const r = await pool.query("SELECT valeur FROM configuration WHERE cle='annee_active'"); if (r.rows.length) annee_active = parseInt(r.rows[0].valeur); } catch(e) {}
  res.json({ authenticated: auth, annee_active });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// ========== TEMPLATES PAR DEFAUT ==========
const TEMPLATES_DEFAUT = {
  confirmation: {
    type: 'confirmation',
    sujet: 'Confirmation inscription garde - {{DATE_GARDE}}',
    titre_header: '✓ Inscription confirmée',
    sous_titre_header: 'Garde du {{DATE_GARDE}}',
    couleur1: '#667eea',
    couleur2: '#764ba2',
    documents_joints: 'all',
    inclure_docx_personnalise: true,
    contenu_html: `<p>Bonjour Dr {{NOM}},</p>
<p>Votre inscription à la garde du <strong>{{DATE_GARDE}}</strong> a bien été enregistrée.</p>
<h3>📋 Vos informations</h3>
<p><strong>Nom :</strong> {{NOM}} {{PRENOM}}</p>
<p><strong>Email :</strong> {{EMAIL}}</p>
<p><strong>Tél :</strong> {{TELEPHONE}}</p>
<p><strong>Adresse :</strong> {{ADRESSE}}</p>
<h3>📎 Documents joints</h3>
<p>Pièces jointes : Fiche de retour, Document praticien (personnalisé), Cadre réglementaire, Attestation de participation.</p>
<p>Contact : <a href="mailto:{{ADMIN_EMAIL}}">{{ADMIN_EMAIL}}</a></p>`
  },
  rappel_j7: {
    type: 'rappel_j7',
    sujet: '🟡 Rappel garde dans 7 jours - {{DATE_GARDE}}',
    titre_header: '🟡 Rappel : garde dans 7 jours',
    sous_titre_header: '{{DATE_GARDE}}',
    couleur1: '#f59e0b',
    couleur2: '#d97706',
    documents_joints: '[]',
    inclure_docx_personnalise: false,
    contenu_html: `<p>Bonjour Dr {{NOM}},</p>
<p>Nous vous rappelons que vous êtes inscrit(e) à la garde du <strong>{{DATE_GARDE}}</strong> (dans 7 jours).</p>
<h3>📋 Rappel de vos informations</h3>
<p><strong>Tél :</strong> {{TELEPHONE}}</p>
<p><strong>Cabinet :</strong> {{ADRESSE}}</p>
<p>En cas d'empêchement, contactez-nous <strong>au plus vite</strong> à <a href="mailto:{{ADMIN_EMAIL}}">{{ADMIN_EMAIL}}</a></p>`
  },
  rappel_j1: {
    type: 'rappel_j1',
    sujet: '🔴 Rappel garde DEMAIN - {{DATE_GARDE}}',
    titre_header: '🔴 Rappel : garde demain',
    sous_titre_header: '{{DATE_GARDE}}',
    couleur1: '#dc2626',
    couleur2: '#b91c1c',
    documents_joints: '[]',
    inclure_docx_personnalise: false,
    contenu_html: `<p>Bonjour Dr {{NOM}},</p>
<p>Nous vous rappelons que vous êtes inscrit(e) à la garde du <strong>{{DATE_GARDE}}</strong> (<strong>demain</strong>).</p>
<h3>📋 Rappel de vos informations</h3>
<p><strong>Tél :</strong> {{TELEPHONE}}</p>
<p><strong>Cabinet :</strong> {{ADRESSE}}</p>
<p>En cas d'empêchement, contactez-nous <strong>au plus vite</strong> à <a href="mailto:{{ADMIN_EMAIL}}">{{ADMIN_EMAIL}}</a></p>`
  }
};

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
      ALTER TABLE inscriptions ADD COLUMN IF NOT EXISTS email_confirmation_message_id VARCHAR(255);
      ALTER TABLE inscriptions ADD COLUMN IF NOT EXISTS email_rappel_j7_message_id VARCHAR(255);
      ALTER TABLE inscriptions ADD COLUMN IF NOT EXISTS email_rappel_j1_message_id VARCHAR(255);
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
    await pool.query(`
      CREATE TABLE IF NOT EXISTS documents_garde (
        id SERIAL PRIMARY KEY, nom_original VARCHAR(255) NOT NULL, nom_email VARCHAR(255) NOT NULL,
        supabase_path VARCHAR(500) NOT NULL, taille INTEGER DEFAULT 0, type_mime VARCHAR(100),
        est_template_docx BOOLEAN DEFAULT false, actif BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS email_templates (
        id SERIAL PRIMARY KEY, type VARCHAR(50) UNIQUE NOT NULL,
        sujet VARCHAR(500) NOT NULL, titre_header VARCHAR(255) NOT NULL,
        sous_titre_header VARCHAR(255) DEFAULT '', couleur1 VARCHAR(7) DEFAULT '#667eea',
        couleur2 VARCHAR(7) DEFAULT '#764ba2', contenu_html TEXT NOT NULL,
        documents_joints TEXT DEFAULT '[]',
        inclure_docx_personnalise BOOLEAN DEFAULT false,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await pool.query(`
      ALTER TABLE email_templates ADD COLUMN IF NOT EXISTS documents_joints TEXT DEFAULT '[]';
      ALTER TABLE email_templates ADD COLUMN IF NOT EXISTS inclure_docx_personnalise BOOLEAN DEFAULT false;
    `);

    // Table configuration
    await pool.query(`
      CREATE TABLE IF NOT EXISTS configuration (
        cle VARCHAR(50) PRIMARY KEY,
        valeur VARCHAR(255) NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    const confExiste = await pool.query("SELECT cle FROM configuration WHERE cle='annee_active'");
    if (confExiste.rows.length === 0) {
      await pool.query("INSERT INTO configuration (cle, valeur) VALUES ('annee_active', $1)", [String(new Date().getFullYear())]);
      console.log(`📅 Année active initialisée: ${new Date().getFullYear()}`);
    }

    // Table email_events (webhooks Brevo)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS email_events (
        id SERIAL PRIMARY KEY,
        message_id VARCHAR(255),
        email VARCHAR(255) NOT NULL,
        event VARCHAR(50) NOT NULL,
        date_event TIMESTAMP,
        subject VARCHAR(500),
        reason TEXT,
        tag VARCHAR(100),
        ts_epoch BIGINT,
        raw_data JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_email_events_email ON email_events(email);
      CREATE INDEX IF NOT EXISTS idx_email_events_message_id ON email_events(message_id);
      CREATE INDEX IF NOT EXISTS idx_email_events_event ON email_events(event);
    `);

    // Tables campagnes de déploiement
    await pool.query(`
      CREATE TABLE IF NOT EXISTS campagnes (
        id SERIAL PRIMARY KEY,
        nom VARCHAR(255),
        annee_cible INTEGER,
        lien_inscription TEXT,
        signataire VARCHAR(255),
        sujet_email VARCHAR(500),
        titre_header VARCHAR(255) DEFAULT 'Service de garde – Inscription',
        sous_titre_header VARCHAR(255) DEFAULT '',
        couleur1 VARCHAR(7) DEFAULT '#667eea',
        couleur2 VARCHAR(7) DEFAULT '#764ba2',
        contenu_html TEXT,
        documents_joints TEXT DEFAULT '[]',
        statut VARCHAR(50) DEFAULT 'brouillon',
        mode_envoi VARCHAR(50) DEFAULT 'progressif',
        nb_destinataires INTEGER DEFAULT 0,
        nb_envoyes INTEGER DEFAULT 0,
        nb_erreurs INTEGER DEFAULT 0,
        lancee_at TIMESTAMP,
        terminee_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS campagne_destinataires (
        id SERIAL PRIMARY KEY,
        campagne_id INTEGER REFERENCES campagnes(id) ON DELETE CASCADE,
        nom VARCHAR(255),
        prenom VARCHAR(255),
        email VARCHAR(255) NOT NULL,
        rpps VARCHAR(20),
        age INTEGER,
        ville VARCHAR(255),
        code_postal VARCHAR(10),
        statut VARCHAR(50) DEFAULT 'en_attente',
        message_id VARCHAR(255),
        nb_ouvertures INTEGER DEFAULT 0,
        nb_clics INTEGER DEFAULT 0,
        derniere_activite TIMESTAMP,
        erreur_detail TEXT,
        envoi_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_camp_dest_campagne ON campagne_destinataires(campagne_id);
      CREATE INDEX IF NOT EXISTS idx_camp_dest_statut ON campagne_destinataires(statut);
      CREATE INDEX IF NOT EXISTS idx_camp_dest_message_id ON campagne_destinataires(message_id);
    `);

    for (const [type, tpl] of Object.entries(TEMPLATES_DEFAUT)) {
      const existe = await pool.query('SELECT id FROM email_templates WHERE type=$1', [type]);
      if (existe.rows.length === 0) {
        await pool.query('INSERT INTO email_templates (type,sujet,titre_header,sous_titre_header,couleur1,couleur2,contenu_html,documents_joints,inclure_docx_personnalise) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
          [tpl.type, tpl.sujet, tpl.titre_header, tpl.sous_titre_header, tpl.couleur1, tpl.couleur2, tpl.contenu_html, tpl.documents_joints || '[]', tpl.inclure_docx_personnalise || false]);
        console.log(`📧 Template "${type}" créé`);
      }
    }
    console.log('✅ Tables vérifiées/créées');

    if (supabase) {
      try {
        const { data: buckets } = await supabase.storage.listBuckets();
        const existe = buckets && buckets.some(b => b.name === BUCKET_NAME);
        if (!existe) { await supabase.storage.createBucket(BUCKET_NAME, { public: false }); console.log(`✅ Bucket créé`); }
        else console.log(`✅ Bucket OK`);
      } catch (e) { console.error('⚠️ Bucket:', e.message); }
    }
  } catch (err) { console.error('Erreur init DB:', err); }
})();

// ========== DOCUMENTS LOCAUX (FALLBACK) ==========
const DOCUMENTS_DIR = path.join(__dirname, 'Documents');
const DOCUMENTS_GARDE_LOCAL = [
  { fichier: 'fiche retour .pdf', nomEmail: 'Fiche-retour-indemnites.pdf' },
  { fichier: 'Cadre-reglementaire v2 à valider.pdf', nomEmail: 'Cadre-reglementaire.pdf' },
  { fichier: 'attestation de participation.pdf', nomEmail: 'Attestation-participation.pdf' }
];
const DOCX_TEMPLATE_LOCAL = { fichier: 'doc prat de garde.docx' };
let DOCUMENTS_STATIQUES_LOCAL = [];
let DOCX_TEMPLATE_BUFFER_LOCAL = null;

function chargerDocumentsLocaux() {
  DOCUMENTS_STATIQUES_LOCAL = []; DOCX_TEMPLATE_BUFFER_LOCAL = null;
  if (!fs.existsSync(DOCUMENTS_DIR)) return;
  const fichiers = fs.readdirSync(DOCUMENTS_DIR);
  function trouver(nom) {
    let f = fichiers.find(f => f.normalize('NFC') === nom.normalize('NFC'));
    if (!f) f = fichiers.find(f => f.normalize('NFD') === nom.normalize('NFD'));
    if (!f) { const n = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase(); f = fichiers.find(fi => n(fi) === n(nom)); }
    return f;
  }
  for (const doc of DOCUMENTS_GARDE_LOCAL) {
    try { const ft = trouver(doc.fichier); if (ft) DOCUMENTS_STATIQUES_LOCAL.push({name:doc.nomEmail, content:fs.readFileSync(path.join(DOCUMENTS_DIR, ft)).toString('base64')}); } catch(e) {}
  }
  try { const ft = trouver(DOCX_TEMPLATE_LOCAL.fichier); if (ft) DOCX_TEMPLATE_BUFFER_LOCAL = fs.readFileSync(path.join(DOCUMENTS_DIR, ft)); } catch(e) {}
  console.log(`📎 ${DOCUMENTS_STATIQUES_LOCAL.length + (DOCX_TEMPLATE_BUFFER_LOCAL?1:0)} docs locaux (fallback)`);
}
chargerDocumentsLocaux();

// ========== CHARGEMENT PJ SUPABASE ==========
async function chargerPiecesJointes() {
  if (!supabase) return { statiques: DOCUMENTS_STATIQUES_LOCAL, templateBuffer: DOCX_TEMPLATE_BUFFER_LOCAL };
  try {
    const docs = await pool.query('SELECT * FROM documents_garde WHERE actif=true ORDER BY est_template_docx ASC, nom_email ASC');
    if (docs.rows.length === 0) return { statiques: DOCUMENTS_STATIQUES_LOCAL, templateBuffer: DOCX_TEMPLATE_BUFFER_LOCAL };
    const statiques = []; let templateBuffer = null;
    for (const doc of docs.rows) {
      try {
        const { data, error } = await supabase.storage.from(BUCKET_NAME).download(doc.supabase_path);
        if (error) continue;
        const buffer = Buffer.from(await data.arrayBuffer());
        if (doc.est_template_docx) templateBuffer = buffer;
        else statiques.push({ name: doc.nom_email, content: buffer.toString('base64') });
      } catch (e) {}
    }
    if (!templateBuffer && DOCX_TEMPLATE_BUFFER_LOCAL) templateBuffer = DOCX_TEMPLATE_BUFFER_LOCAL;
    return { statiques, templateBuffer };
  } catch (e) {
    return { statiques: DOCUMENTS_STATIQUES_LOCAL, templateBuffer: DOCX_TEMPLATE_BUFFER_LOCAL };
  }
}

function genererDocxPersonnalise(templateBuffer, nom, prenom, dateGarde) {
  if (!templateBuffer) return null;
  try {
    const zip = new AdmZip(templateBuffer);
    const xml = zip.readAsText('word/document.xml');
    zip.updateFile('word/document.xml', Buffer.from(xml.replace(/\{\{NOM_PRATICIEN\}\}/g, `${prenom} ${nom}`).replace(/\{\{DATE_GARDE\}\}/g, dateGarde), 'utf-8'));
    return { name: 'Document-praticien-de-garde.docx', content: zip.toBuffer().toString('base64') };
  } catch(e) { return null; }
}

// ========== ASSEMBLAGE EMAIL DEPUIS TEMPLATE DB ==========
async function getTemplate(type) {
  try {
    const r = await pool.query('SELECT * FROM email_templates WHERE type=$1', [type]);
    if (r.rows.length > 0) return r.rows[0];
  } catch (e) {}
  return TEMPLATES_DEFAUT[type] || null;
}

function assemblerEmailHTML(template, variables) {
  let { sujet, titre_header, sous_titre_header, couleur1, couleur2, contenu_html } = template;
  couleur1 = couleur1 || '#667eea'; couleur2 = couleur2 || '#764ba2';
  for (const [k, v] of Object.entries(variables)) {
    const re = new RegExp(`\\{\\{${k}\\}\\}`, 'g');
    sujet = sujet.replace(re, v || '');
    titre_header = titre_header.replace(re, v || '');
    sous_titre_header = (sous_titre_header || '').replace(re, v || '');
    contenu_html = contenu_html.replace(re, v || '');
  }
  contenu_html = contenu_html
    .replace(/<p>/g, '<p style="margin:0 0 12px 0;color:#333;font-size:15px;line-height:1.6">')
    .replace(/<h3>/g, `<h3 style="color:${couleur1};font-size:18px;margin:20px 0 10px 0">`)
    .replace(/<ul>/g, '<ul style="margin:10px 0;padding-left:20px">')
    .replace(/<li>/g, '<li style="margin:5px 0;color:#333;font-size:15px">')
    .replace(/<a /g, `<a style="color:${couleur1}" `);
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="font-family:Arial,sans-serif;line-height:1.6;color:#333;margin:0;padding:0"><div style="max-width:600px;margin:0 auto;padding:20px"><div style="background:linear-gradient(135deg,${couleur1} 0%,${couleur2} 100%);color:white;padding:30px;text-align:center;border-radius:10px 10px 0 0"><h1 style="margin:0;font-size:24px">${titre_header}</h1>${sous_titre_header?`<p style="margin:10px 0 0 0;font-size:18px">${sous_titre_header}</p>`:''}</div><div style="background:#f9f9f9;padding:30px;border-radius:0 0 10px 10px">${contenu_html}</div><div style="text-align:center;margin-top:30px;color:#666;font-size:12px"><p>CDO 94 - Conseil Départemental de l'Ordre des Chirurgiens-Dentistes du Val-de-Marne</p></div></div></body></html>`;
  return { sujet, html };
}

// ========== ENVOI EMAILS ==========

async function chargerPJPourTemplate(template, praticienInfo) {
  const attachments = [];
  const docsJointsStr = template.documents_joints || '[]';
  const inclureDocx = template.inclure_docx_personnalise || false;
  let pjIds = [];
  try { pjIds = docsJointsStr === 'all' ? null : JSON.parse(docsJointsStr); } catch(e) { pjIds = []; }
  const hasPJ = pjIds === null || (Array.isArray(pjIds) && pjIds.length > 0);

  if (!hasPJ && !inclureDocx) return attachments;

  if (supabase) {
    try {
      if (hasPJ) {
        let query = 'SELECT * FROM documents_garde WHERE actif=true AND est_template_docx=false';
        let params = [];
        if (pjIds !== null) { query += ' AND id = ANY($1)'; params = [pjIds]; }
        query += ' ORDER BY nom_email ASC';
        const docs = await pool.query(query, params);
        for (const doc of docs.rows) {
          try {
            const { data, error } = await supabase.storage.from(BUCKET_NAME).download(doc.supabase_path);
            if (error) continue;
            const buffer = Buffer.from(await data.arrayBuffer());
            attachments.push({ name: doc.nom_email, content: buffer.toString('base64') });
          } catch (e) {}
        }
      }
      if (inclureDocx && praticienInfo) {
        const docxR = await pool.query('SELECT * FROM documents_garde WHERE actif=true AND est_template_docx=true LIMIT 1');
        if (docxR.rows.length > 0) {
          try {
            const { data, error } = await supabase.storage.from(BUCKET_NAME).download(docxR.rows[0].supabase_path);
            if (!error) {
              const buffer = Buffer.from(await data.arrayBuffer());
              const d = genererDocxPersonnalise(buffer, praticienInfo.nom, praticienInfo.prenom, praticienInfo.dateGarde);
              if (d) attachments.push(d);
            }
          } catch (e) {}
        }
      }
    } catch (e) {}
  }

  if (attachments.length === 0) {
    if (hasPJ) attachments.push(...DOCUMENTS_STATIQUES_LOCAL);
    if (inclureDocx && praticienInfo && DOCX_TEMPLATE_BUFFER_LOCAL) {
      const d = genererDocxPersonnalise(DOCX_TEMPLATE_BUFFER_LOCAL, praticienInfo.nom, praticienInfo.prenom, praticienInfo.dateGarde);
      if (d) attachments.push(d);
    }
  }

  return attachments;
}

// ✅ MODIFIÉ : retourne { success, messageId } au lieu de true/false
async function envoyerEmailAvecPJ(to, subject, html, template, praticienInfo = null) {
  if (!BREVO_API_KEY) return { success: false, messageId: null };
  try {
    const attachments = await chargerPJPourTemplate(template, praticienInfo);
    const emailData = { sender:{name:EMAIL_FROM_NAME,email:EMAIL_FROM}, to:[{email:to}], cc:[{email:ADMIN_EMAIL}], subject, htmlContent:html };
    if (attachments.length > 0) emailData.attachment = attachments;
    const response = await fetch('https://api.brevo.com/v3/smtp/email', { method:'POST', headers:{'Content-Type':'application/json','api-key':BREVO_API_KEY}, body:JSON.stringify(emailData) });
    if (response.ok) {
      const result = await response.json();
      console.log(`✅ Email → ${to} (${attachments.length} PJ) msgId: ${result.messageId}`);
      return { success: true, messageId: result.messageId || null };
    }
    else { console.error('❌ Brevo:', response.status, await response.text()); return { success: false, messageId: null }; }
  } catch(e) { console.error('❌ Email:', e); return { success: false, messageId: null }; }
}

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
    const annee = await getAnneeActive();
    const insc = await pool.query('SELECT date_garde, COUNT(*) as nb FROM inscriptions WHERE EXTRACT(YEAR FROM date_garde)=$1 GROUP BY date_garde', [annee]);
    const map = {}; insc.rows.forEach(r => { map[r.date_garde.toISOString().split('T')[0]] = parseInt(r.nb); });
    const dates = await pool.query('SELECT date, type, nom_jour_ferie FROM dates_garde WHERE active=true AND EXTRACT(YEAR FROM date)=$1 AND date>=CURRENT_DATE ORDER BY date ASC', [annee]);
    const result = dates.rows.map(r => {
      const ds = r.date.toISOString().split('T')[0]; let label = formatDateFr(new Date(r.date));
      if (r.type==='jour_ferie' && r.nom_jour_ferie) label += ` (${r.nom_jour_ferie})`;
      const nb = map[ds]||0; return { label, value:ds, nb_inscrits:nb, places_restantes:2-nb };
    }).filter(d => d.places_restantes > 0);
    res.json(result);
  } catch(e) { res.status(500).json({error:'Erreur serveur'}); }
});

app.get('/api/dates/:date/statut', async (req, res) => {
  try { const r = await pool.query('SELECT COUNT(*) as nb FROM inscriptions WHERE date_garde=$1', [req.params.date]); const nb = parseInt(r.rows[0].nb); res.json({date:req.params.date, nb_inscrits:nb, places_restantes:2-nb, disponible:nb<2}); }
  catch(e) { res.status(500).json({error:'Erreur serveur'}); }
});

app.get('/api/dates/:date/praticiens', async (req, res) => {
  try { const r = await pool.query('SELECT praticien_nom, praticien_prenom, praticien_email FROM inscriptions WHERE date_garde=$1', [req.params.date]); res.json(r.rows); }
  catch(e) { res.status(500).json({error:'Erreur serveur'}); }
});

app.post('/api/inscriptions', verifierToken, async (req, res) => {
  const { dateGarde, praticien } = req.body;
  if (!praticien||!praticien.email||!praticien.nom||!praticien.prenom) return res.status(400).json({error:'Informations incomplètes'});
  if (!validerEmail(praticien.email)) return res.status(400).json({error:'Email invalide'});
  if (!validerTelephone(praticien.telephone)) return res.status(400).json({error:'Téléphone invalide'});
  if (!validerRPPS(praticien.rpps)) return res.status(400).json({error:'RPPS invalide (11 chiffres)'});
  try {
    const check = await pool.query('SELECT COUNT(*) as nb FROM inscriptions WHERE date_garde=$1', [dateGarde]);
    const nbInscrits = parseInt(check.rows[0].nb);
    if (nbInscrits >= 2) return res.status(400).json({error:'Date complète'});
    const dup = await pool.query('SELECT * FROM inscriptions WHERE date_garde=$1 AND praticien_email=$2', [dateGarde, praticien.email]);
    if (dup.rows.length > 0) return res.status(400).json({error:'Déjà inscrit'});
    const result = await pool.query(`INSERT INTO inscriptions (date_garde, praticien_nom, praticien_prenom, praticien_email, praticien_telephone, praticien_rpps, praticien_numero, praticien_voie, praticien_code_postal, praticien_ville, praticien_etage, praticien_code_entree) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [dateGarde, praticien.nom, praticien.prenom, praticien.email, praticien.telephone, praticien.rpps, praticien.numero, praticien.voie, praticien.codePostal, praticien.ville, praticien.etage, praticien.codeEntree]);
    const nouv = result.rows[0];
    const estComplet = nbInscrits===1;
    try { await envoyerEmailConfirmation(nouv); } catch(e) { console.error('Email:', e.message); }
    res.json({ success:true, inscription:nouv, statut:estComplet?'complete':'partielle' });
  } catch(e) { res.status(500).json({error:"Erreur inscription"}); }
});

app.get('/api/inscriptions', requireAuth, async (req, res) => {
  try { const annee = await getAnneeActive(); const r = await pool.query('SELECT i.*, (SELECT COUNT(*) FROM inscriptions i2 WHERE i2.date_garde=i.date_garde) as nb_praticiens_total FROM inscriptions i WHERE EXTRACT(YEAR FROM i.date_garde)=$1 ORDER BY date_garde DESC, created_at ASC', [annee]); res.json(r.rows); }
  catch(e) { res.status(500).json({error:'Erreur serveur'}); }
});

app.delete('/api/inscriptions/:id', requireAuth, async (req, res) => {
  try { await pool.query('DELETE FROM inscriptions WHERE id=$1', [req.params.id]); res.json({success:true}); }
  catch(e) { res.status(500).json({error:'Erreur serveur'}); }
});

// ✅ MODIFIÉ : stocke messageId
app.post('/api/inscriptions/:id/renvoyer-email', requireAuth, async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM inscriptions WHERE id=$1', [req.params.id]);
    if (r.rows.length===0) return res.status(404).json({error:'Non trouvée'});
    const insc = r.rows[0]; const dateF = formatDateFr(new Date(insc.date_garde));
    const tpl = await getTemplate('confirmation');
    const { sujet, html } = assemblerEmailHTML(tpl, buildVars(insc, dateF));
    const pInfo = {nom:insc.praticien_nom, prenom:insc.praticien_prenom, dateGarde:dateF};
    const result = await envoyerEmailAvecPJ(insc.praticien_email, `[RENVOI] ${sujet}`, html, tpl, pInfo);
    await pool.query('UPDATE inscriptions SET email_confirmation_envoi_at=NOW(), email_confirmation_statut=$1, email_confirmation_message_id=$2 WHERE id=$3', [result.success?'envoye':'erreur', result.messageId, insc.id]);
    if (result.success) res.json({success:true}); else res.status(500).json({error:"Erreur envoi"});
  } catch(e) { res.status(500).json({error:"Erreur envoi"}); }
});

// ========== ROUTES RAPPELS ==========

// ✅ MODIFIÉ : stocke messageId
app.post('/api/inscriptions/:id/envoyer-rappel-j7', requireAuth, async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM inscriptions WHERE id=$1', [req.params.id]);
    if (r.rows.length === 0) return res.status(404).json({error:'Non trouvée'});
    const insc = r.rows[0]; const dateF = formatDateFr(new Date(insc.date_garde));
    const tpl = await getTemplate('rappel_j7');
    const { sujet, html } = assemblerEmailHTML(tpl, buildVars(insc, dateF));
    const pInfo = {nom:insc.praticien_nom, prenom:insc.praticien_prenom, dateGarde:dateF};
    const result = await envoyerEmailAvecPJ(insc.praticien_email, sujet, html, tpl, pInfo);
    await pool.query('UPDATE inscriptions SET email_rappel_j7_envoi_at=NOW(), email_rappel_j7_statut=$1, email_rappel_j7_message_id=$2 WHERE id=$3', [result.success?'envoye':'erreur', result.messageId, insc.id]);
    if (result.success) res.json({success:true, message:`Rappel J-7 envoyé à Dr ${insc.praticien_nom}`}); else res.status(500).json({error:"Erreur"});
  } catch (e) { res.status(500).json({error:"Erreur"}); }
});

// ✅ MODIFIÉ : stocke messageId
app.post('/api/inscriptions/:id/envoyer-rappel-j1', requireAuth, async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM inscriptions WHERE id=$1', [req.params.id]);
    if (r.rows.length === 0) return res.status(404).json({error:'Non trouvée'});
    const insc = r.rows[0]; const dateF = formatDateFr(new Date(insc.date_garde));
    const tpl = await getTemplate('rappel_j1');
    const { sujet, html } = assemblerEmailHTML(tpl, buildVars(insc, dateF));
    const pInfo = {nom:insc.praticien_nom, prenom:insc.praticien_prenom, dateGarde:dateF};
    const result = await envoyerEmailAvecPJ(insc.praticien_email, sujet, html, tpl, pInfo);
    await pool.query('UPDATE inscriptions SET email_rappel_j1_envoi_at=NOW(), email_rappel_j1_statut=$1, email_rappel_j1_message_id=$2 WHERE id=$3', [result.success?'envoye':'erreur', result.messageId, insc.id]);
    if (result.success) res.json({success:true, message:`Rappel J-1 envoyé à Dr ${insc.praticien_nom}`}); else res.status(500).json({error:"Erreur"});
  } catch (e) { res.status(500).json({error:"Erreur"}); }
});

app.post('/api/rappels/envoyer', requireAuth, async (req, res) => {
  try { const result = await envoyerRappels(); res.json({success:true, detail:result}); }
  catch(e) { res.status(500).json({error:'Erreur rappels'}); }
});

// ========== ROUTES DOCUMENTS ==========

app.get('/api/documents', requireAuth, async (req, res) => {
  try { res.json((await pool.query('SELECT * FROM documents_garde ORDER BY est_template_docx DESC, nom_email ASC')).rows); }
  catch (e) { res.status(500).json({error:'Erreur'}); }
});

app.post('/api/documents/upload', requireAuth, upload.single('fichier'), async (req, res) => {
  if (!supabase) return res.status(400).json({error:'Supabase non configuré'});
  if (!req.file) return res.status(400).json({error:'Aucun fichier'});
  const nomEmail = req.body.nom_email || req.file.originalname;
  const estTemplate = req.body.est_template_docx === 'true';
  if (estTemplate) {
    try { const a = await pool.query('SELECT * FROM documents_garde WHERE est_template_docx=true');
    for (const d of a.rows) { await supabase.storage.from(BUCKET_NAME).remove([d.supabase_path]); await pool.query('DELETE FROM documents_garde WHERE id=$1', [d.id]); } } catch(e){}
  }
  const sp = `${Date.now()}-${req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  try {
    const { error } = await supabase.storage.from(BUCKET_NAME).upload(sp, req.file.buffer, { contentType: req.file.mimetype });
    if (error) return res.status(500).json({error:error.message});
    const r = await pool.query('INSERT INTO documents_garde (nom_original,nom_email,supabase_path,taille,type_mime,est_template_docx) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [req.file.originalname, nomEmail, sp, req.file.size, req.file.mimetype, estTemplate]);
    res.json({success:true, document:r.rows[0]});
  } catch (e) { try{await supabase.storage.from(BUCKET_NAME).remove([sp]);}catch(ce){} res.status(500).json({error:"Erreur upload"}); }
});

app.delete('/api/documents/:id', requireAuth, async (req, res) => {
  if (!supabase) return res.status(400).json({error:'Supabase non configuré'});
  try {
    const r = await pool.query('SELECT * FROM documents_garde WHERE id=$1', [req.params.id]);
    if (r.rows.length===0) return res.status(404).json({error:'Non trouvé'});
    await supabase.storage.from(BUCKET_NAME).remove([r.rows[0].supabase_path]);
    await pool.query('DELETE FROM documents_garde WHERE id=$1', [req.params.id]);
    res.json({success:true});
  } catch (e) { res.status(500).json({error:'Erreur'}); }
});

app.put('/api/documents/:id', requireAuth, async (req, res) => {
  try {
    const { nom_email, est_template_docx, actif } = req.body;
    const r = await pool.query('UPDATE documents_garde SET nom_email=COALESCE($1,nom_email), est_template_docx=COALESCE($2,est_template_docx), actif=COALESCE($3,actif), updated_at=NOW() WHERE id=$4 RETURNING *',
      [nom_email, est_template_docx, actif, req.params.id]);
    if (r.rows.length===0) return res.status(404).json({error:'Non trouvé'});
    res.json({success:true, document:r.rows[0]});
  } catch (e) { res.status(500).json({error:'Erreur'}); }
});

app.get('/api/documents/:id/download', requireAuth, async (req, res) => {
  if (!supabase) return res.status(400).json({error:'Supabase non configuré'});
  try {
    const r = await pool.query('SELECT * FROM documents_garde WHERE id=$1', [req.params.id]);
    if (r.rows.length === 0) return res.status(404).json({error:'Non trouvé'});
    const doc = r.rows[0];
    const { data, error } = await supabase.storage.from(BUCKET_NAME).download(doc.supabase_path);
    if (error) return res.status(500).json({error:error.message});
    const buffer = Buffer.from(await data.arrayBuffer());
    const disposition = req.query.inline === 'true' ? 'inline' : 'attachment';
    res.setHeader('Content-Type', doc.type_mime || 'application/octet-stream');
    res.setHeader('Content-Disposition', `${disposition}; filename="${encodeURIComponent(doc.nom_email)}"`);
    res.setHeader('Content-Length', buffer.length);
    res.send(buffer);
  } catch (e) { res.status(500).json({error:'Erreur'}); }
});

// ========== ROUTES EMAIL TEMPLATES ==========

app.get('/api/email-templates', requireAuth, async (req, res) => {
  try { res.json((await pool.query('SELECT * FROM email_templates ORDER BY type ASC')).rows); }
  catch (e) { res.status(500).json({error:'Erreur'}); }
});

app.get('/api/email-templates/:type', requireAuth, async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM email_templates WHERE type=$1', [req.params.type]);
    if (r.rows.length === 0) return res.status(404).json({error:'Non trouvé'});
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({error:'Erreur'}); }
});

app.put('/api/email-templates/:type', requireAuth, async (req, res) => {
  try {
    const { sujet, titre_header, sous_titre_header, couleur1, couleur2, contenu_html, documents_joints, inclure_docx_personnalise } = req.body;
    const r = await pool.query('UPDATE email_templates SET sujet=COALESCE($1,sujet), titre_header=COALESCE($2,titre_header), sous_titre_header=COALESCE($3,sous_titre_header), couleur1=COALESCE($4,couleur1), couleur2=COALESCE($5,couleur2), contenu_html=COALESCE($6,contenu_html), documents_joints=COALESCE($7,documents_joints), inclure_docx_personnalise=COALESCE($8,inclure_docx_personnalise), updated_at=NOW() WHERE type=$9 RETURNING *',
      [sujet, titre_header, sous_titre_header, couleur1, couleur2, contenu_html, documents_joints, inclure_docx_personnalise, req.params.type]);
    if (r.rows.length===0) return res.status(404).json({error:'Non trouvé'});
    res.json({success:true, template:r.rows[0]});
  } catch (e) { res.status(500).json({error:'Erreur'}); }
});

app.post('/api/email-templates/:type/reset', requireAuth, async (req, res) => {
  const defaut = TEMPLATES_DEFAUT[req.params.type];
  if (!defaut) return res.status(404).json({error:'Type inconnu'});
  try {
    const r = await pool.query('UPDATE email_templates SET sujet=$1, titre_header=$2, sous_titre_header=$3, couleur1=$4, couleur2=$5, contenu_html=$6, documents_joints=$7, inclure_docx_personnalise=$8, updated_at=NOW() WHERE type=$9 RETURNING *',
      [defaut.sujet, defaut.titre_header, defaut.sous_titre_header, defaut.couleur1, defaut.couleur2, defaut.contenu_html, defaut.documents_joints || '[]', defaut.inclure_docx_personnalise || false, req.params.type]);
    res.json({success:true, template:r.rows[0]});
  } catch (e) { res.status(500).json({error:'Erreur'}); }
});

app.post('/api/email-templates/:type/preview', requireAuth, async (req, res) => {
  try {
    const sampleVars = { NOM:'DUPONT', PRENOM:'Jean', DATE_GARDE:'dimanche 23 mars 2025', EMAIL:'jean.dupont@email.fr', TELEPHONE:'06 12 34 56 78', ADRESSE:'15 rue de la Paix, 94300 Vincennes', ADMIN_EMAIL };
    const { html } = assemblerEmailHTML(req.body, sampleVars);
    res.json({ html });
  } catch (e) { res.status(500).json({error:'Erreur'}); }
});

// ========== ROUTES STATS & DATES ==========

app.get('/api/stats', requireAuth, async (req, res) => {
  try { const annee = await getAnneeActive(); res.json((await pool.query(`SELECT COUNT(DISTINCT date_garde) as dates_avec_inscriptions, COUNT(*) as total_inscriptions, COUNT(DISTINCT date_garde) FILTER (WHERE date_garde>=CURRENT_DATE AND (SELECT COUNT(*) FROM inscriptions i2 WHERE i2.date_garde=inscriptions.date_garde)=2) as gardes_futures_completes, COUNT(DISTINCT date_garde) FILTER (WHERE date_garde>=CURRENT_DATE AND (SELECT COUNT(*) FROM inscriptions i2 WHERE i2.date_garde=inscriptions.date_garde)=1) as gardes_futures_partielles FROM inscriptions WHERE EXTRACT(YEAR FROM date_garde)=$1`, [annee])).rows[0]); }
  catch(e) { res.status(500).json({error:'Erreur'}); }
});

app.get('/api/dates-garde', requireAuth, async (req, res) => {
  try { const annee = await getAnneeActive(); res.json((await pool.query('SELECT d.*, COUNT(i.id) as nb_inscriptions FROM dates_garde d LEFT JOIN inscriptions i ON d.date=i.date_garde WHERE EXTRACT(YEAR FROM d.date)=$1 GROUP BY d.id,d.date,d.type,d.nom_jour_ferie,d.active,d.created_at ORDER BY d.date ASC', [annee])).rows); }
  catch(e) { res.status(500).json({error:'Erreur'}); }
});

app.post('/api/dates-garde', requireAuth, async (req, res) => {
  try { const r = await pool.query('INSERT INTO dates_garde (date,type,nom_jour_ferie,active) VALUES ($1,$2,$3,true) RETURNING *', [req.body.date, req.body.type, req.body.nom_jour_ferie||null]); res.json({success:true, date:r.rows[0]}); }
  catch(e) { if(e.code==='23505') res.status(400).json({error:'Existe déjà'}); else res.status(500).json({error:'Erreur'}); }
});

app.put('/api/dates-garde/:id', requireAuth, async (req, res) => {
  try { const r = await pool.query('UPDATE dates_garde SET active=COALESCE($1,active), nom_jour_ferie=COALESCE($2,nom_jour_ferie) WHERE id=$3 RETURNING *', [req.body.active, req.body.nom_jour_ferie, req.params.id]); if(r.rows.length===0) return res.status(404).json({error:'Non trouvée'}); res.json({success:true, date:r.rows[0]}); }
  catch(e) { res.status(500).json({error:'Erreur'}); }
});

app.delete('/api/dates-garde/:id', requireAuth, async (req, res) => {
  try {
    const dc = await pool.query('SELECT date FROM dates_garde WHERE id=$1', [req.params.id]);
    if(dc.rows.length===0) return res.status(404).json({error:'Non trouvée'});
    const ic = await pool.query('SELECT COUNT(*) as nb FROM inscriptions WHERE date_garde=$1', [dc.rows[0].date]);
    if(parseInt(ic.rows[0].nb)>0) return res.status(400).json({error:'Inscriptions existent'});
    await pool.query('DELETE FROM dates_garde WHERE id=$1', [req.params.id]); res.json({success:true});
  } catch(e) { res.status(500).json({error:'Erreur'}); }
});

// ========== CAMPAGNES DE DEPLOIEMENT ==========

// Auto-détection des colonnes
function autoDetectMapping(headers) {
  const mapping = { nom: null, prenom: null, email: null, email2: null, age: null, rpps: null, ville: null, code_postal: null, telephone: null };
  const lower = headers.map(h => (h || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''));
  
  lower.forEach((h, i) => {
    if (!h) return;
    if (h.includes('nom') && !h.includes('prenom') && !h.includes('prénom') && !mapping.nom) mapping.nom = i;
    else if (h.includes('prenom') || h.includes('prénom') || h.includes('prenom (usuel)')) { if (!mapping.prenom) mapping.prenom = i; }
    else if (h.includes('email pro') || h === 'email' || h === 'e-mail' || h === 'mail' || h === 'courriel') { if (!mapping.email) mapping.email = i; else if (!mapping.email2) mapping.email2 = i; }
    else if (h.includes('email contact') || h.includes('email oncd') || h.includes('email priv')) { if (!mapping.email) mapping.email = i; else if (!mapping.email2) mapping.email2 = i; }
    else if (h === 'age' || h === 'âge') mapping.age = i;
    else if (h.includes('rpps')) mapping.rpps = i;
    else if (h.includes('localite') || h.includes('localité') || h.includes('ville') || h.includes('commune')) mapping.ville = i;
    else if (h.includes('cp ') || h === 'cp' || h.includes('code postal') || h === 'bdi' || h.includes('pro cp')) mapping.code_postal = i;
    else if (h.includes('tel') || h.includes('mobile') || h.includes('portable')) { if (!mapping.telephone) mapping.telephone = i; }
  });

  // Deuxième passe plus large si des champs manquent
  if (!mapping.nom) lower.forEach((h, i) => { if (h.includes('nom') && !mapping.nom) mapping.nom = i; });
  if (!mapping.email) lower.forEach((h, i) => { if (h.includes('email') && !mapping.email) mapping.email = i; });
  if (!mapping.email2) lower.forEach((h, i) => { if (h.includes('email') && i !== mapping.email && !mapping.email2) mapping.email2 = i; });
  
  return mapping;
}

// Upload et analyse Excel
app.post('/api/campagnes/upload-liste', requireAuth, uploadExcel.single('fichier'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Aucun fichier' });
  try {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(req.file.buffer);
    const ws = wb.worksheets[0];
    if (!ws || ws.rowCount < 2) return res.status(400).json({ error: 'Fichier vide ou sans données' });

    // Lire les en-têtes
    const headerRow = ws.getRow(1);
    const headers = [];
    headerRow.eachCell({ includeEmpty: true }, (cell, colNum) => { headers[colNum - 1] = cell.value ? String(cell.value).trim() : ''; });

    // Auto-détection
    const mapping = autoDetectMapping(headers);

    // Lire toutes les lignes
    const rows = [];
    ws.eachRow({ includeEmpty: false }, (row, rowNum) => {
      if (rowNum === 1) return;
      const vals = [];
      row.eachCell({ includeEmpty: true }, (cell, colNum) => { vals[colNum - 1] = cell.value != null ? String(cell.value).trim() : ''; });
      rows.push(vals);
    });

    // Stats avec mapping actuel
    const stats = computeUploadStats(rows, mapping);

    // Preview (10 premières lignes)
    const preview = rows.slice(0, 10).map(r => ({
      nom: mapping.nom !== null ? r[mapping.nom] || '' : '',
      prenom: mapping.prenom !== null ? r[mapping.prenom] || '' : '',
      email: getEmailFromRow(r, mapping),
      rpps: mapping.rpps !== null ? r[mapping.rpps] || '' : '',
      ville: mapping.ville !== null ? r[mapping.ville] || '' : '',
      code_postal: mapping.code_postal !== null ? r[mapping.code_postal] || '' : '',
    }));

    // Stocker temporairement
    const uploadId = Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
    tempUploads.set(uploadId, { rows, headers, timestamp: Date.now(), filename: req.file.originalname });

    res.json({ success: true, upload_id: uploadId, headers, mapping, stats, preview, total_rows: rows.length });
  } catch (e) {
    console.error('❌ Erreur parse Excel:', e);
    res.status(500).json({ error: 'Erreur lecture fichier Excel' });
  }
});

// Recalculer stats avec un mapping modifié
app.post('/api/campagnes/recalculer-mapping', requireAuth, async (req, res) => {
  const { upload_id, mapping } = req.body;
  const upload = tempUploads.get(upload_id);
  if (!upload) return res.status(404).json({ error: 'Upload expiré, renvoyez le fichier' });

  const stats = computeUploadStats(upload.rows, mapping);
  const preview = upload.rows.slice(0, 10).map(r => ({
    nom: mapping.nom !== null ? r[mapping.nom] || '' : '',
    prenom: mapping.prenom !== null ? r[mapping.prenom] || '' : '',
    email: getEmailFromRow(r, mapping),
    rpps: mapping.rpps !== null ? r[mapping.rpps] || '' : '',
    ville: mapping.ville !== null ? r[mapping.ville] || '' : '',
    code_postal: mapping.code_postal !== null ? r[mapping.code_postal] || '' : '',
  }));

  res.json({ stats, preview });
});

function getEmailFromRow(row, mapping) {
  const e1 = mapping.email !== null ? (row[mapping.email] || '').trim() : '';
  const e2 = mapping.email2 !== null ? (row[mapping.email2] || '').trim() : '';
  if (e1 && validerEmail(e1)) return e1;
  if (e2 && validerEmail(e2)) return e2;
  return e1 || e2 || '';
}

function computeUploadStats(rows, mapping) {
  let total = rows.length, avecEmail = 0, sansEmail = 0, avecEmailPro = 0;
  rows.forEach(r => {
    const e1 = mapping.email !== null ? (r[mapping.email] || '').trim() : '';
    const e2 = mapping.email2 !== null ? (r[mapping.email2] || '').trim() : '';
    const hasE1 = e1 && validerEmail(e1);
    const hasE2 = e2 && validerEmail(e2);
    if (hasE1 || hasE2) avecEmail++;
    else sansEmail++;
    if (hasE1) avecEmailPro++;
  });
  return { total, avec_email: avecEmail, sans_email: sansEmail, avec_email_prioritaire: avecEmailPro };
}

// Créer la campagne avec les destinataires
app.post('/api/campagnes', requireAuth, async (req, res) => {
  const { upload_id, mapping, nom, annee_cible, lien_inscription, signataire, sujet_email, titre_header, sous_titre_header, couleur1, couleur2, contenu_html, documents_joints } = req.body;
  const upload = tempUploads.get(upload_id);
  if (!upload) return res.status(404).json({ error: 'Upload expiré, renvoyez le fichier' });

  try {
    const campR = await pool.query(`
      INSERT INTO campagnes (nom, annee_cible, lien_inscription, signataire, sujet_email, titre_header, sous_titre_header, couleur1, couleur2, contenu_html, documents_joints, statut, nb_destinataires)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'brouillon',0) RETURNING *`,
      [nom || `Campagne ${annee_cible}`, annee_cible, lien_inscription, signataire, sujet_email || 'Service de garde – Inscription {{ANNEE}}',
       titre_header || 'Service de garde – Inscription', sous_titre_header || '', couleur1 || '#667eea', couleur2 || '#764ba2',
       contenu_html || '', documents_joints || '[]']);
    const campagne = campR.rows[0];

    // Insérer les destinataires
    let nbInserted = 0;
    for (const row of upload.rows) {
      const email = getEmailFromRow(row, mapping);
      if (!email || !validerEmail(email)) continue;
      const nom_d = mapping.nom !== null ? row[mapping.nom] || '' : '';
      const prenom_d = mapping.prenom !== null ? row[mapping.prenom] || '' : '';
      const rpps_d = mapping.rpps !== null ? row[mapping.rpps] || '' : '';
      const age_d = mapping.age !== null ? parseInt(row[mapping.age]) || null : null;
      const ville_d = mapping.ville !== null ? row[mapping.ville] || '' : '';
      const cp_d = mapping.code_postal !== null ? row[mapping.code_postal] || '' : '';
      await pool.query('INSERT INTO campagne_destinataires (campagne_id, nom, prenom, email, rpps, age, ville, code_postal) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
        [campagne.id, nom_d, prenom_d, email, rpps_d, age_d, ville_d, cp_d]);
      nbInserted++;
    }

    await pool.query('UPDATE campagnes SET nb_destinataires=$1 WHERE id=$2', [nbInserted, campagne.id]);
    tempUploads.delete(upload_id);
    console.log(`🚀 Campagne #${campagne.id} créée (${nbInserted} destinataires)`);
    res.json({ success: true, campagne: { ...campagne, nb_destinataires: nbInserted } });
  } catch (e) {
    console.error('❌ Création campagne:', e);
    res.status(500).json({ error: 'Erreur création campagne' });
  }
});

// Mettre à jour le template de la campagne
app.put('/api/campagnes/:id', requireAuth, async (req, res) => {
  const { sujet_email, titre_header, sous_titre_header, couleur1, couleur2, contenu_html, documents_joints, lien_inscription, signataire, nom } = req.body;
  try {
    const r = await pool.query(`UPDATE campagnes SET 
      sujet_email=COALESCE($1,sujet_email), titre_header=COALESCE($2,titre_header), sous_titre_header=COALESCE($3,sous_titre_header),
      couleur1=COALESCE($4,couleur1), couleur2=COALESCE($5,couleur2), contenu_html=COALESCE($6,contenu_html),
      documents_joints=COALESCE($7,documents_joints), lien_inscription=COALESCE($8,lien_inscription),
      signataire=COALESCE($9,signataire), nom=COALESCE($10,nom)
      WHERE id=$11 AND statut='brouillon' RETURNING *`,
      [sujet_email, titre_header, sous_titre_header, couleur1, couleur2, contenu_html, documents_joints, lien_inscription, signataire, nom, req.params.id]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Campagne non trouvée ou déjà lancée' });
    res.json({ success: true, campagne: r.rows[0] });
  } catch (e) { res.status(500).json({ error: 'Erreur' }); }
});

// Liste des campagnes
app.get('/api/campagnes', requireAuth, async (req, res) => {
  try { res.json((await pool.query('SELECT * FROM campagnes ORDER BY created_at DESC')).rows); }
  catch (e) { res.status(500).json({ error: 'Erreur' }); }
});

// Détail campagne + stats
app.get('/api/campagnes/:id', requireAuth, async (req, res) => {
  try {
    const cR = await pool.query('SELECT * FROM campagnes WHERE id=$1', [req.params.id]);
    if (cR.rows.length === 0) return res.status(404).json({ error: 'Non trouvée' });
    const campagne = cR.rows[0];
    const statsR = await pool.query(`
      SELECT statut, COUNT(*) as nb FROM campagne_destinataires WHERE campagne_id=$1 GROUP BY statut`, [campagne.id]);
    const stats = {};
    statsR.rows.forEach(r => { stats[r.statut] = parseInt(r.nb); });
    res.json({ campagne, stats });
  } catch (e) { res.status(500).json({ error: 'Erreur' }); }
});

// Destinataires avec filtre
app.get('/api/campagnes/:id/destinataires', requireAuth, async (req, res) => {
  try {
    const filtre = req.query.filtre || 'tous';
    let query = 'SELECT * FROM campagne_destinataires WHERE campagne_id=$1';
    if (filtre !== 'tous') {
      if (filtre === 'non_ouverts') query += " AND statut IN ('envoye','delivre')";
      if (filtre === 'ouverts_non_cliques') query += " AND statut = 'ouvert'";
      else query += ` AND statut='${filtre.replace(/[^a-z_]/g, '')}'`;
    }
    query += ' ORDER BY nom ASC, prenom ASC LIMIT 200';
    res.json((await pool.query(query, [req.params.id])).rows);
  } catch (e) { res.status(500).json({ error: 'Erreur' }); }
});

// Preview email campagne
app.post('/api/campagnes/:id/preview', requireAuth, async (req, res) => {
  try {
    const cR = await pool.query('SELECT * FROM campagnes WHERE id=$1', [req.params.id]);
    if (cR.rows.length === 0) return res.status(404).json({ error: 'Non trouvée' });
    const c = cR.rows[0];
    const sampleVars = { NOM: 'DUPONT', PRENOM: 'Jean', ANNEE: String(c.annee_cible || '2027'), LIEN_INSCRIPTION: c.lien_inscription || '#', SIGNATAIRE: c.signataire || '', ADMIN_EMAIL };
    const { html } = assemblerEmailHTML({ sujet: c.sujet_email, titre_header: c.titre_header, sous_titre_header: c.sous_titre_header, couleur1: c.couleur1, couleur2: c.couleur2, contenu_html: c.contenu_html }, sampleVars);
    res.json({ html });
  } catch (e) { res.status(500).json({ error: 'Erreur' }); }
});

// Lancer la campagne (requiert mot de passe)
app.post('/api/campagnes/:id/lancer', requireAuth, async (req, res) => {
  const { password, mode } = req.body;
  if (password !== ADMIN_PASSWORD) return res.status(403).json({ error: 'Mot de passe incorrect' });

  try {
    const cR = await pool.query('SELECT * FROM campagnes WHERE id=$1', [req.params.id]);
    if (cR.rows.length === 0) return res.status(404).json({ error: 'Non trouvée' });
    const campagne = cR.rows[0];
    if (campagne.statut !== 'brouillon') return res.status(400).json({ error: 'Campagne déjà lancée' });

    await pool.query("UPDATE campagnes SET statut='en_cours', mode_envoi=$1, lancee_at=NOW() WHERE id=$2", [mode || 'progressif', campagne.id]);
    console.log(`🚀 Campagne #${campagne.id} lancée (${mode || 'progressif'})`);

    // Lancer l'envoi en arrière-plan
    envoyerCampagne(campagne.id, mode || 'progressif');

    res.json({ success: true, message: 'Campagne lancée' });
  } catch (e) {
    console.error('❌ Lancement campagne:', e);
    res.status(500).json({ error: 'Erreur lancement' });
  }
});

// Supprimer une campagne (brouillon uniquement)
app.delete('/api/campagnes/:id', requireAuth, async (req, res) => {
  try {
    const r = await pool.query("DELETE FROM campagnes WHERE id=$1 AND statut='brouillon' RETURNING id", [req.params.id]);
    if (r.rows.length === 0) return res.status(400).json({ error: 'Impossible (campagne lancée ou inexistante)' });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: 'Erreur' }); }
});

// Relancer de manière ciblée (non-ouverts OU ouverts-non-cliqués) avec email personnalisé
app.post('/api/campagnes/:id/relancer-cible', requireAuth, async (req, res) => {
  const { password, type, sujet, contenu_html } = req.body;
  if (password !== ADMIN_PASSWORD) return res.status(403).json({ error: 'Mot de passe incorrect' });
  if (!type || !['non_ouverts', 'ouverts_non_cliques'].includes(type)) return res.status(400).json({ error: 'Type invalide' });
  if (!sujet || !contenu_html) return res.status(400).json({ error: 'Sujet et contenu requis' });
  try {
    const cR = await pool.query('SELECT * FROM campagnes WHERE id=$1', [req.params.id]);
    if (cR.rows.length === 0) return res.status(404).json({ error: 'Non trouvée' });
    const campagne = cR.rows[0];
    if (campagne.statut !== 'terminee') return res.status(400).json({ error: 'Campagne non terminée' });

    // Sélectionner les destinataires selon le type
    let statutFilter;
    if (type === 'non_ouverts') {
      statutFilter = "statut IN ('envoye','delivre')";
    } else {
      statutFilter = "statut = 'ouvert'";
    }

    const destR = await pool.query(`SELECT * FROM campagne_destinataires WHERE campagne_id=$1 AND ${statutFilter}`, [campagne.id]);
    if (destR.rows.length === 0) return res.json({ success: true, nb_relances: 0 });

    // Remettre ces destinataires en attente
    await pool.query(`UPDATE campagne_destinataires SET statut='en_attente', message_id=NULL, envoi_at=NULL WHERE campagne_id=$1 AND ${statutFilter}`, [campagne.id]);

    // Mettre à jour la campagne avec le nouveau sujet/contenu pour la relance
    // On stocke temporairement dans des champs dédiés
    await pool.query("UPDATE campagnes SET statut='en_cours', nb_envoyes=nb_envoyes-$1, lancee_at=NOW(), terminee_at=NULL WHERE id=$2", [destR.rows.length, campagne.id]);

    const typeLabel = type === 'non_ouverts' ? 'non-ouverts' : 'ouverts non-cliqués';
    console.log(`🔄 Relance ciblée campagne #${campagne.id}: ${destR.rows.length} ${typeLabel}`);

    // Lancer l'envoi avec le contenu personnalisé
    envoyerRelanceCiblee(campagne.id, sujet, contenu_html, campagne);
    res.json({ success: true, nb_relances: destR.rows.length, type: typeLabel });
  } catch (e) { console.error('Erreur relance ciblée:', e); res.status(500).json({ error: 'Erreur' }); }
});

// Compteurs relance par type
app.get('/api/campagnes/:id/stats-relance', requireAuth, async (req, res) => {
  try {
    const cR = await pool.query('SELECT * FROM campagnes WHERE id=$1', [req.params.id]);
    if (cR.rows.length === 0) return res.status(404).json({ error: 'Non trouvée' });
    const nonOuv = await pool.query("SELECT COUNT(*) as n FROM campagne_destinataires WHERE campagne_id=$1 AND statut IN ('envoye','delivre')", [req.params.id]);
    const ouvNonCli = await pool.query("SELECT COUNT(*) as n FROM campagne_destinataires WHERE campagne_id=$1 AND statut = 'ouvert'", [req.params.id]);
    res.json({ non_ouverts: parseInt(nonOuv.rows[0].n), ouverts_non_cliques: parseInt(ouvNonCli.rows[0].n) });
  } catch (e) { res.status(500).json({ error: 'Erreur' }); }
});

// Fonction d'envoi pour relance ciblée (sujet/contenu custom)
async function envoyerRelanceCiblee(campagneId, sujetCustom, contenuCustom, campagneOrigine) {
  const delai = 2000;
  try {
    // Charger les PJ
    const attachments = [];
    try {
      let pjIds = JSON.parse(campagneOrigine.documents_joints || '[]');
      if (pjIds.length > 0 && supabase) {
        const docs = await pool.query('SELECT * FROM documents_garde WHERE id = ANY($1) AND actif=true', [pjIds]);
        for (const doc of docs.rows) {
          try {
            const { data, error } = await supabase.storage.from(BUCKET_NAME).download(doc.supabase_path);
            if (!error) {
              const buffer = Buffer.from(await data.arrayBuffer());
              attachments.push({ name: doc.nom_email, content: buffer.toString('base64') });
            }
          } catch (e) {}
        }
      }
    } catch (e) {}

    // Récupérer destinataires en attente
    const destR = await pool.query("SELECT * FROM campagne_destinataires WHERE campagne_id=$1 AND statut='en_attente' ORDER BY id ASC", [campagneId]);
    console.log(`📧 Relance ciblée #${campagneId}: ${destR.rows.length} emails à envoyer`);

    let nbEnvoyes = 0, nbErreurs = 0;
    for (const dest of destR.rows) {
      try {
        const vars = {
          NOM: dest.nom || '', PRENOM: dest.prenom || '',
          ANNEE: String(campagneOrigine.annee_cible || ''),
          LIEN_INSCRIPTION: campagneOrigine.lien_inscription || '',
          SIGNATAIRE: campagneOrigine.signataire || '',
          ADMIN_EMAIL
        };
        const { sujet, html } = assemblerEmailHTML({
          sujet: sujetCustom, titre_header: campagneOrigine.titre_header,
          sous_titre_header: campagneOrigine.sous_titre_header,
          couleur1: campagneOrigine.couleur1, couleur2: campagneOrigine.couleur2,
          contenu_html: contenuCustom
        }, vars);

        const emailData = { sender: { name: EMAIL_FROM_NAME, email: EMAIL_FROM }, to: [{ email: dest.email }], subject: sujet, htmlContent: html };
        if (attachments.length > 0) emailData.attachment = attachments;
        emailData.tags = [`campagne-${campagneId}`, 'relance'];

        const response = await fetch('https://api.brevo.com/v3/smtp/email', {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'api-key': BREVO_API_KEY },
          body: JSON.stringify(emailData)
        });

        if (response.ok) {
          const result = await response.json();
          await pool.query("UPDATE campagne_destinataires SET statut='envoye', message_id=$1, envoi_at=NOW() WHERE id=$2", [result.messageId, dest.id]);
          nbEnvoyes++;
        } else {
          const errTxt = await response.text();
          await pool.query("UPDATE campagne_destinataires SET statut='erreur', erreur_detail=$1, envoi_at=NOW() WHERE id=$2", [errTxt.substring(0, 500), dest.id]);
          nbErreurs++;
          console.error(`❌ Relance email → ${dest.email}: ${response.status}`);
        }

        if (delai > 0) await new Promise(r => setTimeout(r, delai));
      } catch (e) {
        console.error(`❌ Erreur relance → ${dest.email}:`, e.message);
        await pool.query("UPDATE campagne_destinataires SET statut='erreur', erreur_detail=$1 WHERE id=$2", [e.message.substring(0, 500), dest.id]);
        nbErreurs++;
      }
    }

    await pool.query("UPDATE campagnes SET statut='terminee', nb_envoyes=$1, nb_erreurs=$2, terminee_at=NOW() WHERE id=$3",
      [nbEnvoyes, nbErreurs, campagneId]);
    console.log(`✅ Relance ciblée #${campagneId} terminée: ${nbEnvoyes} envoyés, ${nbErreurs} erreurs`);
  } catch (e) {
    console.error(`❌ Erreur relance ciblée #${campagneId}:`, e);
    await pool.query("UPDATE campagnes SET statut='terminee', terminee_at=NOW() WHERE id=$1", [campagneId]);
  }
}

// Fonction d'envoi campagne (background)
async function envoyerCampagne(campagneId, mode) {
  const delai = mode === 'progressif' ? 2000 : 100; // 2s ou 100ms entre chaque email
  try {
    const cR = await pool.query('SELECT * FROM campagnes WHERE id=$1', [campagneId]);
    if (cR.rows.length === 0) return;
    const campagne = cR.rows[0];

    // Charger les PJ sélectionnées
    const attachments = [];
    try {
      let pjIds = JSON.parse(campagne.documents_joints || '[]');
      if (pjIds.length > 0 && supabase) {
        const docs = await pool.query('SELECT * FROM documents_garde WHERE id = ANY($1) AND actif=true', [pjIds]);
        for (const doc of docs.rows) {
          try {
            const { data, error } = await supabase.storage.from(BUCKET_NAME).download(doc.supabase_path);
            if (!error) {
              const buffer = Buffer.from(await data.arrayBuffer());
              attachments.push({ name: doc.nom_email, content: buffer.toString('base64') });
            }
          } catch (e) {}
        }
      }
    } catch (e) {}

    // Récupérer destinataires en attente
    const destR = await pool.query("SELECT * FROM campagne_destinataires WHERE campagne_id=$1 AND statut='en_attente' ORDER BY id ASC", [campagneId]);
    console.log(`📧 Envoi campagne #${campagneId}: ${destR.rows.length} emails à envoyer (mode: ${mode})`);

    let nbEnvoyes = 0, nbErreurs = 0;
    for (const dest of destR.rows) {
      try {
        // Préparer les variables
        const vars = {
          NOM: dest.nom || '', PRENOM: dest.prenom || '',
          ANNEE: String(campagne.annee_cible || ''),
          LIEN_INSCRIPTION: campagne.lien_inscription || '',
          SIGNATAIRE: campagne.signataire || '',
          ADMIN_EMAIL
        };
        const { sujet, html } = assemblerEmailHTML({
          sujet: campagne.sujet_email, titre_header: campagne.titre_header,
          sous_titre_header: campagne.sous_titre_header,
          couleur1: campagne.couleur1, couleur2: campagne.couleur2,
          contenu_html: campagne.contenu_html
        }, vars);

        // Envoyer via Brevo (sans CC admin pour les campagnes de masse)
        const emailData = { sender: { name: EMAIL_FROM_NAME, email: EMAIL_FROM }, to: [{ email: dest.email }], subject: sujet, htmlContent: html };
        if (attachments.length > 0) emailData.attachment = attachments;
        emailData.tags = [`campagne-${campagneId}`];

        const response = await fetch('https://api.brevo.com/v3/smtp/email', {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'api-key': BREVO_API_KEY },
          body: JSON.stringify(emailData)
        });

        if (response.ok) {
          const result = await response.json();
          await pool.query("UPDATE campagne_destinataires SET statut='envoye', message_id=$1, envoi_at=NOW() WHERE id=$2", [result.messageId, dest.id]);
          nbEnvoyes++;
        } else {
          const errTxt = await response.text();
          await pool.query("UPDATE campagne_destinataires SET statut='erreur', erreur_detail=$1, envoi_at=NOW() WHERE id=$2", [errTxt.substring(0, 500), dest.id]);
          nbErreurs++;
          console.error(`❌ Campagne email → ${dest.email}: ${response.status}`);
        }

        // Mettre à jour les compteurs toutes les 10 envois
        if ((nbEnvoyes + nbErreurs) % 10 === 0) {
          await pool.query('UPDATE campagnes SET nb_envoyes=nb_envoyes+$1, nb_erreurs=nb_erreurs+$2 WHERE id=$3',
            [Math.min(nbEnvoyes, 10), Math.min(nbErreurs, 10), campagneId]);
          // Reset compteurs partiels si on fait batch
        }

        // Délai entre envois
        if (delai > 0) await new Promise(r => setTimeout(r, delai));
      } catch (e) {
        console.error(`❌ Erreur envoi campagne → ${dest.email}:`, e.message);
        await pool.query("UPDATE campagne_destinataires SET statut='erreur', erreur_detail=$1 WHERE id=$2", [e.message.substring(0, 500), dest.id]);
        nbErreurs++;
      }
    }

    // Finaliser
    await pool.query("UPDATE campagnes SET statut='terminee', nb_envoyes=$1, nb_erreurs=$2, terminee_at=NOW() WHERE id=$3",
      [nbEnvoyes, nbErreurs, campagneId]);
    console.log(`✅ Campagne #${campagneId} terminée: ${nbEnvoyes} envoyés, ${nbErreurs} erreurs`);
  } catch (e) {
    console.error(`❌ Erreur campagne #${campagneId}:`, e);
    await pool.query("UPDATE campagnes SET statut='terminee', terminee_at=NOW() WHERE id=$1", [campagneId]);
  }
}

// ========== WEBHOOK BREVO (NOUVEAU) ==========

app.post('/api/webhook/brevo', async (req, res) => {
  try {
    const secret = req.query.secret;
    if (process.env.BREVO_WEBHOOK_SECRET && secret !== process.env.BREVO_WEBHOOK_SECRET) {
      console.log('⚠️ Webhook Brevo : secret invalide');
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const data = req.body;
    const event = data.event;
    const email = data.email;
    const messageId = data['message-id'];
    const subject = data.subject || '';
    const tsEpoch = data.ts_epoch || null;
    const reason = data.reason || null;
    const tag = (data.tags && data.tags[0]) || null;

    console.log(`📨 Webhook Brevo: ${event} pour ${email} (${subject})`);

    // Stocker l'événement brut
    await pool.query(`
      INSERT INTO email_events (message_id, email, event, date_event, subject, reason, tag, ts_epoch, raw_data)
      VALUES ($1, $2, $3, NOW(), $4, $5, $6, $7, $8)
    `, [messageId, email, event, subject, reason, tag, tsEpoch, JSON.stringify(data)]);

    // Mettre à jour le statut dans inscriptions
    if (messageId && email) {
      let statut = null;
      switch(event) {
        case 'delivered':    statut = 'delivre'; break;
        case 'opened':
        case 'uniqueOpened': statut = 'ouvert'; break;
        case 'hardBounce':   statut = 'bounce_hard'; break;
        case 'softBounce':   statut = 'bounce_soft'; break;
        case 'blocked':      statut = 'bloque'; break;
        case 'spam':         statut = 'spam'; break;
        case 'invalid':      statut = 'invalide'; break;
        case 'error':        statut = 'erreur_brevo'; break;
        case 'click':        statut = 'clique'; break;
      }

      if (statut) {
        // Mise à jour inscriptions
        const cols = [
          { msgCol: 'email_confirmation_message_id', statutCol: 'email_confirmation_statut' },
          { msgCol: 'email_rappel_j7_message_id', statutCol: 'email_rappel_j7_statut' },
          { msgCol: 'email_rappel_j1_message_id', statutCol: 'email_rappel_j1_statut' },
        ];
        for (const col of cols) {
          // Ne pas downgrader un statut 'ouvert'
          await pool.query(`
            UPDATE inscriptions
            SET ${col.statutCol} = $1
            WHERE ${col.msgCol} = $2
            AND ${col.statutCol} NOT IN ('ouvert')
          `, [statut, messageId]);
        }

        // Mise à jour campagne_destinataires
        const isOuvert = ['ouvert'].includes(statut);
        const isClique = event === 'click';
        if (isClique) {
          await pool.query(`UPDATE campagne_destinataires SET statut='clique', nb_clics=nb_clics+1, derniere_activite=NOW() WHERE message_id=$1`, [messageId]);
        } else if (isOuvert) {
          await pool.query(`UPDATE campagne_destinataires SET statut=CASE WHEN statut='clique' THEN statut ELSE $1 END, nb_ouvertures=nb_ouvertures+1, derniere_activite=NOW() WHERE message_id=$2`, [statut, messageId]);
        } else {
          await pool.query(`UPDATE campagne_destinataires SET statut=$1, derniere_activite=NOW() WHERE message_id=$2 AND statut NOT IN ('ouvert','clique')`, [statut, messageId]);
        }
      }
    }

    res.status(200).json({ success: true });
  } catch (error) {
    console.error('❌ Erreur webhook Brevo:', error);
    res.status(200).json({ success: true }); // Toujours 200 pour éviter les retry Brevo
  }
});

// Route admin : événements email récents
app.get('/api/email-events', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT email, event, subject, date_event, reason, message_id
      FROM email_events
      ORDER BY created_at DESC
      LIMIT 100
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Erreur récupération événements:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ========== FONCTIONS UTILITAIRES ==========

function formatDateFr(date) {
  const j = ['dimanche','lundi','mardi','mercredi','jeudi','vendredi','samedi'];
  const m = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];
  return `${j[date.getDay()]} ${date.getDate()} ${m[date.getMonth()]} ${date.getFullYear()}`;
}

function buildVars(insc, dateF) {
  return { NOM:insc.praticien_nom, PRENOM:insc.praticien_prenom, DATE_GARDE:dateF, EMAIL:insc.praticien_email, TELEPHONE:insc.praticien_telephone, ADRESSE:`${insc.praticien_numero} ${insc.praticien_voie}, ${insc.praticien_code_postal} ${insc.praticien_ville}`, ADMIN_EMAIL };
}

// ✅ MODIFIÉ : stocke messageId
async function envoyerEmailConfirmation(inscription) {
  const dateF = formatDateFr(new Date(inscription.date_garde));
  const tpl = await getTemplate('confirmation');
  const { sujet, html } = assemblerEmailHTML(tpl, buildVars(inscription, dateF));
  const pInfo = {nom:inscription.praticien_nom, prenom:inscription.praticien_prenom, dateGarde:dateF};
  try {
    const result = await envoyerEmailAvecPJ(inscription.praticien_email, sujet, html, tpl, pInfo);
    await pool.query('UPDATE inscriptions SET email_confirmation_envoi_at=NOW(), email_confirmation_statut=$1, email_confirmation_message_id=$2 WHERE id=$3', [result.success?'envoye':'erreur', result.messageId, inscription.id]);
    if (!result.success) throw new Error('Échec');
  } catch(e) { await pool.query('UPDATE inscriptions SET email_confirmation_statut=$1 WHERE id=$2', ['erreur', inscription.id]); throw e; }
}

// ✅ MODIFIÉ : stocke messageId
async function envoyerRappels() {
  let nbJ7=0, nbJ1=0;
  try {
    const tplJ7 = await getTemplate('rappel_j7');
    const j7 = await pool.query(`SELECT * FROM inscriptions WHERE date_garde = CURRENT_DATE + INTERVAL '7 days' AND (email_rappel_j7_statut IS NULL OR email_rappel_j7_statut='non_envoye')`);
    for (const insc of j7.rows) {
      const dateF = formatDateFr(new Date(insc.date_garde));
      const { sujet, html } = assemblerEmailHTML(tplJ7, buildVars(insc, dateF));
      const pInfo = {nom:insc.praticien_nom, prenom:insc.praticien_prenom, dateGarde:dateF};
      const result = await envoyerEmailAvecPJ(insc.praticien_email, sujet, html, tplJ7, pInfo);
      await pool.query('UPDATE inscriptions SET email_rappel_j7_envoi_at=NOW(), email_rappel_j7_statut=$1, email_rappel_j7_message_id=$2 WHERE id=$3', [result.success?'envoye':'erreur', result.messageId, insc.id]);
      if (result.success) nbJ7++;
    }
    const tplJ1 = await getTemplate('rappel_j1');
    const j1 = await pool.query(`SELECT * FROM inscriptions WHERE date_garde = CURRENT_DATE + INTERVAL '1 day' AND (email_rappel_j1_statut IS NULL OR email_rappel_j1_statut='non_envoye')`);
    for (const insc of j1.rows) {
      const dateF = formatDateFr(new Date(insc.date_garde));
      const { sujet, html } = assemblerEmailHTML(tplJ1, buildVars(insc, dateF));
      const pInfo = {nom:insc.praticien_nom, prenom:insc.praticien_prenom, dateGarde:dateF};
      const result = await envoyerEmailAvecPJ(insc.praticien_email, sujet, html, tplJ1, pInfo);
      await pool.query('UPDATE inscriptions SET email_rappel_j1_envoi_at=NOW(), email_rappel_j1_statut=$1, email_rappel_j1_message_id=$2 WHERE id=$3', [result.success?'envoye':'erreur', result.messageId, insc.id]);
      if (result.success) nbJ1++;
    }
    console.log(`⏰ Rappels: ${nbJ7} J-7, ${nbJ1} J-1`);
    return { j7_traites:j7.rows.length, j7_envoyes:nbJ7, j1_traites:j1.rows.length, j1_envoyes:nbJ1 };
  } catch(e) { console.error('❌ Rappels:', e); throw e; }
}

cron.schedule('0 8 * * *', () => { envoyerRappels(); });
setTimeout(() => { envoyerRappels(); }, 10000);

// ========== EXPORT EXCEL ==========

function getEaster(year) {
  const a=year%19, b=Math.floor(year/100), c=year%100, d=Math.floor(b/4), e=b%4;
  const f=Math.floor((b+8)/25), g=Math.floor((b-f+1)/3), h=(19*a+b-d-g+15)%30;
  const i=Math.floor(c/4), k=c%4, l=(32+2*e+2*i-h-k)%7, m=Math.floor((a+11*h+22*l)/451);
  const month=Math.floor((h+l-7*m+114)/31), day=((h+l-7*m+114)%31)+1;
  return new Date(year, month-1, day);
}
function addDays(d, n) { const r=new Date(d); r.setDate(r.getDate()+n); return r; }
function getISOWeek(d) { const t=new Date(d.getTime()); t.setHours(0,0,0,0); t.setDate(t.getDate()+3-(t.getDay()+6)%7); const w1=new Date(t.getFullYear(),0,4); return 1+Math.round(((t-w1)/864e5-(3-(w1.getDay()+6)%7))/7); }
const JOURS_FR = ['DIMANCHE','LUNDI','MARDI','MERCREDI','JEUDI','VENDREDI','SAMEDI'];

function getFeriesList(year) {
  const e = getEaster(year);
  return [
    { nom: "Jour de l'an", date: new Date(year,0,1) },
    { nom: "Lundi de Pâques", date: addDays(e,1) },
    { nom: "Fête du travail", date: new Date(year,4,1) },
    { nom: "Victoire 1945", date: new Date(year,4,8) },
    { nom: "Ascension (Jeudi)", date: addDays(e,39) },
    { nom: "Lundi de Pentecôte", date: addDays(e,50) },
    { nom: "Fête nationale", date: new Date(year,6,14) },
    { nom: "Assomption", date: new Date(year,7,15) },
    { nom: "Toussaint", date: new Date(year,10,1) },
    { nom: "Armistice 1918", date: new Date(year,10,11) },
    { nom: "Noël", date: new Date(year,11,25) },
  ];
}

function getDimanchesList(year) {
  const dimanches = [];
  let d = new Date(year, 0, 1);
  while (d.getDay() !== 0) d.setDate(d.getDate() + 1);
  while (d.getFullYear() === year) {
    dimanches.push(new Date(d));
    d.setDate(d.getDate() + 7);
  }
  return dimanches;
}

function formatDateDDMMYYYY(d) {
  const dd = String(d.getDate()).padStart(2,'0');
  const mm = String(d.getMonth()+1).padStart(2,'0');
  return `${dd}/${mm}/${d.getFullYear()}`;
}

function dateToKey(d) {
  if (d instanceof Date) return d.toISOString().split('T')[0];
  return String(d).split('T')[0];
}

// ========== CONFIGURATION ANNÉE ==========

async function getAnneeActive() {
  try { const r = await pool.query("SELECT valeur FROM configuration WHERE cle='annee_active'"); return r.rows.length ? parseInt(r.rows[0].valeur) : new Date().getFullYear(); }
  catch(e) { return new Date().getFullYear(); }
}

async function genererDatesAnnee(year) {
  let nbCreees = 0;
  const dimanches = getDimanchesList(year);
  for (const dim of dimanches) {
    const ds = dim.toISOString().split('T')[0];
    const existe = await pool.query('SELECT id FROM dates_garde WHERE date=$1', [ds]);
    if (existe.rows.length === 0) {
      await pool.query('INSERT INTO dates_garde (date, type, nom_jour_ferie, active) VALUES ($1, $2, NULL, true)', [ds, 'dimanche']);
      nbCreees++;
    }
  }
  const feries = getFeriesList(year);
  for (const f of feries) {
    if (f.date.getDay() === 0) continue;
    const ds = f.date.toISOString().split('T')[0];
    const existe = await pool.query('SELECT id FROM dates_garde WHERE date=$1', [ds]);
    if (existe.rows.length === 0) {
      await pool.query('INSERT INTO dates_garde (date, type, nom_jour_ferie, active) VALUES ($1, $2, $3, true)', [ds, 'jour_ferie', f.nom]);
      nbCreees++;
    }
  }
  return { dimanches: dimanches.length, feries: feries.filter(f => f.date.getDay() !== 0).length, nouvelles: nbCreees };
}

app.get('/api/configuration', requireAuth, async (req, res) => {
  try {
    const annee = await getAnneeActive();
    res.json({ annee_active: annee });
  } catch(e) { res.status(500).json({ error: 'Erreur' }); }
});

app.put('/api/configuration/annee', requireAuth, async (req, res) => {
  const { annee, password } = req.body;
  const year = parseInt(annee);
  if (!year || year < 2020 || year > 2100) return res.status(400).json({ error: 'Année invalide' });
  const pwd = (password || '').trim();
  const expected = (ADMIN_PASSWORD || '').trim();
  console.log(`📅 Tentative changement année → ${year}, mdp reçu: ${pwd.length} chars, attendu: ${expected.length} chars, match: ${pwd === expected}`);
  if (pwd !== expected) return res.status(403).json({ error: 'Mot de passe incorrect' });
  try {
    const result = await genererDatesAnnee(year);
    await pool.query("UPDATE configuration SET valeur=$1, updated_at=NOW() WHERE cle='annee_active'", [String(year)]);
    console.log(`📅 Année active → ${year} (${result.nouvelles} dates créées)`);
    res.json({ success: true, annee_active: year, dates_generees: result });
  } catch(e) { console.error('❌ Changement année:', e); res.status(500).json({ error: 'Erreur changement année' }); }
});

app.get('/api/export-excel', requireAuth, async (req, res) => {
  const anneeAct = await getAnneeActive();
  const year = parseInt(req.query.year) || anneeAct;
  try {
    const inscResult = await pool.query(
      'SELECT * FROM inscriptions WHERE EXTRACT(YEAR FROM date_garde)=$1 ORDER BY date_garde ASC, created_at ASC', [year]
    );
    const parDate = {};
    inscResult.rows.forEach(i => {
      const k = dateToKey(i.date_garde);
      if (!parDate[k]) parDate[k] = [];
      parDate[k].push(i);
    });

    const wb = new ExcelJS.Workbook();
    wb.creator = 'CDO 94';
    const ws = wb.addWorksheet(String(year), { properties: { defaultColWidth: 13 } });

    ws.getColumn('A').width = 7.13;
    ws.getColumn('B').width = 12.88;
    ws.getColumn('C').width = 9.75;
    ws.getColumn('D').width = 11;
    ws.getColumn('E').width = 4.5;
    ws.getColumn('F').width = 10.88;
    ws.getColumn('G').width = 17.38;
    for (let c = 8; c <= 21; c++) ws.getColumn(c).width = 13;

    const fontArial = { name: 'Arial', size: 10 };
    const fontArialBold = { name: 'Arial', size: 10, bold: true };
    const fillJaune = { type:'pattern', pattern:'solid', fgColor:{argb:'FFFFF2CC'} };
    const fillRose = { type:'pattern', pattern:'solid', fgColor:{argb:'FFF4CCCC'} };
    const fillViolet = { type:'pattern', pattern:'solid', fgColor:{argb:'FFD9D2E9'} };
    const fillOrange = { type:'pattern', pattern:'solid', fgColor:{argb:'FFFCE5CD'} };
    const fillBleu = { type:'pattern', pattern:'solid', fgColor:{argb:'FFC9DAF8'} };
    const wrapAlign = { wrapText: true, vertical: 'top' };

    ws.getRow(1).height = 22.5;
    ws.getCell('A1').value = 'Année'; ws.getCell('A1').font = fontArialBold;
    ws.getCell('B1').value = 'Département'; ws.getCell('B1').font = fontArialBold;
    ws.mergeCells('C1:F1');
    ws.getCell('C1').value = 'DATE'; ws.getCell('C1').font = fontArialBold; ws.getCell('C1').fill = fillJaune;
    ws.mergeCells('G1:I1');
    ws.getCell('G1').value = 'PRATICIEN DE GARDE'; ws.getCell('G1').font = fontArialBold; ws.getCell('G1').fill = fillRose;
    ws.mergeCells('L1:S1');
    ws.getCell('L1').value = 'Lieu de PDS'; ws.getCell('L1').font = fontArialBold; ws.getCell('L1').fill = fillViolet;

    ws.getRow(2).height = 61.5;
    ws.getCell('A2').value = year; ws.getCell('A2').font = fontArial;
    ws.getCell('B2').value = 94; ws.getCell('B2').font = { name:'Arial', size:36, bold:true }; ws.getCell('B2').alignment = { horizontal:'center', vertical:'center' };
    const headers2 = [
      ['C','Numéro de Semaine',fillJaune],['D','Nom du Jour',fillJaune],['F','Date du Jour',fillJaune],
      ['G','RPPS',fillRose],['H','NOM',fillRose],['I','Prénom',fillRose],
      ['J','Adresse Mail',null],['K','Num Portable',null],
      ['L','Numéro',fillViolet],['M','Voie',fillViolet],['N','Complément',fillViolet],
      ['O','Code Postal',fillViolet],['P','Ville',fillViolet],['Q','Etage',fillViolet],
      ['R',"Code d'Entrée si nécessaire",fillViolet],
      ['S','Nom Porte (si différent du praticien)',fillViolet],
      ['T','Tel Cabinet à donner au Patient',null],
      ['U','Infos complémentaires',null]
    ];
    headers2.forEach(([col, val, fill]) => {
      const cell = ws.getCell(`${col}2`);
      cell.value = val; cell.font = col <= 'F' ? fontArialBold : fontArial; cell.alignment = wrapAlign;
      if (fill) cell.fill = fill;
    });

    ws.getCell('A4').value = 'JOURS FÉRIÉS'; ws.getCell('A4').font = { name:'Arial', size:12, bold:true };
    ws.getCell('C4').value = '(ne pas remplir si le jour tombe un dimanche)'; ws.getCell('C4').font = { name:'Arial', size:9 };

    function fillPraticien(row, insc) {
      if (!insc) return;
      const r = ws.getRow(row);
      r.getCell('G').value = insc.praticien_rpps ? parseInt(insc.praticien_rpps) || insc.praticien_rpps : '';
      r.getCell('H').value = insc.praticien_nom || '';
      r.getCell('I').value = insc.praticien_prenom || '';
      r.getCell('J').value = insc.praticien_email || '';
      r.getCell('K').value = insc.praticien_telephone || '';
      r.getCell('L').value = insc.praticien_numero || '';
      r.getCell('M').value = insc.praticien_voie || '';
      r.getCell('O').value = insc.praticien_code_postal || '';
      r.getCell('P').value = insc.praticien_ville || '';
      r.getCell('Q').value = insc.praticien_etage || '';
      r.getCell('R').value = insc.praticien_code_entree || '';
      ['G','H','I','J','K','L','M','N','O','P','Q','R','S','T','U'].forEach(c => { r.getCell(c).font = fontArial; });
    }

    function fillDateCols(row, fill, opts) {
      const r = ws.getRow(row);
      ['C','D','E','F'].forEach(c => { r.getCell(c).fill = fill; r.getCell(c).font = fontArial; });
      if (opts.semaine !== undefined) r.getCell('C').value = opts.semaine;
      r.getCell('D').value = opts.jour || '';
      r.getCell('E').value = opts.ab || '';
      r.getCell('F').value = opts.date || '';
      if (opts.nom) { r.getCell('B').value = opts.nom; r.getCell('B').font = fontArial; r.getCell('B').fill = fillOrange; }
    }

    const feries = getFeriesList(year);
    let row = 6;
    feries.forEach(f => {
      const key = dateToKey(f.date);
      const inscs = parDate[key] || [];
      const jourNom = JOURS_FR[f.date.getDay()];
      const dateStr = formatDateDDMMYYYY(f.date);
      fillDateCols(row, fillOrange, { nom: f.nom, jour: jourNom, ab: 'a', date: dateStr });
      if (inscs[0]) fillPraticien(row, inscs[0]);
      row++;
      fillDateCols(row, fillOrange, { jour: jourNom, ab: 'b', date: dateStr });
      if (inscs[1]) fillPraticien(row, inscs[1]);
      row++;
    });

    ws.getCell('A29').value = 'DIMANCHES'; ws.getCell('A29').font = { name:'Arial', size:12, bold:true };

    const dimanches = getDimanchesList(year);
    row = 31;
    dimanches.forEach(dim => {
      const key = dateToKey(dim);
      const inscs = parDate[key] || [];
      const semaine = getISOWeek(dim);
      const dateStr = formatDateDDMMYYYY(dim);
      fillDateCols(row, fillBleu, { semaine, jour: 'DIMANCHE', ab: 'a', date: dateStr });
      if (inscs[0]) fillPraticien(row, inscs[0]);
      row++;
      fillDateCols(row, fillBleu, { semaine, jour: 'DIMANCHE', ab: 'b', date: dateStr });
      if (inscs[1]) fillPraticien(row, inscs[1]);
      row++;
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.document');
    res.setHeader('Content-Disposition', `attachment; filename=GARDES_PRATICIENS_94_${year}.xlsx`);
    await wb.xlsx.write(res);
    res.end();
    console.log(`📊 Export Excel ${year} (${inscResult.rows.length} inscriptions)`);
  } catch (e) {
    console.error('❌ Export Excel:', e);
    res.status(500).json({ error: 'Erreur export' });
  }
});

app.listen(PORT, () => { console.log(`🚀 Serveur sur http://localhost:${PORT}`); });
