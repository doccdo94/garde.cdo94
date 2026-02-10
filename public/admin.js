const API_URL = window.location.origin;
let ongletActif = 'inscriptions';

// Initialisation
document.addEventListener('DOMContentLoaded', () => {
    chargerInscriptions();
    
    // Gérer l'affichage du champ nom férié
    document.getElementById('input-type-date').addEventListener('change', (e) => {
        const groupNomFerie = document.getElementById('group-nom-ferie');
        groupNomFerie.style.display = e.target.value === 'jour_ferie' ? 'block' : 'none';
    });
});

// Changer d'onglet
function changerOnglet(onglet) {
    ongletActif = onglet;
    
    // Mettre à jour les onglets
    document.querySelectorAll('.tab').forEach(tab => tab.classList.remove('active'));
    event.target.classList.add('active');
    
    // Mettre à jour le contenu
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
    document.getElementById(`tab-${onglet}`).classList.add('active');
    
    // Charger les données
    if (onglet === 'inscriptions') {
        chargerInscriptions();
    } else if (onglet === 'dates') {
        chargerDates();
    }
}

// ========== GESTION DES INSCRIPTIONS ==========

async function chargerInscriptions() {
    try {
        const responseInscriptions = await fetch(`${API_URL}/api/inscriptions`);
        const inscriptions = await responseInscriptions.json();

        const responseStats = await fetch(`${API_URL}/api/stats`);
        const stats = await responseStats.json();

        const responseDates = await fetch(`${API_URL}/api/dates-disponibles`);
        const datesDisponibles = await responseDates.json();

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
        if (!parDate[dateStr]) {
            parDate[dateStr] = [];
        }
        parDate[dateStr].push(ins);
    });

    const datesSortees = Object.keys(parDate).sort((a, b) => new Date(b) - new Date(a));

    datesSortees.forEach(dateStr => {
        const praticiens = parDate[dateStr];
        const nbPraticiens = praticiens.length;
        
        const dateObj = new Date(dateStr + 'T00:00:00');
        const dateFormatee = formatDateFr(dateObj);

        let statut = '';
        let statusClass = '';
        if (nbPraticiens === 2) {
            statut = 'Complète (2/2)';
            statusClass = 'status-complete';
        } else if (nbPraticiens === 1) {
            statut = 'Partielle (1/2)';
            statusClass = 'status-partial';
        }

        const groupHtml = `
            <div class="date-group">
                <div class="date-group-header">
                    <h3>📅 ${dateFormatee}</h3>
                    <span class="status-badge ${statusClass}">${statut}</span>
                </div>
                <div class="practitioners-list">
                    ${praticiens.map(p => creerCartePraticien(p)).join('')}
                </div>
            </div>
        `;

        container.innerHTML += groupHtml;
    });
}

