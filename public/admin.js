const API_URL = window.location.origin;
let ongletActif = 'inscriptions';

// Initialisation
document.addEventListener('DOMContentLoaded', () => {
    chargerInscriptions();
    
    document.getElementById('input-type-date').addEventListener('change', (e) => {
        document.getElementById('group-nom-ferie').style.display = e.target.value === 'jour_ferie' ? 'block' : 'none';
    });
});

// ========== ONGLETS ==========

function changerOnglet(onglet) {
    ongletActif = onglet;
    document.querySelectorAll('.tab').forEach(tab => tab.classList.remove('active'));
    event.target.classList.add('active');
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    document.getElementById(`tab-${onglet}`).classList.add('active');

    if (onglet === 'inscriptions') chargerInscriptions();
    else if (onglet === 'dates') chargerDates();
    else if (onglet === 'documents') chargerDocuments();
}

// ========== INSCRIPTIONS ==========

async function chargerInscriptions() {
    try {
        const [resIns, resStats, resDates] = await Promise.all([
            fetch(`${API_URL}/api/inscriptions`),
            fetch(`${API_URL}/api/stats`),
            fetch(`${API_URL}/api/dates-disponibles`)
        ]);
        const inscriptions = await resIns.json();
        const stats = await resStats.json();
        const datesDisponibles = await resDates.json();
        afficherStatistiques(stats, datesDisponibles);
        afficherInscriptions(inscriptions);
        document.getElementById('loading-inscriptions').style.display = 'none';
        document.getElementById('inscriptions-container').style.display = 'block';
    } catch (error) {
        console.error('Erreur:', error);
        afficherErreur('Impossible de charger les données');
    }
}

function afficherStatistiques(stats, datesDisponibles) {
    document.getElementById('stat-completes').textContent = stats.gardes_futures_completes || 0;
    document.getElementById('stat-partielles').textContent = stats.gardes_futures_partielles || 0;
    document.getElementById('stat-total').textContent = stats.total_inscriptions || 0;
    document.getElementById('stat-disponibles').textContent = datesDisponibles.length || 0;
}

function afficherInscriptions(inscriptions) {
    const container = document.getElementById('inscriptions-container');
    container.innerHTML = '';
    if (inscriptions.length === 0) {
        container.innerHTML = '<p class="loading">Aucune inscription pour le moment.</p>';
        return;
    }

    const parDate = {};
    inscriptions.forEach(ins => {
        const dateStr = ins.date_garde.split('T')[0];
        if (!parDate[dateStr]) parDate[dateStr] = [];
        parDate[dateStr].push(ins);
    });

    const datesSortees = Object.keys(parDate).sort((a, b) => new Date(b) - new Date(a));
    const aujourdhui = new Date(); aujourdhui.setHours(0, 0, 0, 0);

    datesSortees.forEach(dateStr => {
        const praticiens = parDate[dateStr];
        const nbP = praticiens.length;
        const dateObj = new Date(dateStr + 'T00:00:00');
        const dateFormatee = formatDateFr(dateObj);
        const estFuture = dateObj >= aujourdhui;
        const joursRestants = Math.ceil((dateObj - aujourdhui) / (1000 * 60 * 60 * 24));

        let statut = '', statusClass = '';
        if (nbP === 2) { statut = 'Complète (2/2)'; statusClass = 'status-complete'; }
        else if (nbP === 1) { statut = 'Partielle (1/2)'; statusClass = 'status-partial'; }

        let badgeJours = '';
        if (estFuture) {
            if (joursRestants === 0) badgeJours = '<span class="badge badge-urgence">AUJOURD\'HUI</span>';
            else if (joursRestants === 1) badgeJours = '<span class="badge badge-urgence">DEMAIN</span>';
            else if (joursRestants <= 7) badgeJours = `<span class="badge badge-attention">J-${joursRestants}</span>`;
            else badgeJours = `<span class="badge badge-info">J-${joursRestants}</span>`;
        } else {
            badgeJours = '<span class="badge badge-passee">Passée</span>';
        }

        container.innerHTML += `
            <div class="date-group ${!estFuture ? 'date-passee' : ''}">
                <div class="date-group-header">
                    <div><h3>📅 ${dateFormatee}</h3><div style="margin-top:6px">${badgeJours}</div></div>
                    <span class="status-badge ${statusClass}">${statut}</span>
                </div>
                <div class="practitioners-list">
                    ${praticiens.map(p => creerCartePraticien(p, estFuture, joursRestants)).join('')}
                </div>
            </div>
        `;
    });
}

