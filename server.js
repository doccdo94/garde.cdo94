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
    await pool.query(`
      CREATE TABLE IF NOT EXISTS inscriptions (
        id SERIAL PRIMARY KEY,
        date_garde DATE NOT NULL,
        praticien1_nom VARCHAR(100) NOT NULL,
        praticien1_prenom VARCHAR(100) NOT NULL,
        praticien1_tel VARCHAR(20) NOT NULL,
        praticien1_email VARCHAR(100) NOT NULL,
        praticien2_nom VARCHAR(100) NOT NULL,
        praticien2_prenom VARCHAR(100) NOT NULL,
        praticien2_tel VARCHAR(20) NOT NULL,
        praticien2_email VARCHAR(100) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_date_garde ON inscriptions(date_garde);
    `);
    console.log('✅ Tables vérifiées/créées');
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

// ... (le reste du code reste identique)
