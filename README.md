# 🏥 Système de Gestion des Gardes Médicales - CDO 94

Système web moderne pour la gestion des inscriptions aux gardes médicales du Conseil Départemental de l'Ordre des Chirurgiens-Dentistes du Val-de-Marne.

## 📋 Fonctionnalités

### Pour les praticiens
- ✅ Formulaire d'inscription en 2 étapes intuitif
- ✅ Sélection des dates disponibles (dimanches + jours fériés 2027)
- ✅ Inscription par binôme (2 praticiens par garde)
- ✅ Email de confirmation automatique avec coordonnées du binôme
- ✅ Interface responsive (mobile, tablette, desktop)

### Pour l'administration
- ✅ Tableau de bord avec statistiques
- ✅ Liste complète des inscriptions
- ✅ Export CSV pour Excel
- ✅ Suppression d'inscriptions
- ✅ Visualisation des coordonnées complètes

### Technique
- ✅ Base de données PostgreSQL
- ✅ Serveur Node.js + Express
- ✅ Emails automatiques avec Nodemailer
- ✅ Design moderne et professionnel
- ✅ 100% RGPD-compatible
- ✅ Hébergement facile sur Render, Railway, etc.

---

## 🚀 Démarrage rapide

### Prérequis
- Node.js 16+ : https://nodejs.org
- PostgreSQL 12+ (seulement pour le mode complet)

### Installation

```bash
# 1. Cloner ou télécharger le projet
cd garde-cdo94

# 2. Installer les dépendances
npm install

# 3. Mode DÉMO (sans base de données) - idéal pour tester
npm run demo

# 4. OU Mode COMPLET (avec PostgreSQL)
# Copier et configurer les variables d'environnement
cp .env.example .env
# Éditer .env avec vos paramètres

# Créer la base de données
npm run init-db

# Démarrer le serveur
npm start
```

### Accès
- **Formulaire** : http://localhost:3000
- **Administration** : http://localhost:3000/admin.html

---

## ⚙️ Configuration (.env)

```env
# Port du serveur
PORT=3000

# Base de données PostgreSQL
DATABASE_URL=postgresql://username:password@localhost:5432/garde_cdo94

# Configuration email (Brevo recommandé - gratuit jusqu'à 300 emails/jour)
EMAIL_HOST=smtp-relay.brevo.com
EMAIL_PORT=587
EMAIL_USER=votre-email@example.com
EMAIL_PASS=votre-cle-api-brevo
EMAIL_FROM=noreply@cdo94.fr
EMAIL_FROM_NAME=CDO 94 - Gardes Médicales

# Email administrateur (copie de tous les emails)
ADMIN_EMAIL=doc.cdo94@gmail.com

# URL de base (pour les liens dans les emails)
BASE_URL=http://localhost:3000
```

---

## 📁 Structure du projet

```
garde-cdo94/
├── public/                  # Fichiers statiques (HTML, CSS, JS)
│   ├── index.html          # Formulaire d'inscription
│   ├── admin.html          # Interface d'administration
│   └── app.js              # JavaScript client
├── server.js               # Serveur principal (avec PostgreSQL)
├── server-demo.js          # Serveur démo (sans BDD)
├── init-db.js              # Initialisation base de données
├── package.json            # Dépendances Node.js
├── .env.example            # Template de configuration
├── .gitignore              # Fichiers à ignorer par Git
├── GUIDE-DEMARRAGE.md      # Guide pas à pas pour débutants
└── README.md               # Ce fichier
```

---

## 🗄️ Base de données

### Schéma de la table `inscriptions`

| Colonne | Type | Description |
|---------|------|-------------|
| id | SERIAL | Identifiant unique |
| date_garde | DATE | Date de la garde |
| praticien1_nom | VARCHAR | Nom du premier praticien |
| praticien1_email | VARCHAR | Email du premier praticien |
| praticien1_telephone | VARCHAR | Téléphone du premier praticien |
| praticien1_rpps | VARCHAR | Numéro RPPS |
| praticien1_numero | VARCHAR | Numéro de rue |
| praticien1_voie | VARCHAR | Nom de la rue |
| praticien1_code_postal | VARCHAR | Code postal |
| praticien1_ville | VARCHAR | Ville |
| praticien1_etage | VARCHAR | Étage/Bâtiment |
| praticien1_code_entree | VARCHAR | Code d'entrée |
| praticien2_* | ... | Mêmes champs pour le praticien 2 |
| created_at | TIMESTAMP | Date d'inscription |

### Commandes utiles

```bash
# Créer/réinitialiser la base de données
npm run init-db

# Se connecter à la base (si PostgreSQL local)
psql -U username -d garde_cdo94
```

---

## 📧 Configuration des emails

### Option recommandée : Brevo (gratuit)

1. Créer un compte sur https://www.brevo.com
2. Aller dans "SMTP & API" → "SMTP"
3. Copier les informations dans `.env`