function creerCartePraticien(p, estFuture, joursRestants) {
    // Statuts emails
    const confIcon = statutIcon('Confirmation', p.email_confirmation_statut, p.email_confirmation_envoi_at);
    let binomeIcon = '';
    if (p.nb_praticiens_total >= 2) {
        binomeIcon = statutIcon('Binôme', p.email_binome_statut, p.email_binome_envoi_at);
    }
    const j7Icon = statutIcon('Rappel J-7', p.email_rappel_j7_statut, p.email_rappel_j7_envoi_at);
    const j1Icon = statutIcon('Rappel J-1', p.email_rappel_j1_statut, p.email_rappel_j1_envoi_at);

    // Boutons rappels
    let boutonsRappels = '';
    if (estFuture) {
        if (p.email_rappel_j7_statut !== 'envoye')
            boutonsRappels += `<button class="btn btn-rappel-j7" onclick="envoyerRappelJ7(${p.id}, '${p.praticien_nom}')">🟡 Envoyer J-7</button>`;
        if (p.email_rappel_j1_statut !== 'envoye')
            boutonsRappels += `<button class="btn btn-rappel-j1" onclick="envoyerRappelJ1(${p.id}, '${p.praticien_nom}')">🔴 Envoyer J-1</button>`;
    }

    return `
        <div class="practitioner-card">
            <div class="practitioner-info">
                <h4>Dr ${p.praticien_nom} ${p.praticien_prenom}</h4>
                <p><strong>Email :</strong> ${p.praticien_email}</p>
                <p><strong>Téléphone :</strong> ${p.praticien_telephone}</p>
                <p><strong>RPPS :</strong> ${p.praticien_rpps}</p>
                <p><strong>Adresse :</strong> ${p.praticien_numero} ${p.praticien_voie}, ${p.praticien_code_postal} ${p.praticien_ville}</p>
                ${p.praticien_etage ? `<p><strong>Étage :</strong> ${p.praticien_etage}</p>` : ''}
                ${p.praticien_code_entree ? `<p><strong>Code d'entrée :</strong> ${p.praticien_code_entree}</p>` : ''}
                <p style="font-size:12px;color:#9ca3af;margin-top:10px">
                    Inscrit le ${new Date(p.created_at).toLocaleDateString('fr-FR')} à ${new Date(p.created_at).toLocaleTimeString('fr-FR')}
                </p>
                <div class="email-statuts-grid">${confIcon}${binomeIcon}${j7Icon}${j1Icon}</div>
            </div>
            <div class="practitioner-actions">
                <button class="btn btn-danger" onclick="supprimerInscription(${p.id}, '${p.praticien_nom}')">🗑️ Supprimer</button>
                ${p.email_confirmation_statut !== 'envoye' ? `<button class="btn btn-success" onclick="renvoyerEmail(${p.id}, '${p.praticien_nom}')">📧 Renvoyer confirmation</button>` : ''}
                ${boutonsRappels}
            </div>
        </div>
    `;
}

function statutIcon(label, statut, dateEnvoi) {
    if (statut === 'envoye') {
        const d = dateEnvoi ? new Date(dateEnvoi).toLocaleString('fr-FR') : '';
        return `<span class="email-status email-ok" title="Envoyé le ${d}">✅ ${label}</span>`;
    } else if (statut === 'erreur') {
        return `<span class="email-status email-erreur" title="Erreur">❌ ${label}</span>`;
    }
    return `<span class="email-status email-attente" title="Non envoyé">⏳ ${label}</span>`;
}

// ========== ACTIONS RAPPELS ==========

async function envoyerRappelJ7(id, nom) {
    if (!confirm(`Envoyer le rappel J-7 à Dr ${nom} ?`)) return;
    try {
        const r = await fetch(`${API_URL}/api/inscriptions/${id}/envoyer-rappel-j7`, { method: 'POST' });
        const d = await r.json();
        if (r.ok && d.success) afficherSucces(d.message); else afficherErreur(d.error || 'Erreur');
        rafraichirInscriptions();
    } catch (e) { afficherErreur("Impossible d'envoyer le rappel J-7"); }
}

async function envoyerRappelJ1(id, nom) {
    if (!confirm(`Envoyer le rappel J-1 à Dr ${nom} ?`)) return;
    try {
        const r = await fetch(`${API_URL}/api/inscriptions/${id}/envoyer-rappel-j1`, { method: 'POST' });
        const d = await r.json();
        if (r.ok && d.success) afficherSucces(d.message); else afficherErreur(d.error || 'Erreur');
        rafraichirInscriptions();
    } catch (e) { afficherErreur("Impossible d'envoyer le rappel J-1"); }
}

async function declencherTousRappels() {
    if (!confirm('Déclencher tous les rappels automatiques (J-7 et J-1) ?\n\nSeuls ceux non encore envoyés seront traités.')) return;
    const btn = document.getElementById('btn-rappels-auto');
    btn.disabled = true; btn.textContent = '⏳ Envoi en cours...';
    try {
        const r = await fetch(`${API_URL}/api/rappels/envoyer`, { method: 'POST' });
        const d = await r.json();
        if (r.ok && d.success) {
            const dt = d.detail || {};
            afficherSucces(`Rappels : ${dt.j7_envoyes || 0} J-7, ${dt.j1_envoyes || 0} J-1 envoyés`);
        } else afficherErreur(d.error || 'Erreur');
        rafraichirInscriptions();
    } catch (e) { afficherErreur('Impossible de déclencher les rappels'); }
    btn.disabled = false; btn.textContent = '⏰ Déclencher rappels auto';
}

// ========== ACTIONS INSCRIPTIONS ==========

async function supprimerInscription(id, nom) {
    if (!confirm(`Supprimer l'inscription de Dr ${nom} ?`)) return;
    try {
        const r = await fetch(`${API_URL}/api/inscriptions/${id}`, { method: 'DELETE' });
        if (!r.ok) throw new Error('Erreur');
        afficherSucces('Inscription supprimée');
        rafraichirInscriptions();
    } catch (e) { afficherErreur('Impossible de supprimer'); }
}

