const API_URL = window.location.origin;
let ongletActif = 'inscriptions';
const quillEditors = {};

document.addEventListener('DOMContentLoaded', () => {
    chargerInscriptions();
    document.getElementById('input-type-date').addEventListener('change', (e) => {
        document.getElementById('group-nom-ferie').style.display = e.target.value === 'jour_ferie' ? 'block' : 'none';
    });
    // Drag & drop pour upload docs
    setupDragDrop();
});

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
async function supprimerInscription(id,nom){if(!confirm(`Supprimer Dr ${nom}?`))return;try{await fetch(`${API_URL}/api/inscriptions/${id}`,{method:'DELETE'});afficherSucces('Supprimé');rafraichirInscriptions();}catch(e){afficherErreur('Erreur');}}
async function renvoyerEmail(id,nom){if(!confirm(`Renvoyer email à Dr ${nom}?`))return;try{const r=await fetch(`${API_URL}/api/inscriptions/${id}/renvoyer-email`,{method:'POST'});if(r.ok)afficherSucces('Email renvoyé');else afficherErreur('Erreur');rafraichirInscriptions();}catch(e){afficherErreur('Erreur');}}
function rafraichirInscriptions(){document.getElementById('inscriptions-container').style.display='none';document.getElementById('loading-inscriptions').style.display='block';chargerInscriptions();}

// ========== DATES ==========

async function chargerDates(){try{document.getElementById('loading-dates').style.display='block';document.getElementById('dates-container').style.display='none';const r=await fetch(`${API_URL}/api/dates-garde`);afficherDates(await r.json());document.getElementById('loading-dates').style.display='none';document.getElementById('dates-container').style.display='block';}catch(e){afficherErreur('Erreur dates');}}

function afficherDates(dates){document.getElementById('dates-container').innerHTML=`<table class="dates-table"><thead><tr><th>Date</th><th>Type</th><th>Nom</th><th>Inscriptions</th><th>Statut</th><th>Actions</th></tr></thead><tbody>${dates.map(d=>`<tr><td>${formatDateFr(new Date(d.date))}</td><td><span class="badge ${d.type==='dimanche'?'badge-dimanche':'badge-ferie'}">${d.type==='dimanche'?'Dimanche':'Férié'}</span></td><td>${d.nom_jour_ferie||'-'}</td><td>${d.nb_inscriptions||0}/2</td><td><span class="badge ${d.active?'badge-active':'badge-inactive'}">${d.active?'Active':'Inactive'}</span></td><td>${d.active?`<button class="btn btn-warning" onclick="desactiverDate(${d.id})">🚫</button>`:`<button class="btn btn-success" onclick="activerDate(${d.id})">✅</button>`}${parseInt(d.nb_inscriptions)===0?`<button class="btn btn-danger" onclick="supprimerDate(${d.id},'${formatDateFr(new Date(d.date))}')">🗑️</button>`:''}</td></tr>`).join('')}</tbody></table>`;}

function ouvrirModalAjouterDate(){document.getElementById('modal-ajouter-date').classList.add('active');document.getElementById('input-nouvelle-date').value='';document.getElementById('input-type-date').value='dimanche';document.getElementById('input-nom-ferie').value='';document.getElementById('group-nom-ferie').style.display='none';}
function fermerModal(id){document.getElementById(id).classList.remove('active');}

