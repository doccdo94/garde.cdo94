# 🚀 GUIDE PAS À PAS - Installation du système de gardes CDO 94

Bienvenue Bob ! Ce guide va te permettre de tester ton système de gestion des gardes en **5 minutes chrono** ! ⏱️

---

## 📦 ÉTAPE 1 : Télécharger le projet

1. **Télécharge le dossier** `garde-cdo94` que je t'ai préparé
2. **Décompresse-le** sur ton ordinateur (par exemple dans `Documents/`)

---

## 🖥️ ÉTAPE 2 : Installer Node.js (si pas déjà fait)

### Tu as déjà Node.js ?
Ouvre un terminal et tape :
```bash
node --version
```

Si tu vois un numéro de version (ex: `v18.17.0`) → **Skip cette étape !** ✅

### Tu n'as pas Node.js ?
1. Va sur https://nodejs.org
2. Télécharge la version **LTS** (recommandée)
3. Installe-la (clique sur "Suivant" partout)
4. Redémarre ton terminal

---

## 🎯 ÉTAPE 3 : Lancer le serveur en mode DÉMO

### Sur Mac/Linux :
```bash
cd chemin/vers/garde-cdo94
npm install
npm run demo
```

### Sur Windows :
```cmd
cd chemin\vers\garde-cdo94
npm install
npm run demo
```

**C'est quoi `npm install` ?**
→ Ça installe toutes les bibliothèques nécessaires (comme quand tu installes une app sur ton téléphone)

**Attends environ 30 secondes...**

Tu devrais voir :
```
🚀 Serveur DÉMO démarré sur http://localhost:3000
📝 Mode démo: les données sont stockées en mémoire (pas de BDD)
📧 Les emails ne sont pas envoyés en mode démo
```

---

## 🎉 ÉTAPE 4 : Tester l'application

### Ouvre ton navigateur :
- **Formulaire d'inscription** : http://localhost:3000
- **Tableau de bord admin** : http://localhost:3000/admin.html

### Teste le formulaire :
1. Choisis une date de garde (ex: dimanche 10 janvier 2027)
2. Remplis les infos du praticien 1
3. Remplis les infos du praticien 2
4. Clique sur "Valider l'inscription"
5. **BOOM** ✨ → Message de confirmation !

### Teste l'admin :
1. Va sur http://localhost:3000/admin.html
2. Tu vois ton inscription dans le tableau
3. Tu peux l'exporter en CSV
4. Tu peux la supprimer

---

## ❓ EN CAS DE PROBLÈME

### Le serveur ne démarre pas ?
```bash
# Vérifie que tu es dans le bon dossier
pwd   # Mac/Linux
cd    # Windows

# Réessaye l'installation
npm install --force
npm run demo
```

### Port 3000 déjà utilisé ?
Quelqu'un d'autre utilise ce port. Change-le :
```bash
PORT=3001 npm run demo
```
Puis va sur http://localhost:3001

### Autre erreur ?
1. Copie le message d'erreur
2. Envoie-le moi
3. Je t'aide ! 😊

---

## 📁 STRUCTURE DU PROJET

```
garde-cdo94/
├── public/              ← Fichiers du site web
│   ├── index.html       ← Page du formulaire (TU PEUX LA MODIFIER)
│   ├── admin.html       ← Page d'administration
│   └── app.js           ← JavaScript du formulaire
├── server.js            ← Serveur avec base de données PostgreSQL
├── server-demo.js       ← Serveur sans base de données (DÉMO)
├── init-db.js           ← Script pour créer la base de données
├── package.json         ← Liste des dépendances
├── .env.example         ← Configuration (à copier en .env)
└── README.md            ← Documentation complète
```

---

## 🎨 PERSONNALISER LE DESIGN

Tu veux changer les couleurs ? Ouvre `public/index.html` et modifie les variables CSS :

```css
:root {
  --primary: #2d5a8c;        /* Bleu principal */
  --accent: #e8925c;         /* Couleur accent */
  --success: #5a8c6f;        /* Vert de confirmation */
  --error: #c74a4a;          /* Rouge d'erreur */
}
```

Sauvegarde → Rafraîchis ton navigateur → **C'est changé !** 🎨

---

## 📧 POUR ACTIVER LES EMAILS (optionnel pour le test)

1. Crée un compte gratuit sur https://www.brevo.com
2. Récupère ta clé API
3. Copie `.env.example` vers `.env`
4. Remplis les infos email dans `.env`
5. Lance avec `npm start` au lieu de `npm run demo`

---

## 🔥 PROCHAINES ÉTAPES

Une fois que tu as testé et que ça te plaît :

1. **On met ça sur Render** (hébergement gratuit en ligne)
2. **On configure PostgreSQL** (vraie base de données)
3. **On active les emails** (avec Brevo gratuit)
4. **On déploie en production** 🚀

---

## 💡 ASTUCES

- **Ctrl+C** dans le terminal pour arrêter le serveur
- **Rafraîchis la page** après avoir modifié le HTML/CSS
- **Redémarre le serveur** après avoir modifié le JavaScript
- Les données en mode démo **disparaissent** quand tu arrêtes le serveur (c'est normal !)

---

## ✅ CHECKLIST DE TEST

- [ ] Le formulaire s'affiche correctement
- [ ] Je peux sélectionner une date
- [ ] Je peux remplir les infos des 2 praticiens
- [ ] L'inscription fonctionne
- [ ] Je vois mon inscription dans l'admin
- [ ] Je peux exporter en CSV
- [ ] Je peux supprimer une inscription
- [ ] La date disparaît de la liste après inscription

---

**🎉 Bravo ! Tu as ton système de gardes qui tourne !**

Prochaine étape : on le met en ligne sur Render ! 🚀

Des questions ? Appelle-moi ! 📞
