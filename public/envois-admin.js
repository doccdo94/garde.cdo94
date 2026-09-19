// ========== ENVOI EN NOMBRE — onglet admin ==========
// Chargé après admin.js (réutilise afficherMessage, ouvrirModal, fermerModal, ongletActif).

let envStep = 1;
let envListe = null;          // résultat d'import { upload_id, headers, mapping, stats, lignes }
let envExclus = new Set();    // index des lignes décochées
let envCourant = null;        // ligne campagnes (type='envoi')
let quillEnvoi = null;
let envSuiviTimer = null;
let envFiltre = 'tous';

const ENV_ERREURS = ['erreur', 'erreur_brevo', 'bounce_hard', 'bounce_soft', 'bloque', 'invalide', 'spam'];
const ENV_BADGES = {
  brouillon: ['📝 Brouillon', 'camp-brouillon'], programmee: ['🗓️ Programmé', 'camp-brouillon'],
  en_cours: ['⏳ En cours', 'camp-en_cours'], suspendue: ['⏸️ Suspendu', 'camp-brouillon'], terminee: ['✅ Terminé', 'camp-terminee'],
};

function escH(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function envCont() { return document.getElementById('envois-container'); }
function tailleLisible(o) { return o > 1048576 ? (o / 1048576).toFixed(1) + ' Mo' : Math.max(1, Math.round(o / 1024)) + ' Ko'; }
function stopSuiviEnvoi() { if (envSuiviTimer) { clearInterval(envSuiviTimer); envSuiviTimer = null; } }
async function envJSON(url, opts) {
  const r = await fetch(url, opts); const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'Erreur');
  return d;
}
const JSONPOST = body => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });

// ---------- Modale mot de passe générique ----------
function demanderMdpEnvoi(titre, texte, libelle, action) {
  let m = document.getElementById('modal-mdp-envoi');
  if (!m) { m = document.createElement('div'); m.id = 'modal-mdp-envoi'; m.className = 'modal'; document.body.appendChild(m); }
  m.innerHTML = `<div class="modal-content"><div class="modal-header">🔐 ${escH(titre)}</div>
    <p style="color:#6b7280;margin-bottom:16px">${escH(texte)}</p>
    <div class="form-group"><label for="mdp-envoi">Mot de passe admin</label><input type="password" id="mdp-envoi" placeholder="Mot de passe"></div>
    <p class="login-erreur" id="mdp-envoi-err"></p>
    <div class="modal-actions"><button class="btn btn-secondary" onclick="fermerModal('modal-mdp-envoi')">Annuler</button>
    <button class="btn btn-primary" id="mdp-envoi-ok">${escH(libelle)}</button></div></div>`;
  ouvrirModal('modal-mdp-envoi');
  const input = document.getElementById('mdp-envoi'); input.focus();
  const valider = async () => {
    const btn = document.getElementById('mdp-envoi-ok');
    if (!input.value) { document.getElementById('mdp-envoi-err').textContent = 'Mot de passe requis'; return; }
    btn.disabled = true;
    try { await action(input.value); fermerModal('modal-mdp-envoi'); }
    catch (e) { document.getElementById('mdp-envoi-err').textContent = e.message; btn.disabled = false; }
  };
  document.getElementById('mdp-envoi-ok').onclick = valider;
  input.onkeydown = e => { if (e.key === 'Enter') valider(); };
}

// ========== ACCUEIL DE L'ONGLET ==========
async function chargerEnvois() {
  stopSuiviEnvoi();
  const cont = envCont();
  cont.innerHTML = '<div class="deploy-section"><div class="loading"><div class="spinner"></div></div></div>';
  try {
    const envois = await envJSON('/api/envois');
    let html = `<div class="deploy-section"><h2>📨 Envoi en nombre</h2>
      <p class="deploy-desc">Envoyez un email (avec ou sans pièces jointes) à une liste de praticiens, avec suivi Brevo des ouvertures et clics.</p>`;
    if (envois.length) {
      html += '<h3 style="margin-bottom:12px;font-size:16px">Envois existants</h3>';
      envois.forEach(e => {
        const [lib, cls] = ENV_BADGES[e.statut] || [e.statut, 'camp-brouillon'];
        html += `<div class="camp-list-item" onclick="ouvrirEnvoi(${e.id},'${e.statut}')">
          <div><strong>${escH(e.nom)}</strong><span style="color:#6b7280;font-size:12px;margin-left:8px">${e.nb_destinataires || 0} destinataires · ${new Date(e.created_at).toLocaleDateString('fr-FR')}</span></div>
          <div style="display:flex;gap:8px;align-items:center"><span class="camp-badge ${cls}">${lib}</span>
          ${e.statut !== 'en_cours' ? `<button class="btn btn-danger" style="font-size:11px;padding:4px 8px" aria-label="Supprimer" onclick="event.stopPropagation();supprimerEnvoi(${e.id})">🗑️</button>` : ''}</div></div>`;
      });
    } else html += '<p class="doc-empty">Aucun envoi pour le moment.</p>';
    html += `<div style="display:flex;gap:10px;margin-top:16px">
      <button class="btn btn-primary" onclick="nouvelEnvoi()">➕ Nouvel envoi</button>
      ${envois.length ? `<select id="env-dup-select" style="padding:8px;border:2px solid #e5e7eb;border-radius:8px;font-size:14px"><option value="">📑 Dupliquer un envoi existant…</option>
        ${envois.map(e => `<option value="${e.id}">${escH(e.nom)}</option>`).join('')}</select>` : ''}</div></div>`;
    cont.innerHTML = html;
    const sel = document.getElementById('env-dup-select');
    if (sel) sel.onchange = () => { if (sel.value) dupliquerEnvoi(sel.value); };
  } catch (e) { cont.innerHTML = `<div class="deploy-section"><p style="color:#ef4444">Erreur de chargement : ${escH(e.message)}</p></div>`; }
}