async function ajouterDate(){const date=document.getElementById('input-nouvelle-date').value,type=document.getElementById('input-type-date').value,nom=document.getElementById('input-nom-ferie').value;if(!date){afficherErreur('Sélectionnez une date');return;}if(type==='jour_ferie'&&!nom){afficherErreur('Nom du jour férié requis');return;}try{const r=await fetch(`${API_URL}/api/dates-garde`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({date,type,nom_jour_ferie:type==='jour_ferie'?nom:null})});if(!r.ok){const e=await r.json();throw new Error(e.error);}afficherSucces('Date ajoutée');fermerModal('modal-ajouter-date');chargerDates();}catch(e){afficherErreur(e.message);}}
async function desactiverDate(id){if(!confirm('Désactiver?'))return;try{await fetch(`${API_URL}/api/dates-garde/${id}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({active:false})});afficherSucces('Désactivée');chargerDates();}catch(e){afficherErreur('Erreur');}}
async function activerDate(id){try{await fetch(`${API_URL}/api/dates-garde/${id}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({active:true})});afficherSucces('Activée');chargerDates();}catch(e){afficherErreur('Erreur');}}
async function supprimerDate(id,label){if(!confirm(`Supprimer "${label}"?`))return;try{const r=await fetch(`${API_URL}/api/dates-garde/${id}`,{method:'DELETE'});if(!r.ok){const e=await r.json();throw new Error(e.error);}afficherSucces('Supprimée');chargerDates();}catch(e){afficherErreur(e.message);}}

// ========== DOCUMENTS & TEMPLATES ==========

async function chargerDocumentsEtTemplates() {
    document.getElementById('loading-documents').style.display = 'block';
    document.getElementById('documents-container').style.display = 'none';
    try {
        const [rDocs, rTpls] = await Promise.all([
            fetch(`${API_URL}/api/documents`), fetch(`${API_URL}/api/email-templates`)
        ]);
        const docs = await rDocs.json();
        const templates = await rTpls.json();
        afficherDocumentsEtTemplates(docs, templates);
        document.getElementById('loading-documents').style.display = 'none';
        document.getElementById('documents-container').style.display = 'block';
    } catch (e) { afficherErreur('Erreur chargement'); }
}

