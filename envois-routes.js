// ============================================================
// ==========  ENVOI EN NOMBRE — module serveur  ==============
// ============================================================
// Branché depuis server.js par :
//   require('./envois-routes')(app, { ...dépendances });
// Réutilise les tables campagnes / campagne_destinataires (type = 'envoi')
// et le webhook Brevo existant (mise à jour par message_id).
// ============================================================

module.exports = function registerEnvois(app, deps) {
  const {
    pool, supabase, BUCKET_NAME, requireAuth, ADMIN_PASSWORD, ADMIN_EMAIL,
    BREVO_API_KEY, EMAIL_FROM, EMAIL_FROM_NAME, assemblerEmailHTML, validerEmail,
    autoDetectMapping, tempUploads, ExcelJS, multer, AdmZip, cron,
  } = deps;

  const PJ_MAX_TOTAL = 10 * 1024 * 1024; // 10 Mo par email
  const STATUTS_ERREUR = ['erreur', 'erreur_brevo', 'bounce_hard', 'bounce_soft', 'bloque', 'invalide', 'spam'];
  const envoisEnCours = new Set(); // évite deux boucles d'envoi sur le même envoi

  // ---------- Migration (idempotente) ----------
  (async function migrer(essai = 1) {
    try {
      // server.js crée « campagnes » en parallèle au démarrage : on attend qu'elle existe
      const t = await pool.query("SELECT to_regclass('public.campagnes') AS t");
      if (!t.rows[0].t) { if (essai < 10) setTimeout(() => migrer(essai + 1), 3000); return; }
      await pool.query(`
        ALTER TABLE campagnes ADD COLUMN IF NOT EXISTS type VARCHAR(20) DEFAULT 'garde';
        ALTER TABLE campagnes ADD COLUMN IF NOT EXISTS reply_to VARCHAR(255);
        ALTER TABLE campagnes ADD COLUMN IF NOT EXISTS pj_envoi TEXT DEFAULT '[]';
        ALTER TABLE campagnes ADD COLUMN IF NOT EXISTS programme_at TIMESTAMP;
        ALTER TABLE campagnes ADD COLUMN IF NOT EXISTS test_envoye_at TIMESTAMP;
        ALTER TABLE campagnes ADD COLUMN IF NOT EXISTS relance_active BOOLEAN DEFAULT false;
        ALTER TABLE campagnes ADD COLUMN IF NOT EXISTS relance_sujet VARCHAR(500);
        ALTER TABLE campagnes ADD COLUMN IF NOT EXISTS relance_contenu TEXT;
        ALTER TABLE campagne_destinataires ADD COLUMN IF NOT EXISTS email_corrige BOOLEAN DEFAULT false;
        CREATE INDEX IF NOT EXISTS idx_campagnes_type ON campagnes(type);
      `);
      console.log('✅ Envoi en nombre : tables prêtes');
      // Reprise après redémarrage du serveur (déploiement Render…)
      const r = await pool.query("SELECT id, mode_envoi FROM campagnes WHERE type='envoi' AND statut='en_cours'");
      for (const c of r.rows) {
        console.log(`🔁 Reprise de l'envoi #${c.id} après redémarrage`);
        envoyerEnvoi(c.id, c.mode_envoi || 'progressif');
      }
    } catch (e) { console.error('❌ Init envoi en nombre:', e.message); }
  })();

  // ---------- Uploads ----------
  const uploadListe = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
  const uploadPJ = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: PJ_MAX_TOTAL },
    fileFilter: (req, file, cb) => cb(null, /\.(pdf|docx?|jpe?g|png)$/i.test(file.originalname)),
  });
  const uploadTexte = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => cb(null, /\.(docx|html?)$/i.test(file.originalname)),
  });

  // Transforme les erreurs multer (fichier trop gros…) en message lisible
  const avecUpload = mw => (req, res, next) => mw(req, res, err => {
    if (!err) return next();
    const msg = err.code === 'LIMIT_FILE_SIZE' ? 'Fichier trop volumineux (10 Mo max pour les pièces jointes, 20 Mo pour une liste)' : `Upload refusé : ${err.message}`;
    res.status(400).json({ error: msg });
  });

  // ---------- Utilitaires ----------
  const tronque = (v, n) => String(v == null ? '' : v).trim().slice(0, n);

  function lireCSV(buffer) {
    let txt = buffer.toString('utf8');
    if (txt.includes('\uFFFD')) txt = buffer.toString('latin1'); // export Excel « CSV (;) » en Windows-1252
    txt = txt.replace(/^\uFEFF/, '');
    const premiere = txt.split(/\r?\n/)[0] || '';
    const sep = (premiere.match(/;/g) || []).length >= (premiere.match(/,/g) || []).length ? ';' : ',';
    const lignes = []; let ligne = [], champ = '', guill = false;
    for (let i = 0; i < txt.length; i++) {
      const c = txt[i];
      if (guill) {
        if (c === '"' && txt[i + 1] === '"') { champ += '"'; i++; }
        else if (c === '"') guill = false;
        else champ += c;
      } else if (c === '"') guill = true;
      else if (c === sep) { ligne.push(champ.trim()); champ = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && txt[i + 1] === '\n') i++;
        ligne.push(champ.trim()); champ = '';
        if (ligne.some(v => v)) lignes.push(ligne);
        ligne = [];
      } else champ += c;
    }
    ligne.push(champ.trim()); if (ligne.some(v => v)) lignes.push(ligne);
    return { headers: lignes[0] || [], rows: lignes.slice(1) };
  }

  async function lireExcel(buffer) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const ws = wb.worksheets[0];
    if (!ws) return { headers: [], rows: [] };
    const headers = [];
    ws.getRow(1).eachCell({ includeEmpty: true }, (cell, col) => { headers[col - 1] = (cell.text || '').trim(); });
    const rows = [];
    ws.eachRow({ includeEmpty: false }, (row, n) => {
      if (n === 1) return;
      const vals = [];
      // cell.text gère aussi les cellules « lien hypertexte » (fréquent pour les emails)
      row.eachCell({ includeEmpty: true }, (cell, col) => { vals[col - 1] = (cell.text || '').trim(); });
      if (vals.some(v => v)) rows.push(vals);
    });
    return { headers, rows };
  }

  function emailDeLigne(row, m) {
    const e1 = m.email != null ? (row[m.email] || '').trim() : '';
    const e2 = m.email2 != null ? (row[m.email2] || '').trim() : '';
    if (e1 && validerEmail(e1)) return e1;
    if (e2 && validerEmail(e2)) return e2;
    return e1 || e2 || '';
  }

  // Analyse complète : chaque ligne avec son statut (valide / sans email / doublon)
  function analyserListe(rows, m) {
    const vus = new Set();
    let avec = 0, sans = 0, doublons = 0;
    const lignes = rows.map((r, i) => {
      const email = emailDeLigne(r, m);
      const valide = !!email && validerEmail(email);
      let doublon = false;
      if (valide) {
        const k = email.toLowerCase();
        if (vus.has(k)) { doublon = true; doublons++; } else { vus.add(k); avec++; }
      } else sans++;
      const col = k => (m[k] != null ? r[m[k]] || '' : '');
      return { i, nom: col('nom'), prenom: col('prenom'), email, rpps: col('rpps'), ville: col('ville'), code_postal: col('code_postal'), valide, doublon };
    });
    return { lignes, stats: { total: rows.length, avec_email: avec, sans_email: sans, doublons } };
  }

  function variablesPour(dest, envoi) {
    return {
      NOM: dest.nom || '', PRENOM: dest.prenom || '', EMAIL: dest.email || '',
      VILLE: dest.ville || '', SIGNATAIRE: envoi.signataire || '', ADMIN_EMAIL,
    };
  }

  function parsePJ(envoi) { try { return JSON.parse(envoi.pj_envoi || '[]'); } catch (e) { return []; } }

  async function chargerPJEnvoi(envoi) {
    const out = [];
    if (!supabase) return out;
    for (const pj of parsePJ(envoi)) {
      try {
        const { data, error } = await supabase.storage.from(BUCKET_NAME).download(pj.path);
        if (error) { console.error(`⚠️ PJ introuvable: ${pj.path}`); continue; }
        out.push({ name: pj.nom, content: Buffer.from(await data.arrayBuffer()).toString('base64') });
      } catch (e) { console.error('⚠️ PJ:', e.message); }
    }
    return out;
  }

  function assembler(envoi, vars, surcharge) {
    return assemblerEmailHTML({
      sujet: (surcharge && surcharge.sujet) || envoi.sujet_email || '',
      titre_header: envoi.titre_header || 'CDO 94',
      sous_titre_header: envoi.sous_titre_header || '',
      couleur1: envoi.couleur1, couleur2: envoi.couleur2,
      contenu_html: (surcharge && surcharge.contenu) || envoi.contenu_html || '',
    }, vars);
  }

  async function posterBrevo(emailData) {
    return fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'api-key': BREVO_API_KEY },
      body: JSON.stringify(emailData),
    });
  }

  async function getEnvoi(id) {
    const r = await pool.query("SELECT * FROM campagnes WHERE id=$1 AND type='envoi'", [id]);
    return r.rows[0] || null;
  }

  function verifMdp(req, res) {
    if (req.body.password !== ADMIN_PASSWORD) { res.status(403).json({ error: 'Mot de passe incorrect' }); return false; }
    return true;
  }

  // ---------- Conversion texte importé → HTML ----------
  function docxVersHTML(buffer) {
    const xml = new AdmZip(buffer).readAsText('word/document.xml');
    const corps = xml.split(/<w:body>/)[1] || xml;
    const paras = corps.match(/<w:p[ >][\s\S]*?<\/w:p>/g) || [];
    let html = '', dansListe = false;
    for (const p of paras) {
      let txt = '';
      for (const run of (p.match(/<w:r[ >][\s\S]*?<\/w:r>/g) || [])) {
        const props = (run.match(/<w:rPr>[\s\S]*?<\/w:rPr>/) || [''])[0];
        let t = (run.match(/<w:t(?: [^>]*)?>[\s\S]*?<\/w:t>|<w:tab\/>|<w:br\/>/g) || [])
          .map(x => x === '<w:tab/>' ? ' ' : x === '<w:br/>' ? '<br>' : x.replace(/<[^>]+>/g, '')).join('');
        if (!t) continue;
        const actif = tag => new RegExp(`<w:${tag}(?: w:val="(?!0|false|none)[^"]*")?\\/>`).test(props);
        if (actif('b')) t = `<strong>${t}</strong>`;
        if (actif('i')) t = `<em>${t}</em>`;
        if (actif('u')) t = `<u>${t}</u>`;
        txt += t;
      }
      const style = (p.match(/<w:pStyle w:val="([^"]+)"/) || [])[1] || '';
      const estListe = /<w:numPr>/.test(p);
      if (estListe && !dansListe) { html += '<ul>'; dansListe = true; }
      if (!estListe && dansListe) { html += '</ul>'; dansListe = false; }
      if (estListe) html += `<li>${txt}</li>`;
      else if (/^(Heading|Titre|Title)/i.test(style) && txt) html += `<h3>${txt}</h3>`;
      else html += txt ? `<p>${txt}</p>` : '<p><br></p>';
    }
    if (dansListe) html += '</ul>';
    return html;
  }

  function nettoyerHTML(src) {
    const body = (src.match(/<body[^>]*>([\s\S]*)<\/body>/i) || [null, src])[1];
    return body
      .replace(/<(script|style|head|iframe|object)[\s\S]*?<\/\1>/gi, '')
      .replace(/\son\w+="[^"]*"/gi, '').replace(/\son\w+='[^']*'/gi, '')
      .replace(/javascript:/gi, '');
  }

  // ========== ROUTES ==========

  // Liste des envois
  app.get('/api/envois', requireAuth, async (req, res) => {
    try { res.json((await pool.query("SELECT * FROM campagnes WHERE type='envoi' ORDER BY created_at DESC")).rows); }
    catch (e) { res.status(500).json({ error: 'Erreur' }); }
  });

  // Détail + stats
  app.get('/api/envois/:id', requireAuth, async (req, res) => {
    try {
      const envoi = await getEnvoi(req.params.id);
      if (!envoi) return res.status(404).json({ error: 'Envoi introuvable' });
      const s = await pool.query('SELECT statut, COUNT(*) nb FROM campagne_destinataires WHERE campagne_id=$1 GROUP BY statut', [envoi.id]);
      const stats = {}; s.rows.forEach(r => { stats[r.statut] = parseInt(r.nb); });
      res.json({ envoi, stats });
    } catch (e) { res.status(500).json({ error: 'Erreur' }); }
  });

  // Étape 1 — import du fichier (xlsx / csv)
  app.post('/api/envois/upload-liste', requireAuth, avecUpload(uploadListe.single('fichier')), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Aucun fichier' });
    try {
      const estCSV = /\.csv$/i.test(req.file.originalname) || req.file.mimetype === 'text/csv';
      if (!estCSV && !/\.xlsx$/i.test(req.file.originalname)) return res.status(400).json({ error: 'Format accepté : .xlsx ou .csv' });
      const { headers, rows } = estCSV ? lireCSV(req.file.buffer) : await lireExcel(req.file.buffer);
      if (!rows.length) return res.status(400).json({ error: 'Fichier vide ou sans données' });
      const mapping = autoDetectMapping(headers);
      const upload_id = 'env' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
      tempUploads.set(upload_id, { rows, headers, timestamp: Date.now(), filename: req.file.originalname });
      res.json({ upload_id, filename: req.file.originalname, headers, mapping, ...analyserListe(rows, mapping) });
    } catch (e) { console.error('❌ Import liste envoi:', e); res.status(500).json({ error: 'Impossible de lire ce fichier' }); }
  });

  app.post('/api/envois/recalculer-mapping', requireAuth, async (req, res) => {
    const up = tempUploads.get(req.body.upload_id);
    if (!up) return res.status(404).json({ error: 'Import expiré (30 min), renvoyez le fichier' });
    up.timestamp = Date.now();
    res.json(analyserListe(up.rows, req.body.mapping || {}));
  });

  // Crée l'envoi (ou remplace sa liste s'il existe déjà en brouillon)
  app.post('/api/envois', requireAuth, async (req, res) => {
    const { upload_id, mapping, exclus, envoi_id } = req.body;
    const up = tempUploads.get(upload_id);
    if (!up) return res.status(404).json({ error: 'Import expiré (30 min), renvoyez le fichier' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      let envoi;
      if (envoi_id) {
        const r = await client.query("SELECT * FROM campagnes WHERE id=$1 AND type='envoi' AND statut='brouillon' FOR UPDATE", [envoi_id]);
        if (!r.rows.length) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Envoi introuvable ou déjà lancé' }); }
        envoi = r.rows[0];
        await client.query('DELETE FROM campagne_destinataires WHERE campagne_id=$1', [envoi.id]);
      } else {
        const r = await client.query(`INSERT INTO campagnes (type, nom, sujet_email, titre_header, contenu_html, signataire, reply_to, documents_joints, pj_envoi, statut, nb_destinataires)
          VALUES ('envoi', $1, '', 'CDO 94', '', 'Dr Agnès Danet', 'cdogardes94@gmail.com', '[]', '[]', 'brouillon', 0) RETURNING *`,
          [`Envoi du ${new Date().toLocaleDateString('fr-FR')}`]);
        envoi = r.rows[0];
      }
      const exclusSet = new Set((exclus || []).map(Number));
      const { lignes } = analyserListe(up.rows, mapping || {});
      const retenues = lignes.filter(l => l.valide && !l.doublon && !exclusSet.has(l.i));
      if (retenues.length) {
        await client.query(`INSERT INTO campagne_destinataires (campagne_id, nom, prenom, email, rpps, ville, code_postal)
          SELECT $1, * FROM unnest($2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[])`,
          [envoi.id, retenues.map(l => tronque(l.nom, 255)), retenues.map(l => tronque(l.prenom, 255)), retenues.map(l => tronque(l.email, 255)),
           retenues.map(l => tronque(l.rpps, 20)), retenues.map(l => tronque(l.ville, 255)), retenues.map(l => tronque(l.code_postal, 10))]);
      }
      const u = await client.query('UPDATE campagnes SET nb_destinataires=$1 WHERE id=$2 RETURNING *', [retenues.length, envoi.id]);
      await client.query('COMMIT');
      tempUploads.delete(upload_id);
      console.log(`📨 Envoi #${envoi.id} : ${retenues.length} destinataires`);
      res.json({ success: true, envoi: u.rows[0] });
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('❌ Création envoi:', e); res.status(500).json({ error: 'Erreur création envoi' });
    } finally { client.release(); }
  });

  // Étape 2 — enregistrer le contenu
  app.put('/api/envois/:id', requireAuth, async (req, res) => {
    const { nom, sujet_email, contenu_html, reply_to, signataire, titre_header } = req.body;
    if (reply_to && !validerEmail(reply_to)) return res.status(400).json({ error: 'Adresse « Répondre à » invalide' });
    try {
      const r = await pool.query(`UPDATE campagnes SET nom=COALESCE($1,nom), sujet_email=COALESCE($2,sujet_email), contenu_html=COALESCE($3,contenu_html),
        reply_to=$4, signataire=COALESCE($5,signataire), titre_header=COALESCE($6,titre_header)
        WHERE id=$7 AND type='envoi' AND statut='brouillon' RETURNING *`,
        [nom, sujet_email, contenu_html, reply_to || null, signataire, titre_header, req.params.id]);
      if (!r.rows.length) return res.status(400).json({ error: 'Envoi introuvable ou déjà lancé' });
      res.json({ success: true, envoi: r.rows[0] });
    } catch (e) { res.status(500).json({ error: 'Erreur' }); }
  });

  // Import du texte depuis un .docx ou .html
  app.post('/api/envois/import-texte', requireAuth, avecUpload(uploadTexte.single('fichier')), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Fichier .docx ou .html attendu' });
    try {
      const html = /\.docx$/i.test(req.file.originalname) ? docxVersHTML(req.file.buffer) : nettoyerHTML(req.file.buffer.toString('utf8'));
      res.json({ html });
    } catch (e) { console.error('❌ Import texte:', e.message); res.status(500).json({ error: 'Impossible de lire ce document' }); }
  });

  // Pièces jointes propres à l'envoi
  app.post('/api/envois/:id/pj', requireAuth, avecUpload(uploadPJ.array('fichiers', 10)), async (req, res) => {
    if (!supabase) return res.status(500).json({ error: 'Stockage Supabase non configuré' });
    try {
      const envoi = await getEnvoi(req.params.id);
      if (!envoi || envoi.statut !== 'brouillon') return res.status(400).json({ error: 'Envoi introuvable ou déjà lancé' });
      if (!req.files || !req.files.length) return res.status(400).json({ error: 'Formats acceptés : PDF, DOCX, JPG, PNG' });
      const pjs = parsePJ(envoi);
      const total = pjs.reduce((s, p) => s + (p.taille || 0), 0) + req.files.reduce((s, f) => s + f.size, 0);
      if (total > PJ_MAX_TOTAL) return res.status(400).json({ error: 'Total des pièces jointes limité à 10 Mo par email' });
      for (const f of req.files) {
        const nom = Buffer.from(f.originalname, 'latin1').toString('utf8'); // multer lit les noms en latin1
        const sur = nom.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9._-]/g, '_');
        const p = `envois/${envoi.id}/${Date.now()}-${sur}`;
        const { error } = await supabase.storage.from(BUCKET_NAME).upload(p, f.buffer, { contentType: f.mimetype, upsert: false });
        if (error) return res.status(500).json({ error: `Upload échoué : ${nom}` });
        pjs.push({ nom, path: p, taille: f.size, type: f.mimetype });
      }
      const r = await pool.query('UPDATE campagnes SET pj_envoi=$1 WHERE id=$2 RETURNING *', [JSON.stringify(pjs), envoi.id]);
      res.json({ success: true, envoi: r.rows[0] });
    } catch (e) { console.error('❌ PJ envoi:', e); res.status(500).json({ error: 'Erreur upload' }); }
  });

  app.delete('/api/envois/:id/pj/:idx', requireAuth, async (req, res) => {
    try {
      const envoi = await getEnvoi(req.params.id);
      if (!envoi || envoi.statut !== 'brouillon') return res.status(400).json({ error: 'Envoi introuvable ou déjà lancé' });
      const pjs = parsePJ(envoi); const [pj] = pjs.splice(parseInt(req.params.idx), 1);
      if (pj && supabase) await supabase.storage.from(BUCKET_NAME).remove([pj.path]).catch(() => {});
      const r = await pool.query('UPDATE campagnes SET pj_envoi=$1 WHERE id=$2 RETURNING *', [JSON.stringify(pjs), envoi.id]);
      res.json({ success: true, envoi: r.rows[0] });
    } catch (e) { res.status(500).json({ error: 'Erreur' }); }
  });

  // Aperçu (données du premier destinataire)
  app.post('/api/envois/:id/preview', requireAuth, async (req, res) => {
    try {
      const envoi = await getEnvoi(req.params.id);
      if (!envoi) return res.status(404).json({ error: 'Envoi introuvable' });
      const d = (await pool.query('SELECT * FROM campagne_destinataires WHERE campagne_id=$1 ORDER BY id LIMIT 1', [envoi.id])).rows[0]
        || { nom: 'DUPONT', prenom: 'Jean', email: 'jean.dupont@exemple.fr', ville: 'Créteil' };
      const merged = { ...envoi, ...req.body }; // permet l'aperçu avant enregistrement
      const { sujet, html } = assembler(merged, variablesPour(d, merged));
      res.json({ sujet, html });
    } catch (e) { res.status(500).json({ error: 'Erreur' }); }
  });

  // Email de test
  app.post('/api/envois/:id/test', requireAuth, async (req, res) => {
    try {
      const envoi = await getEnvoi(req.params.id);
      if (!envoi) return res.status(404).json({ error: 'Envoi introuvable' });
      const to = (req.body.email || ADMIN_EMAIL).trim();
      if (!validerEmail(to)) return res.status(400).json({ error: 'Adresse de test invalide' });
      const d = (await pool.query('SELECT * FROM campagne_destinataires WHERE campagne_id=$1 ORDER BY id LIMIT 1', [envoi.id])).rows[0]
        || { nom: 'DUPONT', prenom: 'Jean', email: to, ville: 'Créteil' };
      const { sujet, html } = assembler(envoi, variablesPour(d, envoi));
      const emailData = { sender: { name: EMAIL_FROM_NAME, email: EMAIL_FROM }, to: [{ email: to }], subject: `[TEST] ${sujet}`, htmlContent: html, tags: [`envoi-${envoi.id}`, 'test'] };
      if (envoi.reply_to) emailData.replyTo = { email: envoi.reply_to };
      const att = await chargerPJEnvoi(envoi); if (att.length) emailData.attachment = att;
      const r = await posterBrevo(emailData);
      if (!r.ok) return res.status(502).json({ error: `Brevo : ${(await r.text()).slice(0, 200)}` });
      await pool.query('UPDATE campagnes SET test_envoye_at=NOW() WHERE id=$1', [envoi.id]);
      res.json({ success: true, to });
    } catch (e) { console.error('❌ Test envoi:', e); res.status(500).json({ error: 'Erreur envoi test' }); }
  });

  // Quota Brevo
  app.get('/api/brevo/quota', requireAuth, async (req, res) => {
    if (!BREVO_API_KEY) return res.json({ credits: null });
    try {
      const r = await fetch('https://api.brevo.com/v3/account', { headers: { 'api-key': BREVO_API_KEY, accept: 'application/json' } });
      if (!r.ok) return res.json({ credits: null });
      const a = await r.json();
      const plans = a.plan || [];
      const p = plans.find(x => x.creditsType === 'sendLimit') || plans[0] || {};
      res.json({ credits: p.credits ?? null, plan: p.type || null, credits_type: p.creditsType || null });
    } catch (e) { res.json({ credits: null }); }
  });

  // Étape 3 — lancement (immédiat, progressif ou programmé)
  app.post('/api/envois/:id/lancer', requireAuth, async (req, res) => {
    if (!verifMdp(req, res)) return;
    const { mode, programme_at } = req.body;
    try {
      const envoi = await getEnvoi(req.params.id);
      if (!envoi) return res.status(404).json({ error: 'Envoi introuvable' });
      if (envoi.statut !== 'brouillon') return res.status(400).json({ error: 'Envoi déjà lancé' });
      if (!envoi.nb_destinataires) return res.status(400).json({ error: 'Aucun destinataire' });
      if (!envoi.sujet_email || !envoi.contenu_html) return res.status(400).json({ error: 'Sujet ou contenu manquant' });
      if (mode === 'programme') {
        const d = new Date(programme_at);
        if (isNaN(d) || d < new Date()) return res.status(400).json({ error: 'Date de programmation invalide ou passée' });
        await pool.query("UPDATE campagnes SET statut='programmee', mode_envoi='progressif', programme_at=($1::timestamptz AT TIME ZONE 'UTC') WHERE id=$2", [d.toISOString(), envoi.id]);
        console.log(`🗓️ Envoi #${envoi.id} programmé pour ${d.toISOString()}`);
        return res.json({ success: true, programme: true });
      }
      const m = mode === 'immediat' ? 'immediat' : 'progressif';
      await pool.query("UPDATE campagnes SET statut='en_cours', mode_envoi=$1, lancee_at=NOW() WHERE id=$2", [m, envoi.id]);
      envoyerEnvoi(envoi.id, m);
      res.json({ success: true });
    } catch (e) { console.error('❌ Lancement envoi:', e); res.status(500).json({ error: 'Erreur lancement' }); }
  });

  app.post('/api/envois/:id/annuler-programmation', requireAuth, async (req, res) => {
    const r = await pool.query("UPDATE campagnes SET statut='brouillon', programme_at=NULL WHERE id=$1 AND type='envoi' AND statut='programmee' RETURNING id", [req.params.id]);
    if (!r.rows.length) return res.status(400).json({ error: 'Envoi non programmé' });
    res.json({ success: true });
  });

  // Reprise après suspension (quota Brevo épuisé)
  app.post('/api/envois/:id/reprendre', requireAuth, async (req, res) => {
    if (!verifMdp(req, res)) return;
    const envoi = await getEnvoi(req.params.id);
    if (!envoi || envoi.statut !== 'suspendue') return res.status(400).json({ error: 'Envoi non suspendu' });
    await pool.query("UPDATE campagnes SET statut='en_cours' WHERE id=$1", [envoi.id]);
    envoyerEnvoi(envoi.id, envoi.mode_envoi || 'progressif');
    res.json({ success: true });
  });

  // Étape 4 — suivi
  app.get('/api/envois/:id/destinataires', requireAuth, async (req, res) => {
    try {
      const f = req.query.filtre || 'tous';
      let q = 'SELECT * FROM campagne_destinataires WHERE campagne_id=$1'; const p = [req.params.id];
      if (f === 'non_ouverts') q += " AND statut IN ('envoye','delivre')";
      else if (f === 'erreur') { p.push(STATUTS_ERREUR); q += ' AND statut = ANY($2)'; }
      else if (f !== 'tous') { p.push(f.replace(/[^a-z_]/g, '')); q += ' AND statut = $2'; }
      q += ' ORDER BY nom ASC, prenom ASC';
      res.json((await pool.query(q, p)).rows);
    } catch (e) { res.status(500).json({ error: 'Erreur' }); }
  });

  // Corriger l'email d'un destinataire en erreur
  app.put('/api/envois/:id/destinataires/:did', requireAuth, async (req, res) => {
    const email = (req.body.email || '').trim();
    if (!validerEmail(email)) return res.status(400).json({ error: 'Email invalide' });
    const r = await pool.query(`UPDATE campagne_destinataires SET email=$1, email_corrige=true, erreur_detail=NULL
      WHERE id=$2 AND campagne_id=$3 AND statut = ANY($4) RETURNING *`, [email, req.params.did, req.params.id, STATUTS_ERREUR]);
    if (!r.rows.length) return res.status(400).json({ error: 'Destinataire non modifiable' });
    res.json({ success: true, destinataire: r.rows[0] });
  });

  // Renvoyer : erreurs techniques + emails corrigés (pas les hard bounces non corrigés)
  app.post('/api/envois/:id/renvoyer-erreurs', requireAuth, async (req, res) => {
    if (!verifMdp(req, res)) return;
    try {
      const envoi = await getEnvoi(req.params.id);
      if (!envoi || envoi.statut !== 'terminee') return res.status(400).json({ error: 'Envoi non terminé' });
      const r = await pool.query(`UPDATE campagne_destinataires SET statut='en_attente', message_id=NULL, envoi_at=NULL, email_corrige=false
        WHERE campagne_id=$1 AND (statut IN ('erreur','erreur_brevo','bounce_soft') OR (email_corrige=true AND statut = ANY($2)))`, [envoi.id, STATUTS_ERREUR]);
      if (!r.rowCount) return res.json({ success: true, nb: 0 });
      await pool.query("UPDATE campagnes SET statut='en_cours', relance_active=false, terminee_at=NULL WHERE id=$1", [envoi.id]);
      envoyerEnvoi(envoi.id, 'progressif');
      res.json({ success: true, nb: r.rowCount });
    } catch (e) { res.status(500).json({ error: 'Erreur' }); }
  });

  // Relancer les non-ouverts avec un sujet / contenu dédiés
  app.post('/api/envois/:id/relancer', requireAuth, async (req, res) => {
    if (!verifMdp(req, res)) return;
    const { sujet, contenu_html } = req.body;
    if (!sujet || !contenu_html) return res.status(400).json({ error: 'Sujet et contenu requis' });
    try {
      const envoi = await getEnvoi(req.params.id);
      if (!envoi || envoi.statut !== 'terminee') return res.status(400).json({ error: 'Envoi non terminé' });
      const r = await pool.query("UPDATE campagne_destinataires SET statut='en_attente', message_id=NULL, envoi_at=NULL WHERE campagne_id=$1 AND statut IN ('envoye','delivre')", [envoi.id]);
      if (!r.rowCount) return res.json({ success: true, nb: 0 });
      await pool.query("UPDATE campagnes SET statut='en_cours', relance_active=true, relance_sujet=$1, relance_contenu=$2, terminee_at=NULL WHERE id=$3", [sujet, contenu_html, envoi.id]);
      envoyerEnvoi(envoi.id, 'progressif');
      res.json({ success: true, nb: r.rowCount });
    } catch (e) { res.status(500).json({ error: 'Erreur' }); }
  });

  // Export Excel du suivi
  app.get('/api/envois/:id/export', requireAuth, async (req, res) => {
    try {
      const envoi = await getEnvoi(req.params.id);
      if (!envoi) return res.status(404).json({ error: 'Envoi introuvable' });
      const dests = (await pool.query('SELECT * FROM campagne_destinataires WHERE campagne_id=$1 ORDER BY nom, prenom', [envoi.id])).rows;
      const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Suivi');
      ws.columns = [
        { header: 'Nom', key: 'nom', width: 22 }, { header: 'Prénom', key: 'prenom', width: 18 }, { header: 'Email', key: 'email', width: 34 },
        { header: 'RPPS', key: 'rpps', width: 14 }, { header: 'Ville', key: 'ville', width: 20 }, { header: 'Statut', key: 'statut', width: 14 },
        { header: 'Ouvertures', key: 'nb_ouvertures', width: 11 }, { header: 'Clics', key: 'nb_clics', width: 8 },
        { header: 'Envoyé le', key: 'envoi_at', width: 20 }, { header: 'Dernière activité', key: 'derniere_activite', width: 20 }, { header: 'Erreur', key: 'erreur_detail', width: 40 },
      ];
      dests.forEach(d => ws.addRow(d));
      ws.getRow(1).font = { bold: true };
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename=suivi_envoi_${envoi.id}.xlsx`);
      await wb.xlsx.write(res); res.end();
    } catch (e) { res.status(500).json({ error: 'Erreur export' }); }
  });

  // Dupliquer (contenu + PJ, sans destinataires)
  app.post('/api/envois/:id/dupliquer', requireAuth, async (req, res) => {
    try {
      const src = await getEnvoi(req.params.id);
      if (!src) return res.status(404).json({ error: 'Envoi introuvable' });
      const r = await pool.query(`INSERT INTO campagnes (type, nom, sujet_email, titre_header, sous_titre_header, couleur1, couleur2, contenu_html, signataire, reply_to, documents_joints, pj_envoi, statut, nb_destinataires)
        VALUES ('envoi', $1, $2, $3, $4, $5, $6, $7, $8, $9, '[]', '[]', 'brouillon', 0) RETURNING *`,
        [`${src.nom} (copie)`, src.sujet_email, src.titre_header, src.sous_titre_header, src.couleur1, src.couleur2, src.contenu_html, src.signataire, src.reply_to]);
      const copie = r.rows[0];
      const pjs = [];
      if (supabase) for (const pj of parsePJ(src)) {
        const dest = `envois/${copie.id}/${pj.path.split('/').pop()}`;
        const { error } = await supabase.storage.from(BUCKET_NAME).copy(pj.path, dest);
        if (!error) pjs.push({ ...pj, path: dest });
      }
      const u = await pool.query('UPDATE campagnes SET pj_envoi=$1 WHERE id=$2 RETURNING *', [JSON.stringify(pjs), copie.id]);
      res.json({ success: true, envoi: u.rows[0] });
    } catch (e) { console.error('❌ Duplication:', e); res.status(500).json({ error: 'Erreur duplication' }); }
  });

  // Supprimer (destinataires + PJ stockées)
  app.post('/api/envois/:id/supprimer', requireAuth, async (req, res) => {
    if (!verifMdp(req, res)) return;
    try {
      const envoi = await getEnvoi(req.params.id);
      if (!envoi) return res.status(404).json({ error: 'Envoi introuvable' });
      if (envoi.statut === 'en_cours') return res.status(400).json({ error: 'Envoi en cours : attendez la fin' });
      const paths = parsePJ(envoi).map(p => p.path);
      if (paths.length && supabase) await supabase.storage.from(BUCKET_NAME).remove(paths).catch(() => {});
      await pool.query('DELETE FROM campagne_destinataires WHERE campagne_id=$1', [envoi.id]);
      await pool.query('DELETE FROM campagnes WHERE id=$1', [envoi.id]);
      console.log(`🗑️ Envoi #${envoi.id} supprimé`);
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: 'Erreur' }); }
  });

  // ========== BOUCLE D'ENVOI (arrière-plan) ==========
  async function envoyerEnvoi(id, mode) {
    if (envoisEnCours.has(id)) return;
    envoisEnCours.add(id);
    const delai = mode === 'immediat' ? 150 : 2000;
    try {
      const envoi = await getEnvoi(id);
      if (!envoi) return;
      const surcharge = envoi.relance_active ? { sujet: envoi.relance_sujet, contenu: envoi.relance_contenu } : null;
      const attachments = await chargerPJEnvoi(envoi);
      if (parsePJ(envoi).length && attachments.length < parsePJ(envoi).length) {
        console.error(`❌ Envoi #${id} : pièce(s) jointe(s) manquante(s), envoi suspendu`);
        await pool.query("UPDATE campagnes SET statut='suspendue' WHERE id=$1", [id]);
        return;
      }
      const dests = (await pool.query("SELECT * FROM campagne_destinataires WHERE campagne_id=$1 AND statut='en_attente' ORDER BY id", [id])).rows;
      console.log(`📨 Envoi #${id} : ${dests.length} emails (${mode}${surcharge ? ', relance' : ''})`);
      let n = 0;
      for (const dest of dests) {
        const { sujet, html } = assembler(envoi, variablesPour(dest, envoi), surcharge);
        const emailData = { sender: { name: EMAIL_FROM_NAME, email: EMAIL_FROM }, to: [{ email: dest.email }], subject: sujet, htmlContent: html, tags: [`envoi-${id}`] };
        if (envoi.reply_to) emailData.replyTo = { email: envoi.reply_to };
        if (attachments.length) emailData.attachment = attachments;
        let r, essais = 0;
        try {
          do {
            r = await posterBrevo(emailData);
            if (r.status === 429) { essais++; await new Promise(ok => setTimeout(ok, 30000)); } // limite de débit : on patiente
          } while (r.status === 429 && essais < 3);
        } catch (e) { r = { ok: false, status: 0, text: async () => e.message }; }

        if (r.ok) {
          const j = await r.json();
          await pool.query("UPDATE campagne_destinataires SET statut='envoye', message_id=$1, envoi_at=NOW(), erreur_detail=NULL WHERE id=$2", [j.messageId, dest.id]);
        } else if (r.status === 402) {
          // Crédits Brevo épuisés : on s'arrête proprement, les restants restent « en_attente »
          console.error(`⏸️ Envoi #${id} suspendu : quota Brevo épuisé`);
          await pool.query("UPDATE campagnes SET statut='suspendue' WHERE id=$1", [id]);
          return;
        } else {
          const t = (await r.text()).slice(0, 500);
          await pool.query("UPDATE campagne_destinataires SET statut='erreur', erreur_detail=$1, envoi_at=NOW() WHERE id=$2", [t, dest.id]);
          console.error(`❌ Envoi #${id} → ${dest.email} : ${r.status}`);
        }
        // Toutes les 25 : l'envoi existe-t-il toujours ?
        if (++n % 25 === 0 && !(await getEnvoi(id))) { console.log(`🛑 Envoi #${id} supprimé en cours de route`); return; }
        await new Promise(ok => setTimeout(ok, delai));
      }
      const c = await pool.query(`SELECT COUNT(*) FILTER (WHERE statut <> ALL($2) AND statut <> 'en_attente') env,
        COUNT(*) FILTER (WHERE statut = ANY($2)) err FROM campagne_destinataires WHERE campagne_id=$1`, [id, STATUTS_ERREUR]);
      await pool.query("UPDATE campagnes SET statut='terminee', relance_active=false, nb_envoyes=$1, nb_erreurs=$2, terminee_at=NOW() WHERE id=$3",
        [parseInt(c.rows[0].env), parseInt(c.rows[0].err), id]);
      console.log(`✅ Envoi #${id} terminé`);
    } catch (e) {
      console.error(`❌ Envoi #${id}:`, e);
      await pool.query("UPDATE campagnes SET statut='suspendue' WHERE id=$1", [id]).catch(() => {});
    } finally { envoisEnCours.delete(id); }
  }

  // Envois programmés : vérification chaque minute
  cron.schedule('* * * * *', async () => {
    try {
      const r = await pool.query(`UPDATE campagnes SET statut='en_cours', lancee_at=NOW()
        WHERE type='envoi' AND statut='programmee' AND programme_at <= (NOW() AT TIME ZONE 'UTC') RETURNING id, mode_envoi`);
      for (const c of r.rows) { console.log(`🗓️ Démarrage envoi programmé #${c.id}`); envoyerEnvoi(c.id, c.mode_envoi || 'progressif'); }
    } catch (e) { console.error('❌ Cron envois programmés:', e.message); }
  });
};
