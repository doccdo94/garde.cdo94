// ========== ADMIN.JS - CDO 94 ==========
let anneeActive = new Date().getFullYear();
let inscriptionsData = [];
let datesData = [];
let documentsData = [];
let templatesData = [];
let ongletActif = 'inscriptions';
let quillInstances = {};
let quillCampagne = null;

// ========== DEPLOIEMENT STATE ==========
let deployStep = 1;
let uploadResult = null;  // { upload_id, headers, mapping, stats, preview }
let campagneEnCours = null;
let campagneConfig = { annee: '', lien: '', signataire: 'Dr Agnès Danet', sujet: 'Service de garde – Inscription {{ANNEE}}' };

// ========== AUTH ==========
document.getElementById('login-form').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = document.getElementById('login-btn');
  btn.disabled = true; btn.textContent = 'Connexion...';
  try {
    const r = await fetch('/api/login', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ username: document.getElementById('login-username').value, password: document.getElementById('login-password').value })});
    const d = await r.json();
    if (r.ok) { document.getElementById('login-screen').style.display='none'; document.getElementById('admin-screen').style.display='block'; initialiser(); }
    else document.getElementById('login-erreur').textContent = d.error || 'Erreur';
  } catch(e) { document.getElementById('login-erreur').textContent = 'Erreur réseau'; }
  btn.disabled = false; btn.textContent = 'Se connecter';
});

async function verifierAuth() {
  try {
    const r = await fetch('/api/auth-status');
    const d = await r.json();
    if (d.authenticated) { document.getElementById('login-screen').style.display='none'; document.getElementById('admin-screen').style.display='block'; anneeActive = d.annee_active; initialiser(); }
  } catch(e){}
}
verifierAuth();

async function deconnexion() { await fetch('/api/logout',{method:'POST'}); location.reload(); }

function initialiser() {
  const sel = document.getElementById('select-annee');
  sel.innerHTML = '';
  for (let y = anneeActive - 2; y <= anneeActive + 3; y++) { const o = document.createElement('option'); o.value = y; o.textContent = y; if (y === anneeActive) o.selected = true; sel.appendChild(o); }
  chargerStats(); chargerInscriptions();
}

// ========== MESSAGES ==========
function afficherMessage(texte, type='success') {
  const m = document.createElement('div'); m.className = `message ${type}`; m.textContent = texte;
  document.body.appendChild(m); setTimeout(() => m.remove(), 4000);
}

// ========== ONGLETS ==========
function changerOnglet(nom) {
  ongletActif = nom;
  document.querySelectorAll('.tab').forEach((t,i) => t.classList.toggle('active', ['inscriptions','dates','documents','deploiement'][i] === nom));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  document.getElementById(`tab-${nom}`).classList.add('active');
  if (nom === 'inscriptions') { chargerStats(); chargerInscriptions(); }
  else if (nom === 'dates') chargerDates();
  else if (nom === 'documents') chargerDocumentsEtTemplates();
  else if (nom === 'deploiement') chargerDeploiement();
}

// ========== MODALS ==========
function ouvrirModal(id) { document.getElementById(id).classList.add('active'); }
function fermerModal(id) { document.getElementById(id).classList.remove('active'); }

// ========== STATS ==========
async function chargerStats() {
  try {
    const r = await fetch('/api/stats'); const d = await r.json();
    document.getElementById('stat-completes').textContent = d.gardes_futures_completes || 0;
    document.getElementById('stat-partielles').textContent = d.gardes_futures_partielles || 0;
    document.getElementById('stat-total').textContent = d.total_inscriptions || 0;
    const rd = await fetch('/api/dates-garde'); const dates = await rd.json();
    const futures = dates.filter(d => new Date(d.date) >= new Date() && d.active);
    const dispo = futures.filter(d => parseInt(d.nb_inscriptions) < 2).length;
    document.getElementById('stat-disponibles').textContent = dispo;
  } catch(e){}
}

// ========== INSCRIPTIONS ==========
async function chargerInscriptions() {
  try {
    const r = await fetch('/api/inscriptions'); inscriptionsData = await r.json();
    document.getElementById('loading-inscriptions').style.display = 'none';
    const cont = document.getElementById('inscriptions-container'); cont.style.display = 'block';
    afficherInscriptions(cont);
  } catch(e){}
}

function emailStatusIcon(statut) {
  const map = {
    envoye: { icon:'📤', text:'Envoyé', cls:'email-envoye' },
    delivre: { icon:'✅', text:'Délivré', cls:'email-ok' },
    ouvert: { icon:'👁️', text:'Ouvert', cls:'email-ouvert' },
    bounce_hard: { icon:'❌', text:'Bounce invalide', cls:'email-erreur' },
    bounce_soft: { icon:'⚠️', text:'Bounce temporaire', cls:'email-warning' },
    bloque: { icon:'🚫', text:'Bloqué', cls:'email-erreur' },
    spam: { icon:'🗑️', text:'Spam', cls:'email-erreur' },
    invalide: { icon:'❓', text:'Email invalide', cls:'email-erreur' },
    erreur: { icon:'💥', text:'Erreur', cls:'email-erreur' },
    erreur_brevo: { icon:'💥', text:'Erreur Brevo', cls:'email-erreur' },
    non_envoye: { icon:'⏳', text:'Non envoyé', cls:'email-attente' },
  };
  const s = map[statut] || map.non_envoye;
  return `<span class="email-status ${s.cls}" title="${s.text}">${s.icon} ${s.text}</span>`;
}

function isEmailEnvoye(statut) { return ['envoye','delivre','ouvert'].includes(statut); }

function afficherInscriptions(cont) {
  const parDate = {};
  inscriptionsData.forEach(i => { const k = i.date_garde.split('T')[0]; if (!parDate[k]) parDate[k]=[]; parDate[k].push(i); });
  const datesTriees = Object.keys(parDate).sort((a,b) => new Date(b)-new Date(a));
  if (datesTriees.length === 0) { cont.innerHTML = '<p style="text-align:center;color:#6b7280;padding:40px">Aucune inscription pour cette année.</p>'; return; }
  cont.innerHTML = datesTriees.map(ds => {
    const inscs = parDate[ds]; const d = new Date(ds); const estPassee = d < new Date(new Date().toDateString());
    const nb = inscs.length; const complet = nb >= 2;
    return `<div class="date-group ${estPassee?'date-passee':''}">
      <div class="date-group-header"><h3>${formatDateFr(d)}</h3>
      <span class="status-badge ${complet?'status-complete':'status-partial'}">${complet?'✅ Complète (2/2)':'⚠️ '+nb+'/2'}</span></div>
      <div class="practitioners-list">${inscs.map(i => cartePraticien(i, estPassee)).join('')}</div></div>`;
  }).join('');
}