function nouvelEnvoi() { envCourant = null; envListe = null; envExclus = new Set(); envStep = 1; afficherWizardEnvoi(); }

async function ouvrirEnvoi(id, statut) {
  try {
    const { envoi } = await envJSON(`/api/envois/${id}`);
    envCourant = envoi; envListe = null; envExclus = new Set(); envFiltre = 'tous';
    envStep = statut === 'brouillon' ? (envoi.nb_destinataires > 0 ? 2 : 1) : 4;
    afficherWizardEnvoi();
  } catch (e) { afficherMessage(e.message, 'error'); }
}

async function dupliquerEnvoi(id) {
  try {
    const { envoi } = await envJSON(`/api/envois/${id}/dupliquer`, JSONPOST());
    afficherMessage('Envoi dupliqué — importez la nouvelle liste');
    envCourant = envoi; envListe = null; envExclus = new Set(); envStep = 1; afficherWizardEnvoi();
  } catch (e) { afficherMessage(e.message, 'error'); }
}

function supprimerEnvoi(id) {
  demanderMdpEnvoi('Supprimer l\'envoi', 'Les destinataires, statistiques et pièces jointes de cet envoi seront supprimés.', '🗑️ Supprimer', async mdp => {
    await envJSON(`/api/envois/${id}/supprimer`, JSONPOST({ password: mdp }));
    afficherMessage('Envoi supprimé'); chargerEnvois();
  });
}

// ========== WIZARD ==========
function afficherWizardEnvoi() {
  stopSuiviEnvoi();
  const etapes = [{ n: 1, l: 'Liste praticiens' }, { n: 2, l: 'Email' }, { n: 3, l: 'Lancement' }, { n: 4, l: 'Suivi' }];
  envCont().innerHTML = `<div class="deploy-section"><h2>📨 ${envCourant ? escH(envCourant.nom) : 'Nouvel envoi en nombre'}</h2>
    <p class="deploy-desc">Envoi libre (hors campagne d'inscription) : courrier, documents, information ordinale.</p>
    <div class="workflow">${etapes.map(s => `<div class="wf-step ${s.n < envStep ? 'done' : s.n === envStep ? 'active' : ''}" onclick="allerEtapeEnvoi(${s.n})">
      <div class="wf-num">${s.n < envStep ? '✓' : s.n}</div><div class="wf-label">${s.l}</div></div>`).join('')}</div>
    <div id="env-panels"></div></div>`;
  const p = document.getElementById('env-panels');
  if (envStep === 1) envEtape1(p);
  else if (envStep === 2) envEtape2(p);
  else if (envStep === 3) envEtape3(p);
  else envEtape4(p);
}

function allerEtapeEnvoi(n) {
  const lance = envCourant && envCourant.statut !== 'brouillon';
  if (lance && n < 4) return afficherMessage('Envoi déjà lancé : seul le suivi est disponible', 'error');
  if (n === 4 && !lance) return afficherMessage('L\'envoi n\'est pas encore lancé', 'error');
  if (n >= 2 && !(envCourant && envCourant.nb_destinataires > 0)) return afficherMessage('Importez d\'abord la liste', 'error');
  if (envStep === 2 && n !== 2) return sauverEmailEnvoi(n); // enregistre la saisie (et vérifie sujet/contenu si n = 3)
  if (n === 3 && !(envCourant.sujet_email && envCourant.contenu_html)) return afficherMessage('Complétez d\'abord l\'email', 'error');
  envStep = n; afficherWizardEnvoi();
}

// ---------- Étape 1 : liste ----------
function envEtape1(p) {
  let html = `<h3 style="margin-bottom:8px">📋 Liste des praticiens</h3>
    <p style="color:#6b7280;font-size:14px;margin-bottom:16px">Importez le fichier Excel ou CSV des destinataires.</p>`;
  if (envCourant && envCourant.nb_destinataires > 0 && !envListe)
    html += `<div class="upload-result" style="margin:0 0 16px"><h4 style="color:#065f46">✅ Liste actuelle : ${envCourant.nb_destinataires} destinataires</h4>
      <p style="color:#6b7280;font-size:13px">Importez un nouveau fichier ci-dessous pour la remplacer.</p></div>`;
  html += `<div class="upload-drop-zone" id="env-drop" onclick="document.getElementById('env-file').click()">
      <p style="font-size:16px">📂 <strong>Glissez votre fichier Excel ici</strong> ou cliquez</p>
      <p style="font-size:12px;color:#9ca3af;margin-top:4px">.xlsx · .csv · Max 20 Mo</p></div>
    <input type="file" id="env-file" accept=".xlsx,.csv" style="display:none">`;
  if (envListe) html += envResultatListe();
  const peutSuivre = envListe ? envNbRetenus() > 0 : (envCourant && envCourant.nb_destinataires > 0);
  html += `<div class="step-nav"><button class="btn btn-secondary" onclick="chargerEnvois()">← Envois</button>
    <button class="btn btn-primary" id="env-suiv-1" ${peutSuivre ? '' : 'disabled'} onclick="validerListeEnvoi()">Suivant → Email</button></div>`;
  p.innerHTML = html;
  const zone = document.getElementById('env-drop');
  document.getElementById('env-file').onchange = e => { if (e.target.files[0]) importerListeEnvoi(e.target.files[0]); };
  zone.ondragover = e => { e.preventDefault(); zone.classList.add('drop-active'); };
  zone.ondragleave = () => zone.classList.remove('drop-active');
  zone.ondrop = e => { e.preventDefault(); zone.classList.remove('drop-active'); if (e.dataTransfer.files[0]) importerListeEnvoi(e.dataTransfer.files[0]); };
}