async function renvoyerEmail(id, nom) {
    if (!confirm(`Renvoyer l'email de confirmation à Dr ${nom} ?`)) return;
    try {
        const r = await fetch(`${API_URL}/api/inscriptions/${id}/renvoyer-email`, { method: 'POST' });
        if (!r.ok) throw new Error('Erreur');
        afficherSucces('Email renvoyé');
        rafraichirInscriptions();
    } catch (e) { afficherErreur("Impossible de renvoyer l'email"); }
}

function rafraichirInscriptions() {
    document.getElementById('inscriptions-container').style.display = 'none';
    document.getElementById('loading-inscriptions').style.display = 'block';
    chargerInscriptions();
}

// ========== GESTION DES DATES ==========

async function chargerDates() {
    try {
        document.getElementById('loading-dates').style.display = 'block';
        document.getElementById('dates-container').style.display = 'none';
        const r = await fetch(`${API_URL}/api/dates-garde`);
        const dates = await r.json();
        afficherDates(dates);
        document.getElementById('loading-dates').style.display = 'none';
        document.getElementById('dates-container').style.display = 'block';
    } catch (e) { afficherErreur('Impossible de charger les dates'); }
}

function afficherDates(dates) {
    document.getElementById('dates-container').innerHTML = `
        <table class="dates-table">
            <thead><tr><th>Date</th><th>Type</th><th>Nom</th><th>Inscriptions</th><th>Statut</th><th>Actions</th></tr></thead>
            <tbody>
                ${dates.map(d => `<tr>
                    <td>${formatDateFr(new Date(d.date))}</td>
                    <td><span class="badge ${d.type === 'dimanche' ? 'badge-dimanche' : 'badge-ferie'}">${d.type === 'dimanche' ? 'Dimanche' : 'Jour férié'}</span></td>
                    <td>${d.nom_jour_ferie || '-'}</td>
                    <td>${d.nb_inscriptions || 0} / 2</td>
                    <td><span class="badge ${d.active ? 'badge-active' : 'badge-inactive'}">${d.active ? 'Active' : 'Inactive'}</span></td>
                    <td>
                        ${d.active ? `<button class="btn btn-warning" onclick="desactiverDate(${d.id})">🚫 Désactiver</button>`
                                   : `<button class="btn btn-success" onclick="activerDate(${d.id})">✅ Activer</button>`}
                        ${parseInt(d.nb_inscriptions) === 0 ? `<button class="btn btn-danger" onclick="supprimerDate(${d.id}, '${formatDateFr(new Date(d.date))}')">🗑️ Supprimer</button>` : ''}
                    </td>
                </tr>`).join('')}
            </tbody>
        </table>
    `;
}