function cartePraticien(i, passee) {
  const confSt = i.email_confirmation_statut || 'non_envoye';
  const j7St = i.email_rappel_j7_statut || 'non_envoye';
  const j1St = i.email_rappel_j1_statut || 'non_envoye';
  const dateEnvoi = i.email_confirmation_envoi_at ? new Date(i.email_confirmation_envoi_at).toLocaleString('fr-FR') : '';
  const actionsHtml = passee ? '' : `<div class="practitioner-actions">
    ${!isEmailEnvoye(confSt)?`<button class="btn btn-success" onclick="renvoyerEmail(${i.id})">📧 Renvoyer</button>`:''}
    ${!isEmailEnvoye(j7St)?`<button class="btn btn-rappel-j7" onclick="envoyerRappel(${i.id},'j7')">📧 J-7</button>`:''}
    ${!isEmailEnvoye(j1St)?`<button class="btn btn-rappel-j1" onclick="envoyerRappel(${i.id},'j1')">📧 J-1</button>`:''}
    <button class="btn btn-danger" onclick="supprimerInscription(${i.id})">🗑️</button></div>`;
  return `<div class="practitioner-card"><div class="practitioner-info">
    <h4>Dr ${i.praticien_nom} ${i.praticien_prenom}</h4>
    <p>📧 ${i.praticien_email} · 📱 ${i.praticien_telephone}</p>
    <p>🏥 ${i.praticien_numero} ${i.praticien_voie}, ${i.praticien_code_postal} ${i.praticien_ville}</p>
    <p>🔢 RPPS: ${i.praticien_rpps}</p>
    <div class="email-statuts-grid">
      <span title="${dateEnvoi}">Confirmation: ${emailStatusIcon(confSt)}</span>
      <span>J-7: ${emailStatusIcon(j7St)}</span>
      <span>J-1: ${emailStatusIcon(j1St)}</span>
    </div></div>${actionsHtml}</div>`;
}

function formatDateFr(d) {
  const j = ['dimanche','lundi','mardi','mercredi','jeudi','vendredi','samedi'];
  const m = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];
  return `${j[d.getDay()]} ${d.getDate()} ${m[d.getMonth()]} ${d.getFullYear()}`;
}

async function rafraichirInscriptions() { await chargerStats(); await chargerInscriptions(); afficherMessage('Actualisé'); }

async function renvoyerEmail(id) {
  if (!confirm('Renvoyer l\'email de confirmation ?')) return;
  try { const r = await fetch(`/api/inscriptions/${id}/renvoyer-email`,{method:'POST'}); if (r.ok) { afficherMessage('Email renvoyé'); chargerInscriptions(); } else { const d = await r.json(); afficherMessage(d.error||'Erreur','error'); } } catch(e) { afficherMessage('Erreur réseau','error'); }
}

async function envoyerRappel(id, type) {
  try { const r = await fetch(`/api/inscriptions/${id}/envoyer-rappel-${type}`,{method:'POST'}); if (r.ok) { const d = await r.json(); afficherMessage(d.message||'Rappel envoyé'); chargerInscriptions(); } else { afficherMessage('Erreur','error'); } } catch(e) { afficherMessage('Erreur','error'); }
}

async function supprimerInscription(id) {
  if (!confirm('Supprimer cette inscription ?')) return;
  try { await fetch(`/api/inscriptions/${id}`,{method:'DELETE'}); afficherMessage('Supprimée'); chargerStats(); chargerInscriptions(); } catch(e) { afficherMessage('Erreur','error'); }
}

async function declencherTousRappels() {
  if (!confirm('Envoyer tous les rappels automatiques (J-7 et J-1) maintenant ?')) return;
  try { const r = await fetch('/api/rappels/envoyer',{method:'POST'}); const d = await r.json(); afficherMessage(`Rappels: ${d.detail?.j7_envoyes||0} J-7, ${d.detail?.j1_envoyes||0} J-1`); chargerInscriptions(); } catch(e) { afficherMessage('Erreur','error'); }
}

async function exporterExcel() { window.open(`/api/export-excel?year=${anneeActive}`); }

// ========== DATES ==========
async function chargerDates() {
  try {
    const r = await fetch('/api/dates-garde'); datesData = await r.json();
    document.getElementById('loading-dates').style.display = 'none';
    const cont = document.getElementById('dates-container'); cont.style.display = 'block';
    const now = new Date(); now.setHours(0,0,0,0);
    cont.innerHTML = `<table class="dates-table"><thead><tr><th>Date</th><th>Type</th><th>Nom</th><th>Inscrits</th><th>Statut</th><th>Actions</th></tr></thead><tbody>
      ${datesData.map(d => {
        const dt = new Date(d.date); const p = dt < now;
        const nb = parseInt(d.nb_inscriptions)||0;
        let badge = ''; if (p) badge='<span class="badge badge-passee">Passée</span>'; else if (nb>=2) badge='<span class="badge badge-active">Complète</span>'; else if (nb===1) badge='<span class="badge badge-attention">1/2</span>'; else badge='<span class="badge badge-urgence">Vide</span>';
        return `<tr style="${p?'opacity:0.5':''}"><td>${formatDateFr(dt)}</td><td><span class="badge ${d.type==='dimanche'?'badge-dimanche':'badge-ferie'}">${d.type==='dimanche'?'Dimanche':'Férié'}</span></td>
          <td>${d.nom_jour_ferie||'—'}</td><td>${nb}/2</td><td>${badge}</td>
          <td>${!p?`<button class="btn btn-danger" onclick="supprimerDate(${d.id})" style="font-size:11px;padding:4px 8px">🗑️</button>`:''}</td></tr>`;
      }).join('')}</tbody></table>`;
  } catch(e){}
}

function ouvrirModalAjouterDate() { ouvrirModal('modal-ajouter-date'); document.getElementById('input-type-date').onchange = function(){ document.getElementById('group-nom-ferie').style.display = this.value==='jour_ferie'?'block':'none'; }; }

async function ajouterDate() {
  const date = document.getElementById('input-nouvelle-date').value;
  const type = document.getElementById('input-type-date').value;
  const nom = document.getElementById('input-nom-ferie').value;
  if (!date) return afficherMessage('Date requise','error');
  try { const r = await fetch('/api/dates-garde',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({date,type,nom_jour_ferie:nom||null})}); if (r.ok) { fermerModal('modal-ajouter-date'); chargerDates(); afficherMessage('Date ajoutée'); } else { const d=await r.json(); afficherMessage(d.error,'error'); } } catch(e) { afficherMessage('Erreur','error'); }
}

async function supprimerDate(id) {
  if (!confirm('Supprimer cette date ?')) return;
  try { const r = await fetch(`/api/dates-garde/${id}`,{method:'DELETE'}); if (r.ok) { chargerDates(); afficherMessage('Supprimée'); } else { const d=await r.json(); afficherMessage(d.error,'error'); } } catch(e) { afficherMessage('Erreur','error'); }
}

// ========== ANNEE ==========
function demanderChangementAnnee(val) {
  const y = parseInt(val); if (y === anneeActive) return;
  document.getElementById('annee-cible').textContent = y;
  document.getElementById('input-mdp-annee').value = '';
  document.getElementById('erreur-annee').textContent = '';
  ouvrirModal('modal-changer-annee');
}

function annulerChangementAnnee() { fermerModal('modal-changer-annee'); document.getElementById('select-annee').value = anneeActive; }

