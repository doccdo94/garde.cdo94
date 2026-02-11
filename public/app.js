// Configuration
const API_URL = window.location.origin;

// Récupérer le token depuis l'URL
const urlParams = new URLSearchParams(window.location.search);
const ACCESS_TOKEN = urlParams.get('token');

// État de l'application
let currentStep = 1;
let formData = { dateGarde: '', praticien: {} };

// Initialisation
document.addEventListener('DOMContentLoaded', async () => {
    if (!ACCESS_TOKEN) { afficherAccesRefuse(); return; }
    try {
        const response = await fetch(`${API_URL}/api/verify-token?token=${ACCESS_TOKEN}`);
        if (!response.ok) { afficherAccesRefuse(); return; }
    } catch (error) { afficherAccesRefuse(); return; }
    chargerDatesDisponibles();
    setupEventListeners();
});

function afficherAccesRefuse() {
    document.querySelector('.container').innerHTML = `
        <div class="header">
            <h1>🏥 Gardes Médicales CDO 94</h1>
        </div>
        <div style="background: white; border-radius: 12px; padding: 40px; text-align: center; margin-top: 20px;">
            <h2 style="color: #dc2626; margin-bottom: 15px;">🔒 Accès restreint</h2>
            <p style="color: #666; font-size: 16px;">Ce formulaire est réservé aux praticiens du CDO 94.</p>
            <p style="color: #666; font-size: 14px; margin-top: 10px;">Utilisez le lien qui vous a été envoyé par email pour accéder au formulaire d'inscription.</p>
            <p style="color: #999; font-size: 13px; margin-top: 20px;">En cas de problème, contactez : doc.cdo94@gmail.com</p>
        </div>
    `;
}

function setupEventListeners() {
    document.getElementById('btn-suivant-1').addEventListener('click', () => {
        if (validerEtape1()) allerAEtape(2);
    });
    document.getElementById('btn-precedent-2').addEventListener('click', () => allerAEtape(1));
    document.getElementById('btn-suivant-2').addEventListener('click', () => {
        if (validerEtape2()) { afficherRecapitulatif(); allerAEtape(3); }
    });
    document.getElementById('btn-precedent-3').addEventListener('click', () => allerAEtape(2));
    document.getElementById('btn-confirmer').addEventListener('click', soumettreInscription);
}

async function chargerDatesDisponibles() {
    try {
        const response = await fetch(`${API_URL}/api/dates-disponibles?token=${ACCESS_TOKEN}`);
        const dates = await response.json();
        const select = document.getElementById('date-garde');
        select.innerHTML = '<option value="">-- Sélectionnez une date --</option>';
        dates.forEach(date => {
            const option = document.createElement('option');
            option.value = date.value;
            const placesInfo = date.places_restantes === 2 ? ' (2 places)' : ' (1 place restante)';
            option.textContent = date.label + placesInfo;
            select.appendChild(option);
        });
    } catch (error) {
        console.error('Erreur:', error);
        afficherErreur('Impossible de charger les dates. Rafraîchissez la page.');
    }
}

function validerEtape1() {
    const dateGarde = document.getElementById('date-garde').value;
    if (!dateGarde) { afficherErreur('Veuillez sélectionner une date de garde'); return false; }
    formData.dateGarde = dateGarde;
    return true;
}

function validerEtape2() {
    const champs = [
        { id: 'praticien-nom', label: 'Nom' },
        { id: 'praticien-prenom', label: 'Prénom' },
        { id: 'praticien-email', label: 'Email' },
        { id: 'praticien-telephone', label: 'Téléphone' },
        { id: 'praticien-rpps', label: 'Numéro RPPS' },
        { id: 'praticien-numero', label: 'Numéro de rue' },
        { id: 'praticien-voie', label: 'Voie' },
        { id: 'praticien-codePostal', label: 'Code postal' },
        { id: 'praticien-ville', label: 'Ville' }
    ];
    for (const champ of champs) {
        const valeur = document.getElementById(champ.id).value.trim();
        if (!valeur) { afficherErreur(`Le champ "${champ.label}" est obligatoire`); document.getElementById(champ.id).focus(); return false; }
    }
    // Email
    const email = document.getElementById('praticien-email').value.trim();
    if (!/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(email)) {
        afficherErreur('Adresse email invalide'); document.getElementById('praticien-email').focus(); return false;
    }
    // Téléphone
    const tel = document.getElementById('praticien-telephone').value.replace(/[\s.\-]/g, '');
    if (!/^0[1-9]\d{8}$/.test(tel)) {
        afficherErreur('Téléphone invalide (format : 0X XX XX XX XX)'); document.getElementById('praticien-telephone').focus(); return false;
    }
    // RPPS
    const rpps = document.getElementById('praticien-rpps').value.trim();
    if (!/^\d{11}$/.test(rpps)) {
        afficherErreur('Numéro RPPS invalide (11 chiffres requis)'); document.getElementById('praticien-rpps').focus(); return false;
    }
    // Code postal
    const cp = document.getElementById('praticien-codePostal').value.trim();
    if (!/^\d{5}$/.test(cp)) {
        afficherErreur('Code postal invalide (5 chiffres)'); document.getElementById('praticien-codePostal').focus(); return false;
    }
    formData.praticien = {
        nom: document.getElementById('praticien-nom').value.trim(),
        prenom: document.getElementById('praticien-prenom').value.trim(),
        email: email, telephone: tel, rpps: rpps,
        numero: document.getElementById('praticien-numero').value.trim(),
        voie: document.getElementById('praticien-voie').value.trim(),
        codePostal: cp,
        ville: document.getElementById('praticien-ville').value.trim(),
        etage: document.getElementById('praticien-etage').value.trim(),
        codeEntree: document.getElementById('praticien-codeEntree').value.trim()
    };
    return true;
}