function ouvrirModalAjouterDate() {
    document.getElementById('modal-ajouter-date').classList.add('active');
    document.getElementById('input-nouvelle-date').value = '';
    document.getElementById('input-type-date').value = 'dimanche';
    document.getElementById('input-nom-ferie').value = '';
    document.getElementById('group-nom-ferie').style.display = 'none';
}

function fermerModal(modalId) { document.getElementById(modalId).classList.remove('active'); }

async function ajouterDate() {
    const date = document.getElementById('input-nouvelle-date').value;
    const type = document.getElementById('input-type-date').value;
    const nomFerie = document.getElementById('input-nom-ferie').value;
    if (!date) { afficherErreur('Sélectionnez une date'); return; }
    if (type === 'jour_ferie' && !nomFerie) { afficherErreur('Entrez le nom du jour férié'); return; }
    try {
        const r = await fetch(`${API_URL}/api/dates-garde`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date, type, nom_jour_ferie: type === 'jour_ferie' ? nomFerie : null }) });
        if (!r.ok) { const e = await r.json(); throw new Error(e.error || 'Erreur'); }
        afficherSucces('Date ajoutée'); fermerModal('modal-ajouter-date'); chargerDates();
    } catch (e) { afficherErreur(e.message); }
}

async function desactiverDate(id) {
    if (!confirm('Désactiver cette date ?')) return;
    try {
        const r = await fetch(`${API_URL}/api/dates-garde/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active: false }) });
        if (!r.ok) throw new Error('Erreur');
        afficherSucces('Date désactivée'); chargerDates();
    } catch (e) { afficherErreur('Impossible de désactiver'); }
}

async function activerDate(id) {
    try {
        const r = await fetch(`${API_URL}/api/dates-garde/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active: true }) });
        if (!r.ok) throw new Error('Erreur');
        afficherSucces('Date activée'); chargerDates();
    } catch (e) { afficherErreur("Impossible d'activer"); }
}

async function supprimerDate(id, dateLabel) {
    if (!confirm(`Supprimer "${dateLabel}" ?\n\nAction irréversible.`)) return;
    try {
        const r = await fetch(`${API_URL}/api/dates-garde/${id}`, { method: 'DELETE' });
        if (!r.ok) { const e = await r.json(); throw new Error(e.error || 'Erreur'); }
        afficherSucces('Date supprimée'); chargerDates();
    } catch (e) { afficherErreur(e.message); }
}

// ========== GESTION DES DOCUMENTS ==========

async function chargerDocuments() {
    try {
        document.getElementById('loading-documents').style.display = 'block';
        document.getElementById('documents-container').style.display = 'none';
        const r = await fetch(`${API_URL}/api/documents`);
        const docs = await r.json();
        afficherDocuments(docs);
        document.getElementById('loading-documents').style.display = 'none';
        document.getElementById('documents-container').style.display = 'block';
    } catch (e) { afficherErreur('Impossible de charger les documents'); }
}

