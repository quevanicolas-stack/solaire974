/* ==================================================================
   Page interne « Prospects » — lecture de la copie locale de secours.
   Externalisé pour permettre une politique CSP sans 'unsafe-inline'
   sur les scripts.
   ================================================================== */

(function () {
  "use strict";
  var CLE = "ff_prospects";

  function lire() {
    try { return JSON.parse(localStorage.getItem(CLE) || "[]"); }
    catch (e) { return []; }
  }

  function echapper(t) {
    return String(t).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function afficher() {
    var liste = lire();
    var tuiles = document.getElementById("tuiles");
    var zone = document.getElementById("zone-tableau");

    var uniques = {};
    var prospection = 0;
    var rappels = 0;
    liste.forEach(function (c) {
      uniques[String(c.email).toLowerCase()] = true;
      if (c.accepteProspection) prospection++;
      if (c.demandeRappel) rappels++;
    });

    tuiles.innerHTML =
      tuile(liste.length, "téléchargements") +
      tuile(Object.keys(uniques).length, "adresses uniques") +
      tuile(prospection, "acceptent la prospection") +
      tuile(rappels, "demandent à être rappelés");

    if (!liste.length) {
      zone.innerHTML = '<div class="vide">Aucun contact enregistré sur ce navigateur pour le moment.</div>';
      return;
    }

    var lignes = liste.slice().reverse().map(function (c) {
      return "<tr>" +
        '<td class="date">' + echapper((c.date || "").replace("T", " ").slice(0, 16)) + "</td>" +
        "<td>" + echapper(c.prenom) + "</td>" +
        "<td>" + echapper(c.email) + "</td>" +
        '<td class="oui-non">' + (c.accepteProspection ? "oui" : "non") + "</td>" +
        '<td class="oui-non">' + (c.demandeRappel ? "oui" : "non") + "</td>" +
        "<td>" + echapper(c.origine) + "</td>" +
        "<td>" + echapper(c.provenance) + "</td>" +
        "</tr>";
    }).join("");

    zone.innerHTML =
      '<div class="tableau-enveloppe"><table>' +
      "<thead><tr><th>Date</th><th>Prénom</th><th>Email</th><th>Prospection</th><th>Rappel</th><th>Formulaire</th><th>Provenance</th></tr></thead>" +
      "<tbody>" + lignes + "</tbody></table></div>";
  }

  function tuile(valeur, libelle) {
    return '<div class="tuile"><div class="valeur">' + valeur +
           '</div><div class="libelle">' + libelle + "</div></div>";
  }

  document.getElementById("exporter").addEventListener("click", function () {
    var liste = lire();
    if (!liste.length) { alert("Aucun contact à exporter."); return; }

    var champs = ["date", "prenom", "email", "consentementRgpd", "accepteProspection", "demandeRappel", "origine", "provenance"];
    var lignes = [champs.join(";")].concat(liste.map(function (c) {
      return champs.map(function (f) {
        var v = c[f];
        // Les booléens sont exportés en oui/non, lisibles dans un tableur.
        if (typeof v === "boolean") v = v ? "oui" : "non";
        return '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"';
      }).join(";");
    }));

    // BOM UTF-8 pour qu'Excel affiche correctement les accents.
    var blob = new Blob(["﻿" + lignes.join("\r\n")], { type: "text/csv;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var lien = document.createElement("a");
    lien.href = url;
    lien.download = "prospects-fluent-forward.csv";
    document.body.appendChild(lien);
    lien.click();
    document.body.removeChild(lien);
    URL.revokeObjectURL(url);
  });

  document.getElementById("vider").addEventListener("click", function () {
    if (!confirm("Vider la liste conservée sur ce navigateur ? Cette action est définitive.")) return;
    localStorage.removeItem(CLE);
    afficher();
  });

  afficher();
})();
