const API_URL = window.location.origin;
let ongletActif = 'inscriptions';
let anneeActive = new Date().getFullYear();
let anneeAvantChangement = null;
const quillEditors = {};

document.addEventListener('DOMContentLoaded', () => {
    verifierAuth();
    document.getElementById('login-form').addEventListener('submit', login);
    document.getElementById('input-type-date').addEventListener('change', (e) => {
        document.getElementById('group-nom-ferie').style.display = e.target.value === 'jour_ferie' ? 'block' : 'none';
    });
    setupDragDrop();
});

// ========== AUTH ==========

async function verifierAuth() {
    try {
        const r = await fetch(`${API_URL}/api/auth-status`);
        const d = await r.json();
        if (d.authenticated) {
            anneeActive = d.annee_active || new Date().getFullYear();
            initSelecteurAnnee();
            montrerAdmin();
        } else {
            montrerLogin();
        }
    } catch (e) {
        montrerLogin();
    }
}

function initSelecteurAnnee() {
    const sel = document.getElementById('select-annee');
    if (!sel) return;
    const curYear = new Date().getFullYear();
    sel.innerHTML = '';
    for (let y = curYear - 2; y <= curYear + 3; y++) {
        const opt = document.createElement('option');
        opt.value = y; opt.textContent = y;
        if (y === anneeActive) opt.selected = true;
        sel.appendChild(opt);
    }
}

function demanderChangementAnnee(nouvelleAnnee) {
    nouvelleAnnee = parseInt(nouvelleAnnee);
    if (nouvelleAnnee === anneeActive) return;
    anneeAvantChangement = anneeActive;
    document.getElementById('annee-cible').textContent = nouvelleAnnee;
    document.getElementById('input-mdp-annee').value = '';
    document.getElementById('erreur-annee').textContent = '';
    document.getElementById('modal-changer-annee').classList.add('active');
}

function annulerChangementAnnee() {
    fermerModal('modal-changer-annee');
    // Remettre le select sur l'année active actuelle
    document.getElementById('select-annee').value = anneeActive;
    anneeAvantChangement = null;
}

async function confirmerChangementAnnee() {
    const mdp = document.getElementById('input-mdp-annee').value.trim();
    const errEl = document.getElementById('erreur-annee');
    const btn = document.getElementById('btn-confirmer-annee');
    const cible = parseInt(document.getElementById('annee-cible').textContent);
    if (!mdp) { errEl.textContent = 'Saisissez votre mot de passe.'; return; }
    btn.disabled = true; btn.textContent = '⏳ Changement...';
    errEl.textContent = '';
    try {
        const r = await fetch(`${API_URL}/api/configuration/annee`, {
            method: 'PUT', headers: {'Content-Type':'application/json'},
            body: JSON.stringify({ annee: cible, password: mdp })
        });
        const d = await r.json();
        if (r.ok && d.success) {
            anneeActive = d.annee_active;
            initSelecteurAnnee();
            fermerModal('modal-changer-annee');
            let msg = `Année active : ${anneeActive}`;
            if (d.dates_generees && d.dates_generees.nouvelles > 0) msg += ` (${d.dates_generees.nouvelles} dates créées)`;
            afficherSucces(msg);
            // Rafraîchir l'onglet actif
            if (ongletActif === 'inscriptions') chargerInscriptions();
            else if (ongletActif === 'dates') chargerDates();
        } else {
            errEl.textContent = d.error || 'Erreur';
        }
    } catch(e) { errEl.textContent = 'Erreur de connexion'; }
    btn.disabled = false; btn.textContent = '🔄 Confirmer le changement';
    anneeAvantChangement = null;
}

function montrerLogin() {
    document.getElementById('login-screen').style.display = 'flex';
    document.getElementById('admin-screen').style.display = 'none';
}

function montrerAdmin() {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('admin-screen').style.display = 'block';
    chargerInscriptions();
}