function creerCartePraticien(praticien) {
    let emailConfirmationIcon = '';
    if (praticien.email_confirmation_statut === 'envoye') {
        const date = praticien.email_confirmation_envoi_at 
            ? new Date(praticien.email_confirmation_envoi_at).toLocaleString('fr-FR')
            : '';
        emailConfirmationIcon = `<span style="color: #10b981;" title="Email envoyé le ${date}">✅ Email confirmation</span>`;
    } else if (praticien.email_confirmation_statut === 'erreur') {
        emailConfirmationIcon = `<span style="color: #ef4444;" title="Erreur lors de l'envoi">❌ Email confirmation</span>`;
    } else {
        emailConfirmationIcon = `<span style="color: #6b7280;" title="Email non envoyé">⏳ Email confirmation</span>`;
    }
    
    let emailBinomeIcon = '';
    if (praticien.nb_praticiens_total >= 2) {
        if (praticien.email_binome_statut === 'envoye') {
            const date = praticien.email_binome_envoi_at 
                ? new Date(praticien.email_binome_envoi_at).toLocaleString('fr-FR')
                : '';
            emailBinomeIcon = `<br><span style="color: #10b981;" title="Email binôme envoyé le ${date}">✅ Email binôme</span>`;
        } else if (praticien.email_binome_statut === 'erreur') {
            emailBinomeIcon = `<br><span style="color: #ef4444;" title="Erreur lors de l'envoi">❌ Email binôme</span>`;
        } else if (praticien.email_binome_statut === 'non_envoye') {
            emailBinomeIcon = `<br><span style="color: #6b7280;" title="Email non envoyé">⏳ Email binôme</span>`;
        }
    }
    
    return `
        <div class="practitioner-card">
            <div class="practitioner-info">
                <h4>Dr ${praticien.praticien_nom} ${praticien.praticien_prenom}</h4>
                <p><strong>Email :</strong> ${praticien.praticien_email}</p>
                <p><strong>Téléphone :</strong> ${praticien.praticien_telephone}</p>
                <p><strong>RPPS :</strong> ${praticien.praticien_rpps}</p>
                <p><strong>Adresse :</strong> ${praticien.praticien_numero} ${praticien.praticien_voie}, ${praticien.praticien_code_postal} ${praticien.praticien_ville}</p>
                ${praticien.praticien_etage ? `<p><strong>Étage :</strong> ${praticien.praticien_etage}</p>` : ''}
                ${praticien.praticien_code_entree ? `<p><strong>Code d'entrée :</strong> ${praticien.praticien_code_entree}</p>` : ''}
                <p style="font-size: 12px; color: #9ca3af; margin-top: 10px;">
                    Inscrit le ${new Date(praticien.created_at).toLocaleDateString('fr-FR')} à ${new Date(praticien.created_at).toLocaleTimeString('fr-FR')}
                </p>
                <p style="font-size: 14px; margin-top: 10px;">
                    ${emailConfirmationIcon}${emailBinomeIcon}
                </p>
            </div>
            <div class="practitioner-actions">
                <button class="btn btn-danger" onclick="supprimerInscription(${praticien.id}, '${praticien.praticien_nom}')">
                    🗑️ Supprimer
                </button>
                ${praticien.email_confirmation_statut !== 'envoye' ? `
                <button class="btn btn-success" onclick="renvoyerEmail(${praticien.id}, '${praticien.praticien_nom}')">
                    📧 Renvoyer email
                </button>
                ` : ''}
            </div>
        </div>
    `;
}

async function supprimerInscription(id, nom) {
    if (!confirm(`Voulez-vous vraiment supprimer l'inscription de Dr ${nom} ?`)) {
        return;
    }

    try {
        const response = await fetch(`${API_URL}/api/inscriptions/${id}`, {
            method: 'DELETE'
        });

        if (!response.ok) {
            throw new Error('Erreur lors de la suppression');
        }

        afficherSucces('Inscription supprimée avec succès');
        rafraichirInscriptions();

    } catch (error) {
        console.error('Erreur:', error);
        afficherErreur('Impossible de supprimer l\'inscription');
    }
}

async function renvoyerEmail(id, nom) {
    if (!confirm(`Renvoyer l'email de confirmation à Dr ${nom} ?`)) {
        return;
    }

    try {
        const response = await fetch(`${API_URL}/api/inscriptions/${id}/renvoyer-email`, {
            method: 'POST'
        });

        if (!response.ok) {
            throw new Error('Erreur lors de l\'envoi');
        }

        afficherSucces('Email renvoyé avec succès');
        rafraichirInscriptions();

    } catch (error) {
        console.error('Erreur:', error);
        afficherErreur('Impossible de renvoyer l\'email');
    }
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
        
        const response = await fetch(`${API_URL}/api/dates-garde`);
        const dates = await response.json();

        afficherDates(dates);

        document.getElementById('loading-dates').style.display = 'none';
        document.getElementById('dates-container').style.display = 'block';

    } catch (error) {
        console.error('Erreur:', error);
        afficherErreur('Impossible de charger les dates');
    }
}

