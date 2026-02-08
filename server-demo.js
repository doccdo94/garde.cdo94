const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Stockage en mémoire (remplace la base de données pour la démo)
let inscriptions = [];
let nextId = 1;

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));

// ========== ROUTES API ==========

// GET - Obtenir toutes les dates disponibles pour 2027
app.get('/api/dates-disponibles', (req, res) => {
  const datesPrises = inscriptions.map(i => i.date_garde);
  const datesDisponibles = genererDatesGarde2027();
  const datesLibres = datesDisponibles.filter(date => !datesPrises.includes(date.value));
  res.json(datesLibres);
});

// POST - Créer une nouvelle inscription
app.post('/api/inscriptions', (req, res) => {
  const { dateGarde, praticien1, praticien2 } = req.body;
  
  // Vérifier si la date est déjà prise
  if (inscriptions.some(i => i.date_garde === dateGarde)) {
    return res.status(400).json({ error: 'Cette date est déjà prise' });
  }
  
  // Créer l'inscription
  const inscription = {
    id: nextId++,
    date_garde: dateGarde,
    praticien1_nom: praticien1.nom,
    praticien1_email: praticien1.email,
    praticien1_telephone: praticien1.telephone,
    praticien1_rpps: praticien1.rpps,
    praticien1_numero: praticien1.numero,
    praticien1_voie: praticien1.voie,
    praticien1_code_postal: praticien1.codePostal,
    praticien1_ville: praticien1.ville,
    praticien1_etage: praticien1.etage,
    praticien1_code_entree: praticien1.codeEntree,
    praticien2_nom: praticien2.nom,
    praticien2_email: praticien2.email,
    praticien2_telephone: praticien2.telephone,
    praticien2_rpps: praticien2.rpps,
    praticien2_numero: praticien2.numero,
    praticien2_voie: praticien2.voie,
    praticien2_code_postal: praticien2.codePostal,
    praticien2_ville: praticien2.ville,
    praticien2_etage: praticien2.etage,
    praticien2_code_entree: praticien2.codeEntree,
    created_at: new Date().toISOString()
  };
  
  inscriptions.push(inscription);
  
  console.log(`✅ Nouvelle inscription: ${praticien1.nom} & ${praticien2.nom} - ${dateGarde}`);
  console.log('   📧 En mode démo, les emails ne sont pas envoyés');
  
  res.json({ success: true, inscription });
});

// GET - Obtenir toutes les inscriptions
app.get('/api/inscriptions', (req, res) => {
  const sorted = [...inscriptions].sort((a, b) => new Date(b.date_garde) - new Date(a.date_garde));
  res.json(sorted);
});

// DELETE - Supprimer une inscription
app.delete('/api/inscriptions/:id', (req, res) => {
  const id = parseInt(req.params.id);
  inscriptions = inscriptions.filter(i => i.id !== id);
  res.json({ success: true });
});

// GET - Statistiques
app.get('/api/stats', (req, res) => {
  const now = new Date();
  const stats = {
    total_inscriptions: inscriptions.length,
    gardes_futures: inscriptions.filter(i => new Date(i.date_garde) >= now).length,
    gardes_passees: inscriptions.filter(i => new Date(i.date_garde) < now).length
  };
  res.json(stats);
});

// ========== FONCTIONS UTILITAIRES ==========

function genererDatesGarde2027() {
  const dates = [];
  const joursFeries2027 = [
    '2027-01-01', '2027-04-05', '2027-05-01', '2027-05-08', '2027-05-13',
    '2027-05-24', '2027-07-14', '2027-08-15', '2027-11-01', '2027-11-11', '2027-12-25'
  ];
  
  const debut = new Date('2027-01-01');
  const fin = new Date('2027-12-31');
  
  for (let date = new Date(debut); date <= fin; date.setDate(date.getDate() + 1)) {
    if (date.getDay() === 0) {
      const dateStr = date.toISOString().split('T')[0];
      dates.push({ label: formatDateFr(date), value: dateStr });
    }
  }
  
  joursFeries2027.forEach(ferie => {
    const date = new Date(ferie);
    if (date.getDay() !== 0) {
      dates.push({ label: formatDateFr(date) + ' (jour férié)', value: ferie });
    }
  });
  
  dates.sort((a, b) => new Date(a.value) - new Date(b.value));
  return dates;
}

function formatDateFr(date) {
  const jours = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  const mois = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 
                'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  return `${jours[date.getDay()]} ${date.getDate()} ${mois[date.getMonth()]} ${date.getFullYear()}`;
}

app.listen(PORT, () => {
  console.log(`🚀 Serveur DÉMO démarré sur http://localhost:${PORT}`);
  console.log('📝 Mode démo: les données sont stockées en mémoire (pas de BDD)');
  console.log('📧 Les emails ne sont pas envoyés en mode démo');
});
