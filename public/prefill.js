// ========== PRÉ-REMPLISSAGE DU FORMULAIRE D'INSCRIPTION (CDO 94) ==========
// Chargé APRÈS app.js. Si le lien contient un jeton personnel (?d=...), on récupère
// les coordonnées du praticien (fichier ONCD importé dans la campagne, ou inscription
// annulée par le CDO) et on remplit les champs restés vides. Tous les champs restent
// modifiables : le praticien corrige si besoin avant de valider.
(function () {
  const params = new URLSearchParams(window.location.search);
  const jeton = params.get('d');
  const token = params.get('token');
  if (!jeton || !token) return;

  const CHAMPS = {
    nom: 'praticien-nom',
    prenom: 'praticien-prenom',
    email: 'praticien-email',
    telephone: 'praticien-telephone',
    rpps: 'praticien-rpps',
    numero: 'praticien-numero',
    voie: 'praticien-voie',
    codePostal: 'praticien-codePostal',
    ville: 'praticien-ville',
    etage: 'praticien-etage',
    codeEntree: 'praticien-codeEntree'
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function remplir(p) {
    let nb = 0;
    for (const [cle, id] of Object.entries(CHAMPS)) {
      const el = document.getElementById(id);
      const val = p[cle];
      if (!el) continue;
      el.removeAttribute('readonly');
      el.removeAttribute('disabled');
      if (!val) continue;
      if (el.value && el.value.trim() !== '') continue;   // ne jamais écraser une saisie
      el.value = String(val).slice(0, el.maxLength > 0 ? el.maxLength : 500);
      el.classList.add('prefilled');
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.addEventListener('input', () => el.classList.remove('prefilled'), { once: true });
      nb++;
    }
    return nb;
  }

  function bandeaux(p, nb) {
    const style = document.createElement('style');
    style.textContent = `
      input.prefilled { background: #f0f9ff; border-color: #93c5fd !important; }
      .prefill-note { background:#ecfdf5; border-left:4px solid #10b981; border-radius:6px; padding:12px 15px; margin-bottom:20px; color:#065f46; font-size:14px; line-height:1.5; }
      .prefill-note.annulation { background:#fffbeb; border-left-color:#f59e0b; color:#92400e; }`;
    document.head.appendChild(style);

    // Étape 1 : rappel de l'identité (et de la garde annulée le cas échéant)
    const corps1 = document.querySelector('#step-1 .card-body');
    if (corps1 && (p.nom || p.prenom)) {
      const n = document.createElement('div');
      n.className = 'prefill-note' + (p.source === 'reinvitation' ? ' annulation' : '');
      let html = `👋 Inscription pour <strong>Dr ${esc(p.prenom)} ${esc(p.nom)}</strong>`;
      if (p.rpps) html += ` <span style="opacity:.8">(RPPS ${esc(p.rpps)})</span>`;
      if (p.source === 'reinvitation' && p.date_annulee) {
        const d = new Date(String(p.date_annulee).split('T')[0] + 'T12:00:00');
        const lib = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
        html += `<br>Votre garde du <strong>${esc(lib)}</strong> a été annulée : merci de choisir une nouvelle date.`;
      }
      n.innerHTML = html;
      corps1.insertBefore(n, corps1.firstChild);
    }

    // Étape 2 : coordonnées pré-remplies, à vérifier
    const corps2 = document.querySelector('#step-2 .card-body');
    if (corps2 && nb > 0) {
      const n = document.createElement('div');
      n.className = 'prefill-note';
      n.innerHTML = '✏️ Vos coordonnées ont été <strong>pré-remplies</strong> (champs en bleu) à partir des informations dont dispose le Conseil de l\'Ordre. <strong>Vérifiez-les et corrigez-les</strong> si nécessaire avant de continuer.';
      corps2.insertBefore(n, corps2.firstChild);
    }
  }

  async function charger() {
    try {
      const r = await fetch(`/api/prefill?token=${encodeURIComponent(token)}&d=${encodeURIComponent(jeton)}`);
      if (!r.ok) return;   // lien ancien ou inconnu : formulaire vierge, comme avant
      const p = await r.json();
      // Laisse app.js finir sa propre initialisation (email depuis l'URL, etc.)
      setTimeout(() => { const nb = remplir(p); bandeaux(p, nb); }, 50);
    } catch (e) { /* silencieux : le formulaire reste utilisable à la main */ }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', charger);
  else charger();
})();