function afficherDocuments(docs) {
    const container = document.getElementById('documents-container');

    const template = docs.find(d => d.est_template_docx);
    const statiques = docs.filter(d => !d.est_template_docx);

    let html = '';

    // Section Template DOCX
    html += `
        <div class="doc-section">
            <h3>📝 Template DOCX personnalisé</h3>
            <p class="doc-section-desc">Ce document est personnalisé avec le nom du praticien et la date de garde (balises <code>{{NOM_PRATICIEN}}</code> et <code>{{DATE_GARDE}}</code>).</p>
            ${template ? `
                <div class="doc-card doc-template">
                    <div class="doc-icon">📝</div>
                    <div class="doc-info">
                        <strong>${template.nom_email}</strong>
                        <span class="doc-meta">${template.nom_original} · ${formatTaille(template.taille)}</span>
                        <span class="doc-meta">Uploadé le ${new Date(template.created_at).toLocaleString('fr-FR')}</span>
                    </div>
                    <div class="doc-actions">
                        <button class="btn btn-danger" onclick="supprimerDocument(${template.id}, '${template.nom_email}')">🗑️</button>
                    </div>
                </div>
            ` : '<p class="doc-empty">Aucun template DOCX. Les fichiers locaux seront utilisés en fallback.</p>'}
            <button class="btn btn-primary" onclick="ouvrirModalUpload(true)">📤 ${template ? 'Remplacer' : 'Uploader'} le template DOCX</button>
        </div>
    `;

    // Section Pièces jointes
    html += `
        <div class="doc-section">
            <h3>📎 Pièces jointes (PDF)</h3>
            <p class="doc-section-desc">Ces documents sont envoyés en pièces jointes dans chaque email de confirmation.</p>
            ${statiques.length > 0 ? statiques.map(d => `
                <div class="doc-card">
                    <div class="doc-icon">${d.type_mime && d.type_mime.includes('pdf') ? '📄' : '📁'}</div>
                    <div class="doc-info">
                        <strong>${d.nom_email}</strong>
                        <span class="doc-meta">${d.nom_original} · ${formatTaille(d.taille)}</span>
                        <span class="doc-meta">Uploadé le ${new Date(d.created_at).toLocaleString('fr-FR')}</span>
                        ${!d.actif ? '<span class="badge badge-inactive">Désactivé</span>' : ''}
                    </div>
                    <div class="doc-actions">
                        <button class="btn btn-warning" onclick="renommerDocument(${d.id}, '${d.nom_email}')" title="Renommer">✏️</button>
                        ${d.actif
                            ? `<button class="btn btn-warning" onclick="toggleDocument(${d.id}, false)" title="Désactiver">🚫</button>`
                            : `<button class="btn btn-success" onclick="toggleDocument(${d.id}, true)" title="Activer">✅</button>`
                        }
                        <button class="btn btn-danger" onclick="supprimerDocument(${d.id}, '${d.nom_email}')" title="Supprimer">🗑️</button>
                    </div>
                </div>
            `).join('') : '<p class="doc-empty">Aucune pièce jointe. Les fichiers locaux seront utilisés en fallback.</p>'}
            <button class="btn btn-primary" onclick="ouvrirModalUpload(false)">📤 Ajouter une pièce jointe</button>
        </div>
    `;

    // Info fallback
    html += `
        <div class="doc-section doc-section-info">
            <h3>ℹ️ Fonctionnement</h3>
            <p>Si aucun document n'est uploadé ici, le serveur utilise les fichiers du dossier <code>Documents/</code> sur GitHub (fallback).</p>
            <p>Dès qu'au moins un document est présent ici, <strong>seuls les documents Supabase sont utilisés</strong> pour les emails.</p>
        </div>
    `;

    container.innerHTML = html;
}

function ouvrirModalUpload(estTemplate) {
    document.getElementById('modal-upload-doc').classList.add('active');
    document.getElementById('upload-est-template').value = estTemplate ? 'true' : 'false';
    document.getElementById('upload-titre').textContent = estTemplate ? '📝 Uploader le template DOCX' : '📤 Ajouter une pièce jointe';
    document.getElementById('upload-fichier').value = '';
    document.getElementById('upload-nom-email').value = '';
    document.getElementById('upload-nom-email').placeholder = estTemplate ? 'Document-praticien-de-garde.docx' : 'Ex: Fiche-retour.pdf';

    // Drag & drop
    const zone = document.getElementById('upload-drop-zone');
    zone.innerHTML = '<p>📁 Glissez un fichier ici ou cliquez pour parcourir</p><p class="doc-meta">' + (estTemplate ? 'Fichier .docx uniquement' : 'Fichiers .pdf ou .docx') + ' · Max 20 MB</p>';
    zone.classList.remove('drop-active');
}