function afficherRecapitulatif() {
    const dateSelect = document.getElementById('date-garde');
    const dateTexte = dateSelect.options[dateSelect.selectedIndex].text;
    document.getElementById('recap-date').innerHTML = `<strong>${dateTexte}</strong>`;
    const p = formData.praticien;
    document.getElementById('recap-praticien').innerHTML = `
        <p><strong>Nom :</strong> ${p.nom} ${p.prenom}</p>
        <p><strong>Email :</strong> ${p.email}</p>
        <p><strong>Téléphone :</strong> ${p.telephone}</p>
        <p><strong>RPPS :</strong> ${p.rpps}</p>
        <p><strong>Adresse :</strong> ${p.numero} ${p.voie}, ${p.codePostal} ${p.ville}</p>
        ${p.etage ? `<p><strong>Étage :</strong> ${p.etage}</p>` : ''}
        ${p.codeEntree ? `<p><strong>Code d'entrée :</strong> ${p.codeEntree}</p>` : ''}
    `;
}

async function soumettreInscription() {
    const btnConfirmer = document.getElementById('btn-confirmer');
    btnConfirmer.disabled = true;
    btnConfirmer.textContent = '⏳ Inscription en cours...';
    try {
        const response = await fetch(`${API_URL}/api/inscriptions?token=${ACCESS_TOKEN}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dateGarde: formData.dateGarde, praticien: formData.praticien, token: ACCESS_TOKEN })
        });
        const data = await response.json();
        if (response.ok && data.success) {
            afficherSucces(data.message || 'Inscription confirmée !');
        } else {
            afficherErreur(data.error || 'Erreur lors de l\'inscription');
            btnConfirmer.disabled = false;
            btnConfirmer.textContent = '✓ Confirmer mon inscription';
        }
    } catch (error) {
        console.error('Erreur:', error);
        afficherErreur('Erreur de connexion au serveur');
        btnConfirmer.disabled = false;
        btnConfirmer.textContent = '✓ Confirmer mon inscription';
    }
}

function allerAEtape(etape) {
    document.querySelectorAll('.step-content').forEach(el => el.style.display = 'none');
    document.getElementById(`step-${etape}`).style.display = 'block';
    document.querySelectorAll('.step-indicator').forEach((el, index) => {
        el.classList.remove('active', 'completed');
        if (index + 1 < etape) el.classList.add('completed');
        if (index + 1 === etape) el.classList.add('active');
    });
    currentStep = etape;
    window.scrollTo(0, 0);
}

function afficherErreur(message) {
    let errDiv = document.getElementById('error-message');
    if (!errDiv) {
        errDiv = document.createElement('div');
        errDiv.id = 'error-message';
        errDiv.style.cssText = 'background:#fef2f2;border:1px solid #fecaca;color:#dc2626;padding:15px;border-radius:8px;margin:15px 0;text-align:center;font-weight:500;';
        document.querySelector('.card-body') ? document.querySelector(`#step-${currentStep} .card-body`).prepend(errDiv) : document.body.prepend(errDiv);
    }
    errDiv.textContent = message;
    errDiv.style.display = 'block';
    setTimeout(() => { errDiv.style.display = 'none'; }, 5000);
}

function afficherSucces(message) {
    const container = document.querySelector('.container');
    container.innerHTML = `
        <div class="header"><h1>🏥 Gardes Médicales CDO 94</h1></div>
        <div style="background: white; border-radius: 12px; padding: 40px; text-align: center; margin-top: 20px;">
            <div style="width: 80px; height: 80px; background: #10b981; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 20px; font-size: 40px; color: white;">✓</div>
            <h2 style="color: #10b981; margin-bottom: 15px;">Inscription confirmée !</h2>
            <p style="color: #666; font-size: 16px;">${message}</p>
            <p style="color: #999; font-size: 14px; margin-top: 15px;">Un email de confirmation vous a été envoyé.</p>
            <button onclick="location.reload()" style="margin-top: 25px; padding: 12px 30px; background: linear-gradient(135deg, #667eea, #764ba2); color: white; border: none; border-radius: 8px; cursor: pointer; font-size: 16px;">Nouvelle inscription</button>
        </div>
    `;
}