async function importerListeEnvoi(file) {
  const zone = document.getElementById('env-drop');
  zone.innerHTML = '<p>⏳ Analyse en cours…</p>';
  const fd = new FormData(); fd.append('fichier', file);
  try {
    envListe = await envJSON('/api/envois/upload-liste', { method: 'POST', body: fd });
    envExclus = new Set();
    envEtape1(document.getElementById('env-panels'));
  } catch (e) { zone.innerHTML = `<p style="color:#ef4444">❌ ${escH(e.message)}</p>`; }
}

function envNbRetenus() { return envListe.lignes.filter(l => l.valide && !l.doublon && !envExclus.has(l.i)).length; }

function envResultatListe() {
  const u = envListe, s = u.stats;
  const champs = [['nom', 'Nom *'], ['prenom', 'Prénom'], ['email', 'Email (prioritaire) *'], ['email2', 'Email (secondaire)'], ['rpps', 'RPPS'], ['ville', 'Ville'], ['code_postal', 'Code postal']];
  let html = `<div class="upload-result">
    <h4 style="color:#065f46;margin-bottom:4px">✅ ${escH(u.filename)} importé</h4>
    <p style="color:#6b7280;font-size:13px">${s.total} lignes analysées</p>
    <div class="upload-stats-grid">
      <div class="up-stat"><div class="n">${s.total}</div><div class="l">Praticiens</div></div>
      <div class="up-stat"><div class="n" style="color:#10b981">${s.avec_email}</div><div class="l">Avec email</div></div>
      <div class="up-stat"><div class="n" style="color:#f59e0b">${s.doublons}</div><div class="l">Doublons retirés</div></div>
      <div class="up-stat"><div class="n" style="color:#ef4444">${s.sans_email}</div><div class="l">Sans email (exclus)</div></div>
    </div>
    <h4 style="margin-top:16px;margin-bottom:8px">🔍 Colonnes détectées <span style="color:#6b7280;font-size:12px;font-weight:400">(modifiables)</span></h4>
    <div class="mapping-grid">${champs.map(([k, l]) => `<div class="mapping-item"><label for="env-map-${k}">${l}</label>
      <select id="env-map-${k}" onchange="changerMappingEnvoi('${k}',this.value)"><option value="-1">— Non mappé —</option>
      ${u.headers.map((h, i) => `<option value="${i}" ${u.mapping[k] === i ? 'selected' : ''}>${i < 26 ? String.fromCharCode(65 + i) : i + 1}: ${escH(h || '(vide)')}</option>`).join('')}</select></div>`).join('')}</div>
    <div class="preview-mini" style="max-height:320px"><table><thead><tr>
      <th style="width:30px"><input type="checkbox" id="env-tout" ${envExclus.size === 0 ? 'checked' : ''} onchange="toutCocherEnvoi(this.checked)" aria-label="Tout sélectionner"></th>
      <th>Nom</th><th>Prénom</th><th>Email</th><th>RPPS</th><th>Ville</th></tr></thead><tbody>
      ${u.lignes.map(l => {
        const ok = l.valide && !l.doublon;
        const em = !l.valide ? '<span class="em-missing">⚠️ Aucun email valide</span>' : l.doublon ? `<span style="color:#b45309">${escH(l.email)} (doublon)</span>` : `<span class="em-found">${escH(l.email)}</span>`;
        return `<tr><td><input type="checkbox" ${ok ? (envExclus.has(l.i) ? '' : 'checked') : 'disabled'} onchange="cocherEnvoi(${l.i},this.checked)" aria-label="Inclure"></td>
          <td>${escH(l.nom)}</td><td>${escH(l.prenom)}</td><td>${em}</td><td>${escH(l.rpps)}</td><td>${escH(l.ville)}</td></tr>`;
      }).join('')}</tbody></table></div>
    <p style="margin-top:10px;font-weight:700;color:#065f46" id="env-nb-retenus">👥 ${envNbRetenus()} destinataires retenus</p>
    <div style="margin-top:12px;background:#fffbeb;border:1px solid #fcd34d;border-radius:8px;padding:12px;font-size:13px;color:#92400e">
      💡 Vous pouvez décocher des praticiens. Les doublons d'email sont retirés automatiquement (insensible à la casse).</div></div>`;
  return html;
}

function majCompteurEnvoi() {
  const n = envNbRetenus();
  document.getElementById('env-nb-retenus').textContent = `👥 ${n} destinataires retenus`;
  document.getElementById('env-suiv-1').disabled = n === 0;
}
function cocherEnvoi(i, on) { if (on) envExclus.delete(i); else envExclus.add(i); majCompteurEnvoi(); }
function toutCocherEnvoi(on) {
  envExclus = new Set(on ? [] : envListe.lignes.filter(l => l.valide && !l.doublon).map(l => l.i));
  envEtape1(document.getElementById('env-panels'));
}
async function changerMappingEnvoi(k, v) {
  envListe.mapping[k] = v === '-1' ? null : parseInt(v);
  try {
    const d = await envJSON('/api/envois/recalculer-mapping', JSONPOST({ upload_id: envListe.upload_id, mapping: envListe.mapping }));
    envListe.stats = d.stats; envListe.lignes = d.lignes; envExclus = new Set();
    envEtape1(document.getElementById('env-panels'));
  } catch (e) { afficherMessage(e.message, 'error'); }
}

async function validerListeEnvoi() {
  if (!envListe) { envStep = 2; return afficherWizardEnvoi(); } // liste existante conservée
  const btn = document.getElementById('env-suiv-1'); btn.disabled = true;
  try {
    const { envoi } = await envJSON('/api/envois', JSONPOST({ upload_id: envListe.upload_id, mapping: envListe.mapping, exclus: [...envExclus], envoi_id: envCourant ? envCourant.id : null }));
    envCourant = envoi; envListe = null; envExclus = new Set();
    afficherMessage(`Liste enregistrée : ${envoi.nb_destinataires} destinataires`);
    envStep = 2; afficherWizardEnvoi();
  } catch (e) { afficherMessage(e.message, 'error'); btn.disabled = false; }
}