function afficherDocumentsEtTemplates(docs, templates) {
    const c = document.getElementById('documents-container');
    const tplDoc = docs.find(d => d.est_template_docx);
    const statiques = docs.filter(d => !d.est_template_docx);

    let html = '';

    // === SECTION DOCUMENTS ===
    html += `<div class="doc-section"><h3>📝 Template DOCX personnalisé</h3><p class="doc-section-desc">Personnalisé avec <code>{{NOM_PRATICIEN}}</code> et <code>{{DATE_GARDE}}</code>.</p>`;
    if (tplDoc) html += `<div class="doc-card doc-template"><div class="doc-icon">📝</div><div class="doc-info"><strong>${tplDoc.nom_email}</strong><span class="doc-meta">${tplDoc.nom_original} · ${formatTaille(tplDoc.taille)}</span></div><div class="doc-actions"><button class="btn btn-success" onclick="previsualiserDocument(${tplDoc.id},'${tplDoc.nom_email}','${tplDoc.type_mime}')" title="Aperçu">👁️</button><button class="btn btn-danger" onclick="supprimerDocument(${tplDoc.id},'${tplDoc.nom_email}')">🗑️</button></div></div>`;
    else html += '<p class="doc-empty">Aucun template → fallback fichiers locaux.</p>';
    html += `<button class="btn btn-primary" onclick="ouvrirModalUpload(true)">📤 ${tplDoc ? 'Remplacer' : 'Uploader'} template</button></div>`;

    html += `<div class="doc-section"><h3>📎 Pièces jointes (PDF)</h3><p class="doc-section-desc">Envoyées avec chaque email de confirmation.</p>`;
    if (statiques.length) statiques.forEach(d => {
        html += `<div class="doc-card"><div class="doc-icon">📄</div><div class="doc-info"><strong>${d.nom_email}</strong><span class="doc-meta">${d.nom_original} · ${formatTaille(d.taille)}</span>${!d.actif?'<span class="badge badge-inactive">Désactivé</span>':''}</div><div class="doc-actions"><button class="btn btn-success" onclick="previsualiserDocument(${d.id},'${d.nom_email}','${d.type_mime}')" title="Aperçu">👁️</button><button class="btn btn-warning" onclick="renommerDocument(${d.id},'${d.nom_email}')">✏️</button>${d.actif?`<button class="btn btn-warning" onclick="toggleDocument(${d.id},false)">🚫</button>`:`<button class="btn btn-success" onclick="toggleDocument(${d.id},true)">✅</button>`}<button class="btn btn-danger" onclick="supprimerDocument(${d.id},'${d.nom_email}')">🗑️</button></div></div>`;
    }); else html += '<p class="doc-empty">Aucune PJ → fallback fichiers locaux.</p>';
    html += `<button class="btn btn-primary" onclick="ouvrirModalUpload(false)">📤 Ajouter PJ</button></div>`;

    // === SECTION TEMPLATES EMAIL ===
    const labelsType = { confirmation: '📧 Email de confirmation', rappel_j7: '🟡 Rappel J-7', rappel_j1: '🔴 Rappel J-1' };
    const ordre = ['confirmation', 'rappel_j7', 'rappel_j1'];

    html += '<div class="doc-section"><h3>✉️ Templates des emails</h3><p class="doc-section-desc">Modifiez le contenu des emails envoyés. Variables disponibles : <code>{{NOM}}</code> <code>{{PRENOM}}</code> <code>{{DATE_GARDE}}</code> <code>{{EMAIL}}</code> <code>{{TELEPHONE}}</code> <code>{{ADRESSE}}</code> <code>{{ADMIN_EMAIL}}</code></p>';

    ordre.forEach(type => {
        const tpl = templates.find(t => t.type === type);
        if (!tpl) return;
        const modified = tpl.updated_at ? new Date(tpl.updated_at).toLocaleString('fr-FR') : '';
        html += `
        <div class="template-editor-block" id="tpl-block-${type}">
            <div class="template-header-bar">
                <h4>${labelsType[type] || type}</h4>
                <span class="doc-meta">Modifié : ${modified}</span>
            </div>
            <div class="template-fields">
                <div class="tpl-field-row">
                    <label>Sujet :</label>
                    <input type="text" id="tpl-sujet-${type}" value="${escapeHtml(tpl.sujet)}" class="tpl-input">
                </div>
                <div class="tpl-field-row">
                    <label>Titre bandeau :</label>
                    <input type="text" id="tpl-titre-${type}" value="${escapeHtml(tpl.titre_header)}" class="tpl-input">
                </div>
                <div class="tpl-field-row">
                    <label>Sous-titre :</label>
                    <input type="text" id="tpl-soustitre-${type}" value="${escapeHtml(tpl.sous_titre_header || '')}" class="tpl-input">
                </div>
                <div class="tpl-field-row">
                    <label>Couleurs :</label>
                    <input type="color" id="tpl-couleur1-${type}" value="${tpl.couleur1 || '#667eea'}">
                    <input type="color" id="tpl-couleur2-${type}" value="${tpl.couleur2 || '#764ba2'}">
                </div>
                <div class="tpl-field-row">
                    <label>Corps de l'email :</label>
                </div>
                <div id="quill-${type}" class="quill-container"></div>
            </div>
            <div class="template-actions">
                <button class="btn btn-primary" onclick="sauverTemplate('${type}')">💾 Enregistrer</button>
                <button class="btn btn-secondary" onclick="previsualiserTemplate('${type}')">👁️ Aperçu</button>
                <button class="btn btn-warning" onclick="resetTemplate('${type}')">↩️ Réinitialiser</button>
            </div>
        </div>`;
    });

    html += '</div>';

    // Info
    html += '<div class="doc-section doc-section-info"><h3>ℹ️ Fonctionnement</h3><p>Les documents Supabase remplacent les fichiers locaux dès qu\'au moins un est uploadé.</p><p>Les templates email sont stockés en base de données. Le bouton "Réinitialiser" restaure le contenu par défaut.</p></div>';

    c.innerHTML = html;

    // Initialiser les éditeurs Quill
    setTimeout(() => {
        ordre.forEach(type => {
            const tpl = templates.find(t => t.type === type);
            if (!tpl) return;
            initQuillEditor(type, tpl.contenu_html);
        });
    }, 100);
}

