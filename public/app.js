// État de l'application
let currentStep = 1;
let datesDisponibles = [];

// Charger les dates disponibles au démarrage
document.addEventListener('DOMContentLoaded', () => {
  chargerDatesDisponibles();
});

// Charger les dates disponibles depuis l'API
async function chargerDatesDisponibles() {
  try {
    const response = await fetch('/api/dates-disponibles');
    datesDisponibles = await response.json();
    
    const select = document.getElementById('dateGarde');
    select.innerHTML = '<option value="">-- Sélectionnez une date --</option>';
    
    datesDisponibles.forEach(date => {
      const option = document.createElement('option');
      option.value = date.value;
      option.textContent = date.label;
      select.appendChild(option);
    });
  } catch (error) {
    console.error('Erreur:', error);
    showError('Erreur lors du chargement des dates disponibles');
  }
}

// Navigation entre les étapes
function nextStep() {
  if (currentStep === 1) {
    const dateGarde = document.getElementById('dateGarde').value;
    if (!dateGarde) {
      showError('Veuillez sélectionner une date de garde');
      return;
    }
  }
  
  hideError();
  currentStep++;
  updateStepDisplay();
}

function prevStep() {
  hideError();
  currentStep--;
  updateStepDisplay();
}

function updateStepDisplay() {
  // Cacher toutes les sections
  document.querySelectorAll('.form-section').forEach(section => {
    section.classList.remove('active');
  });
  
  // Afficher la section active
  document.getElementById(`step${currentStep}`).classList.add('active');
  
  // Mettre à jour la barre de progression
  document.querySelectorAll('.progress-step').forEach((step, index) => {
    const stepNumber = index + 1;
    step.classList.remove('active', 'completed');
    
    if (stepNumber < currentStep) {
      step.classList.add('completed');
    } else if (stepNumber === currentStep) {
      step.classList.add('active');
    }
  });
  
  // Scroll vers le haut
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Soumission du formulaire
document.getElementById('gardeForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  
  hideError();
  showLoading();
  
  const data = {
    dateGarde: document.getElementById('dateGarde').value,
    praticien1: {
      nom: document.getElementById('p1Nom').value,
      email: document.getElementById('p1Email').value,
      telephone: document.getElementById('p1Telephone').value,
      rpps: document.getElementById('p1Rpps').value,
      numero: document.getElementById('p1Numero').value,
      voie: document.getElementById('p1Voie').value,
      codePostal: document.getElementById('p1CodePostal').value,
      ville: document.getElementById('p1Ville').value,
      etage: document.getElementById('p1Etage').value,
      codeEntree: document.getElementById('p1CodeEntree').value
    },
    praticien2: {
      nom: document.getElementById('p2Nom').value,
      email: document.getElementById('p2Email').value,
      telephone: document.getElementById('p2Telephone').value,
      rpps: document.getElementById('p2Rpps').value,
      numero: document.getElementById('p2Numero').value,
      voie: document.getElementById('p2Voie').value,
      codePostal: document.getElementById('p2CodePostal').value,
      ville: document.getElementById('p2Ville').value,
      etage: document.getElementById('p2Etage').value,
      codeEntree: document.getElementById('p2CodeEntree').value
    }
  };
  
  try {
    const response = await fetch('/api/inscriptions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(data)
    });
    
    const result = await response.json();
    
    hideLoading();
    
    if (response.ok) {
      // Afficher le message de succès
      document.getElementById('step2').classList.remove('active');
      document.getElementById('successMessage').classList.add('active');
      
      // Mettre à jour la barre de progression
      document.querySelectorAll('.progress-step').forEach(step => {
        step.classList.remove('active');
        step.classList.add('completed');
      });
      
      // Scroll vers le haut
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      showError(result.error || 'Erreur lors de l\'inscription');
    }
  } catch (error) {
    hideLoading();
    console.error('Erreur:', error);
    showError('Erreur de connexion au serveur');
  }
});

// Gestion des messages d'erreur
function showError(message) {
  const errorDiv = document.getElementById('errorMessage');
  errorDiv.textContent = message;
  errorDiv.classList.add('active');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function hideError() {
  document.getElementById('errorMessage').classList.remove('active');
}

// Gestion du chargement
function showLoading() {
  document.getElementById('loading').classList.add('active');
  document.getElementById('step2').style.opacity = '0.5';
  document.getElementById('step2').style.pointerEvents = 'none';
}

function hideLoading() {
  document.getElementById('loading').classList.remove('active');
  document.getElementById('step2').style.opacity = '1';
  document.getElementById('step2').style.pointerEvents = 'auto';
}