async function confirmerChangementAnnee() {
  const y = parseInt(document.getElementById('annee-cible').textContent);
  const mdp = document.getElementById('input-mdp-annee').value;
  if (!mdp) { document.getElementById('erreur-annee').textContent = 'Mot de passe requis'; return; }
  const btn = document.getElementById('btn-confirmer-annee'); btn.disabled = true;
  try {
    const r = await fetch('/api/configuration/annee',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({annee:y,password:mdp})});
    const d = await r.json();
    if (r.ok) { anneeActive = y; fermerModal('modal-changer-annee'); afficherMessage(`Année changée → ${y}`); initialiser(); }
    else document.getElementById('erreur-annee').textContent = d.error || 'Erreur';
  } catch(e) { document.getElementById('erreur-annee').textContent = 'Erreur réseau'; }
  btn.disabled = false;
}

// ========== DOCUMENTS & TEMPLATES ==========
async function chargerDocumentsEtTemplates() {
  try {
    const [rd, rt] = await Promise.all([fetch('/api/documents'), fetch('/api/email-templates')]);
    documentsData = await rd.json(); templatesData = await rt.json();
    document.getElementById('loading-documents').style.display = 'none';
    const cont = document.getElementById('documents-container'); cont.style.display = 'block';
    afficherDocumentsEtTemplates(cont);
  } catch(e){}
}

function afficherDocumentsEtTemplates(cont) {
  const pjDocs = documentsData.filter(d => !d.est_template_docx && d.actif);
  const tplDoc = documentsData.find(d => d.est_template_docx && d.actif);
  let html = `<div class="doc-section"><h3>📄 Pièces jointes</h3><p class="doc-section-desc">Documents PDF envoyés avec les emails de confirmation.</p>`;
  if (pjDocs.length === 0) html += '<p class="doc-empty">Aucune PJ. Ajoutez-en ci-dessous.</p>';
  else html += pjDocs.map(d => `<div class="doc-card"><span class="doc-icon">📄</span><div class="doc-info"><strong>${d.nom_email}</strong><span class="doc-meta">${d.nom_original} · ${Math.round(d.taille/1024)} Ko</span></div><div class="doc-actions"><button class="btn btn-success" onclick="window.open('/api/documents/${d.id}/download')" style="font-size:11px;padding:4px 8px">⬇️</button><button class="btn btn-danger" onclick="supprimerDocument(${d.id})" style="font-size:11px;padding:4px 8px">🗑️</button></div></div>`).join('');
  html += `<button class="btn btn-primary" onclick="ouvrirUploadDoc(false)" style="margin-top:8px">➕ Ajouter PJ</button></div>`;
  html += `<div class="doc-section"><h3>📝 Template DOCX personnalisé</h3><p class="doc-section-desc">Document Word avec variables <code>{{NOM_PRATICIEN}}</code> et <code>{{DATE_GARDE}}</code></p>`;
  if (tplDoc) html += `<div class="doc-card doc-template"><span class="doc-icon">📝</span><div class="doc-info"><strong>${tplDoc.nom_email}</strong><span class="doc-meta">${tplDoc.nom_original}</span></div><div class="doc-actions"><button class="btn btn-success" onclick="window.open('/api/documents/${tplDoc.id}/download')" style="font-size:11px;padding:4px 8px">⬇️</button><button class="btn btn-danger" onclick="supprimerDocument(${tplDoc.id})" style="font-size:11px;padding:4px 8px">🗑️</button></div></div>`;
  else html += '<p class="doc-empty">Aucun template DOCX.</p>';
  html += `<button class="btn btn-primary" onclick="ouvrirUploadDoc(true)" style="margin-top:8px">📝 ${tplDoc?'Remplacer':'Ajouter'} template DOCX</button></div>`;

  // Email templates
  html += '<div class="doc-section"><h3>✉️ Templates email</h3><p class="doc-section-desc">Personnalisez les emails envoyés aux praticiens.</p>';
  const tplTypes = [{type:'confirmation',label:'📧 Confirmation',desc:'Envoyé après inscription'},{type:'rappel_j7',label:'🟡 Rappel J-7',desc:'7 jours avant'},{type:'rappel_j1',label:'🔴 Rappel J-1',desc:'La veille'}];
  tplTypes.forEach(t => {
    const tpl = templatesData.find(x => x.type === t.type);
    if (!tpl) return;
    html += `<div class="template-editor-block" id="tpl-block-${t.type}">
      <div class="template-header-bar"><h4>${t.label}</h4><span style="color:#6b7280;font-size:13px">${t.desc}</span></div>
      <div class="tpl-field-row"><label>Sujet :</label><input class="tpl-input" id="tpl-sujet-${t.type}" value="${(tpl.sujet||'').replace(/"/g,'&quot;')}"></div>
      <div class="tpl-field-row"><label>Titre header :</label><input class="tpl-input" id="tpl-titre-${t.type}" value="${(tpl.titre_header||'').replace(/"/g,'&quot;')}"></div>
      <div class="tpl-field-row"><label>Couleur 1 :</label><input type="color" id="tpl-c1-${t.type}" value="${tpl.couleur1||'#667eea'}"><label>Couleur 2 :</label><input type="color" id="tpl-c2-${t.type}" value="${tpl.couleur2||'#764ba2'}"></div>`;
    // PJ selection
    html += `<div class="tpl-pj-section"><label>📎 Pièces jointes à inclure :</label><div class="tpl-pj-list" id="tpl-pj-list-${t.type}">`;
    let pjSel = [];
    try { pjSel = tpl.documents_joints === 'all' ? documentsData.filter(d=>d.actif&&!d.est_template_docx).map(d=>d.id) : JSON.parse(tpl.documents_joints||'[]'); } catch(e){}
    pjDocs.forEach(d => { html += `<div class="tpl-pj-item"><input type="checkbox" data-doc-id="${d.id}" ${pjSel.includes(d.id)?'checked':''}><span>📄 ${d.nom_email}</span></div>`; });
    if (tplDoc) html += `<div class="tpl-pj-item tpl-pj-docx"><input type="checkbox" id="tpl-docx-${t.type}" ${tpl.inclure_docx_personnalise?'checked':''}><span>📝 ${tplDoc.nom_email}</span><span class="pj-tag">personnalisé</span></div>`;
    html += `</div></div>`;
    html += `<div id="quill-${t.type}"></div>
      <div class="template-actions" style="margin-top:12px">
        <button class="btn btn-primary" onclick="sauverTemplate('${t.type}')">💾 Sauvegarder</button>
        <button class="btn btn-secondary" onclick="previewTemplate('${t.type}')">👁️ Aperçu</button>
        <button class="btn btn-warning" onclick="resetTemplate('${t.type}')">🔄 Défaut</button>
      </div></div>`;
  });
  html += '</div>';
  cont.innerHTML = html;
  // Init Quills
  tplTypes.forEach(t => {
    const tpl = templatesData.find(x => x.type === t.type);
    if (!tpl) return;
    const q = new Quill(`#quill-${t.type}`, { theme:'snow', modules:{toolbar:[[{header:[1,2,3,false]}],['bold','italic','underline'],[{list:'ordered'},{list:'bullet'}],['link'],['clean']]} });
    q.root.innerHTML = tpl.contenu_html || '';
    quillInstances[t.type] = q;
  });
}

