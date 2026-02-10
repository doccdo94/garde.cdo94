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

// Auto-initialisation de la base de données
(async () => {
  try {
    // Nouvelle structure : inscriptions individuelles
    await pool.query(`
      CREATE TABLE IF NOT EXISTS inscriptions (
        id SERIAL PRIMARY KEY,
        date_garde DATE NOT NULL,
        praticien_nom VARCHAR(100) NOT NULL,
        praticien_prenom VARCHAR(100) NOT NULL,
        praticien_email VARCHAR(100) NOT NULL,
        praticien_telephone VARCHAR(20) NOT NULL,
        praticien_rpps VARCHAR(20) NOT NULL,
        praticien_numero VARCHAR(10) NOT NULL,
        praticien_voie VARCHAR(200) NOT NULL,
        praticien_code_postal VARCHAR(10) NOT NULL,
        praticien_ville VARCHAR(100) NOT NULL,
        praticien_etage VARCHAR(50),
        praticien_code_entree VARCHAR(50),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_date_garde ON inscriptions(date_garde);
      CREATE INDEX IF NOT EXISTS idx_praticien_email ON inscriptions(praticien_email);
    `);
    console.log('✅ Tables vérifiées/créées (inscriptions individuelles)');
  } catch (err) {
    console.error('Erreur init DB:', err);
  }
})();

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
    // Récupérer les dates avec le nombre de praticiens inscrits
    const result = await pool.query(`
      SELECT date_garde, COUNT(*) as nb_inscrits 
      FROM inscriptions 
      GROUP BY date_garde
      HAVING COUNT(*) < 2
    `);
    
    const datesAvecStatut = {};
    result.rows.forEach(row => {
      datesAvecStatut[row.date_garde.toISOString().split('T')[0]] = {
        nb_inscrits: parseInt(row.nb_inscrits),
        places_restantes: 2 - parseInt(row.nb_inscrits)
      };
    });
    
    // Générer toutes les dates de dimanches et jours fériés 2027
    const toutesLesDates = genererDatesGarde2027();
    
    // Filtrer : garder les dates qui ont 0 ou 1 inscription
    const datesDisponibles = toutesLesDates.map(date => {
      const statut = datesAvecStatut[date.value];
      return {
        ...date,
        nb_inscrits: statut ? statut.nb_inscrits : 0,
        places_restantes: statut ? statut.places_restantes : 2
      };
    }).filter(date => date.places_restantes > 0);
    
    res.json(datesDisponibles);
  } catch (error) {
    console.error('Erreur:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET - Vérifier le statut d'une date spécifique
app.get('/api/dates/:date/statut', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT COUNT(*) as nb_inscrits FROM inscriptions WHERE date_garde = $1',
      [req.params.date]
    );
    
    const nbInscrits = parseInt(result.rows[0].nb_inscrits);
    
    res.json({
      date: req.params.date,
      nb_inscrits: nbInscrits,
      places_restantes: 2 - nbInscrits,
      disponible: nbInscrits < 2
    });
  } catch (error) {
    console.error('Erreur:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET - Obtenir les praticiens déjà inscrits pour une date
app.get('/api/dates/:date/praticiens', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT praticien_nom, praticien_prenom, praticien_email 
       FROM inscriptions 
       WHERE date_garde = $1`,
      [req.params.date]
    );
    
    res.json(result.rows);
  } catch (error) {
    console.error('Erreur:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST - Créer une nouvelle inscription (1 seul praticien)
app.post('/api/inscriptions', async (req, res) => {
  const {
    dateGarde,
    praticien
  } = req.body;
  
  try {
    // Vérifier le nombre d'inscriptions pour cette date
    const checkResult = await pool.query(
      'SELECT COUNT(*) as nb FROM inscriptions WHERE date_garde = $1',
      [dateGarde]
    );
    
    const nbInscrits = parseInt(checkResult.rows[0].nb);
    
    if (nbInscrits >= 2) {
      return res.status(400).json({ 
        error: 'Cette date est complète (2 praticiens déjà inscrits)' 
      });
    }
    
    // Vérifier que ce praticien n'est pas déjà inscrit pour cette date
    const duplicateCheck = await pool.query(
      'SELECT * FROM inscriptions WHERE date_garde = $1 AND praticien_email = $2',
      [dateGarde, praticien.email]
    );
    
    if (duplicateCheck.rows.length > 0) {
      return res.status(400).json({ 
        error: 'Vous êtes déjà inscrit pour cette date' 
      });
    }
    
    // Insérer l'inscription
    const result = await pool.query(`
      INSERT INTO inscriptions (
        date_garde,
        praticien_nom, praticien_prenom, praticien_email, praticien_telephone, praticien_rpps,
        praticien_numero, praticien_voie, praticien_code_postal, praticien_ville,
        praticien_etage, praticien_code_entree
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
      ) RETURNING *
    `, [
      dateGarde,
      praticien.nom, praticien.prenom, praticien.email, praticien.telephone, praticien.rpps,
      praticien.numero, praticien.voie, praticien.codePostal, praticien.ville,
      praticien.etage, praticien.codeEntree
    ]);
    
    const nouvelleInscription = result.rows[0];
    
    // Vérifier si c'est le 1er ou le 2ème praticien
    const estPremier = nbInscrits === 0;
    const estComplet = nbInscrits === 1;
    
    // Récupérer le binôme s'il existe
    let binome = null;
    if (estComplet) {
      const binomeResult = await pool.query(
        `SELECT * FROM inscriptions 
         WHERE date_garde = $1 AND id != $2`,
        [dateGarde, nouvelleInscription.id]
      );
      binome = binomeResult.rows[0];
    }
    
    // Envoyer les emails de confirmation (ne pas bloquer si ça échoue)
    try {
      await envoyerEmailsConfirmation(nouvelleInscription, binome, estPremier, estComplet);
    } catch (emailError) {
      console.error('Erreur envoi email (non bloquant):', emailError.message);
      // On continue quand même, l'inscription est enregistrée
    }
    
    res.json({ 
      success: true, 
      inscription: nouvelleInscription,
      statut: estComplet ? 'complete' : 'partielle',
      message: estComplet 
        ? 'Inscription confirmée ! La garde est maintenant complète avec 2 praticiens.'
        : 'Inscription confirmée ! En attente d\'un 2ème praticien pour cette garde.'
    });
    
  } catch (error) {
    console.error('Erreur inscription:', error);
    res.status(500).json({ error: 'Erreur lors de l\'inscription' });
  }
});

// GET - Obtenir toutes les inscriptions (pour l'admin)
app.get('/api/inscriptions', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        i.*,
        (SELECT COUNT(*) FROM inscriptions i2 WHERE i2.date_garde = i.date_garde) as nb_praticiens_total
      FROM inscriptions i
      ORDER BY date_garde DESC, created_at ASC
    `);
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
        COUNT(DISTINCT date_garde) as dates_avec_inscriptions,
        COUNT(*) as total_inscriptions,
        COUNT(DISTINCT date_garde) FILTER (
          WHERE date_garde >= CURRENT_DATE 
          AND (SELECT COUNT(*) FROM inscriptions i2 WHERE i2.date_garde = inscriptions.date_garde) = 2
        ) as gardes_futures_completes,
        COUNT(DISTINCT date_garde) FILTER (
          WHERE date_garde >= CURRENT_DATE 
          AND (SELECT COUNT(*) FROM inscriptions i2 WHERE i2.date_garde = inscriptions.date_garde) = 1
        ) as gardes_futures_partielles,
        COUNT(DISTINCT date_garde) FILTER (
          WHERE date_garde < CURRENT_DATE
        ) as gardes_passees
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

async function envoyerEmailsConfirmation(inscription, binome, estPremier, estComplet) {
  const dateFormatee = formatDateFr(new Date(inscription.date_garde));
  
  // Email pour le praticien qui vient de s'inscrire
  const html = genererHtmlEmail(inscription, binome, dateFormatee, estPremier, estComplet);
  
  await transporter.sendMail({
    from: `"${process.env.EMAIL_FROM_NAME}" <${process.env.EMAIL_FROM}>`,
    to: inscription.praticien_email,
    cc: process.env.ADMIN_EMAIL,
    subject: `Confirmation inscription garde - ${dateFormatee}`,
    html: html
  });
  
  // Si la garde est maintenant complète, envoyer un email au premier praticien
  if (estComplet && binome) {
    const htmlBinome = genererHtmlEmailGardeComplete(binome, inscription, dateFormatee);
    await transporter.sendMail({
      from: `"${process.env.EMAIL_FROM_NAME}" <${process.env.EMAIL_FROM}>`,
      to: binome.praticien_email,
      cc: process.env.ADMIN_EMAIL,
      subject: `Garde complète - ${dateFormatee}`,
      html: htmlBinome
    });
  }
}

function genererHtmlEmail(inscription, binome, dateFormatee, estPremier, estComplet) {
  const praticien = {
    nom: inscription.praticien_nom,
    prenom: inscription.praticien_prenom,
    email: inscription.praticien_email,
    telephone: inscription.praticien_telephone,
    adresse: `${inscription.praticien_numero} ${inscription.praticien_voie}, ${inscription.praticien_code_postal} ${inscription.praticien_ville}`
  };
  
  let binomeSection = '';
  if (estComplet && binome) {
    binomeSection = `
      <div class="info-box">
        <h2>👥 Votre binôme</h2>
        <p><strong>Nom :</strong> ${binome.praticien_nom} ${binome.praticien_prenom}</p>
        <p><strong>Email :</strong> ${binome.praticien_email}</p>
        <p><strong>Téléphone :</strong> ${binome.praticien_telephone}</p>
        <p><strong>Adresse :</strong> ${binome.praticien_numero} ${binome.praticien_voie}, ${binome.praticien_code_postal} ${binome.praticien_ville}</p>
      </div>
    `;
  } else if (estPremier) {
    binomeSection = `
      <div class="info-box" style="background: #fff3cd; border-left-color: #ffc107;">
        <h2>⏳ En attente d'un 2ème praticien</h2>
        <p>Vous êtes actuellement le seul inscrit pour cette garde. Un email vous sera envoyé dès qu'un second praticien s'inscrira.</p>
      </div>
    `;
  }
  
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
          
          ${binomeSection}
          
          <div class="info-box">
            <h2>📋 Vos informations</h2>
            <p><strong>Nom :</strong> ${praticien.nom} ${praticien.prenom}</p>
            <p><strong>Email :</strong> ${praticien.email}</p>
            <p><strong>Téléphone :</strong> ${praticien.telephone}</p>
            <p><strong>Adresse :</strong> ${praticien.adresse}</p>
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

function genererHtmlEmailGardeComplete(binome, nouveauPraticien, dateFormatee) {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
        .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
        .info-box { background: white; padding: 20px; margin: 20px 0; border-left: 4px solid #10b981; border-radius: 5px; }
        .footer { text-align: center; margin-top: 30px; color: #666; font-size: 12px; }
        h1 { margin: 0; font-size: 24px; }
        h2 { color: #10b981; font-size: 18px; margin-top: 0; }
        strong { color: #10b981; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>🎉 Garde complète !</h1>
          <p style="margin: 10px 0 0 0; font-size: 18px;">Garde du ${dateFormatee}</p>
        </div>
        <div class="content">
          <p>Bonjour Dr ${binome.praticien_nom},</p>
          
          <p>Bonne nouvelle ! Un second praticien vient de s'inscrire pour la garde du <strong>${dateFormatee}</strong>.</p>
          
          <p>La garde est maintenant <strong>complète avec 2 praticiens</strong>.</p>
          
          <div class="info-box">
            <h2>👥 Votre binôme</h2>
            <p><strong>Nom :</strong> ${nouveauPraticien.praticien_nom} ${nouveauPraticien.praticien_prenom}</p>
            <p><strong>Email :</strong> ${nouveauPraticien.praticien_email}</p>
            <p><strong>Téléphone :</strong> ${nouveauPraticien.praticien_telephone}</p>
            <p><strong>Adresse :</strong> ${nouveauPraticien.praticien_numero} ${nouveauPraticien.praticien_voie}, ${nouveauPraticien.praticien_code_postal} ${nouveauPraticien.praticien_ville}</p>
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
