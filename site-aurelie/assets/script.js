/* ------------------------------------------------------------------
   Site Aurélie — cours d'anglais professionnel
   Script commun : menu mobile, année du pied de page, formulaire.
   ------------------------------------------------------------------ */

(function () {
  "use strict";

  /* --- Menu mobile ------------------------------------------------ */
  function initMenu() {
    var bouton = document.querySelector(".bouton-menu");
    var navigation = document.querySelector(".navigation");
    if (!bouton || !navigation) return;

    bouton.addEventListener("click", function () {
      var ouvert = navigation.classList.toggle("ouvert");
      bouton.setAttribute("aria-expanded", ouvert ? "true" : "false");
      bouton.textContent = ouvert ? "Fermer" : "Menu";
    });

    // Referme le menu après un clic sur un lien (navigation mobile).
    navigation.addEventListener("click", function (evenement) {
      if (evenement.target.tagName === "A") {
        navigation.classList.remove("ouvert");
        bouton.setAttribute("aria-expanded", "false");
        bouton.textContent = "Menu";
      }
    });
  }

  /* --- Année courante dans le pied de page ------------------------ */
  function initAnnee() {
    var cibles = document.querySelectorAll(".annee-courante");
    var annee = String(new Date().getFullYear());
    for (var i = 0; i < cibles.length; i++) {
      cibles[i].textContent = annee;
    }
  }

  /* --- Formulaire de contact --------------------------------------
     Le site est statique : aucun serveur ne reçoit les messages.
     Le formulaire compose donc un courriel pré-rempli que le visiteur
     envoie depuis sa propre messagerie.
     Pour un envoi automatique, brancher un service tiers (voir README).
     ------------------------------------------------------------------ */
  function initFormulaire() {
    var formulaire = document.getElementById("formulaire-contact");
    if (!formulaire) return;

    var message = document.getElementById("message-formulaire");
    var destinataire = formulaire.getAttribute("data-destinataire") || "";

    formulaire.addEventListener("submit", function (evenement) {
      evenement.preventDefault();

      if (!formulaire.checkValidity()) {
        formulaire.reportValidity();
        return;
      }

      var donnees = new FormData(formulaire);
      var nom = (donnees.get("nom") || "").toString().trim();
      var societe = (donnees.get("societe") || "").toString().trim();
      var courriel = (donnees.get("courriel") || "").toString().trim();
      var telephone = (donnees.get("telephone") || "").toString().trim();
      var besoin = (donnees.get("besoin") || "").toString().trim();
      var effectif = (donnees.get("effectif") || "").toString().trim();
      var texte = (donnees.get("message") || "").toString().trim();

      var lignes = [
        "Nom : " + nom,
        "Société : " + (societe || "non renseignée"),
        "Courriel : " + courriel,
        "Téléphone : " + (telephone || "non renseigné"),
        "Besoin : " + besoin,
        "Nombre de participants : " + (effectif || "non renseigné"),
        "",
        "Message :",
        texte
      ];

      var sujet = "Demande de renseignements — " + (societe || nom);
      var lien = "mailto:" + encodeURIComponent(destinataire) +
        "?subject=" + encodeURIComponent(sujet) +
        "&body=" + encodeURIComponent(lignes.join("\n"));

      window.location.href = lien;

      if (message) {
        message.textContent = "Votre messagerie va s'ouvrir avec la demande pré-remplie. " +
          "Il ne reste qu'à l'envoyer. Si rien ne se passe, écrivez directement à " +
          destinataire + ".";
        message.classList.add("visible");
      }
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    initMenu();
    initAnnee();
    initFormulaire();
  });
})();