function getTemplatePJData(type) {
  const list = document.getElementById(`tpl-pj-list-${type}`);
  if (!list) return { documents_joints: '[]', inclure_docx_personnalise: false };
  const ids = []; list.querySelectorAll('input[data-doc-id]').forEach(cb => { if (cb.checked) ids.push(parseInt(cb.dataset.docId)); });
  const docxCb = document.getElementById(`tpl-docx-${type}`);
  return { documents_joints: JSON.stringify(ids), inclure_docx_personnalise: docxCb ? docxCb.checked : false };
}

async function sauverTemplate(type) {
  const q = quillInstances[type]; if (!q) return;
  const pjData = getTemplatePJData(type);
  const body = { sujet: document.getElementById(`tpl-sujet-${type}`).value, titre_header: document.getElementById(`tpl-titre-${type}`).value, couleur1: document.getElementById(`tpl-c1-${type}`).value, couleur2: document.getElementById(`tpl-c2-${type}`).value, contenu_html: q.root.innerHTML, ...pjData };
  try { const r = await fetch(`/api/email-templates/${type}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}); if (r.ok) afficherMessage('Template sauvegardé'); else afficherMessage('Erreur','error'); } catch(e) { afficherMessage('Erreur','error'); }
}

async function previewTemplate(type) {
  const q = quillInstances[type]; if (!q) return;
  const pjData = getTemplatePJData(type);
  const body = { sujet: document.getElementById(`tpl-sujet-${type}`).value, titre_header: document.getElementById(`tpl-titre-${type}`).value, sous_titre_header: '', couleur1: document.getElementById(`tpl-c1-${type}`).value, couleur2: document.getElementById(`tpl-c2-${type}`).value, contenu_html: q.root.innerHTML, ...pjData };
  try { const r = await fetch(`/api/email-templates/${type}/preview`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}); const d = await r.json(); document.getElementById('preview-iframe').srcdoc = d.html; ouvrirModal('modal-preview'); } catch(e){}
}

async function resetTemplate(type) {
  if (!confirm('Remettre le template par défaut ?')) return;
  try { const r = await fetch(`/api/email-templates/${type}/reset`,{method:'POST'}); if (r.ok) { afficherMessage('Template réinitialisé'); chargerDocumentsEtTemplates(); } } catch(e){}
}

// ========== UPLOAD DOCUMENTS ==========
function ouvrirUploadDoc(isTemplate) {
  document.getElementById('upload-titre').textContent = isTemplate ? '📝 Upload template DOCX' : '📤 Upload pièce jointe';
  document.getElementById('upload-est-template').value = isTemplate ? 'true' : 'false';
  document.getElementById('upload-nom-email').value = '';
  document.getElementById('upload-fichier').value = '';
  ouvrirModal('modal-upload-doc');
  const zone = document.getElementById('upload-drop-zone');
  zone.onclick = () => document.getElementById('upload-fichier').click();
  document.getElementById('upload-fichier').onchange = e => { if (e.target.files[0]) zone.innerHTML = `<p>✅ ${e.target.files[0].name}</p>`; };
}

async function uploaderDocument() {
  const fichier = document.getElementById('upload-fichier').files[0];
  if (!fichier) return afficherMessage('Choisissez un fichier','error');
  const fd = new FormData();
  fd.append('fichier', fichier);
  fd.append('nom_email', document.getElementById('upload-nom-email').value || fichier.name);
  fd.append('est_template_docx', document.getElementById('upload-est-template').value);
  const btn = document.getElementById('btn-upload'); btn.disabled = true;
  try { const r = await fetch('/api/documents/upload',{method:'POST',body:fd}); if (r.ok) { fermerModal('modal-upload-doc'); chargerDocumentsEtTemplates(); afficherMessage('Document uploadé'); } else { const d=await r.json(); afficherMessage(d.error,'error'); } } catch(e) { afficherMessage('Erreur','error'); }
  btn.disabled = false;
}

async function supprimerDocument(id) {
  if (!confirm('Supprimer ce document ?')) return;
  try { await fetch(`/api/documents/${id}`,{method:'DELETE'}); chargerDocumentsEtTemplates(); afficherMessage('Supprimé'); } catch(e){}
}

// ========== DEPLOIEMENT ==========
async function chargerDeploiement() {
  const cont = document.getElementById('deploiement-container');
  // Charger les campagnes existantes
  try {
    const r = await fetch('/api/campagnes');
    const campagnes = await r.json();
    // Si campagne en_cours, afficher le suivi
    const enCours = campagnes.find(c => c.statut === 'en_cours');
    const terminee = campagnes.find(c => c.statut === 'terminee');
    if (enCours) { campagneEnCours = enCours; afficherSuiviCampagne(cont, enCours.id); return; }

    let html = `<div class="deploy-section"><h2>🚀 Campagne d'appel aux gardes</h2>
      <p class="deploy-desc">Envoyez un email d'invitation à tous les praticiens du département.</p>`;
    // Liste des campagnes passées
    if (campagnes.length > 0) {
      html += '<h3 style="margin-bottom:12px;font-size:16px">Campagnes existantes</h3>';
      campagnes.forEach(c => {
        html += `<div class="camp-list-item" onclick="${c.statut==='terminee'?`afficherSuiviCampagne(document.getElementById('deploiement-container'),${c.id})`:`chargerBrouillon(${c.id})`}">
          <div><strong>${c.nom||'Campagne '+c.annee_cible}</strong>
          <span style="color:#6b7280;font-size:12px;margin-left:8px">${c.nb_destinataires} destinataires · ${new Date(c.created_at).toLocaleDateString('fr-FR')}</span></div>
          <div style="display:flex;gap:8px;align-items:center">
            <span class="camp-badge camp-${c.statut}">${c.statut==='brouillon'?'📝 Brouillon':c.statut==='en_cours'?'⏳ En cours':'✅ Terminée'}</span>
            ${c.statut==='brouillon'?`<button class="btn btn-danger" onclick="event.stopPropagation();supprimerCampagne(${c.id})" style="font-size:11px;padding:4px 8px">🗑️</button>`:''}
          </div></div>`;
      });
    }
    html += `<button class="btn btn-primary" onclick="nouvelleCampagne()" style="margin-top:16px">➕ Nouvelle campagne</button></div>`;
    cont.innerHTML = html;
  } catch(e) { cont.innerHTML = '<p style="color:#ef4444">Erreur chargement</p>'; }
}

async function supprimerCampagne(id) {
  if (!confirm('Supprimer cette campagne brouillon ?')) return;
  try { await fetch(`/api/campagnes/${id}`,{method:'DELETE'}); chargerDeploiement(); afficherMessage('Campagne supprimée'); } catch(e) { afficherMessage('Erreur','error'); }
}

function nouvelleCampagne() {
  deployStep = 1; uploadResult = null; campagneEnCours = null;
  campagneConfig = { annee: anneeActive + 1, lien: `https://garde-cdo94.onrender.com/?token=garde${anneeActive+1}cdo94`, signataire: 'Dr Agnès Danet', sujet: 'Service de garde – Inscription {{ANNEE}}' };
  afficherWizard();
}

function afficherWizard() {
  const cont = document.getElementById('deploiement-container');
  cont.innerHTML = `<div class="deploy-section"><h2>🚀 Nouvelle campagne</h2>
    <div class="workflow">${[{n:1,l:'Configuration'},{n:2,l:'Liste praticiens'},{n:3,l:'Email'},{n:4,l:'Lancement'},{n:5,l:'Suivi'}].map(s =>
      `<div class="wf-step ${s.n<deployStep?'done':s.n===deployStep?'active':''}" onclick="allerEtape(${s.n})"><div class="wf-num">${s.n}</div><div class="wf-label">${s.l}</div></div>`
    ).join('')}</div>
    <div id="deploy-panels"></div></div>`;
  afficherEtape();
}

function allerEtape(n) {
  if (n > deployStep + 1) return;
  if (n === 3 && !uploadResult) return afficherMessage('Importez d\'abord la liste','error');
  if (n === 4 && !campagneEnCours) return afficherMessage('Configurez d\'abord l\'email','error');
  deployStep = n; afficherWizard();
}

function afficherEtape() {
  const p = document.getElementById('deploy-panels');
  if (deployStep === 1) afficherEtape1(p);
  else if (deployStep === 2) afficherEtape2(p);
  else if (deployStep === 3) afficherEtape3(p);
  else if (deployStep === 4) afficherEtape4(p);
  else if (deployStep === 5 && campagneEnCours) afficherSuiviCampagne(document.getElementById('deploiement-container'), campagneEnCours.id);
}

function afficherEtape1(p) {
  p.innerHTML = `<h3 style="margin-bottom:16px">⚙️ Configuration</h3>
    <div class="config-grid">
      <div class="config-card"><h4>📅 Année cible</h4><select id="cfg-annee" onchange="campagneConfig.annee=parseInt(this.value)">
        ${[anneeActive,anneeActive+1,anneeActive+2].map(y=>`<option value="${y}" ${y==campagneConfig.annee?'selected':''}>${y}</option>`).join('')}</select>
        <div class="config-hint">Les praticiens seront invités pour les gardes de cette année.</div></div>
      <div class="config-card"><h4>📧 Expéditeur</h4><input value="${EMAIL_FROM||'doc.cdo94@gmail.com'}" disabled style="background:#f3f4f6">
        <div class="config-hint">Configuré dans Brevo</div></div>
      <div class="config-card"><h4>🔗 Lien d'inscription</h4><input id="cfg-lien" value="${campagneConfig.lien}" onchange="campagneConfig.lien=this.value">
        <div class="config-hint">Inséré via {{LIEN_INSCRIPTION}}</div></div>
      <div class="config-card"><h4>✍️ Signataire</h4><input id="cfg-sign" value="${campagneConfig.signataire}" onchange="campagneConfig.signataire=this.value">
        <div class="config-hint">Via {{SIGNATAIRE}}</div></div>
    </div>
    <div class="step-nav"><div></div><button class="btn btn-primary" onclick="deployStep=2;afficherWizard()">Suivant → Liste praticiens</button></div>`;
}

const EMAIL_FROM = 'doc.cdo94@gmail.com';

function afficherEtape2(p) {
  let html = `<h3 style="margin-bottom:16px">📋 Liste des praticiens</h3>
    <p style="color:#6b7280;font-size:14px;margin-bottom:16px">Importez le fichier Excel des praticiens en exercice (format ONCD).</p>
    <div class="upload-drop-zone" id="deploy-upload-zone" onclick="document.getElementById('deploy-upload-file').click()">
      <p style="font-size:16px">📂 <strong>Glissez votre fichier Excel ici</strong> ou cliquez</p>
      <p style="font-size:12px;color:#9ca3af;margin-top:4px">.xlsx · Max 20 MB</p>
    </div>
    <input type="file" id="deploy-upload-file" accept=".xlsx,.xls,.csv" style="display:none">`;
  if (uploadResult) {
    html += afficherResultatUpload();
  }
  html += `<div class="step-nav"><button class="btn btn-secondary" onclick="deployStep=1;afficherWizard()">← Configuration</button>
    <button class="btn btn-primary" ${!uploadResult?'disabled':''} onclick="deployStep=3;afficherWizard()">Suivant → Email</button></div>`;
  p.innerHTML = html;

  // Events
  const fileInput = document.getElementById('deploy-upload-file');
  fileInput.onchange = e => { if (e.target.files[0]) uploaderListePraticiens(e.target.files[0]); };
  const zone = document.getElementById('deploy-upload-zone');
  zone.ondragover = e => { e.preventDefault(); zone.classList.add('drop-active'); };
  zone.ondragleave = () => zone.classList.remove('drop-active');
  zone.ondrop = e => { e.preventDefault(); zone.classList.remove('drop-active'); if (e.dataTransfer.files[0]) uploaderListePraticiens(e.dataTransfer.files[0]); };
}

async function uploaderListePraticiens(file) {
  const zone = document.getElementById('deploy-upload-zone');
  zone.innerHTML = '<p>⏳ Analyse en cours...</p>';
  const fd = new FormData(); fd.append('fichier', file);
  try {
    const r = await fetch('/api/campagnes/upload-liste', { method: 'POST', body: fd });
    const d = await r.json();
    if (!r.ok) { zone.innerHTML = `<p style="color:#ef4444">❌ ${d.error}</p>`; return; }
    uploadResult = d;
    afficherEtape2(document.getElementById('deploy-panels'));
  } catch (e) { zone.innerHTML = '<p style="color:#ef4444">Erreur réseau</p>'; }
}

function afficherResultatUpload() {
  const u = uploadResult;
  const s = u.stats;
  let html = `<div class="upload-result">
    <h4 style="color:#065f46;margin-bottom:4px">✅ Fichier importé</h4>
    <p style="color:#6b7280;font-size:13px">${u.total_rows} lignes analysées</p>
    <div class="upload-stats-grid">
      <div class="up-stat"><div class="n">${s.total}</div><div class="l">Praticiens</div></div>
      <div class="up-stat"><div class="n" style="color:#10b981">${s.avec_email}</div><div class="l">Avec email</div></div>
      <div class="up-stat"><div class="n" style="color:#ef4444">${s.sans_email}</div><div class="l">Sans email</div></div>
      <div class="up-stat"><div class="n" style="color:#f59e0b">${s.avec_email_prioritaire}</div><div class="l">Email prioritaire</div></div>
    </div>`;
  // Mapping auto-détecté
  html += `<h4 style="margin-top:16px;margin-bottom:8px">🔍 Colonnes détectées <span style="color:#6b7280;font-size:12px;font-weight:400">(modifiez si nécessaire)</span></h4>
    <div class="mapping-grid">`;
  const fields = [
    { key:'nom', label:'Nom', required:true },
    { key:'prenom', label:'Prénom' },
    { key:'email', label:'Email (prioritaire)', required:true },
    { key:'email2', label:'Email (secondaire)' },
    { key:'age', label:'Âge' },
    { key:'rpps', label:'RPPS' },
    { key:'ville', label:'Ville' },
    { key:'code_postal', label:'Code postal' },
  ];
  fields.forEach(f => {
    const selVal = u.mapping[f.key];
    html += `<div class="mapping-item"><label>${f.label}${f.required?' *':''}</label>
      <select onchange="updateMapping('${f.key}',this.value)" id="map-${f.key}">
        <option value="-1">— Non mappé —</option>
        ${u.headers.map((h,i) => `<option value="${i}" ${selVal===i?'selected':''}>${String.fromCharCode(65+i)}: ${h||'(vide)'}</option>`).join('')}
      </select></div>`;
  });
  html += '</div>';
  // Info priorité
  html += `<div style="margin-top:12px;background:#fffbeb;border:1px solid #fcd34d;border-radius:8px;padding:12px;font-size:13px;color:#92400e;">
    💡 <strong>Priorité email :</strong> Le système utilisera l'email prioritaire, sinon le secondaire. Les praticiens sans aucun email valide seront exclus.</div>`;
  // Preview
  if (u.preview && u.preview.length > 0) {
    html += `<div class="preview-mini"><table><thead><tr><th>Nom</th><th>Prénom</th><th>Email</th><th>RPPS</th><th>Ville</th></tr></thead><tbody>
      ${u.preview.map(r => `<tr><td>${r.nom}</td><td>${r.prenom}</td><td class="${r.email?'em-found':'em-missing'}">${r.email||'⚠️ Aucun'}</td><td>${r.rpps}</td><td>${r.ville}</td></tr>`).join('')}
      <tr><td colspan="5" style="text-align:center;color:#9ca3af;font-style:italic">... ${Math.max(0,u.total_rows-10)} autres lignes ...</td></tr>
    </tbody></table></div>`;
  }
  html += '</div>';
  return html;
}

async function updateMapping(key, val) {
  uploadResult.mapping[key] = val === '-1' ? null : parseInt(val);
  // Recalculer côté serveur
  try {
    const r = await fetch('/api/campagnes/recalculer-mapping', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ upload_id: uploadResult.upload_id, mapping: uploadResult.mapping })
    });
    const d = await r.json();
    if (r.ok) { uploadResult.stats = d.stats; uploadResult.preview = d.preview; afficherEtape2(document.getElementById('deploy-panels')); }
  } catch (e) {}
}