// ---------- Étape 2 : email ----------
function envEtape2(p) {
  const e = envCourant, pjs = JSON.parse(e.pj_envoi || '[]');
  const total = pjs.reduce((s, x) => s + (x.taille || 0), 0);
  const champ = (id, lbl, val, ph) => `<div class="tpl-field-row"><label for="${id}">${lbl}</label><input class="tpl-input" id="${id}" value="${escH(val || '')}" placeholder="${escH(ph || '')}"></div>`;
  p.innerHTML = `<h3 style="margin-bottom:12px">✉️ Contenu de l'email</h3>
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px;align-items:center">
      <select id="env-tpl" style="padding:8px;border:2px solid #e5e7eb;border-radius:8px;font-size:13px"><option value="">📨 Charger un template existant…</option></select>
      <button class="btn btn-secondary" style="font-size:12px;padding:8px 14px" onclick="document.getElementById('env-texte-file').click()">📄 Importer le texte (.docx / .html)</button>
      <input type="file" id="env-texte-file" accept=".docx,.html,.htm" style="display:none">
      <span style="font-size:12px;color:#6b7280">ou rédigez directement ci-dessous</span></div>
    ${champ('env-nom', 'Nom de l\'envoi :', e.nom, 'Visible uniquement dans l\'admin')}
    ${champ('env-sujet', 'Sujet :', e.sujet_email, 'Objet de l\'email')}
    ${champ('env-reply', 'Répondre à :', e.reply_to, 'cdogardes94@gmail.com')}
    ${champ('env-titre', 'Titre du bandeau :', e.titre_header, 'CDO 94')}
    ${champ('env-sign', 'Signataire :', e.signataire, 'Dr …')}
    <div id="quill-envoi" style="margin:12px 0;min-height:250px;background:white"></div>
    <div style="background:#eff6ff;border:1px solid #93c5fd;border-radius:8px;padding:12px;font-size:13px;color:#1e40af">
      <strong>Variables :</strong> <code>{{NOM}}</code> <code>{{PRENOM}}</code> <code>{{EMAIL}}</code> <code>{{VILLE}}</code> <code>{{SIGNATAIRE}}</code></div>
    <div class="tpl-pj-section" style="margin-top:16px"><label>📎 Pièces jointes <span style="font-weight:400;color:#6b7280;font-size:12px">(${tailleLisible(total)} / 10 Mo)</span></label>
      <div class="upload-drop-zone" id="env-pj-drop" style="padding:14px;background:white" onclick="document.getElementById('env-pj-file').click()">
        <strong>📤 Glissez vos fichiers</strong> ou cliquez<div style="font-size:11px;margin-top:2px">PDF, DOCX, JPG, PNG · 10 Mo max au total</div></div>
      <input type="file" id="env-pj-file" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" multiple style="display:none">
      <div class="tpl-pj-list">${pjs.length ? pjs.map((x, i) => `<div class="tpl-pj-item" style="justify-content:space-between;border-color:#86efac">
        <span>✅ ${escH(x.nom)} <span style="color:#6b7280">${tailleLisible(x.taille || 0)}</span></span>
        <button class="btn btn-danger" style="font-size:11px;padding:3px 8px" aria-label="Retirer" onclick="retirerPJEnvoi(${i})">✕</button></div>`).join('')
        : '<p style="color:#9ca3af;font-size:12px">Aucune pièce jointe.</p>'}</div></div>
    <div style="display:flex;gap:10px;margin-top:14px"><button class="btn btn-secondary" onclick="apercuEnvoi()">👁️ Aperçu</button>
      <button class="btn btn-secondary" onclick="testEnvoi()">🧪 M'envoyer un test</button></div>
    <div class="step-nav"><button class="btn btn-secondary" onclick="allerEtapeEnvoi(1)">← Liste</button>
      <button class="btn btn-primary" onclick="sauverEmailEnvoi(3)">Suivant → Lancement</button></div>`;

  quillEnvoi = new Quill('#quill-envoi', { theme: 'snow', modules: { toolbar: [[{ header: [1, 2, 3, false] }], ['bold', 'italic', 'underline'], [{ color: [] }, { align: [] }], [{ list: 'ordered' }, { list: 'bullet' }], ['link'], ['clean']] } });
  quillEnvoi.root.innerHTML = e.contenu_html || '<p>Chère consœur, cher confrère,</p><p><br></p><p>Confraternellement,</p><p><strong>{{SIGNATAIRE}}</strong></p>';

  // Templates existants
  fetch('/api/email-templates').then(r => r.json()).then(tpls => {
    const sel = document.getElementById('env-tpl'); if (!sel || !Array.isArray(tpls)) return;
    tpls.forEach(t => sel.insertAdjacentHTML('beforeend', `<option value="${escH(t.type)}">${escH(t.type)} — ${escH(t.sujet)}</option>`));
    sel.onchange = () => {
      const t = tpls.find(x => x.type === sel.value); if (!t) return;
      if (!confirm('Remplacer le sujet et le contenu actuels par ce template ?')) { sel.value = ''; return; }
      document.getElementById('env-sujet').value = t.sujet || '';
      quillEnvoi.root.innerHTML = t.contenu_html || '';
      afficherMessage('Template chargé — vérifiez les variables propres aux gardes ({{DATE_GARDE}}…)');
      sel.value = '';
    };
  }).catch(() => {});
  document.getElementById('env-texte-file').onchange = ev => { if (ev.target.files[0]) importerTexteEnvoi(ev.target.files[0]); };
  const zone = document.getElementById('env-pj-drop');
  document.getElementById('env-pj-file').onchange = ev => { if (ev.target.files.length) ajouterPJEnvoi(ev.target.files); };
  zone.ondragover = ev => { ev.preventDefault(); zone.classList.add('drop-active'); };
  zone.ondragleave = () => zone.classList.remove('drop-active');
  zone.ondrop = ev => { ev.preventDefault(); zone.classList.remove('drop-active'); if (ev.dataTransfer.files.length) ajouterPJEnvoi(ev.dataTransfer.files); };
}