**Avantages :**
- ✅ 300 emails/jour gratuits
- ✅ Fiable et rapide
- ✅ Interface simple
- ✅ Hébergé en Europe (RGPD)

### Autres options
- **SendGrid** : 100 emails/jour gratuits
- **Mailgun** : Payant mais puissant
- **SMTP Gmail** : Possible mais limitations strictes

---

## 🌐 Déploiement en production

### Sur Render.com (recommandé - gratuit)

1. Créer un compte sur https://render.com
2. Connecter votre dépôt GitHub
3. Créer un **Web Service** :
   - Build Command : `npm install`
   - Start Command : `npm start`
4. Créer une **PostgreSQL Database** (gratuite)
5. Ajouter les variables d'environnement dans Render
6. Déployer ! 🚀

**Limites version gratuite :**
- Le serveur s'endort après 15 min d'inactivité
- Redémarre en ~30 sec à la première visite
- Suffisant pour usage CDO 94

### Sur Railway.app

1. Créer un compte sur https://railway.app
2. Créer un nouveau projet
3. Ajouter PostgreSQL
4. Déployer depuis GitHub
5. Configurer les variables d'environnement

**Avantages :**
- 5$ de crédit gratuit/mois
- Pas de mise en veille
- Très simple

### Sur VPS (Infomaniak, OVH) - Production complète

Pour une solution 100% professionnelle et RGPD :
- Infomaniak : ~8€/mois
- OVH : ~5€/mois
- Contrôle total
- Pas de limitations

---

## 🎨 Personnalisation

### Modifier les couleurs

Éditer `public/index.html` et `public/admin.html` :

```css
:root {
  --primary: #2d5a8c;        /* Bleu principal */
  --primary-dark: #1e3a5f;   /* Bleu foncé */
  --accent: #e8925c;         /* Orange accent */
  --bg-light: #f8f6f3;       /* Fond clair */
  --success: #5a8c6f;        /* Vert succès */
  --error: #c74a4a;          /* Rouge erreur */
}
```

### Modifier les dates disponibles

Éditer `server.js` ou `server-demo.js` → fonction `genererDatesGarde2027()` :

```javascript
const joursFeries2027 = [
  '2027-01-01',  // Ajouter/modifier les jours fériés
  // ...
];
```

### Modifier les emails

Éditer `server.js` → fonction `genererHtmlEmail()` pour personnaliser le template.

---

## 🔒 Sécurité et RGPD

### Mesures de sécurité
- ✅ Pas de faille SQL (requêtes préparées)
- ✅ HTTPS en production (via Render/Railway)
- ✅ Variables sensibles dans `.env` (pas dans Git)
- ✅ Validation des données côté serveur

### Conformité RGPD
- ✅ Données hébergées en EU (Render EU/Railway EU)
- ✅ Pas de cookies de tracking
- ✅ Données minimales collectées
- ✅ Possibilité de suppression (admin)
- ✅ Emails avec consentement implicite (inscription volontaire)

**Pour production CDO 94 :**
→ Utiliser hébergeur certifié HDS (Infomaniak, OVH) pour données de santé

---

## 🐛 Dépannage

### Le serveur ne démarre pas

```bash
# Vérifier Node.js
node --version  # Doit être >= 16

# Réinstaller les dépendances
rm -rf node_modules package-lock.json
npm install

# Vérifier les permissions
chmod +x server.js
```

### Erreur de connexion PostgreSQL

```bash
# Vérifier que PostgreSQL tourne
# Mac :
brew services start postgresql

# Linux :
sudo systemctl start postgresql

# Windows :
# Démarrer via le panneau de services
```

### Port 3000 déjà utilisé

```bash
# Utiliser un autre port
PORT=3001 npm start
```

### Les emails ne partent pas

1. Vérifier `.env` → EMAIL_* sont corrects
2. Tester la connexion SMTP manuellement
3. Vérifier les logs du serveur pour les erreurs
4. En mode démo, les emails ne sont PAS envoyés (normal)

---

## 📞 Support

- **Documentation** : Lire GUIDE-DEMARRAGE.md
- **Bugs** : Ouvrir une issue sur GitHub
- **Questions** : Contacter l'équipe technique CDO 94

---

## 📜 Licence

Projet développé pour le CDO 94.
Tous droits réservés © 2027 CDO Val-de-Marne.

---

## 🎉 Crédits

Développé avec ❤️ pour faciliter la vie des chirurgiens-dentistes du Val-de-Marne.

**Technologies utilisées :**
- Node.js + Express
- PostgreSQL
- Nodemailer
- HTML5 + CSS3 + Vanilla JS

**Design :**
- Fonts : Crimson Pro + Work Sans (Google Fonts)
- Couleurs inspirées de la charte CDO

---

**Version :** 1.0.0  
**Dernière mise à jour :** Février 2026