function initQuillEditor(type, html) {
    const container = document.getElementById(`quill-${type}`);
    if (!container) return;
    // Détruire l'ancien éditeur si existant
    container.innerHTML = '';

    const quill = new Quill(container, {
        theme: 'snow',
        modules: {
            toolbar: [
                ['bold', 'italic', 'underline'],
                [{ 'header': [3, false] }],
                [{ 'list': 'ordered' }, { 'list': 'bullet' }],
                ['link'],
                ['clean']
            ]
        },
        placeholder: 'Contenu de l\'email...'
    });

    // Charger le HTML
    quill.root.innerHTML = html;
    quillEditors[type] = quill;
}

async function sauverTemplate(type) {
    const quill = quillEditors[type];
    if (!quill) { afficherErreur('Éditeur non trouvé'); return; }

    const data = {
        sujet: document.getElementById(`tpl-sujet-${type}`).value,
        titre_header: document.getElementById(`tpl-titre-${type}`).value,
        sous_titre_header: document.getElementById(`tpl-soustitre-${type}`).value,
        couleur1: document.getElementById(`tpl-couleur1-${type}`).value,
        couleur2: document.getElementById(`tpl-couleur2-${type}`).value,
        contenu_html: quill.root.innerHTML
    };

    try {
        const r = await fetch(`${API_URL}/api/email-templates/${type}`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        const d = await r.json();
        if (r.ok && d.success) afficherSucces('Template enregistré');
        else afficherErreur(d.error || 'Erreur');
    } catch (e) { afficherErreur('Erreur sauvegarde'); }
}

async function previsualiserTemplate(type) {
    const quill = quillEditors[type];
    if (!quill) return;

    const data = {
        sujet: document.getElementById(`tpl-sujet-${type}`).value,
        titre_header: document.getElementById(`tpl-titre-${type}`).value,
        sous_titre_header: document.getElementById(`tpl-soustitre-${type}`).value,
        couleur1: document.getElementById(`tpl-couleur1-${type}`).value,
        couleur2: document.getElementById(`tpl-couleur2-${type}`).value,
        contenu_html: quill.root.innerHTML
    };

    try {
        const r = await fetch(`${API_URL}/api/email-templates/${type}/preview`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        const d = await r.json();
        if (d.html) {
            const modal = document.getElementById('modal-preview');
            const iframe = document.getElementById('preview-iframe');
            modal.classList.add('active');
            iframe.srcdoc = d.html;
        }
    } catch (e) { afficherErreur('Erreur aperçu'); }
}

async function resetTemplate(type) {
    const labels = { confirmation: 'confirmation', rappel_j7: 'rappel J-7', rappel_j1: 'rappel J-1' };
    if (!confirm(`Réinitialiser le template "${labels[type]}" ?\n\nLe contenu par défaut sera restauré.`)) return;
    try {
        const r = await fetch(`${API_URL}/api/email-templates/${type}/reset`, { method: 'POST' });
        const d = await r.json();
        if (r.ok && d.success) {
            afficherSucces('Template réinitialisé');
            chargerDocumentsEtTemplates();
        } else afficherErreur(d.error || 'Erreur');
    } catch (e) { afficherErreur('Erreur réinitialisation'); }
}

// ========== DOCUMENTS UPLOAD ==========

function ouvrirModalUpload(estTemplate) {
    document.getElementById('modal-upload-doc').classList.add('active');
    document.getElementById('upload-est-template').value = estTemplate ? 'true' : 'false';
    document.getElementById('upload-titre').textContent = estTemplate ? '📝 Uploader template DOCX' : '📤 Ajouter une pièce jointe';
    document.getElementById('upload-fichier').value = '';
    document.getElementById('upload-nom-email').value = '';
    const zone = document.getElementById('upload-drop-zone');
    zone.innerHTML = '<p>📁 Glissez un fichier ou cliquez</p><p class="doc-meta">' + (estTemplate ? '.docx uniquement' : '.pdf ou .docx') + ' · Max 20 MB</p>';
}

function setupDragDrop() {
    const zone = document.getElementById('upload-drop-zone');
    if (!zone) return;
    zone.addEventListener('click', () => document.getElementById('upload-fichier').click());
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drop-active'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drop-active'));
    zone.addEventListener('drop', e => {
        e.preventDefault(); zone.classList.remove('drop-active');
        if (e.dataTransfer.files.length) { document.getElementById('upload-fichier').files = e.dataTransfer.files; const f = e.dataTransfer.files[0]; zone.innerHTML = `<p>📄 <strong>${f.name}</strong></p><p class="doc-meta">${formatTaille(f.size)}</p>`; }
    });
    document.getElementById('upload-fichier').addEventListener('change', e => {
        if (e.target.files.length) { const f = e.target.files[0]; zone.innerHTML = `<p>📄 <strong>${f.name}</strong></p><p class="doc-meta">${formatTaille(f.size)}</p>`; }
    });
}