function valeursEmailEnvoi() {
  return {
    nom: document.getElementById('env-nom').value.trim() || envCourant.nom,
    sujet_email: document.getElementById('env-sujet').value.trim(),
    reply_to: document.getElementById('env-reply').value.trim(),
    titre_header: document.getElementById('env-titre').value.trim() || 'CDO 94',
    signataire: document.getElementById('env-sign').value.trim(),
    contenu_html: quillEnvoi ? quillEnvoi.root.innerHTML : '',
  };
}

async function sauverEmailEnvoi(etapeSuivante) {
  const v = valeursEmailEnvoi();
  const vide = !v.contenu_html.replace(/<[^>]+>/g, '').trim();
  if (etapeSuivante === 3 && (!v.sujet_email || vide)) return afficherMessage('Sujet et contenu requis', 'error');
  try {
    const { envoi } = await envJSON(`/api/envois/${envCourant.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(v) });
    envCourant = envoi;
    if (etapeSuivante) { envStep = etapeSuivante; afficherWizardEnvoi(); }
    return true;
  } catch (e) { afficherMessage(e.message, 'error'); return false; }
}

async function importerTexteEnvoi(file) {
  const fd = new FormData(); fd.append('fichier', file);
  try {
    const { html } = await envJSON('/api/envois/import-texte', { method: 'POST', body: fd });
    if (quillEnvoi.getText().trim() && !confirm('Remplacer le contenu actuel par le texte importé ?')) return;
    quillEnvoi.root.innerHTML = html;
    afficherMessage('Texte importé — vérifiez la mise en forme');
  } catch (e) { afficherMessage(e.message, 'error'); }
}

async function ajouterPJEnvoi(files) {
  if (!(await sauverEmailEnvoi())) return; // conserve la saisie en cours avant de réafficher
  const fd = new FormData(); [...files].forEach(f => fd.append('fichiers', f));
  document.getElementById('env-pj-drop').innerHTML = '<p>⏳ Envoi des fichiers…</p>';
  try {
    const { envoi } = await envJSON(`/api/envois/${envCourant.id}/pj`, { method: 'POST', body: fd });
    envCourant = envoi; afficherMessage('Pièce(s) jointe(s) ajoutée(s)');
  } catch (e) { afficherMessage(e.message, 'error'); }
  envEtape2(document.getElementById('env-panels'));
}

async function retirerPJEnvoi(i) {
  if (!(await sauverEmailEnvoi())) return;
  try {
    const { envoi } = await envJSON(`/api/envois/${envCourant.id}/pj/${i}`, { method: 'DELETE' });
    envCourant = envoi; envEtape2(document.getElementById('env-panels'));
  } catch (e) { afficherMessage(e.message, 'error'); }
}

async function apercuEnvoi() {
  try {
    const { html } = await envJSON(`/api/envois/${envCourant.id}/preview`, JSONPOST(valeursEmailEnvoi()));
    document.getElementById('preview-iframe').srcdoc = html; ouvrirModal('modal-preview');
  } catch (e) { afficherMessage(e.message, 'error'); }
}

async function testEnvoi() {
  const to = prompt('Adresse qui recevra le test :', 'doc.cdo94@gmail.com');
  if (!to) return;
  if (!(await sauverEmailEnvoi())) return;
  try {
    await envJSON(`/api/envois/${envCourant.id}/test`, JSONPOST({ email: to }));
    envCourant.test_envoye_at = new Date().toISOString();
    afficherMessage(`🧪 Test envoyé à ${to}`);
  } catch (e) { afficherMessage(e.message, 'error'); }
}

// ---------- Étape 3 : lancement ----------
async function envEtape3(p) {
  p.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  let quota = { credits: null };
  try { ({ envoi: envCourant } = await envJSON(`/api/envois/${envCourant.id}`)); } catch (e) {}
  try { quota = await envJSON('/api/brevo/quota'); } catch (e) {}
  const e = envCourant, n = e.nb_destinataires, pjs = JSON.parse(e.pj_envoi || '[]');
  const poids = pjs.reduce((s, x) => s + (x.taille || 0), 0);
  const carte = (ic, v, l) => `<div style="text-align:center;padding:20px;background:#f9fafb;border-radius:10px;border:2px solid #e5e7eb">
    <div style="font-size:30px">${ic}</div><div style="font-size:26px;font-weight:700;color:#667eea">${v}</div><div style="font-size:12px;color:#6b7280">${l}</div></div>`;
  const qOk = quota.credits == null || quota.credits >= n;
  const demain = new Date(Date.now() + 864e5); demain.setHours(8, 0, 0, 0);
  const defProg = new Date(demain.getTime() - demain.getTimezoneOffset() * 6e4).toISOString().slice(0, 16);
  p.innerHTML = `<h3 style="margin-bottom:16px">🚀 Lancement</h3>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:20px">
      ${carte('👥', n, 'Destinataires')}${carte('📎', pjs.length, 'Pièces jointes')}${carte('📦', poids ? tailleLisible(poids) : '—', 'Poids des PJ')}${carte('⏱️', '~' + Math.max(1, Math.ceil(n * 2 / 60)) + ' min', 'Durée (progressif)')}</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px">
      <div style="background:#eff6ff;border:2px solid #93c5fd;border-radius:10px;padding:20px">
        <h4 style="color:#1e40af;margin-bottom:12px">⏱️ Mode d'envoi</h4>
        <label style="display:flex;gap:8px;align-items:center;cursor:pointer"><input type="radio" name="env-mode" value="progressif" checked style="accent-color:#667eea"> <strong>Progressif (recommandé)</strong></label>
        <p style="font-size:12px;color:#6b7280;margin:2px 0 10px 24px">~2 s entre chaque email</p>
        <label style="display:flex;gap:8px;align-items:center;cursor:pointer"><input type="radio" name="env-mode" value="immediat" style="accent-color:#667eea"> <strong>Immédiat</strong></label>
        <p style="font-size:12px;color:#6b7280;margin:2px 0 10px 24px">Rapide, risque de throttling Brevo</p>
        <label style="display:flex;gap:8px;align-items:center;cursor:pointer"><input type="radio" name="env-mode" value="programme" style="accent-color:#667eea"> <strong>Programmé</strong></label>
        <div style="margin:6px 0 0 24px"><input type="datetime-local" id="env-prog" value="${defProg}" aria-label="Date et heure d'envoi" style="padding:6px;border:2px solid #e5e7eb;border-radius:6px"></div>
      </div>
      <div style="background:${qOk ? '#fffbeb' : '#fef2f2'};border:2px solid ${qOk ? '#fcd34d' : '#fca5a5'};border-radius:10px;padding:20px;color:${qOk ? '#92400e' : '#991b1b'}">
        <h4 style="margin-bottom:10px">📊 Quota Brevo</h4>
        <p style="font-size:14px;margin-bottom:8px">Crédits restants : <strong>${quota.credits == null ? 'non disponible' : quota.credits}</strong>${quota.plan ? ` <span style="font-size:12px">(offre ${escH(quota.plan)})</span>` : ''}</p>
        ${!qOk ? `<p style="font-size:13px;font-weight:700;margin-bottom:8px">⚠️ Quota insuffisant pour ${n} emails.</p>` : ''}
        <p style="font-size:13px">Si le quota s'épuise, l'envoi se met en pause proprement ; les emails restants attendent et vous pourrez reprendre depuis le suivi.</p>
      </div></div>
    <div style="background:#fef2f2;border:2px solid #fca5a5;border-radius:10px;padding:16px;margin-bottom:20px;color:#991b1b;font-size:14px">
      <p style="font-weight:700;margin-bottom:8px">⚠️ Vérification</p>
      <p>✅ Sujet : <strong>${escH(e.sujet_email)}</strong></p>
      <p>✅ ${n} destinataires avec email valide</p>
      <p>${pjs.length ? '✅' : 'ℹ️'} ${pjs.length} pièce(s) jointe(s)${pjs.length ? ' : ' + pjs.map(x => escH(x.nom)).join(', ') : ''}</p>
      <p>${e.test_envoye_at ? `✅ Test envoyé le ${new Date(e.test_envoye_at).toLocaleString('fr-FR')}` : '⚠️ Aucun email de test envoyé — recommandé avant lancement'}</p>
    </div>
    <button class="btn-launch-big" onclick="lancerEnvoi()">🔐 Authentification requise — Lancer (${n} emails)</button>
    <div class="step-nav"><button class="btn btn-secondary" onclick="allerEtapeEnvoi(2)">← Email</button><div></div></div>`;
}

function lancerEnvoi() {
  const mode = document.querySelector('input[name="env-mode"]:checked').value;
  const progLocal = document.getElementById('env-prog').value;
  let programme_at = null;
  if (mode === 'programme') {
    if (!progLocal) return afficherMessage('Choisissez la date et l\'heure', 'error');
    programme_at = new Date(progLocal).toISOString();
  }
  const texte = mode === 'programme' ? `Programmer l'envoi de ${envCourant.nb_destinataires} emails le ${new Date(progLocal).toLocaleString('fr-FR')}.`
    : `Lancer l'envoi de ${envCourant.nb_destinataires} emails maintenant.`;
  demanderMdpEnvoi('Confirmer le lancement', texte, '🚀 Confirmer', async mdp => {
    await envJSON(`/api/envois/${envCourant.id}/lancer`, JSONPOST({ password: mdp, mode, programme_at }));
    afficherMessage(mode === 'programme' ? '🗓️ Envoi programmé' : '🚀 Envoi lancé !');
    envCourant.statut = mode === 'programme' ? 'programmee' : 'en_cours';
    envStep = 4; afficherWizardEnvoi();
  });
}

// ---------- Étape 4 : suivi ----------
async function envEtape4(p) {
  stopSuiviEnvoi();
  try {
    const { envoi: c, stats } = await envJSON(`/api/envois/${envCourant.id}`);
    envCourant = c;
    const tot = c.nb_destinataires || 1, st = k => stats[k] || 0;
    const env = st('envoye') + st('delivre') + st('ouvert') + st('clique');
    const del = st('delivre') + st('ouvert') + st('clique'), ouv = st('ouvert') + st('clique'), cli = st('clique');
    const err = ENV_ERREURS.reduce((s, k) => s + st(k), 0), att = st('en_attente'), nonOuv = st('envoye') + st('delivre');
    const pc = x => ((x / tot) * 100).toFixed(1);
    const etat = {
      en_cours: `⏳ Envoi en cours… (${att} en attente)`, programmee: `🗓️ Programmé pour le ${c.programme_at ? new Date(c.programme_at).toLocaleString('fr-FR') : '—'}`,
      suspendue: `⏸️ Suspendu (quota Brevo ou pièce jointe indisponible) — ${att} emails en attente`, terminee: '✅ Envoi terminé',
    }[c.statut] || c.statut;
    const tc = (v, pct, l, col) => `<div class="track-card"><div class="tn" style="color:${col}">${v}</div><div class="tp">${pct}%</div><div class="tl">${l}</div></div>`;
    const bar = (l, pct, cls) => `<div class="progress-row"><div class="progress-lbl">${l}</div><div class="progress-bar"><div class="progress-fill ${cls}" style="width:${pct}%">${pct}%</div></div></div>`;
    const chips = [['tous', `Tous (${c.nb_destinataires})`], ['en_attente', `⏳ En attente (${att})`], ['envoye', `📤 Envoyés (${st('envoye')})`], ['delivre', `✅ Délivrés (${st('delivre')})`],
      ['ouvert', `👁️ Ouverts (${st('ouvert')})`], ['clique', `🔗 Cliqués (${cli})`], ['erreur', `❌ Erreurs (${err})`], ['non_ouverts', `😴 Non ouverts (${nonOuv})`]];
    p.innerHTML = `<h3 style="margin-bottom:4px">📊 Suivi — ${escH(c.sujet_email)}</h3>
      <p class="deploy-desc">${etat} · ${c.nb_destinataires} destinataires${c.lancee_at ? ' · lancé le ' + new Date(c.lancee_at).toLocaleString('fr-FR') : ''}</p>
      <div class="track-stats">${tc(env, pc(env), 'Envoyés', '#3b82f6')}${tc(del, pc(del), 'Délivrés', '#10b981')}${tc(ouv, pc(ouv), 'Ouverts', '#8b5cf6')}${tc(cli, pc(cli), 'Cliqués', '#f59e0b')}${tc(err, pc(err), 'Erreurs', '#ef4444')}</div>
      <div style="margin-bottom:20px">${bar('Envoyés', pc(env), 'fill-env')}${bar('Délivrés', pc(del), 'fill-del')}${bar('Ouverts', pc(ouv), 'fill-ouv')}${bar('Cliqués', pc(cli), 'fill-cli')}</div>
      <h4 style="margin-bottom:8px">📋 Détail par praticien</h4>
      <div class="filter-bar" id="env-filtres">${chips.map(([k, l]) => `<div class="filter-chip ${k === envFiltre ? 'active' : ''}" onclick="filtrerEnvoi('${k}')">${l}</div>`).join('')}</div>
      <div class="dest-scroll" id="env-dest"><div class="loading"><div class="spinner"></div></div></div>
      <div style="margin-top:16px;display:flex;gap:10px;flex-wrap:wrap">
        <button class="btn btn-primary" onclick="envEtape4(document.getElementById('env-panels'))">🔄 Rafraîchir</button>
        ${c.statut === 'programmee' ? '<button class="btn btn-warning" onclick="annulerProgEnvoi()">✖️ Annuler la programmation</button>' : ''}
        ${c.statut === 'suspendue' ? '<button class="btn btn-success" onclick="reprendreEnvoi()">▶️ Reprendre l\'envoi</button>' : ''}
        ${c.statut === 'terminee' && nonOuv > 0 ? `<button class="btn btn-warning" onclick="ouvrirRelanceEnvoi(${nonOuv})">😴 Relancer les non-ouverts (${nonOuv})</button>` : ''}
        ${c.statut === 'terminee' && err > 0 ? '<button class="btn btn-danger" onclick="renvoyerErreursEnvoi()">🔁 Renvoyer les erreurs corrigées</button>' : ''}
        <button class="btn btn-secondary" onclick="window.open('/api/envois/${c.id}/export')">📥 Export Excel</button>
        <button class="btn btn-secondary" onclick="chargerEnvois()">← Retour</button></div>`;
    chargerDestEnvoi();
    if (['en_cours', 'programmee'].includes(c.statut)) envSuiviTimer = setInterval(() => {
      if (ongletActif !== 'envois' || envStep !== 4) return stopSuiviEnvoi();
      envEtape4(document.getElementById('env-panels'));
    }, 10000);
  } catch (e) { p.innerHTML = `<p style="color:#ef4444">Erreur chargement du suivi : ${escH(e.message)}</p>`; }
}

function filtrerEnvoi(f) {
  envFiltre = f;
  document.querySelectorAll('#env-filtres .filter-chip').forEach(ch => ch.classList.toggle('active', ch.getAttribute('onclick').includes(`'${f}'`)));
  chargerDestEnvoi();
}

async function chargerDestEnvoi() {
  const cont = document.getElementById('env-dest'); if (!cont) return;
  try {
    const dests = await envJSON(`/api/envois/${envCourant.id}/destinataires?filtre=${envFiltre}`);
    if (!dests.length) { cont.innerHTML = '<p style="text-align:center;color:#9ca3af;padding:20px">Aucun résultat pour ce filtre.</p>'; return; }
    const lib = { en_attente: 'En attente', envoye: 'Envoyé', delivre: 'Délivré', ouvert: 'Ouvert', clique: 'Cliqué', erreur: 'Erreur', erreur_brevo: 'Erreur Brevo',
      bounce_hard: 'Bounce (définitif)', bounce_soft: 'Bounce (temporaire)', bloque: 'Bloqué', invalide: 'Invalide', spam: 'Spam' };
    const dot = s => ({ clique: 'dot-clique', ouvert: 'dot-ouvert', delivre: 'dot-delivre', envoye: 'dot-envoye', en_attente: 'dot-attente' }[s] || 'dot-erreur');
    cont.innerHTML = `<table class="dest-table"><thead><tr><th>Praticien</th><th>Email</th><th>Statut</th><th>Ouverts</th><th>Clics</th><th>Dernière activité</th></tr></thead><tbody>
      ${dests.map(d => {
        const enErreur = ENV_ERREURS.includes(d.statut);
        return `<tr><td><strong>${escH(d.nom)} ${escH(d.prenom)}</strong></td>
          <td style="font-size:11px">${escH(d.email)}${d.email_corrige ? ' <span class="pj-tag">corrigé</span>' : ''}
            ${enErreur && envCourant.statut === 'terminee' ? ` <button class="btn btn-secondary" style="font-size:10px;padding:2px 6px" aria-label="Corriger l'email" data-email="${escH(d.email)}" onclick="corrigerEmailEnvoi(${d.id}, this.dataset.email)">✏️</button>` : ''}</td>
          <td title="${escH(d.erreur_detail || '')}"><span class="status-dot ${dot(d.statut)}"></span>${lib[d.statut] || escH(d.statut)}</td>
          <td>${d.nb_ouvertures > 0 ? '👁️ ' + d.nb_ouvertures : '—'}</td><td>${d.nb_clics > 0 ? '🔗 ' + d.nb_clics : '—'}</td>
          <td style="font-size:11px;color:#6b7280">${d.derniere_activite ? new Date(d.derniere_activite).toLocaleString('fr-FR') : d.envoi_at ? new Date(d.envoi_at).toLocaleString('fr-FR') : '—'}</td></tr>`;
      }).join('')}</tbody></table>`;
  } catch (e) { cont.innerHTML = `<p style="color:#ef4444">${escH(e.message)}</p>`; }
}

async function corrigerEmailEnvoi(id, actuel) {
  const email = prompt('Adresse corrigée :', actuel);
  if (!email || email === actuel) return;
  try {
    await envJSON(`/api/envois/${envCourant.id}/destinataires/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
    afficherMessage('Email corrigé — utilisez « Renvoyer les erreurs corrigées »'); chargerDestEnvoi();
  } catch (e) { afficherMessage(e.message, 'error'); }
}

async function annulerProgEnvoi() {
  if (!confirm('Annuler la programmation ? L\'envoi repasse en brouillon.')) return;
  try {
    await envJSON(`/api/envois/${envCourant.id}/annuler-programmation`, JSONPOST());
    afficherMessage('Programmation annulée'); envCourant.statut = 'brouillon'; envStep = 3; afficherWizardEnvoi();
  } catch (e) { afficherMessage(e.message, 'error'); }
}

function reprendreEnvoi() {
  demanderMdpEnvoi('Reprendre l\'envoi', 'Les emails restés en attente vont être envoyés. Vérifiez d\'abord votre quota Brevo.', '▶️ Reprendre', async mdp => {
    await envJSON(`/api/envois/${envCourant.id}/reprendre`, JSONPOST({ password: mdp }));
    afficherMessage('Envoi repris'); envEtape4(document.getElementById('env-panels'));
  });
}

function renvoyerErreursEnvoi() {
  demanderMdpEnvoi('Renvoyer les erreurs', 'Seront renvoyés : les erreurs techniques, les bounces temporaires et les adresses que vous avez corrigées. Les bounces définitifs non corrigés sont ignorés.', '🔁 Renvoyer', async mdp => {
    const d = await envJSON(`/api/envois/${envCourant.id}/renvoyer-erreurs`, JSONPOST({ password: mdp }));
    afficherMessage(d.nb ? `${d.nb} email(s) renvoyé(s)` : 'Rien à renvoyer (corrigez d\'abord les adresses)', d.nb ? 'success' : 'error');
    envEtape4(document.getElementById('env-panels'));
  });
}

function ouvrirRelanceEnvoi(nb) {
  let m = document.getElementById('modal-relance-envoi');
  if (!m) { m = document.createElement('div'); m.id = 'modal-relance-envoi'; m.className = 'modal'; document.body.appendChild(m); }
  m.innerHTML = `<div class="modal-content" style="max-width:750px"><div class="modal-header">😴 Relancer les non-ouverts (${nb})</div>
    <div style="background:#FEF3C7;border-left:4px solid #F59E0B;padding:12px 16px;border-radius:6px;margin-bottom:16px;font-size:14px;color:#92400E">
      Ces praticiens n'ont pas ouvert l'email. Changez le sujet pour attirer leur attention. Les pièces jointes sont renvoyées.</div>
    <div class="form-group"><label for="rel-env-sujet">Sujet</label><input id="rel-env-sujet" value="${escH('Rappel — ' + (envCourant.sujet_email || ''))}"></div>
    <div id="rel-env-quill" style="min-height:220px;background:white"></div>
    <div class="modal-actions"><button class="btn btn-secondary" onclick="fermerModal('modal-relance-envoi')">Annuler</button>
      <button class="btn btn-warning" style="font-size:14px;padding:10px 20px" id="rel-env-ok">🔄 Relancer ${nb} praticiens</button></div></div>`;
  ouvrirModal('modal-relance-envoi');
  const q = new Quill('#rel-env-quill', { theme: 'snow', modules: { toolbar: [['bold', 'italic', 'underline'], [{ color: [] }, { align: [] }], ['link'], ['clean']] } });
  q.root.innerHTML = envCourant.contenu_html || '';
  document.getElementById('rel-env-ok').onclick = () => {
    const sujet = document.getElementById('rel-env-sujet').value.trim(), contenu_html = q.root.innerHTML;
    if (!sujet || !q.getText().trim()) return afficherMessage('Sujet et contenu requis', 'error');
    fermerModal('modal-relance-envoi');
    demanderMdpEnvoi('Confirmer la relance', `${nb} praticiens vont recevoir la relance.`, '🔄 Relancer', async mdp => {
      const d = await envJSON(`/api/envois/${envCourant.id}/relancer`, JSONPOST({ password: mdp, sujet, contenu_html }));
      afficherMessage(`Relance lancée : ${d.nb} praticiens`); envEtape4(document.getElementById('env-panels'));
    });
  };
}
