require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const nodemailer = require('nodemailer');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');

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
    // Table inscriptions avec suivi emails
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
        email_confirmation_envoi_at TIMESTAMP,
        email_confirmation_statut VARCHAR(20) DEFAULT 'non_envoye',
        email_binome_envoi_at TIMESTAMP,
        email_binome_statut VARCHAR(20) DEFAULT 'non_envoye',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_date_garde ON inscriptions(date_garde);
      CREATE INDEX IF NOT EXISTS idx_praticien_email ON inscriptions(praticien_email);
    `);
    
    // Table dates_garde
    await pool.query(`
      CREATE TABLE IF NOT EXISTS dates_garde (
        id SERIAL PRIMARY KEY,
        date DATE NOT NULL UNIQUE,
        type VARCHAR(50) NOT NULL,
        nom_jour_ferie VARCHAR(100),
        active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_date_garde_date ON dates_garde(date);
      CREATE INDEX IF NOT EXISTS idx_date_garde_active ON dates_garde(active);
    `);
    
    console.log('✅ Tables vérifiées/créées (inscriptions + emails + dates)');
  } catch (err) {
    console.error('Erreur init DB:', err);
  }
})();

// Configuration email via API Brevo avec pièces jointes
const BREVO_API_KEY = process.env.BREVO_API_KEY;
const EMAIL_FROM = process.env.EMAIL_FROM || 'doc.cdo94@gmail.com';
const EMAIL_FROM_NAME = process.env.EMAIL_FROM_NAME || 'CDO 94 - Gardes Médicales';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'doc.cdo94@gmail.com';

// ============================================
// CHARGEMENT DES PDF DEPUIS LE DISQUE LOCAL
// (les fichiers sont déployés avec le repo)
// ============================================
const DOCUMENTS_DIR = path.join(__dirname, 'Documents');

// Noms EXACTS des fichiers tels que sur GitHub
const DOCUMENTS_GARDE = [
  { fichier: 'fiche retour .pdf',                    nomEmail: 'Fiche-retour-indemnites.pdf' },
  { fichier: 'doc prat de garde.docx',               nomEmail: 'Document-praticien-de-garde.docx' },
  { fichier: 'Cadre-reglementaire v2 à valider.pdf', nomEmail: 'Cadre-reglementaire.pdf' },
  { fichier: 'attestation de participation.pdf',      nomEmail: 'Attestation-participation.pdf' }
];

// Charger les documents en mémoire au démarrage (une seule fois)
let DOCUMENTS_CHARGES = [];

function chargerDocuments() {
  DOCUMENTS_CHARGES = [];
  
  console.log(`📂 Dossier documents : ${DOCUMENTS_DIR}`);
  
  // Vérifier que le dossier existe
  if (!fs.existsSync(DOCUMENTS_DIR)) {
    console.error(`❌ Dossier "${DOCUMENTS_DIR}" introuvable !`);
    // Lister ce qui existe à la racine pour debug
    try {
      const contenuRacine = fs.readdirSync(__dirname);
      console.log('📁 Contenu de la racine :', contenuRacine.join(', '));
    } catch (e) {
      console.error('Impossible de lister la racine');
    }
    return;
  }
  
  // Lister le contenu réel du dossier pour debug
  try {
    const contenuDossier = fs.readdirSync(DOCUMENTS_DIR);
    console.log(`📁 Fichiers dans Documents/ : ${contenuDossier.join(', ')}`);
  } catch (e) {
    console.error('Impossible de lister Documents/');
  }
  
  for (const doc of DOCUMENTS_GARDE) {
    try {
      const cheminComplet = path.join(DOCUMENTS_DIR, doc.fichier);
      
      if (fs.existsSync(cheminComplet)) {
        const contenu = fs.readFileSync(cheminComplet);
        const base64 = contenu.toString('base64');
        
        DOCUMENTS_CHARGES.push({
          name: doc.nomEmail,
          content: base64
        });
        
        console.log(`✅ Document chargé : "${doc.fichier}" → ${doc.nomEmail} (${(contenu.length / 1024).toFixed(1)} KB)`);
      } else {
        console.error(`❌ Fichier introuvable : "${doc.fichier}"`);
      }
    } catch (error) {
      console.error(`❌ Erreur chargement "${doc.fichier}" :`, error.message);
    }
  }
  
  console.log(`📎 ${DOCUMENTS_CHARGES.length}/${DOCUMENTS_GARDE.length} documents chargés pour les pièces jointes`);
}

// Charger au démarrage
chargerDocuments();

async function envoyerEmailViaAPI(to, subject, html) {
  if (!BREVO_API_KEY) {
    console.log('BREVO_API_KEY manquant - emails désactivés');
    return false;
  }

  try {
    const emailData = {
      sender: {
        name: EMAIL_FROM_NAME,
        email: EMAIL_FROM
      },
      to: [
        { email: to }
      ],
      cc: [
        { email: ADMIN_EMAIL }
      ],
      subject: subject,
      htmlContent: html
    };
    
    // Ajouter les pièces jointes si disponibles
    if (DOCUMENTS_CHARGES.length > 0) {
      emailData.attachment = DOCUMENTS_CHARGES;
      console.log(`📎 ${DOCUMENTS_CHARGES.length} documents joints à l'email`);
    } else {
      console.log('⚠️ Aucun document à joindre (0 fichiers chargés)');
    }

    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': BREVO_API_KEY
      },
      body: JSON.stringify(emailData)
    });

    if (response.ok) {
      const result = await response.json();
      console.log(`✅ Email envoyé à ${to} avec ${DOCUMENTS_CHARGES.length} PJ - MessageId: ${result.messageId}`);
      return true;
    } else {
      const error = await response.text();
      console.error('❌ Erreur API Brevo:', response.status, error);
      return false;
    }
  } catch (error) {
    console.error('❌ Erreur envoi email Brevo:', error);
    return false;
  }
}

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));