function afficherEtape3(p) {
  const contenuDefaut = `<p>Chère consœur, cher confrère,</p>
<p>Comme vous le savez, notre profession est soumise à la mise en place d'un service de garde obligatoire.</p>
<p>Concrètement pour notre département : deux praticiens seront d'astreinte les dimanches et jours fériés.</p>
<p>Pour satisfaire à cette obligation, nous vous demandons de vous inscrire, à la date qui vous convient, via le lien ci-dessous :</p>
<p>👉 <a href="{{LIEN_INSCRIPTION}}">{{LIEN_INSCRIPTION}}</a></p>
<p>Le document ci-joint rassemble toutes les informations qui répondront à vos questions.</p>
<p>Confraternellement,</p>
<p><strong>{{SIGNATAIRE}}</strong><br>Service de gardes : <a href="mailto:cdogardes94@gmail.com">cdogardes94@gmail.com</a></p>`;

  const pjDocs = documentsData.filter(d => !d.est_template_docx && d.actif);

  let html = `<h3 style="margin-bottom:16px">✉️ Email d'invitation</h3>
    <div class="tpl-field-row"><label>Sujet :</label><input class="tpl-input" id="camp-sujet" value="${campagneConfig.sujet.replace(/"/g,'&quot;')}"></div>
    <div id="quill-campagne" style="margin:16px 0;min-height:250px"></div>
    <div class="tpl-pj-section"><label>📎 Pièces jointes :</label><div class="tpl-pj-list" id="camp-pj-list">
      ${pjDocs.map(d => `<div class="tpl-pj-item"><input type="checkbox" data-doc-id="${d.id}"><span>📄 ${d.nom_email}</span></div>`).join('')}
      ${pjDocs.length===0?'<p style="color:#9ca3af;font-size:12px">Aucune PJ disponible. Ajoutez-en dans l\'onglet Documents.</p>':''}
    </div></div>
    <div style="margin-top:12px;background:#eff6ff;border:1px solid #93c5fd;border-radius:8px;padding:12px;font-size:13px;color:#1e40af;">
      <strong>Variables :</strong> <code>{{NOM}}</code> <code>{{PRENOM}}</code> <code>{{ANNEE}}</code> <code>{{LIEN_INSCRIPTION}}</code> <code>{{SIGNATAIRE}}</code></div>
    <div style="margin-top:12px"><button class="btn btn-secondary" onclick="previewCampagneEmail()">👁️ Aperçu</button></div>
    <div class="step-nav"><button class="btn btn-secondary" onclick="deployStep=2;afficherWizard()">← Liste</button>
      <button class="btn btn-primary" onclick="creerCampagne()">Suivant → Lancement</button></div>`;
  p.innerHTML = html;

  // Init Quill
  setTimeout(() => {
    quillCampagne = new Quill('#quill-campagne', {
      theme: 'snow',
      modules: { toolbar: [[{header:[1,2,3,false]}],['bold','italic','underline'],[{list:'ordered'},{list:'bullet'}],['link'],['clean']] }
    });
    const existingContent = campagneEnCours ? campagneEnCours.contenu_html : null;
    quillCampagne.root.innerHTML = existingContent || contenuDefaut;
  }, 100);
}

