require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const nodemailer = require('nodemailer');
const bodyParser = require('body-parser');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuration PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Configuration Nodemailer
const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: process.env.EMAIL_PORT,
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));

// ========== ROUTES API ==========

// GET - Obtenir toutes les dates disponibles pour 2027
app.get('/api/dates-disponibles', async (req, res) => {
  try {
    // Récupérer toutes les inscriptions existantes
    const result = await pool.query('SELECT date_garde FROM inscriptions ORDER BY date_garde');
    const datesPrises = result.rows.map(row => row.date_garde.toISOString().split('T')[0]);
    
    // Générer toutes les dates de dimanches et jours fériés 2027
    const datesDisponibles = genererDatesGarde2027();
    
    // Filtrer les dates déjà prises
    const datesLibres = datesDisponibles.filter(date => !datesPrises.includes(date.value));
    
    res.json(datesLibres);
  } catch (error) {
    console.error('Erreur:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST - Créer une nouvelle inscription
app.post('/api/inscriptions', async (req, res) => {
  const {
    dateGarde,
    praticien1, praticien2
  } = req.body;
  
  try {
    // Vérifier si la date est déjà prise
    const checkResult = await pool.query(
      'SELECT * FROM inscriptions WHERE date_garde = $1',
      [dateGarde]
    );
    
    if (checkResult.rows.length > 0) {
      return res.status(400).json({ error: 'Cette date est déjà prise' });
    }
    
    // Insérer l'inscription
    const result = await pool.query(`
      INSERT INTO inscriptions (
        date_garde,
        praticien1_nom, praticien1_email, praticien1_telephone, praticien1_rpps,
        praticien1_numero, praticien1_voie, praticien1_code_postal, praticien1_ville,
        praticien1_etage, praticien1_code_entree,
        praticien2_nom, praticien2_email, praticien2_telephone, praticien2_rpps,
        praticien2_numero, praticien2_voie, praticien2_code_postal, praticien2_ville,
        praticien2_etage, praticien2_code_entree
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
        $12, $13, $14, $15, $16, $17, $18, $19, $20, $21
      ) RETURNING *
    `, [
      dateGarde,
      praticien1.nom, praticien1.email, praticien1.telephone, praticien1.rpps,
      praticien1.numero, praticien1.voie, praticien1.codePostal, praticien1.ville,
      praticien1.etage, praticien1.codeEntree,
      praticien2.nom, praticien2.email, praticien2.telephone, praticien2.rpps,
      praticien2.numero, praticien2.voie, praticien2.codePostal, praticien2.ville,
      praticien2.etage, praticien2.codeEntree
    ]);
    
    // Envoyer les emails de confirmation
    await envoyerEmailsConfirmation(result.rows[0]);
    
    res.json({ success: true, inscription: result.rows[0] });
    
  } catch (error) {
    console.error('Erreur inscription:', error);
    res.status(500).json({ error: 'Erreur lors de l\'inscription' });
  }
});

// GET - Obtenir toutes les inscriptions (pour l'admin)
app.get('/api/inscriptions', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM inscriptions ORDER BY date_garde DESC'
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Erreur:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE - Supprimer une inscription (pour l'admin)
app.delete('/api/inscriptions/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM inscriptions WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (error) {
    console.error('Erreur:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET - Statistiques (pour l'admin)
app.get('/api/stats', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        COUNT(*) as total_inscriptions,
        COUNT(*) FILTER (WHERE date_garde >= CURRENT_DATE) as gardes_futures,
        COUNT(*) FILTER (WHERE date_garde < CURRENT_DATE) as gardes_passees
      FROM inscriptions
    `);
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Erreur:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ========== FONCTIONS UTILITAIRES ==========

function genererDatesGarde2027() {
  const dates = [];
  const joursFeries2027 = [
    '2027-01-01', // Jour de l'an
    '2027-04-05', // Lundi de Pâques
    '2027-05-01', // Fête du travail
    '2027-05-08', // Victoire 1945
    '2027-05-13', // Ascension
    '2027-05-24', // Lundi de Pentecôte
    '2027-07-14', // Fête nationale
    '2027-08-15', // Assomption
    '2027-11-01', // Toussaint
    '2027-11-11', // Armistice 1918
    '2027-12-25'  // Noël
  ];
  
  // Ajouter tous les dimanches de 2027
  const debut = new Date('2027-01-01');
  const fin = new Date('2027-12-31');
  
  for (let date = new Date(debut); date <= fin; date.setDate(date.getDate() + 1)) {
    if (date.getDay() === 0) { // Dimanche
      const dateStr = date.toISOString().split('T')[0];
      dates.push({
        label: formatDateFr(date),
        value: dateStr
      });
    }
  }
  
  // Ajouter les jours fériés qui ne sont pas des dimanches
  joursFeries2027.forEach(ferie => {
    const date = new Date(ferie);
    if (date.getDay() !== 0) {
      dates.push({
        label: formatDateFr(date) + ' (jour férié)',
        value: ferie
      });
    }
  });
  
  // Trier par date
  dates.sort((a, b) => new Date(a.value) - new Date(b.value));
  
  return dates;
}

function formatDateFr(date) {
  const jours = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  const mois = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 
                'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  
  return `${jours[date.getDay()]} ${date.getDate()} ${mois[date.getMonth()]} ${date.getFullYear()}`;
}

async function envoyerEmailsConfirmation(inscription) {
  const dateFormatee = formatDateFr(new Date(inscription.date_garde));
  
  // Email pour praticien 1
  const htmlP1 = genererHtmlEmail(inscription, 1, dateFormatee);
  await transporter.sendMail({
    from: `"${process.env.EMAIL_FROM_NAME}" <${process.env.EMAIL_FROM}>`,
    to: inscription.praticien1_email,
    cc: process.env.ADMIN_EMAIL,
    subject: `Confirmation inscription garde - ${dateFormatee}`,
    html: htmlP1
  });
  
  // Email pour praticien 2
  const htmlP2 = genererHtmlEmail(inscription, 2, dateFormatee);
  await transporter.sendMail({
    from: `"${process.env.EMAIL_FROM_NAME}" <${process.env.EMAIL_FROM}>`,
    to: inscription.praticien2_email,
    cc: process.env.ADMIN_EMAIL,
    subject: `Confirmation inscription garde - ${dateFormatee}`,
    html: htmlP2
  });
}

function genererHtmlEmail(inscription, numPraticien, dateFormatee) {
  const praticien = numPraticien === 1 ? {
    nom: inscription.praticien1_nom,
    email: inscription.praticien1_email,
    telephone: inscription.praticien1_telephone,
    adresse: `${inscription.praticien1_numero} ${inscription.praticien1_voie}, ${inscription.praticien1_code_postal} ${inscription.praticien1_ville}`
  } : {
    nom: inscription.praticien2_nom,
    email: inscription.praticien2_email,
    telephone: inscription.praticien2_telephone,
    adresse: `${inscription.praticien2_numero} ${inscription.praticien2_voie}, ${inscription.praticien2_code_postal} ${inscription.praticien2_ville}`
  };
  
  const binome = numPraticien === 1 ? {
    nom: inscription.praticien2_nom,
    email: inscription.praticien2_email,
    telephone: inscription.praticien2_telephone
  } : {
    nom: inscription.praticien1_nom,
    email: inscription.praticien1_email,
    telephone: inscription.praticien1_telephone
  };
  
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
        .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
        .info-box { background: white; padding: 20px; margin: 20px 0; border-left: 4px solid #667eea; border-radius: 5px; }
        .footer { text-align: center; margin-top: 30px; color: #666; font-size: 12px; }
        h1 { margin: 0; font-size: 24px; }
        h2 { color: #667eea; font-size: 18px; margin-top: 0; }
        strong { color: #667eea; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>✓ Inscription confirmée</h1>
          <p style="margin: 10px 0 0 0; font-size: 18px;">Garde du ${dateFormatee}</p>
        </div>
        <div class="content">
          <p>Bonjour Dr ${praticien.nom},</p>
          
          <p>Votre inscription à la garde du <strong>${dateFormatee}</strong> a bien été enregistrée.</p>
          
          <div class="info-box">
            <h2>📋 Vos informations</h2>
            <p><strong>Nom :</strong> ${praticien.nom}</p>
            <p><strong>Email :</strong> ${praticien.email}</p>
            <p><strong>Téléphone :</strong> ${praticien.telephone}</p>
            <p><strong>Adresse :</strong> ${praticien.adresse}</p>
          </div>
          
          <div class="info-box">
            <h2>👥 Votre binôme</h2>
            <p><strong>Nom :</strong> ${binome.nom}</p>
            <p><strong>Email :</strong> ${binome.email}</p>
            <p><strong>Téléphone :</strong> ${binome.telephone}</p>
          </div>
          
          <p>En cas de problème ou pour toute question, contactez-nous à <a href="mailto:${process.env.ADMIN_EMAIL}">${process.env.ADMIN_EMAIL}</a></p>
        </div>
        <div class="footer">
          <p>CDO 94 - Conseil Départemental de l'Ordre des Chirurgiens-Dentistes du Val-de-Marne</p>
        </div>
      </div>
    </body>
    </html>
  `;
}

// Démarrage du serveur
app.listen(PORT, () => {
  console.log(`🚀 Serveur démarré sur http://localhost:${PORT}`);
});