function afficherDates(dates) {
    const container = document.getElementById('dates-container');
    
    const tableHtml = `
        <table class="dates-table">
            <thead>
                <tr>
                    <th>Date</th>
                    <th>Type</th>
                    <th>Nom</th>
                    <th>Inscriptions</th>
                    <th>Statut</th>
                    <th>Actions</th>
                </tr>
            </thead>
            <tbody>
                ${dates.map(date => `
                    <tr>
                        <td>${formatDateFr(new Date(date.date))}</td>
                        <td>
                            <span class="badge ${date.type === 'dimanche' ? 'badge-dimanche' : 'badge-ferie'}">
                                ${date.type === 'dimanche' ? 'Dimanche' : 'Jour férié'}
                            </span>
                        </td>
                        <td>${date.nom_jour_ferie || '-'}</td>
                        <td>${date.nb_inscriptions || 0} / 2</td>
                        <td>
                            <span class="badge ${date.active ? 'badge-active' : 'badge-inactive'}">
                                ${date.active ? 'Active' : 'Inactive'}
                            </span>
                        </td>
                        <td>
                            ${date.active ? `
                                <button class="btn btn-warning" onclick="desactiverDate(${date.id})">
                                    🚫 Désactiver
                                </button>
                            ` : `
                                <button class="btn btn-success" onclick="activerDate(${date.id})">
                                    ✅ Activer
                                </button>
                            `}
                            ${parseInt(date.nb_inscriptions) === 0 ? `
                                <button class="btn btn-danger" onclick="supprimerDate(${date.id}, '${formatDateFr(new Date(date.date))}')">
                                    🗑️ Supprimer
                                </button>
                            ` : ''}
                        </td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
    
    container.innerHTML = tableHtml;
}

function ouvrirModalAjouterDate() {
    document.getElementById('modal-ajouter-date').classList.add('active');
    document.getElementById('input-nouvelle-date').value = '';
    document.getElementById('input-type-date').value = 'dimanche';
    document.getElementById('input-nom-ferie').value = '';
    document.getElementById('group-nom-ferie').style.display = 'none';
}

function fermerModal(modalId) {
    document.getElementById(modalId).classList.remove('active');
}

async function ajouterDate() {
    const date = document.getElementById('input-nouvelle-date').value;
    const type = document.getElementById('input-type-date').value;
    const nomFerie = document.getElementById('input-nom-ferie').value;
    
    if (!date) {
        afficherErreur('Veuillez sélectionner une date');
        return;
    }
    
    if (type === 'jour_ferie' && !nomFerie) {
        afficherErreur('Veuillez entrer le nom du jour férié');
        return;
    }
    
    try {
        const response = await fetch(`${API_URL}/api/dates-garde`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                date,
                type,
                nom_jour_ferie: type === 'jour_ferie' ? nomFerie : null
            })
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Erreur lors de l\'ajout');
        }
        
        afficherSucces('Date ajoutée avec succès');
        fermerModal('modal-ajouter-date');
        chargerDates();
        
    } catch (error) {
        console.error('Erreur:', error);
        afficherErreur(error.message);
    }
}

async function desactiverDate(id) {
    if (!confirm('Désactiver cette date ? Elle n\'apparaîtra plus dans le formulaire d\'inscription.')) {
        return;
    }
    
    try {
        const response = await fetch(`${API_URL}/api/dates-garde/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ active: false })
        });
        
        if (!response.ok) throw new Error('Erreur');
        
        afficherSucces('Date désactivée');
        chargerDates();
        
    } catch (error) {
        afficherErreur('Impossible de désactiver la date');
    }
}

async function activerDate(id) {
    try {
        const response = await fetch(`${API_URL}/api/dates-garde/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ active: true })
        });
        
        if (!response.ok) throw new Error('Erreur');
        
        afficherSucces('Date activée');
        chargerDates();
        
    } catch (error) {
        afficherErreur('Impossible d\'activer la date');
    }
}

async function supprimerDate(id, dateLabel) {
    if (!confirm(`Supprimer définitivement la date "${dateLabel}" ?\n\nCette action est irréversible.`)) {
        return;
    }
    
    try {
        const response = await fetch(`${API_URL}/api/dates-garde/${id}`, {
            method: 'DELETE'
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Erreur');
        }
        
        afficherSucces('Date supprimée');
        chargerDates();
        
    } catch (error) {
        afficherErreur(error.message);
    }
}

// ========== UTILITAIRES ==========

function formatDateFr(date) {
    const jours = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
    const mois = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 
                  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
    
    return `${jours[date.getDay()]} ${date.getDate()} ${mois[date.getMonth()]} ${date.getFullYear()}`;
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