async function previewCampagneEmail() {
  if (!quillCampagne) return;
  const body = {
    sujet: document.getElementById('camp-sujet').value,
    titre_header: 'Service de garde – Inscription',
    sous_titre_header: '', couleur1: '#667eea', couleur2: '#764ba2',
    contenu_html: quillCampagne.root.innerHTML
  };
  try {
    const r = await fetch('/api/email-templates/confirmation/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const d = await r.json();
    document.getElementById('preview-iframe').srcdoc = d.html; ouvrirModal('modal-preview');
  } catch (e) {}
}

async function creerCampagne() {
  if (!quillCampagne || !uploadResult) return afficherMessage('Données manquantes', 'error');
  // Collecter PJ
  const pjIds = [];
  document.querySelectorAll('#camp-pj-list input[data-doc-id]').forEach(cb => { if (cb.checked) pjIds.push(parseInt(cb.dataset.docId)); });

  const body = {
    upload_id: uploadResult.upload_id,
    mapping: uploadResult.mapping,
    nom: `Campagne ${campagneConfig.annee}`,
    annee_cible: campagneConfig.annee,
    lien_inscription: campagneConfig.lien,
    signataire: campagneConfig.signataire,
    sujet_email: document.getElementById('camp-sujet').value,
    contenu_html: quillCampagne.root.innerHTML,
    documents_joints: JSON.stringify(pjIds),
  };
  try {
    const r = await fetch('/api/campagnes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const d = await r.json();
    if (r.ok) {
      campagneEnCours = d.campagne;
      afficherMessage(`Campagne créée (${d.campagne.nb_destinataires} destinataires)`);
      deployStep = 4; afficherWizard();
    } else afficherMessage(d.error || 'Erreur', 'error');
  } catch (e) { afficherMessage('Erreur réseau', 'error'); }
}

function afficherEtape4(p) {
  if (!campagneEnCours) { p.innerHTML = '<p>Pas de campagne. Revenez à l\'étape 3.</p>'; return; }
  const c = campagneEnCours;
  const nbDest = c.nb_destinataires;
  p.innerHTML = `<h3 style="margin-bottom:16px">🚀 Lancement</h3>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:20px">
      <div style="text-align:center;padding:20px;background:#f9fafb;border-radius:10px;border:2px solid #e5e7eb">
        <div style="font-size:32px">👥</div><div style="font-size:28px;font-weight:700;color:#667eea">${nbDest}</div><div style="font-size:12px;color:#6b7280">Destinataires</div></div>
      <div style="text-align:center;padding:20px;background:#f9fafb;border-radius:10px;border:2px solid #e5e7eb">
        <div style="font-size:32px">📧</div><div style="font-size:28px;font-weight:700;color:#667eea">${nbDest}</div><div style="font-size:12px;color:#6b7280">Emails à envoyer</div></div>
      <div style="text-align:center;padding:20px;background:#f9fafb;border-radius:10px;border:2px solid #e5e7eb">
        <div style="font-size:32px">📅</div><div style="font-size:28px;font-weight:700;color:#667eea">${c.annee_cible}</div><div style="font-size:12px;color:#6b7280">Année cible</div></div>
    </div>
    <div style="background:#eff6ff;border:2px solid #93c5fd;border-radius:10px;padding:20px;margin-bottom:20px">
      <h4 style="color:#1e40af;margin-bottom:12px">⏱️ Mode d'envoi</h4>
      <label style="display:flex;align-items:center;gap:8px;margin-bottom:8px;cursor:pointer">
        <input type="radio" name="mode-envoi" value="progressif" checked style="accent-color:#667eea"> <strong>Progressif (recommandé)</strong></label>
      <p style="font-size:12px;color:#6b7280;margin-left:24px;margin-bottom:12px">~2s entre chaque email. Durée estimée : ~${Math.ceil(nbDest*2/60)} min</p>
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
        <input type="radio" name="mode-envoi" value="immediat" style="accent-color:#667eea"> <strong>Immédiat</strong></label>
      <p style="font-size:12px;color:#6b7280;margin-left:24px">Rapide mais risque de throttling Brevo sur gros volumes.</p>
    </div>
    <div style="background:#fef2f2;border:2px solid #fca5a5;border-radius:10px;padding:16px;margin-bottom:20px">
      <p style="font-weight:700;color:#991b1b;margin-bottom:8px">⚠️ Vérification</p>
      <p style="color:#991b1b;font-size:14px">✅ Année : <strong>${c.annee_cible}</strong></p>
      <p style="color:#991b1b;font-size:14px">✅ ${nbDest} destinataires avec email valide</p>
      <p style="color:#991b1b;font-size:14px">✅ Lien : ${c.lien_inscription||'—'}</p>
    </div>
    <button class="btn-launch-big" onclick="demanderAuthCampagne('lancer')">🔐 Authentification requise — Lancer (${nbDest} emails)</button>
    <div class="step-nav" style="margin-top:16px"><button class="btn btn-secondary" onclick="deployStep=3;afficherWizard()">← Email</button><div></div></div>`;
}

let authCampagneAction = 'lancer';
function demanderAuthCampagne(action) {
  authCampagneAction = action;
  document.getElementById('input-mdp-campagne').value = '';
  document.getElementById('erreur-campagne').textContent = '';
  if (action === 'relancer') {
    document.getElementById('auth-camp-desc').textContent = 'Confirmez pour relancer les emails non ouverts.';
    document.getElementById('btn-confirmer-campagne').textContent = '🔄 Relancer';
  } else {
    document.getElementById('auth-camp-desc').textContent = 'Confirmez votre identité pour lancer la campagne.';
    document.getElementById('btn-confirmer-campagne').textContent = '🚀 Confirmer';
  }
  ouvrirModal('modal-auth-campagne');
}

async function confirmerLancementCampagne() {
  const mdp = document.getElementById('input-mdp-campagne').value;
  if (!mdp) { document.getElementById('erreur-campagne').textContent = 'Mot de passe requis'; return; }
  const btn = document.getElementById('btn-confirmer-campagne'); btn.disabled = true;

  if (authCampagneAction === 'relancer') {
    try {
      const r = await fetch(`/api/campagnes/${campagneEnCours.id}/relancer`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: mdp }) });
      const d = await r.json();
      if (r.ok) { fermerModal('modal-auth-campagne'); afficherMessage(`Relance lancée (${d.nb_relances} emails)`); setTimeout(() => afficherSuiviCampagne(document.getElementById('deploiement-container'), campagneEnCours.id), 1000); }
      else document.getElementById('erreur-campagne').textContent = d.error || 'Erreur';
    } catch (e) { document.getElementById('erreur-campagne').textContent = 'Erreur réseau'; }
    btn.disabled = false; return;
  }

  const mode = document.querySelector('input[name="mode-envoi"]:checked')?.value || 'progressif';
  try {
    const r = await fetch(`/api/campagnes/${campagneEnCours.id}/lancer`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: mdp, mode })
    });
    const d = await r.json();
    if (r.ok) {
      fermerModal('modal-auth-campagne');
      afficherMessage('🚀 Campagne lancée !');
      deployStep = 5;
      setTimeout(() => afficherSuiviCampagne(document.getElementById('deploiement-container'), campagneEnCours.id), 1000);
    } else document.getElementById('erreur-campagne').textContent = d.error || 'Erreur';
  } catch (e) { document.getElementById('erreur-campagne').textContent = 'Erreur réseau'; }
  btn.disabled = false;
}