async function login(e) {
    e.preventDefault();
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;
    const erreur = document.getElementById('login-erreur');
    const btn = document.getElementById('login-btn');

    if (!username || !password) { erreur.textContent = 'Remplissez les deux champs.'; return; }

    btn.disabled = true; btn.textContent = '⏳ Connexion...';
    erreur.textContent = '';

    try {
        const r = await fetch(`${API_URL}/api/login`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        const d = await r.json();
        if (r.ok && d.success) {
            // Charger l'année active après login
            try {
                const rc = await fetch(`${API_URL}/api/auth-status`);
                const dc = await rc.json();
                anneeActive = dc.annee_active || new Date().getFullYear();
            } catch(e2) {}
            initSelecteurAnnee();
            montrerAdmin();
        } else {
            erreur.textContent = d.error || 'Identifiants incorrects';
            if (d.blocked) {
                btn.disabled = true;
                btn.textContent = `🔒 Bloqué ${d.minutes_restantes} min`;
                setTimeout(() => { btn.disabled = false; btn.textContent = 'Se connecter'; }, d.minutes_restantes * 60000);
                return;
            }
        }
    } catch (e) {
        erreur.textContent = 'Erreur de connexion au serveur';
    }
    btn.disabled = false; btn.textContent = 'Se connecter';
}

async function deconnexion() {
    if (!confirm('Se déconnecter ?')) return;
    try { await fetch(`${API_URL}/api/logout`, { method: 'POST' }); } catch (e) {}
    montrerLogin();
    document.getElementById('login-username').value = '';
    document.getElementById('login-password').value = '';
    document.getElementById('login-erreur').textContent = '';
}

// ========== ONGLETS ==========

function changerOnglet(onglet) {
    ongletActif = onglet;
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    event.target.classList.add('active');
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    document.getElementById(`tab-${onglet}`).classList.add('active');
    if (onglet === 'inscriptions') chargerInscriptions();
    else if (onglet === 'dates') chargerDates();
    else if (onglet === 'documents') chargerDocumentsEtTemplates();
}

// ========== INSCRIPTIONS ==========

async function chargerInscriptions() {
    try {
        const [rI, rS, rD] = await Promise.all([
            fetch(`${API_URL}/api/inscriptions`), fetch(`${API_URL}/api/stats`), fetch(`${API_URL}/api/dates-disponibles`)
        ]);
        if (rI.status === 401) { montrerLogin(); return; }
        afficherStatistiques(await rS.json(), await rD.json());
        afficherInscriptions(await rI.json());
        document.getElementById('loading-inscriptions').style.display = 'none';
        document.getElementById('inscriptions-container').style.display = 'block';
    } catch (e) { afficherErreur('Impossible de charger'); }
}

function afficherStatistiques(stats, dates) {
    document.getElementById('stat-completes').textContent = stats.gardes_futures_completes || 0;
    document.getElementById('stat-partielles').textContent = stats.gardes_futures_partielles || 0;
    document.getElementById('stat-total').textContent = stats.total_inscriptions || 0;
    document.getElementById('stat-disponibles').textContent = dates.length || 0;
}

function afficherInscriptions(inscriptions) {
    const c = document.getElementById('inscriptions-container'); c.innerHTML = '';
    if (!inscriptions.length) { c.innerHTML = '<p class="loading">Aucune inscription.</p>'; return; }
    const parDate = {};
    inscriptions.forEach(i => { const d = i.date_garde.split('T')[0]; (parDate[d]=parDate[d]||[]).push(i); });
    const auj = new Date(); auj.setHours(0,0,0,0);
    Object.keys(parDate).sort((a,b)=>new Date(b)-new Date(a)).forEach(dateStr => {
        const ps = parDate[dateStr], nb = ps.length;
        const dateObj = new Date(dateStr+'T00:00:00'), dateF = formatDateFr(dateObj);
        const future = dateObj >= auj, jR = Math.ceil((dateObj-auj)/(864e5));
        let statut='',sc='';
        if(nb===2){statut='Complète (2/2)';sc='status-complete';}else{statut='Partielle (1/2)';sc='status-partial';}
        let badge='';
        if(future){if(jR===0)badge='<span class="badge badge-urgence">AUJOURD\'HUI</span>';else if(jR===1)badge='<span class="badge badge-urgence">DEMAIN</span>';else if(jR<=7)badge=`<span class="badge badge-attention">J-${jR}</span>`;else badge=`<span class="badge badge-info">J-${jR}</span>`;}else badge='<span class="badge badge-passee">Passée</span>';
        c.innerHTML += `<div class="date-group ${!future?'date-passee':''}"><div class="date-group-header"><div><h3>📅 ${dateF}</h3><div style="margin-top:6px">${badge}</div></div><span class="status-badge ${sc}">${statut}</span></div><div class="practitioners-list">${ps.map(p=>cartePraticien(p,future)).join('')}</div></div>`;
    });
}

function cartePraticien(p, future) {
    const si = (l,s,d) => s==='envoye'?`<span class="email-status email-ok" title="Envoyé${d?' le '+new Date(d).toLocaleString('fr-FR'):''}">✅ ${l}</span>`:s==='erreur'?`<span class="email-status email-erreur">❌ ${l}</span>`:`<span class="email-status email-attente">⏳ ${l}</span>`;
    let btns='';
    if(future){if(p.email_rappel_j7_statut!=='envoye')btns+=`<button class="btn btn-rappel-j7" onclick="envoyerRappelJ7(${p.id},'${p.praticien_nom}')">🟡 J-7</button>`;if(p.email_rappel_j1_statut!=='envoye')btns+=`<button class="btn btn-rappel-j1" onclick="envoyerRappelJ1(${p.id},'${p.praticien_nom}')">🔴 J-1</button>`;}
    return `<div class="practitioner-card"><div class="practitioner-info"><h4>Dr ${p.praticien_nom} ${p.praticien_prenom}</h4><p><strong>Email:</strong> ${p.praticien_email}</p><p><strong>Tél:</strong> ${p.praticien_telephone}</p><p><strong>RPPS:</strong> ${p.praticien_rpps}</p><p><strong>Adresse:</strong> ${p.praticien_numero} ${p.praticien_voie}, ${p.praticien_code_postal} ${p.praticien_ville}</p>${p.praticien_etage?`<p><strong>Étage:</strong> ${p.praticien_etage}</p>`:''}${p.praticien_code_entree?`<p><strong>Code:</strong> ${p.praticien_code_entree}</p>`:''}<p style="font-size:12px;color:#9ca3af;margin-top:10px">Inscrit le ${new Date(p.created_at).toLocaleDateString('fr-FR')}</p><div class="email-statuts-grid">${si('Confirmation',p.email_confirmation_statut,p.email_confirmation_envoi_at)}${si('Rappel J-7',p.email_rappel_j7_statut,p.email_rappel_j7_envoi_at)}${si('Rappel J-1',p.email_rappel_j1_statut,p.email_rappel_j1_envoi_at)}</div></div><div class="practitioner-actions"><button class="btn btn-danger" onclick="supprimerInscription(${p.id},'${p.praticien_nom}')">🗑️ Supprimer</button>${p.email_confirmation_statut!=='envoye'?`<button class="btn btn-success" onclick="renvoyerEmail(${p.id},'${p.praticien_nom}')">📧 Renvoyer</button>`:''}${btns}</div></div>`;
}

async function envoyerRappelJ7(id,nom){if(!confirm(`Envoyer rappel J-7 à Dr ${nom}?`))return;try{const r=await fetch(`${API_URL}/api/inscriptions/${id}/envoyer-rappel-j7`,{method:'POST'});const d=await r.json();if(r.ok&&d.success)afficherSucces(d.message);else afficherErreur(d.error||'Erreur');rafraichirInscriptions();}catch(e){afficherErreur("Erreur J-7");}}
async function envoyerRappelJ1(id,nom){if(!confirm(`Envoyer rappel J-1 à Dr ${nom}?`))return;try{const r=await fetch(`${API_URL}/api/inscriptions/${id}/envoyer-rappel-j1`,{method:'POST'});const d=await r.json();if(r.ok&&d.success)afficherSucces(d.message);else afficherErreur(d.error||'Erreur');rafraichirInscriptions();}catch(e){afficherErreur("Erreur J-1");}}
async function declencherTousRappels(){if(!confirm('Déclencher les rappels automatiques?'))return;const b=document.getElementById('btn-rappels-auto');b.disabled=true;b.textContent='⏳...';try{const r=await fetch(`${API_URL}/api/rappels/envoyer`,{method:'POST'});const d=await r.json();if(r.ok)afficherSucces(`${d.detail?.j7_envoyes||0} J-7, ${d.detail?.j1_envoyes||0} J-1`);else afficherErreur(d.error);rafraichirInscriptions();}catch(e){afficherErreur('Erreur');}b.disabled=false;b.textContent='⏰ Déclencher rappels auto';}
function exporterExcel(){const y=prompt('Année à exporter :',anneeActive);if(!y)return;window.open(`${API_URL}/api/export-excel?year=${encodeURIComponent(y)}`,'_blank');}
async function supprimerInscription(id,nom){if(!confirm(`Supprimer Dr ${nom}?`))return;try{await fetch(`${API_URL}/api/inscriptions/${id}`,{method:'DELETE'});afficherSucces('Supprimé');rafraichirInscriptions();}catch(e){afficherErreur('Erreur');}}
async function renvoyerEmail(id,nom){if(!confirm(`Renvoyer email à Dr ${nom}?`))return;try{const r=await fetch(`${API_URL}/api/inscriptions/${id}/renvoyer-email`,{method:'POST'});if(r.ok)afficherSucces('Email renvoyé');else afficherErreur('Erreur');rafraichirInscriptions();}catch(e){afficherErreur('Erreur');}}
function rafraichirInscriptions(){document.getElementById('inscriptions-container').style.display='none';document.getElementById('loading-inscriptions').style.display='block';chargerInscriptions();}

// ========== DATES ==========

async function chargerDates(){try{document.getElementById('loading-dates').style.display='block';document.getElementById('dates-container').style.display='none';const r=await fetch(`${API_URL}/api/dates-garde`);if(r.status===401){montrerLogin();return;}afficherDates(await r.json());document.getElementById('loading-dates').style.display='none';document.getElementById('dates-container').style.display='block';}catch(e){afficherErreur('Erreur dates');}}

function afficherDates(dates){document.getElementById('dates-container').innerHTML=`<table class="dates-table"><thead><tr><th>Date</th><th>Type</th><th>Nom</th><th>Inscriptions</th><th>Statut</th><th>Actions</th></tr></thead><tbody>${dates.map(d=>`<tr><td>${formatDateFr(new Date(d.date))}</td><td><span class="badge ${d.type==='dimanche'?'badge-dimanche':'badge-ferie'}">${d.type==='dimanche'?'Dimanche':'Férié'}</span></td><td>${d.nom_jour_ferie||'-'}</td><td>${d.nb_inscriptions||0}/2</td><td><span class="badge ${d.active?'badge-active':'badge-inactive'}">${d.active?'Active':'Inactive'}</span></td><td>${d.active?`<button class="btn btn-warning" onclick="desactiverDate(${d.id})">🚫</button>`:`<button class="btn btn-success" onclick="activerDate(${d.id})">✅</button>`}${parseInt(d.nb_inscriptions)===0?`<button class="btn btn-danger" onclick="supprimerDate(${d.id},'${formatDateFr(new Date(d.date))}')">🗑️</button>`:''}</td></tr>`).join('')}</tbody></table>`;}

function ouvrirModalAjouterDate(){document.getElementById('modal-ajouter-date').classList.add('active');document.getElementById('input-nouvelle-date').value='';document.getElementById('input-type-date').value='dimanche';document.getElementById('input-nom-ferie').value='';document.getElementById('group-nom-ferie').style.display='none';}
function fermerModal(id){document.getElementById(id).classList.remove('active');}
async function ajouterDate(){const date=document.getElementById('input-nouvelle-date').value,type=document.getElementById('input-type-date').value,nom=document.getElementById('input-nom-ferie').value;if(!date){afficherErreur('Sélectionnez une date');return;}if(type==='jour_ferie'&&!nom){afficherErreur('Nom requis');return;}try{const r=await fetch(`${API_URL}/api/dates-garde`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({date,type,nom_jour_ferie:type==='jour_ferie'?nom:null})});if(!r.ok){const e=await r.json();throw new Error(e.error);}afficherSucces('Date ajoutée');fermerModal('modal-ajouter-date');chargerDates();}catch(e){afficherErreur(e.message);}}
async function desactiverDate(id){if(!confirm('Désactiver?'))return;try{await fetch(`${API_URL}/api/dates-garde/${id}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({active:false})});afficherSucces('Désactivée');chargerDates();}catch(e){afficherErreur('Erreur');}}
async function activerDate(id){try{await fetch(`${API_URL}/api/dates-garde/${id}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({active:true})});afficherSucces('Activée');chargerDates();}catch(e){afficherErreur('Erreur');}}
async function supprimerDate(id,label){if(!confirm(`Supprimer "${label}"?`))return;try{const r=await fetch(`${API_URL}/api/dates-garde/${id}`,{method:'DELETE'});if(!r.ok){const e=await r.json();throw new Error(e.error);}afficherSucces('Supprimée');chargerDates();}catch(e){afficherErreur(e.message);}}

