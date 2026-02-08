require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function initDatabase() {
  const client = await pool.connect();
  
  try {
    console.log('🔧 Initialisation de la base de données...');
    
    // Créer la table des inscriptions
    await client.query(`
      CREATE TABLE IF NOT EXISTS inscriptions (
        id SERIAL PRIMARY KEY,
        date_garde DATE NOT NULL UNIQUE,
        praticien1_nom VARCHAR(255) NOT NULL,
        praticien1_email VARCHAR(255) NOT NULL,
        praticien1_telephone VARCHAR(20) NOT NULL,
        praticien1_rpps VARCHAR(20),
        praticien1_numero VARCHAR(10),
        praticien1_voie VARCHAR(255),
        praticien1_code_postal VARCHAR(10),
        praticien1_ville VARCHAR(100),
        praticien1_etage VARCHAR(50),
        praticien1_code_entree VARCHAR(50),
        praticien2_nom VARCHAR(255) NOT NULL,
        praticien2_email VARCHAR(255) NOT NULL,
        praticien2_telephone VARCHAR(20) NOT NULL,
        praticien2_rpps VARCHAR(20),
        praticien2_numero VARCHAR(10),
        praticien2_voie VARCHAR(255),
        praticien2_code_postal VARCHAR(10),
        praticien2_ville VARCHAR(100),
        praticien2_etage VARCHAR(50),
        praticien2_code_entree VARCHAR(50),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    
    console.log('✅ Table "inscriptions" créée avec succès');
    
    // Créer un index sur la date de garde pour des recherches rapides
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_date_garde ON inscriptions(date_garde);
    `);
    
    console.log('✅ Index créé avec succès');
    console.log('🎉 Base de données initialisée !');
    
  } catch (error) {
    console.error('❌ Erreur lors de l\'initialisation:', error);
  } finally {
    client.release();
    await pool.end();
  }
}

initDatabase();