async function uploaderDocument() {
    const f = document.getElementById('upload-fichier').files[0];
    if (!f) { afficherErreur('Sélectionnez un fichier'); return; }
    const formData = new FormData();
    formData.append('fichier', f);
    formData.append('nom_email', document.getElementById('upload-nom-email').value || f.name);
    formData.append('est_template_docx', document.getElementById('upload-est-template').value);
    const btn = document.getElementById('btn-upload'); btn.disabled = true; btn.textContent = '⏳...';
    try {
        const r = await fetch(`${API_URL}/api/documents/upload`, { method: 'POST', body: formData });
        const d = await r.json();
        if (r.ok && d.success) { afficherSucces('Uploadé'); fermerModal('modal-upload-doc'); chargerDocumentsEtTemplates(); }
        else afficherErreur(d.error || 'Erreur');
    } catch (e) { afficherErreur('Erreur upload'); }
    btn.disabled = false; btn.textContent = '📤 Uploader';
}

function previsualiserDocument(id, nom, typeMime) {
    if (typeMime && typeMime.includes('pdf')) {
        // PDF : ouvrir dans le modal aperçu via iframe
        const modal = document.getElementById('modal-preview');
        const iframe = document.getElementById('preview-iframe');
        modal.classList.add('active');
        iframe.src = `${API_URL}/api/documents/${id}/download?inline=true`;
        iframe.srcdoc = '';
    } else {
        // DOCX ou autre : télécharger directement
        window.open(`${API_URL}/api/documents/${id}/download`, '_blank');
    }
}

async function supprimerDocument(id, nom) { if (!confirm(`Supprimer "${nom}"?`)) return; try { await fetch(`${API_URL}/api/documents/${id}`, { method: 'DELETE' }); afficherSucces('Supprimé'); chargerDocumentsEtTemplates(); } catch (e) { afficherErreur('Erreur'); } }
async function renommerDocument(id, nom) { const n = prompt('Nouveau nom:', nom); if (!n || n === nom) return; try { await fetch(`${API_URL}/api/documents/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nom_email: n }) }); afficherSucces('Renommé'); chargerDocumentsEtTemplates(); } catch (e) { afficherErreur('Erreur'); } }
async function toggleDocument(id, actif) { try { await fetch(`${API_URL}/api/documents/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ actif }) }); afficherSucces(actif ? 'Activé' : 'Désactivé'); chargerDocumentsEtTemplates(); } catch (e) { afficherErreur('Erreur'); } }

// ========== UTILITAIRES ==========

function formatDateFr(d) { const j=['dimanche','lundi','mardi','mercredi','jeudi','vendredi','samedi'], m=['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre']; return `${j[d.getDay()]} ${d.getDate()} ${m[d.getMonth()]} ${d.getFullYear()}`; }
function formatTaille(o) { if (o < 1024) return o + ' o'; if (o < 1048576) return (o/1024).toFixed(1)+' KB'; return (o/1048576).toFixed(1)+' MB'; }
function escapeHtml(s) { return (s||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function afficherSucces(m) { const d = document.createElement('div'); d.className = 'message success'; d.textContent = '✅ ' + m; document.body.appendChild(d); setTimeout(() => d.remove(), 3000); }
function afficherErreur(m) { const d = document.createElement('div'); d.className = 'message error'; d.textContent = '❌ ' + m; document.body.appendChild(d); setTimeout(() => d.remove(), 5000); }