// ========== DOCUMENTS & TEMPLATES ==========

async function chargerDocumentsEtTemplates() {
    document.getElementById('loading-documents').style.display = 'block';
    document.getElementById('documents-container').style.display = 'none';
    try {
        const [rD, rT] = await Promise.all([fetch(`${API_URL}/api/documents`), fetch(`${API_URL}/api/email-templates`)]);
        if (rD.status === 401) { montrerLogin(); return; }
        afficherDocumentsEtTemplates(await rD.json(), await rT.json());
        document.getElementById('loading-documents').style.display = 'none';
        document.getElementById('documents-container').style.display = 'block';
    } catch (e) { afficherErreur('Erreur chargement'); }
}

function afficherDocumentsEtTemplates(docs, templates) {
    const c = document.getElementById('documents-container');
    const tplDoc = docs.find(d => d.est_template_docx);
    const statiques = docs.filter(d => !d.est_template_docx);
    let html = '';

    html += `<div class="doc-section"><h3>📝 Template DOCX personnalisé</h3><p class="doc-section-desc">Personnalisé avec <code>{{NOM_PRATICIEN}}</code> et <code>{{DATE_GARDE}}</code>.</p>`;
    if (tplDoc) html += `<div class="doc-card doc-template"><div class="doc-icon">📝</div><div class="doc-info"><strong>${tplDoc.nom_email}</strong><span class="doc-meta">${tplDoc.nom_original} · ${formatTaille(tplDoc.taille)}</span></div><div class="doc-actions"><button class="btn btn-success" onclick="previsualiserDocument(${tplDoc.id},'${tplDoc.type_mime}')" title="Aperçu">👁️</button><button class="btn btn-danger" onclick="supprimerDocument(${tplDoc.id},'${tplDoc.nom_email}')">🗑️</button></div></div>`;
    else html += '<p class="doc-empty">Aucun template → fallback local.</p>';
    html += `<button class="btn btn-primary" onclick="ouvrirModalUpload(true)">📤 ${tplDoc?'Remplacer':'Uploader'} template</button></div>`;

    html += `<div class="doc-section"><h3>📎 Pièces jointes (PDF)</h3><p class="doc-section-desc">Sélectionnez les PJ à joindre dans chaque template ci-dessous.</p>`;
    if (statiques.length) statiques.forEach(d => {
        html += `<div class="doc-card"><div class="doc-icon">📄</div><div class="doc-info"><strong>${d.nom_email}</strong><span class="doc-meta">${d.nom_original} · ${formatTaille(d.taille)}</span>${!d.actif?'<span class="badge badge-inactive">Désactivé</span>':''}</div><div class="doc-actions"><button class="btn btn-success" onclick="previsualiserDocument(${d.id},'${d.type_mime}')" title="Aperçu">👁️</button><button class="btn btn-warning" onclick="renommerDocument(${d.id},'${d.nom_email}')">✏️</button>${d.actif?`<button class="btn btn-warning" onclick="toggleDocument(${d.id},false)">🚫</button>`:`<button class="btn btn-success" onclick="toggleDocument(${d.id},true)">✅</button>`}<button class="btn btn-danger" onclick="supprimerDocument(${d.id},'${d.nom_email}')">🗑️</button></div></div>`;
    }); else html += '<p class="doc-empty">Aucune PJ → fallback local.</p>';
    html += `<button class="btn btn-primary" onclick="ouvrirModalUpload(false)">📤 Ajouter PJ</button></div>`;

    const labelsType = { confirmation:'📧 Email de confirmation', rappel_j7:'🟡 Rappel J-7', rappel_j1:'🔴 Rappel J-1' };
    const ordre = ['confirmation','rappel_j7','rappel_j1'];
    const allDocs = docs.filter(d => d.actif);
    html += '<div class="doc-section"><h3>✉️ Templates des emails</h3><p class="doc-section-desc">Variables : <code>{{NOM}}</code> <code>{{PRENOM}}</code> <code>{{DATE_GARDE}}</code> <code>{{EMAIL}}</code> <code>{{TELEPHONE}}</code> <code>{{ADRESSE}}</code> <code>{{ADMIN_EMAIL}}</code></p>';
    ordre.forEach(type => {
        const tpl = templates.find(t => t.type === type); if (!tpl) return;
        const mod = tpl.updated_at ? new Date(tpl.updated_at).toLocaleString('fr-FR') : '';
        let pjIds = [];
        try { pjIds = tpl.documents_joints === 'all' ? allDocs.map(d=>d.id) : JSON.parse(tpl.documents_joints || '[]'); } catch(e) { pjIds=[]; }
        const docxChecked = tpl.inclure_docx_personnalise ? 'checked' : '';
        let pjHtml = '<div class="tpl-pj-section"><label>📎 Pièces jointes :</label><div class="tpl-pj-list">';
        if (tplDoc) pjHtml += `<label class="tpl-pj-item tpl-pj-docx"><input type="checkbox" id="tpl-docx-${type}" ${docxChecked}> 📝 ${tplDoc.nom_email} <span class="pj-tag">DOCX personnalisé</span></label>`;
        statiques.forEach(d => {
            const checked = pjIds.includes(d.id) ? 'checked' : '';
            pjHtml += `<label class="tpl-pj-item"><input type="checkbox" class="tpl-pj-cb-${type}" value="${d.id}" ${checked}> 📄 ${d.nom_email}</label>`;
        });
        if (!tplDoc && !statiques.length) pjHtml += '<span class="doc-empty">Aucun document uploadé</span>';
        pjHtml += '</div></div>';
        html += `<div class="template-editor-block" id="tpl-block-${type}"><div class="template-header-bar"><h4>${labelsType[type]||type}</h4><span class="doc-meta">Modifié : ${mod}</span></div><div class="template-fields"><div class="tpl-field-row"><label>Sujet :</label><input type="text" id="tpl-sujet-${type}" value="${escapeHtml(tpl.sujet)}" class="tpl-input"></div><div class="tpl-field-row"><label>Titre bandeau :</label><input type="text" id="tpl-titre-${type}" value="${escapeHtml(tpl.titre_header)}" class="tpl-input"></div><div class="tpl-field-row"><label>Sous-titre :</label><input type="text" id="tpl-soustitre-${type}" value="${escapeHtml(tpl.sous_titre_header||'')}" class="tpl-input"></div><div class="tpl-field-row"><label>Couleurs :</label><input type="color" id="tpl-couleur1-${type}" value="${tpl.couleur1||'#667eea'}"><input type="color" id="tpl-couleur2-${type}" value="${tpl.couleur2||'#764ba2'}"></div>${pjHtml}<div class="tpl-field-row"><label>Corps :</label></div><div id="quill-${type}" class="quill-container"></div></div><div class="template-actions"><button class="btn btn-primary" onclick="sauverTemplate('${type}')">💾 Enregistrer</button><button class="btn btn-secondary" onclick="previsualiserTemplate('${type}')">👁️ Aperçu</button><button class="btn btn-warning" onclick="resetTemplate('${type}')">↩️ Réinitialiser</button></div></div>`;
    });
    html += '</div>';
    html += '<div class="doc-section doc-section-info"><h3>ℹ️ Fonctionnement</h3><p>Documents Supabase remplacent les fichiers locaux. Templates email stockés en base.</p></div>';
    c.innerHTML = html;
    setTimeout(() => { ordre.forEach(type => { const tpl = templates.find(t => t.type === type); if (tpl) initQuillEditor(type, tpl.contenu_html); }); }, 100);
}

