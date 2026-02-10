// Configuration
const API_URL = window.location.origin;

// État de l'application
let currentStep = 1;
let formData = {
    dateGarde: '',
    praticien: {}
};

// Initialisation au chargement de la page
document.addEventListener('DOMContentLoaded', () => {
    chargerDatesDisponibles();
    setupEventListeners();
});

// Configuration des écouteurs d'événements
function setupEventListeners() {
    // Boutons de navigation
    document.getElementById('btn-suivant-1').addEventListener('click', () => {
        if (validerEtape1()) {
            allerAEtape(2);
        }
    });
    
    document.getElementById('btn-precedent-2').addEventListener('click', () => allerAEtape(1));
    document.getElementById('btn-suivant-2').addEventListener('click', () => {
        if (validerEtape2()) {
            afficherRecapitulatif();
            allerAEtape(3);
        }
    });
    
    document.getElementById('btn-precedent-3').addEventListener('click', () => allerAEtape(2));
    document.getElementById('btn-confirmer').addEventListener('click', soumettreInscription);
}

// Chargement des dates disponibles
async function chargerDatesDisponibles() {
    try {
        const response = await fetch(`${API_URL}/api/dates-disponibles`);
        const dates = await response.json();
        
        const select = document.getElementById('date-garde');
        select.innerHTML = '<option value="">-- Sélectionnez une date --</option>';
        
        dates.forEach(date => {
            const option = document.createElement('option');
            option.value = date.value;
            
            // Afficher le nombre de places restantes
            const placesInfo = date.places_restantes === 2 
                ? ' (2 places disponibles)' 
                : ' (1 place restante)';
            
            option.textContent = date.label + placesInfo;
            select.appendChild(option);
        });
    } catch (error) {
        console.error('Erreur lors du chargement des dates:', error);
        afficherErreur('Impossible de charger les dates disponibles. Veuillez rafraîchir la page.');
    }
}

// Navigation entre les étapes
function allerAEtape(numero) {
    // Cacher toutes les étapes
    document.querySelectorAll('.step-content').forEach(step => {
        step.classList.remove('active');
    });
    
    // Afficher l'étape demandée
    document.getElementById(`step-${numero}`).classList.add('active');
    
    // Mettre à jour les indicateurs
    document.querySelectorAll('.step-indicator').forEach((indicator, index) => {
        if (index + 1 < numero) {
            indicator.classList.add('completed');
            indicator.classList.remove('active');
        } else if (index + 1 === numero) {
            indicator.classList.add('active');
            indicator.classList.remove('completed');
        } else {
            indicator.classList.remove('active', 'completed');
        }
    });
    
    currentStep = numero;
    
    // Scroll vers le haut
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Validation Étape 1 : Date de garde
function validerEtape1() {
    const dateGarde = document.getElementById('date-garde').value;
    const errorDiv = document.getElementById('error-date');
    
    if (!dateGarde) {
        errorDiv.textContent = 'Veuillez sélectionner une date de garde';
        errorDiv.style.display = 'block';
        return false;
    }
    
    formData.dateGarde = dateGarde;
    errorDiv.style.display = 'none';
    return true;
}

// Validation Étape 2 : Informations praticien
function validerEtape2() {
    const champs = [
        'nom', 'prenom', 'email', 'telephone', 'rpps',
        'numero', 'voie', 'codePostal', 'ville'
    ];
    
    let valide = true;
    const praticien = {};
    
    champs.forEach(champ => {
        const input = document.getElementById(`praticien-${champ}`);
        const value = input.value.trim();
        
        if (!value) {
            input.classList.add('error');
            valide = false;
        } else {
            input.classList.remove('error');
            praticien[champ] = value;
        }
    });
    
    // Champs optionnels
    praticien.etage = document.getElementById('praticien-etage').value.trim();
    praticien.codeEntree = document.getElementById('praticien-codeEntree').value.trim();
    
    if (!valide) {
        afficherErreur('Veuillez remplir tous les champs obligatoires');
        return false;
    }
    
    // Validation email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(praticien.email)) {
        document.getElementById('praticien-email').classList.add('error');
        afficherErreur('Veuillez entrer une adresse email valide');
        return false;
    }
    
    formData.praticien = praticien;
    return true;
}

// Affichage du récapitulatif
function afficherRecapitulatif() {
    const dateOption = document.querySelector(`#date-garde option[value="${formData.dateGarde}"]`);
    const dateLabel = dateOption ? dateOption.textContent : formData.dateGarde;
    
    document.getElementById('recap-date').textContent = dateLabel;
    
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

// Soumission de l'inscription
async function soumettreInscription() {
    const btnConfirmer = document.getElementById('btn-confirmer');
    const originalText = btnConfirmer.textContent;
    
    try {
        btnConfirmer.disabled = true;
        btnConfirmer.textContent = 'Inscription en cours...';
        
        const response = await fetch(`${API_URL}/api/inscriptions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                dateGarde: formData.dateGarde,
                praticien: formData.praticien
            })
        });
        
        const result = await response.json();
        
        if (!response.ok) {
            throw new Error(result.error || 'Erreur lors de l\'inscription');
        }
        
        // Succès !
        afficherSucces(result.message || 'Inscription réussie !');
        
        // Réinitialiser le formulaire après 3 secondes
        setTimeout(() => {
            window.location.reload();
        }, 3000);
        
    } catch (error) {
        console.error('Erreur:', error);
        afficherErreur(error.message);
        btnConfirmer.disabled = false;
        btnConfirmer.textContent = originalText;
    }
}

// Affichage des messages
function afficherErreur(message) {
    const div = document.createElement('div');
    div.className = 'message error';
    div.textContent = '❌ ' + message;
    document.body.appendChild(div);
    
    setTimeout(() => div.remove(), 5000);
}

function afficherSucces(message) {
    const div = document.createElement('div');
    div.className = 'message success';
    div.textContent = '✅ ' + message;
    document.body.appendChild(div);
}
