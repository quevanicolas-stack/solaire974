/* ==================================================================
   Fluent & Forward — landing « Stop Avoiding - English Essentials »

   Le téléchargement du guide est conditionné au renseignement du
   prénom et de l'adresse email. À la validation :
     1. le contact est enregistré (collecteur distant + copie locale) ;
     2. le PDF est téléchargé immédiatement.
   ================================================================== */

(function () {
  "use strict";

  /* ------------------------------------------------------------------
     RÉGLAGES — le seul bloc à modifier

     fichier   : le PDF remis au prospect.
     collecteur: l'adresse qui reçoit et archive les contacts.
     ------------------------------------------------------------------ */
  var REGLAGES = {
    fichier: "assets/stop-avoiding-english-essentials.pdf",
    nomFichier: "Stop-Avoiding-English-Essentials.pdf",
    collecteur: "https://script.google.com/macros/s/AKfycbwg_-N5wG5108h1O2mqxfWmsFOeUDO_cp8XDzdzyCTCBQ3PZn7zTqqC6006yeAm1rh7/exec",
    /* Le parcours est journalisé par le script du site, et non par celui
       du guide : un seul endroit à tenir à jour, une seule feuille à
       lire. Le contact, lui, continue d'aller au collecteur ci-dessus. */
    journal: "https://script.google.com/macros/s/AKfycbwK0XxvWhNiwoWVsROAHi7EFQFRMymFOcH5gxV-KSZ3C5F39DPcT1YxSp83iJq9oMbO/exec"
  };

  /* ---------- Parcours ----------
     Même principe que sur le site : rien n'est écrit sur l'appareil du
     visiteur. Le numéro de visite est tiré au hasard au chargement et
     meurt avec l'onglet ; il ne relie jamais deux visites. Les étapes
     sont accumulées et envoyées en un seul appel. */

  var VISITE = Math.random().toString(36).slice(2, 10);
  var DEPART = Date.now();
  var PARCOURS = [];
  var dejaEnvoye = 0;

  function noterEtape(nom) {
    if (PARCOURS.length >= 40) return;
    PARCOURS.push(nom + " " + Math.round((Date.now() - DEPART) / 1000) + "s");
  }

  function envoyerParcours(motif) {
    if (PARCOURS.length <= dejaEnvoye || !REGLAGES.journal) return;
    dejaEnvoye = PARCOURS.length;
    var charge = JSON.stringify({
      type: "parcours",
      visite: VISITE,
      page: location.pathname,
      provenance: document.referrer || "direct",
      largeur: window.innerWidth,
      duree: Math.round((Date.now() - DEPART) / 1000),
      etapes: PARCOURS.join(" > "),
      motif: motif || "fermeture"
    });
    try {
      if (navigator.sendBeacon &&
          navigator.sendBeacon(REGLAGES.journal,
            new Blob([charge], { type: "text/plain;charset=utf-8" }))) return;
    } catch (e) {}
    try {
      fetch(REGLAGES.journal, { method: "POST", mode: "no-cors", keepalive: true,
        headers: { "Content-Type": "text/plain;charset=utf-8" }, body: charge });
    } catch (e) {}
  }

  /* ---------- Outils ---------- */

  function emailPlausible(valeur) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(valeur);
  }

  function afficherErreur(champ, idMessage, actif) {
    var message = document.getElementById(idMessage);
    if (message) message.classList.toggle("visible", actif);
    if (champ) champ.setAttribute("aria-invalid", actif ? "true" : "false");
  }

  function afficherRetour(formulaire, texte) {
    var zone = formulaire.querySelector(".retour-formulaire");
    if (!zone) return;
    zone.textContent = texte;
    zone.classList.add("visible");
  }

  /* ---------- Envoi au collecteur ---------- */

  function envoyerAuCollecteur(contact) {
    if (!REGLAGES.collecteur) return Promise.resolve(false);
    return fetch(REGLAGES.collecteur, {
      method: "POST",
      // text/plain évite la requête préalable CORS, que Google Apps Script
      // et la plupart des scripts d'hébergement mutualisé ne gèrent pas.
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(contact)
    }).then(function (reponse) {
      return reponse.ok;
    }).catch(function () {
      return false;
    });
  }

  /* ---------- Téléchargement ---------- */

  function telechargerGuide() {
    var lien = document.createElement("a");
    lien.href = REGLAGES.fichier;
    lien.download = REGLAGES.nomFichier;
    document.body.appendChild(lien);
    lien.click();
    document.body.removeChild(lien);
  }

  /* ---------- Formulaires ---------- */

  function initFormulaire(formulaire) {
    var prenom = formulaire.querySelector("input[name=prenom]");
    var email = formulaire.querySelector("input[name=email]");
    var rappel = formulaire.querySelector("input[name=rappel]");
    var bouton = formulaire.querySelector("button[type=submit]");
    var idErrPrenom = prenom.getAttribute("aria-describedby");
    var idErrEmail = email.getAttribute("aria-describedby");
    var libelleBouton = bouton.textContent.trim();

    [[prenom, idErrPrenom], [email, idErrEmail]].forEach(function (paire) {
      paire[0].addEventListener("input", function () {
        if (paire[0].getAttribute("aria-invalid") === "true") {
          afficherErreur(paire[0], paire[1], false);
        }
      });
    });

    formulaire.addEventListener("submit", function (evenement) {
      evenement.preventDefault();

      var prenomVide = prenom.value.trim() === "";
      var emailInvalide = !emailPlausible(email.value.trim());

      afficherErreur(prenom, idErrPrenom, prenomVide);
      afficherErreur(email, idErrEmail, emailInvalide);

      if (prenomVide || emailInvalide) {
        (prenomVide ? prenom : email).focus();
        return;
      }

      noterEtape("guide demandé (" +
        (formulaire.getAttribute("data-origine") || "inconnue") + ")");

      var contact = {
        prenom: prenom.value.trim(),
        email: email.value.trim(),
        date: new Date().toISOString(),
        /* Envoyer le formulaire EST la demande : c'est cette démarche
           qui vaut accord pour la remise du guide, et le collecteur
           attend toujours ce drapeau. La suite repose sur l'intérêt
           légitime, avec l'information donnée sous le bouton. */
        consentementRgpd: true,
        accepteProspection: true,
        demandeRappel: !!(rappel && rappel.checked),
        origine: formulaire.getAttribute("data-origine") || "inconnue",
        provenance: document.referrer || "direct",
        page: location.href,
        visite: VISITE,
        parcours: PARCOURS.join(" > ")
      };

      envoyerParcours("guide demandé");

      bouton.disabled = true;
      bouton.textContent = "Préparation du guide…";

      envoyerAuCollecteur(contact).then(function (transmis) {
        telechargerGuide();
        formulaire.reset();
        bouton.disabled = false;
        bouton.textContent = libelleBouton;
        afficherRetour(formulaire,
          transmis || !REGLAGES.collecteur
            ? "C'est parti, " + contact.prenom + " — ton guide est en cours de téléchargement."
            : "Ton guide est en cours de téléchargement. L'enregistrement du contact n'a pas abouti, il a été conservé localement.");
      });
    });
  }


  /* ---------- Bascule WhatsApp ----------
     Le lien pointe sur whatsapp:// pour ouvrir l'application sans passer par
     la page de redirection de wa.me. Si l'application n'est pas installée,
     rien ne se produit : on bascule alors sur l'adresse web de secours. */

  function initWhatsApp() {
    /* Le numéro n'étant plus écrit dans la page, l'adresse de secours
       n'apparaît qu'au moment du clic, sous forme de data-repli. Au
       chargement, seul data-wa-repli existe : il faut donc sélectionner
       les deux, sinon plus aucun lien n'est équipé. Le script qui
       recompose le numéro écoute le clic en phase de capture, donc
       data-repli est bien posé quand ce gestionnaire-ci s'exécute. */
    var liens = document.querySelectorAll("a[data-repli], a[data-wa-repli]");

    for (var i = 0; i < liens.length; i++) {
      liens[i].addEventListener("click", function (evenement) {
        var lien = evenement.currentTarget;
        var repli = lien.getAttribute("data-repli");
        if (!repli) return;

        var bascule = false;
        // Si l'application s'ouvre, l'onglet passe en arrière-plan :
        // c'est le signal qu'aucun repli n'est nécessaire.
        function onQuitte() { bascule = true; }
        window.addEventListener("blur", onQuitte, { once: true });
        document.addEventListener("visibilitychange", onQuitte, { once: true });

        setTimeout(function () {
          window.removeEventListener("blur", onQuitte);
          document.removeEventListener("visibilitychange", onQuitte);
          if (!bascule && !document.hidden) window.location.href = repli;
        }, 1400);
      });
    }
  }

  /* ---------- Année du pied de page ---------- */

  function initAnnee() {
    var cibles = document.querySelectorAll(".annee-courante");
    var annee = String(new Date().getFullYear());
    for (var i = 0; i < cibles.length; i++) cibles[i].textContent = annee;
  }

  document.addEventListener("DOMContentLoaded", function () {
    var formulaires = document.querySelectorAll(".formulaire-guide");
    for (var i = 0; i < formulaires.length; i++) initFormulaire(formulaires[i]);
    initWhatsApp();
    initAnnee();

    noterEtape("arrivée");
    /* Première frappe dans un champ : la personne a commencé à remplir.
       C'est l'étape qui sépare « a lu la page » de « a essayé ». */
    var commence = false;
    document.addEventListener("input", function () {
      if (commence) return;
      commence = true;
      noterEtape("formulaire commencé");
    }, true);
    window.addEventListener("pagehide", function () { envoyerParcours("fermeture"); });
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") envoyerParcours("fermeture");
    });
  });
})();