function initQuillEditor(type, html) {
    const container = document.getElementById(`quill-${type}`);
    if (!container) return; container.innerHTML = '';
    const quill = new Quill(container, {
        theme: 'snow', modules: { toolbar: [['bold','italic','underline'],[{'header':[3,false]}],[{'list':'ordered'},{'list':'bullet'}],['link'],['clean']] },
        placeholder: 'Contenu...'
    });
    quill.root.innerHTML = html;
    quillEditors[type] = quill;
}

async function sauverTemplate(type) {
    const q = quillEditors[type]; if (!q) return;
    const pjCbs = document.querySelectorAll(`.tpl-pj-cb-${type}:checked`);
    const docIds = Array.from(pjCbs).map(cb => parseInt(cb.value));
    const docxEl = document.getElementById(`tpl-docx-${type}`);
    const inclureDocx = docxEl ? docxEl.checked : false;
    const data = { sujet:document.getElementById(`tpl-sujet-${type}`).value, titre_header:document.getElementById(`tpl-titre-${type}`).value, sous_titre_header:document.getElementById(`tpl-soustitre-${type}`).value, couleur1:document.getElementById(`tpl-couleur1-${type}`).value, couleur2:document.getElementById(`tpl-couleur2-${type}`).value, contenu_html:q.root.innerHTML, documents_joints:JSON.stringify(docIds), inclure_docx_personnalise:inclureDocx };
    try { const r = await fetch(`${API_URL}/api/email-templates/${type}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}); const d=await r.json(); if(r.ok&&d.success)afficherSucces('Template enregistré');else afficherErreur(d.error||'Erreur'); } catch(e){afficherErreur('Erreur');}
}

async function previsualiserTemplate(type) {
    const q = quillEditors[type]; if (!q) return;
    const data = { sujet:document.getElementById(`tpl-sujet-${type}`).value, titre_header:document.getElementById(`tpl-titre-${type}`).value, sous_titre_header:document.getElementById(`tpl-soustitre-${type}`).value, couleur1:document.getElementById(`tpl-couleur1-${type}`).value, couleur2:document.getElementById(`tpl-couleur2-${type}`).value, contenu_html:q.root.innerHTML };
    try { const r = await fetch(`${API_URL}/api/email-templates/${type}/preview`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}); const d=await r.json(); if(d.html){const m=document.getElementById('modal-preview');m.classList.add('active');document.getElementById('preview-iframe').srcdoc=d.html;} } catch(e){afficherErreur('Erreur');}
}

async function resetTemplate(type) {
    if (!confirm('Réinitialiser ce template?')) return;
    try { const r = await fetch(`${API_URL}/api/email-templates/${type}/reset`,{method:'POST'}); const d=await r.json(); if(r.ok&&d.success){afficherSucces('Réinitialisé');chargerDocumentsEtTemplates();}else afficherErreur(d.error||'Erreur'); } catch(e){afficherErreur('Erreur');}
}

// ========== DOCUMENTS ==========

function previsualiserDocument(id, typeMime) {
    window.open(`${API_URL}/api/documents/${id}/download?inline=true`, '_blank');
}

function ouvrirModalUpload(estTemplate) {
    document.getElementById('modal-upload-doc').classList.add('active');
    document.getElementById('upload-est-template').value = estTemplate ? 'true' : 'false';
    document.getElementById('upload-titre').textContent = estTemplate ? '📝 Uploader template DOCX' : '📤 Ajouter PJ';
    document.getElementById('upload-fichier').value = '';
    document.getElementById('upload-nom-email').value = '';
    const z = document.getElementById('upload-drop-zone');
    z.innerHTML = '<p>📁 Glissez un fichier ou cliquez</p><p class="doc-meta">' + (estTemplate ? '.docx' : '.pdf/.docx') + ' · Max 20 MB</p>';
}

function setupDragDrop() {
    const z = document.getElementById('upload-drop-zone'); if (!z) return;
    z.addEventListener('click', () => document.getElementById('upload-fichier').click());
    z.addEventListener('dragover', e => { e.preventDefault(); z.classList.add('drop-active'); });
    z.addEventListener('dragleave', () => z.classList.remove('drop-active'));
    z.addEventListener('drop', e => { e.preventDefault(); z.classList.remove('drop-active'); if(e.dataTransfer.files.length){document.getElementById('upload-fichier').files=e.dataTransfer.files;const f=e.dataTransfer.files[0];z.innerHTML=`<p>📄 <strong>${f.name}</strong></p><p class="doc-meta">${formatTaille(f.size)}</p>`;} });
    document.getElementById('upload-fichier').addEventListener('change', e => { if(e.target.files.length){const f=e.target.files[0];z.innerHTML=`<p>📄 <strong>${f.name}</strong></p><p class="doc-meta">${formatTaille(f.size)}</p>`;} });
}

async function uploaderDocument() {
    const f = document.getElementById('upload-fichier').files[0]; if(!f){afficherErreur('Sélectionnez un fichier');return;}
    const fd = new FormData(); fd.append('fichier',f); fd.append('nom_email',document.getElementById('upload-nom-email').value||f.name); fd.append('est_template_docx',document.getElementById('upload-est-template').value);
    const btn=document.getElementById('btn-upload');btn.disabled=true;btn.textContent='⏳...';
    try{const r=await fetch(`${API_URL}/api/documents/upload`,{method:'POST',body:fd});const d=await r.json();if(r.ok&&d.success){afficherSucces('Uploadé');fermerModal('modal-upload-doc');chargerDocumentsEtTemplates();}else afficherErreur(d.error||'Erreur');}catch(e){afficherErreur('Erreur');}
    btn.disabled=false;btn.textContent='📤 Uploader';
}

async function supprimerDocument(id,nom){if(!confirm(`Supprimer "${nom}"?`))return;try{await fetch(`${API_URL}/api/documents/${id}`,{method:'DELETE'});afficherSucces('Supprimé');chargerDocumentsEtTemplates();}catch(e){afficherErreur('Erreur');}}
async function renommerDocument(id,nom){const n=prompt('Nouveau nom:',nom);if(!n||n===nom)return;try{await fetch(`${API_URL}/api/documents/${id}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({nom_email:n})});afficherSucces('Renommé');chargerDocumentsEtTemplates();}catch(e){afficherErreur('Erreur');}}
async function toggleDocument(id,actif){try{await fetch(`${API_URL}/api/documents/${id}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({actif})});afficherSucces(actif?'Activé':'Désactivé');chargerDocumentsEtTemplates();}catch(e){afficherErreur('Erreur');}}

// ========== UTILITAIRES ==========
function formatDateFr(d){const j=['dimanche','lundi','mardi','mercredi','jeudi','vendredi','samedi'],m=['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];return`${j[d.getDay()]} ${d.getDate()} ${m[d.getMonth()]} ${d.getFullYear()}`;}
function formatTaille(o){if(o<1024)return o+' o';if(o<1048576)return(o/1024).toFixed(1)+' KB';return(o/1048576).toFixed(1)+' MB';}
function escapeHtml(s){return(s||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function afficherSucces(m){const d=document.createElement('div');d.className='message success';d.textContent='✅ '+m;document.body.appendChild(d);setTimeout(()=>d.remove(),3000);}
function afficherErreur(m){const d=document.createElement('div');d.className='message error';d.textContent='❌ '+m;document.body.appendChild(d);setTimeout(()=>d.remove(),5000);}