// ========== SUIVI CAMPAGNE ==========
let suiviInterval = null;

async function afficherSuiviCampagne(cont, campagneId) {
  if (suiviInterval) clearInterval(suiviInterval);
  try {
    const r = await fetch(`/api/campagnes/${campagneId}`);
    const { campagne: c, stats } = await r.json();
    campagneEnCours = c;

    const total = c.nb_destinataires || 1;
    const env = (stats.envoye||0) + (stats.delivre||0) + (stats.ouvert||0) + (stats.clique||0);
    const del = (stats.delivre||0) + (stats.ouvert||0) + (stats.clique||0);
    const ouv = (stats.ouvert||0) + (stats.clique||0);
    const cli = stats.clique||0;
    const err = (stats.erreur||0) + (stats.bounce_hard||0) + (stats.bounce_soft||0) + (stats.bloque||0) + (stats.spam||0);
    const pEnv = ((env/total)*100).toFixed(1);
    const pDel = ((del/total)*100).toFixed(1);
    const pOuv = ((ouv/total)*100).toFixed(1);
    const pCli = ((cli/total)*100).toFixed(1);
    const nonOuv = (stats.envoye||0) + (stats.delivre||0);

    let html = `<div class="deploy-section"><h2>📊 Suivi — ${c.nom||'Campagne '+c.annee_cible}</h2>
      <p class="deploy-desc">${c.statut==='en_cours'?'⏳ Envoi en cours...':'✅ Campagne terminée'} · ${total} destinataires · Lancée le ${c.lancee_at?new Date(c.lancee_at).toLocaleString('fr-FR'):'—'}</p>
      <div class="track-stats">
        <div class="track-card"><div class="tn" style="color:#3b82f6">${env}</div><div class="tp">${pEnv}%</div><div class="tl">Envoyés</div></div>
        <div class="track-card"><div class="tn" style="color:#10b981">${del}</div><div class="tp">${pDel}%</div><div class="tl">Délivrés</div></div>
        <div class="track-card"><div class="tn" style="color:#8b5cf6">${ouv}</div><div class="tp">${pOuv}%</div><div class="tl">Ouverts</div></div>
        <div class="track-card"><div class="tn" style="color:#f59e0b">${cli}</div><div class="tp">${pCli}%</div><div class="tl">Cliqués</div></div>
        <div class="track-card"><div class="tn" style="color:#ef4444">${err}</div><div class="tp">${((err/total)*100).toFixed(1)}%</div><div class="tl">Erreurs</div></div>
      </div>
      <div style="margin-bottom:20px">
        <div class="progress-row"><div class="progress-lbl">Envoyés</div><div class="progress-bar"><div class="progress-fill fill-env" style="width:${pEnv}%">${pEnv}%</div></div></div>
        <div class="progress-row"><div class="progress-lbl">Délivrés</div><div class="progress-bar"><div class="progress-fill fill-del" style="width:${pDel}%">${pDel}%</div></div></div>
        <div class="progress-row"><div class="progress-lbl">Ouverts</div><div class="progress-bar"><div class="progress-fill fill-ouv" style="width:${pOuv}%">${pOuv}%</div></div></div>
        <div class="progress-row"><div class="progress-lbl">Cliqués</div><div class="progress-bar"><div class="progress-fill fill-cli" style="width:${pCli}%">${pCli}%</div></div></div>
      </div>
      <h4 style="margin-bottom:8px">📋 Détail par praticien</h4>
      <div class="filter-bar" id="camp-filters">
        <div class="filter-chip active" onclick="filtrerDest('tous',this)">Tous (${total})</div>
        <div class="filter-chip" onclick="filtrerDest('envoye',this)">📤 Envoyés (${stats.envoye||0})</div>
        <div class="filter-chip" onclick="filtrerDest('delivre',this)">✅ Délivrés (${stats.delivre||0})</div>
        <div class="filter-chip" onclick="filtrerDest('ouvert',this)">👁️ Ouverts (${stats.ouvert||0})</div>
        <div class="filter-chip" onclick="filtrerDest('clique',this)">🔗 Cliqués (${cli})</div>
        <div class="filter-chip" onclick="filtrerDest('erreur',this)">❌ Erreurs (${err})</div>
        <div class="filter-chip" onclick="filtrerDest('non_ouverts',this)">😴 Non ouverts (${nonOuv})</div>
      </div>
      <div class="dest-scroll" id="dest-table-container"><div class="loading"><div class="spinner"></div></div></div>
      <div style="margin-top:16px;display:flex;gap:10px;flex-wrap:wrap">
        <button class="btn btn-primary" onclick="afficherSuiviCampagne(document.getElementById('deploiement-container'),${c.id})">🔄 Rafraîchir</button>
        ${c.statut==='terminee'&&nonOuv>0?`<button class="btn btn-warning" onclick="demanderAuthCampagne('relancer')">📧 Relancer les non-ouverts (${nonOuv})</button>`:''}
        <button class="btn btn-secondary" onclick="chargerDeploiement()">← Retour</button>
      </div></div>`;
    cont.innerHTML = html;
    chargerDestinataires(campagneId, 'tous');

    // Auto-refresh si en cours
    if (c.statut === 'en_cours') {
      suiviInterval = setInterval(() => afficherSuiviCampagne(cont, campagneId), 10000);
    }
  } catch (e) { cont.innerHTML = '<p style="color:#ef4444">Erreur chargement suivi</p>'; }
}