// ========== ROUTES API ==========

// GET - Obtenir toutes les dates disponibles pour 2027
app.get('/api/dates-disponibles', async (req, res) => {
  try {
    // Récupérer les dates avec le nombre de praticiens inscrits
    const inscriptionsResult = await pool.query(`
      SELECT date_garde, COUNT(*) as nb_inscrits 
      FROM inscriptions 
      GROUP BY date_garde
    `);
    
    const datesAvecInscriptions = {};
    inscriptionsResult.rows.forEach(row => {
      datesAvecInscriptions[row.date_garde.toISOString().split('T')[0]] = {
        nb_inscrits: parseInt(row.nb_inscrits),
        places_restantes: 2 - parseInt(row.nb_inscrits)
      };
    });
    
    // Récupérer toutes les dates actives depuis la base de données
    const datesResult = await pool.query(`
      SELECT date, type, nom_jour_ferie 
      FROM dates_garde 
      WHERE active = true AND date >= CURRENT_DATE
      ORDER BY date ASC
    `);
    
    // Formater les dates et filtrer celles qui ont encore de la place
    const datesDisponibles = datesResult.rows.map(row => {
      const dateStr = row.date.toISOString().split('T')[0];
      const inscriptions = datesAvecInscriptions[dateStr];
      
      let label = formatDateFr(new Date(row.date));
      if (row.type === 'jour_ferie' && row.nom_jour_ferie) {
        label += ` (${row.nom_jour_ferie})`;
      }
      
      const nbInscrits = inscriptions ? inscriptions.nb_inscrits : 0;
      const placesRestantes = 2 - nbInscrits;
      
      return {
        label: label,
        value: dateStr,
        nb_inscrits: nbInscrits,
        places_restantes: placesRestantes
      };
    }).filter(date => date.places_restantes > 0);
    
    res.json(datesDisponibles);
  } catch (error) {
    console.error('Erreur dates-disponibles:', error);
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
        : 'Inscription confirmée ! Votre inscription a bien été enregistrée.'
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

// POST - Renvoyer l'email de confirmation (pour l'admin)
app.post('/api/inscriptions/:id/renvoyer-email', async (req, res) => {
  try {
    // Récupérer l'inscription
    const result = await pool.query('SELECT * FROM inscriptions WHERE id = $1', [req.params.id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Inscription non trouvée' });
    }
    
    const inscription = result.rows[0];
    
    // Vérifier si c'est le 1er ou 2ème praticien
    const countResult = await pool.query(
      'SELECT COUNT(*) as nb FROM inscriptions WHERE date_garde = $1 AND id < $2',
      [inscription.date_garde, inscription.id]
    );
    const estPremier = parseInt(countResult.rows[0].nb) === 0;
    
    // Récupérer le binôme si existe
    let binome = null;
    const binomeResult = await pool.query(
      'SELECT * FROM inscriptions WHERE date_garde = $1 AND id != $2',
      [inscription.date_garde, inscription.id]
    );
    if (binomeResult.rows.length > 0) {
      binome = binomeResult.rows[0];
    }
    
    const estComplet = binome !== null;
    const dateFormatee = formatDateFr(new Date(inscription.date_garde));
    
    // Générer et envoyer l'email via API
    const html = genererHtmlEmail(inscription, binome, dateFormatee, estPremier, estComplet);
    const subject = `[RENVOI] Confirmation inscription garde - ${dateFormatee}`;
    
    const success = await envoyerEmailViaAPI(inscription.praticien_email, subject, html);
    
    if (success) {
      // Mettre à jour le statut
      await pool.query(
        'UPDATE inscriptions SET email_confirmation_envoi_at = NOW(), email_confirmation_statut = $1 WHERE id = $2',
        ['envoye', inscription.id]
      );
      
      res.json({ success: true, message: 'Email renvoyé avec succès' });
    } else {
      // Enregistrer l'échec
      await pool.query(
        'UPDATE inscriptions SET email_confirmation_statut = $1 WHERE id = $2',
        ['erreur', inscription.id]
      );
      
      res.status(500).json({ error: 'Erreur lors de l\'envoi de l\'email' });
    }
    
  } catch (error) {
    console.error('Erreur renvoyer email:', error);
    
    // Enregistrer l'échec
    await pool.query(
      'UPDATE inscriptions SET email_confirmation_statut = $1 WHERE id = $2',
      ['erreur', req.params.id]
    );
    
    res.status(500).json({ error: 'Erreur lors de l\'envoi de l\'email' });
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

// ========== GESTION DES DATES ==========

// GET - Obtenir toutes les dates (pour l'admin)
app.get('/api/dates-garde', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        d.*,
        COUNT(i.id) as nb_inscriptions
      FROM dates_garde d
      LEFT JOIN inscriptions i ON d.date = i.date_garde
      GROUP BY d.id, d.date, d.type, d.nom_jour_ferie, d.active, d.created_at
      ORDER BY d.date ASC
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Erreur:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST - Ajouter une nouvelle date
app.post('/api/dates-garde', async (req, res) => {
  const { date, type, nom_jour_ferie } = req.body;
  
  try {
    const result = await pool.query(
      `INSERT INTO dates_garde (date, type, nom_jour_ferie, active) 
       VALUES ($1, $2, $3, true) 
       RETURNING *`,
      [date, type, nom_jour_ferie || null]
    );
    
    res.json({ success: true, date: result.rows[0] });
  } catch (error) {
    console.error('Erreur ajout date:', error);
    if (error.code === '23505') { // Duplicate key
      res.status(400).json({ error: 'Cette date existe déjà' });
    } else {
      res.status(500).json({ error: 'Erreur lors de l\'ajout' });
    }
  }
});

// PUT - Modifier une date
app.put('/api/dates-garde/:id', async (req, res) => {
  const { active, nom_jour_ferie } = req.body;
  
  try {
    const result = await pool.query(
      `UPDATE dates_garde 
       SET active = COALESCE($1, active),
           nom_jour_ferie = COALESCE($2, nom_jour_ferie)
       WHERE id = $3
       RETURNING *`,
      [active, nom_jour_ferie, req.params.id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Date non trouvée' });
    }
    
    res.json({ success: true, date: result.rows[0] });
  } catch (error) {
    console.error('Erreur modification date:', error);
    res.status(500).json({ error: 'Erreur lors de la modification' });
  }
});

// DELETE - Supprimer une date (seulement si aucune inscription)
app.delete('/api/dates-garde/:id', async (req, res) => {
  try {
    // Vérifier qu'il n'y a pas d'inscriptions
    const dateCheck = await pool.query(
      'SELECT date FROM dates_garde WHERE id = $1',
      [req.params.id]
    );
    
    if (dateCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Date non trouvée' });
    }
    
    const inscriptionsCheck = await pool.query(
      'SELECT COUNT(*) as nb FROM inscriptions WHERE date_garde = $1',
      [dateCheck.rows[0].date]
    );
    
    if (parseInt(inscriptionsCheck.rows[0].nb) > 0) {
      return res.status(400).json({ 
        error: 'Impossible de supprimer : des inscriptions existent pour cette date' 
      });
    }
    
    await pool.query('DELETE FROM dates_garde WHERE id = $1', [req.params.id]);
    res.json({ success: true });
    
  } catch (error) {
    console.error('Erreur suppression date:', error);
    res.status(500).json({ error: 'Erreur lors de la suppression' });
  }
});

// ========== FONCTIONS UTILITAIRES ==========

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
  const subject = `Confirmation inscription garde - ${dateFormatee}`;
  
  try {
    const success = await envoyerEmailViaAPI(inscription.praticien_email, subject, html);
    
    if (success) {
      // Enregistrer l'envoi réussi
      await pool.query(
        'UPDATE inscriptions SET email_confirmation_envoi_at = NOW(), email_confirmation_statut = $1 WHERE id = $2',
        ['envoye', inscription.id]
      );
    } else {
      // Enregistrer l'échec
      await pool.query(
        'UPDATE inscriptions SET email_confirmation_statut = $1 WHERE id = $2',
        ['erreur', inscription.id]
      );
      throw new Error('Échec envoi email via API');
    }
    
  } catch (error) {
    console.error('Erreur envoi email confirmation:', error);
    
    // Enregistrer l'échec
    await pool.query(
      'UPDATE inscriptions SET email_confirmation_statut = $1 WHERE id = $2',
      ['erreur', inscription.id]
    );
    
    throw error;
  }
  
  // Si la garde est maintenant complète, envoyer un email au premier praticien
  if (estComplet && binome) {
    const htmlBinome = genererHtmlEmailGardeComplete(binome, inscription, dateFormatee);
    const subjectBinome = `Garde complète - ${dateFormatee}`;
    
    try {
      const success = await envoyerEmailViaAPI(binome.praticien_email, subjectBinome, htmlBinome);
      
      if (success) {
        // Enregistrer l'envoi réussi du 2ème email
        await pool.query(
          'UPDATE inscriptions SET email_binome_envoi_at = NOW(), email_binome_statut = $1 WHERE id = $2',
          ['envoye', binome.id]
        );
      } else {
        // Enregistrer l'échec
        await pool.query(
          'UPDATE inscriptions SET email_binome_statut = $1 WHERE id = $2',
          ['erreur', binome.id]
        );
      }
      
    } catch (error) {
      console.error('Erreur envoi email binôme:', error);
      
      // Enregistrer l'échec
      await pool.query(
        'UPDATE inscriptions SET email_binome_statut = $1 WHERE id = $2',
        ['erreur', binome.id]
      );
    }
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
      <div class="info-box" style="background: #f0f9ff; border-left-color: #0ea5e9;">
        <h2>📋 Informations de garde</h2>
        <p>Votre inscription a bien été enregistrée. Vous recevrez un email complémentaire si un second praticien s'inscrit pour cette garde.</p>
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
          
          <div class="info-box" style="background: #f0fdf4; border-left-color: #16a34a;">
            <h2>📎 Documents joints</h2>
            <p>Vous trouverez en pièces jointes les documents suivants :</p>
            <ul>
              <li>Fiche de retour</li>
              <li>Document praticien de garde</li>
              <li>Cadre réglementaire</li>
              <li>Attestation de participation</li>
            </ul>
          </div>
          
          <p>En cas de problème ou pour toute question, contactez-nous à <a href="mailto:${ADMIN_EMAIL}">${ADMIN_EMAIL}</a></p>
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
          
          <p>En cas de problème ou pour toute question, contactez-nous à <a href="mailto:${ADMIN_EMAIL}">${ADMIN_EMAIL}</a></p>
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