// Drag & drop
document.addEventListener('DOMContentLoaded', () => {
    const zone = document.getElementById('upload-drop-zone');
    if (!zone) return;

    zone.addEventListener('click', () => document.getElementById('upload-fichier').click());

    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('drop-active'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drop-active'));
    zone.addEventListener('drop', (e) => {
        e.preventDefault(); zone.classList.remove('drop-active');
        if (e.dataTransfer.files.length > 0) {
            document.getElementById('upload-fichier').files = e.dataTransfer.files;
            const f = e.dataTransfer.files[0];
            zone.innerHTML = `<p>📄 <strong>${f.name}</strong></p><p class="doc-meta">${formatTaille(f.size)}</p>`;
        }
    });

    document.getElementById('upload-fichier').addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            const f = e.target.files[0];
            zone.innerHTML = `<p>📄 <strong>${f.name}</strong></p><p class="doc-meta">${formatTaille(f.size)}</p>`;
        }
    });
});

async function uploaderDocument() {
    const fichier = document.getElementById('upload-fichier').files[0];
    if (!fichier) { afficherErreur('Sélectionnez un fichier'); return; }

    const nomEmail = document.getElementById('upload-nom-email').value || fichier.name;
    const estTemplate = document.getElementById('upload-est-template').value;

    const formData = new FormData();
    formData.append('fichier', fichier);
    formData.append('nom_email', nomEmail);
    formData.append('est_template_docx', estTemplate);

    const btn = document.getElementById('btn-upload');
    btn.disabled = true; btn.textContent = '⏳ Upload en cours...';

    try {
        const r = await fetch(`${API_URL}/api/documents/upload`, { method: 'POST', body: formData });
        const d = await r.json();
        if (r.ok && d.success) {
            afficherSucces(`Document "${nomEmail}" uploadé`);
            fermerModal('modal-upload-doc');
            chargerDocuments();
        } else {
            afficherErreur(d.error || 'Erreur upload');
        }
    } catch (e) { afficherErreur("Erreur lors de l'upload"); }
    btn.disabled = false; btn.textContent = '📤 Uploader';
}

async function supprimerDocument(id, nom) {
    if (!confirm(`Supprimer "${nom}" ?\n\nLe fichier sera supprimé de Supabase Storage.`)) return;
    try {
        const r = await fetch(`${API_URL}/api/documents/${id}`, { method: 'DELETE' });
        if (!r.ok) throw new Error('Erreur');
        afficherSucces('Document supprimé');
        chargerDocuments();
    } catch (e) { afficherErreur('Impossible de supprimer'); }
}

async function renommerDocument(id, nomActuel) {
    const nouveau = prompt('Nouveau nom du fichier dans l\'email :', nomActuel);
    if (!nouveau || nouveau === nomActuel) return;
    try {
        const r = await fetch(`${API_URL}/api/documents/${id}`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nom_email: nouveau })
        });
        if (!r.ok) throw new Error('Erreur');
        afficherSucces('Document renommé');
        chargerDocuments();
    } catch (e) { afficherErreur('Impossible de renommer'); }
}

async function toggleDocument(id, actif) {
    try {
        const r = await fetch(`${API_URL}/api/documents/${id}`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ actif })
        });
        if (!r.ok) throw new Error('Erreur');
        afficherSucces(actif ? 'Document activé' : 'Document désactivé');
        chargerDocuments();
    } catch (e) { afficherErreur('Erreur'); }
}

// ========== UTILITAIRES ==========

function formatDateFr(date) {
    const jours = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
    const mois = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
    return `${jours[date.getDay()]} ${date.getDate()} ${mois[date.getMonth()]} ${date.getFullYear()}`;
}

function formatTaille(octets) {
    if (octets < 1024) return octets + ' o';
    if (octets < 1024 * 1024) return (octets / 1024).toFixed(1) + ' KB';
    return (octets / (1024 * 1024)).toFixed(1) + ' MB';
}

function afficherSucces(message) {
    const div = document.createElement('div');
    div.className = 'message success';
    div.textContent = '✅ ' + message;
    document.body.appendChild(div);
    setTimeout(() => div.remove(), 3000);
}

function afficherErreur(message) {
    const div = document.createElement('div');
    div.className = 'message error';
    div.textContent = '❌ ' + message;
    document.body.appendChild(div);
    setTimeout(() => div.remove(), 5000);
}