async function filtrerDest(filtre, el) {
  document.querySelectorAll('#camp-filters .filter-chip').forEach(c => c.classList.remove('active'));
  if (el) el.classList.add('active');
  if (campagneEnCours) chargerDestinataires(campagneEnCours.id, filtre);
}

async function chargerDestinataires(campagneId, filtre) {
  const cont = document.getElementById('dest-table-container');
  try {
    const r = await fetch(`/api/campagnes/${campagneId}/destinataires?filtre=${filtre}`);
    const dests = await r.json();
    if (dests.length === 0) { cont.innerHTML = '<p style="text-align:center;color:#9ca3af;padding:20px">Aucun résultat pour ce filtre.</p>'; return; }
    cont.innerHTML = `<table class="dest-table"><thead><tr><th>Praticien</th><th>Email</th><th>Statut</th><th>Ouverts</th><th>Clics</th><th>Dernière activité</th></tr></thead><tbody>
      ${dests.map(d => {
        const dotCls = d.statut === 'clique' ? 'dot-clique' : d.statut === 'ouvert' ? 'dot-ouvert' : d.statut === 'delivre' ? 'dot-delivre' : d.statut === 'envoye' ? 'dot-envoye' : d.statut === 'en_attente' ? 'dot-attente' : 'dot-erreur';
        const stLabel = { en_attente:'En attente', envoye:'Envoyé', delivre:'Délivré', ouvert:'Ouvert', clique:'Cliqué', erreur:'Erreur', bounce_hard:'Bounce', bounce_soft:'Bounce', bloque:'Bloqué', spam:'Spam' }[d.statut] || d.statut;
        return `<tr><td><strong>${d.nom} ${d.prenom}</strong></td><td style="font-size:11px">${d.email}</td>
          <td><span class="status-dot ${dotCls}"></span>${stLabel}</td>
          <td>${d.nb_ouvertures>0?'👁️ '+d.nb_ouvertures:'—'}</td>
          <td>${d.nb_clics>0?'🔗 '+d.nb_clics:'—'}</td>
          <td style="font-size:11px;color:#6b7280">${d.derniere_activite?new Date(d.derniere_activite).toLocaleString('fr-FR'):'—'}</td></tr>`;
      }).join('')}
      ${dests.length>=200?'<tr><td colspan="6" style="text-align:center;color:#9ca3af;font-style:italic">Limité à 200 résultats</td></tr>':''}
    </tbody></table>`;
  } catch (e) { cont.innerHTML = '<p style="color:#ef4444">Erreur</p>'; }
}

async function chargerBrouillon(id) {
  try {
    const r = await fetch(`/api/campagnes/${id}`);
    const { campagne } = await r.json();
    campagneEnCours = campagne;
    campagneConfig.annee = campagne.annee_cible;
    campagneConfig.lien = campagne.lien_inscription;
    campagneConfig.signataire = campagne.signataire;
    campagneConfig.sujet = campagne.sujet_email;
    deployStep = 4; afficherWizard();
  } catch (e) { afficherMessage('Erreur', 'error'); }
}
