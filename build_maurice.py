#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Construit maurice.html a partir de index.html (idempotent : repart toujours de index.html).
Adapte le calculateur solaire Reunion au marche mauricien :
  - devise Rs (MUR), prix kits x50, remises 150000/225000 Rs
  - donnees PVGIS Maurice (32 localites, facteurs orientation/inclinaison/saison)
  - grille tarifaire CEB par tranches (110A/110/120/140/commercial/industriel)
  - suppression TVA, prime EDF, revente du surplus
"""
import json, re, sys, os

# Placé à la racine du dépôt, à côté de index.html : régénère maurice.html à partir
# de index.html (Réunion). Toute évolution "Maurice" doit se faire DANS ce script,
# puis relancer `python3 build_maurice.py` — ne pas éditer maurice.html à la main.
HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "index.html")
DST = os.path.join(HERE, "maurice.html")

with open(SRC, encoding="utf-8") as f:
    html = f.read()

errors = []

def sub(label, old, new, expect=1):
    """Remplace old par new. expect=int -> compte exact ; None -> >=1, remplace tout."""
    global html
    n = html.count(old)
    if expect is None:
        if n < 1:
            errors.append(f"[{label}] introuvable (attendu >=1)")
            return
        html = html.replace(old, new)
    else:
        if n != expect:
            errors.append(f"[{label}] trouve {n}x, attendu {expect}x")
            return
        html = html.replace(old, new)

def sub_re(label, pattern, new, flags=re.DOTALL):
    global html
    m = re.search(pattern, html, flags)
    if not m:
        errors.append(f"[{label}] regex introuvable")
        return
    html = html[:m.start()] + new + html[m.end():]

# ─────────────────────────────────────────────────────────────────────────────
# 1) DONNEES PVGIS MAURICE  → COMMUNES
# ─────────────────────────────────────────────────────────────────────────────
# (nom, prod=P14_N kWh/kWc/an, lat, lng)  — PVGIS SARAH3, Nord 21°, pertes 14%, relief ON
MAURICE = [
    ("Port-Louis",              1371, -20.16, 57.50),
    ("Grand-Baie",              1559, -20.01, 57.58),
    ("Cap-Malheureux",          1561, -19.99, 57.61),
    ("Trou-aux-Biches",         1543, -20.03, 57.55),
    ("Triolet",                 1501, -20.06, 57.55),
    ("Pamplemousses",           1483, -20.10, 57.57),
    ("Rivière-du-Rempart",      1555, -20.05, 57.68),
    ("Centre-de-Flacq",         1502, -20.19, 57.72),
    ("Belle-Mare",              1526, -20.19, 57.76),
    ("Trou-d'Eau-Douce",        1502, -20.24, 57.79),
    ("Bel-Air-Rivière-Sèche",   1450, -20.25, 57.74),
    ("Mahébourg",               1514, -20.41, 57.70),
    ("Blue-Bay",                1512, -20.45, 57.71),
    ("Plaine-Magnien",          1495, -20.43, 57.66),
    ("Souillac",                1478, -20.52, 57.52),
    ("Surinam",                 1478, -20.51, 57.50),
    ("Bel-Ombre",               1462, -20.50, 57.40),
    ("Baie-du-Cap",             1413, -20.49, 57.38),
    ("Le Morne",                1402, -20.46, 57.31),
    ("Rivière-Noire",           1251, -20.36, 57.37),
    ("Tamarin",                 1410, -20.33, 57.37),
    ("Flic-en-Flac",            1442, -20.27, 57.37),
    ("Albion",                  1430, -20.21, 57.40),
    ("Curepipe",                1278, -20.32, 57.53),
    ("Vacoas-Phoenix",          1377, -20.30, 57.48),
    ("Quatre-Bornes",           1374, -20.27, 57.48),
    ("Beau-Bassin-Rose-Hill",   1426, -20.23, 57.47),
    ("Moka",                    1428, -20.22, 57.50),
    ("Saint-Pierre",            1340, -20.22, 57.52),
    ("Nouvelle-France",         1313, -20.35, 57.55),
    ("Grand-Bassin",            1256, -20.42, 57.49),
    ("Plaine-Champagne",        1254, -20.42, 57.45),
]

def zone_of(p):
    if p >= 1500: return 'A'
    if p >= 1450: return 'B'
    if p >= 1380: return 'C'
    return 'D'

lines = ["const COMMUNES=[  // productible = PVGIS SARAH3 (Nord, 21°, pertes 14%, relief ON) — P14_N (île Maurice)"]
for name, prod, lat, lng in MAURICE:
    irr = round(prod / 0.893)
    nm = name.replace("'", "\\'")
    lines.append(f"  {{name:'{nm}',irr:{irr},prod:{prod},lat:{lat},lng:{lng},zone:'{zone_of(prod)}'}},")
lines.append("];")
communes_js = "\n".join(lines)
sub_re("COMMUNES", r"const COMMUNES=\[.*?\n\];", communes_js)

# ─────────────────────────────────────────────────────────────────────────────
# 2) FACTEURS MAURICE : saison, orientation, inclinaison
# ─────────────────────────────────────────────────────────────────────────────
sub("PROD_MOIS_FACTORS",
    "const PROD_MOIS_FACTORS =[1.06,0.97,1.03,0.94,0.93,0.86,0.92,0.99,1.05,1.10,1.04,1.11]; // Σ=12 (PVGIS SARAH3, Nord 21°)",
    "const PROD_MOIS_FACTORS =[1.07,0.97,1.04,0.98,0.92,0.83,0.86,0.95,1.05,1.13,1.08,1.13]; // Σ=12 (PVGIS SARAH3, Nord 21°, Maurice)")

# oFact : N=1.0, E/O≈0.925 (Est 0.917 / Ouest 0.933), Sud 0.838  (PVGIS Maurice)
sub("oFact",
    "function oFact(d){const deg=d>180?360-d:d;if(deg<=15)return 1;if(deg<=40)return.98;if(deg<=70)return.95;if(deg<=100)return.92;if(deg<=130)return.89;if(deg<=160)return.86;return.83;}",
    "function oFact(d){const deg=d>180?360-d:d;if(deg<=15)return 1;if(deg<=40)return.99;if(deg<=70)return.96;if(deg<=100)return.925;if(deg<=130)return.90;if(deg<=160)return.87;return.838;}")

# iFact : 0°:0.964 10°:0.992 21°:1.0 30°:0.989 45°:0.932 60°:0.827 90°:0.493 (PVGIS Maurice)
sub("iFact",
    "function iFact(i){if(i<5)return.96;if(i<=12)return.99;if(i<=25)return 1;if(i<=37)return.99;if(i<=52)return.94;if(i<=70)return.85;if(i<=82)return.68;return.53;}",
    "function iFact(i){if(i<5)return.964;if(i<=12)return.99;if(i<=25)return 1;if(i<=37)return.99;if(i<=52)return.93;if(i<=70)return.83;if(i<=82)return.66;return.49;}")

# ─────────────────────────────────────────────────────────────────────────────
# 3) PRIX_DATA  → x50, TVA=0  (+ construction de PRIX_TTC_TABLE = ht x50)
# ─────────────────────────────────────────────────────────────────────────────
m = re.search(r"const PRIX_DATA=(\{.*?\});\s*function computeDevis", html, re.DOTALL)
if not m:
    errors.append("[PRIX_DATA] bloc introuvable")
    prix = {}
else:
    prix = json.loads(m.group(1))
    SCALE = ["pan", "structure", "cpb", "mi", "rac", "mo", "onduleur", "batterie", "ht", "remise", "ttc", "delta"]
    for k, o in prix.items():
        for fld in SCALE:
            if fld in o:
                o[fld] = round(o[fld] * 50, 2)
        o["tva"] = 0
    new_prix = "const PRIX_DATA=" + json.dumps(prix, ensure_ascii=False, separators=(",", ":")) + ";\nfunction computeDevis"
    html = html[:m.start()] + new_prix + html[m.end():]

# PRIX_TTC_TABLE = ht x50 (brut HT sans TVA), regroupe par kWc puis capacite batterie
def fmt_num(v):
    return str(int(v)) if float(v).is_integer() else str(round(v, 2))

groups = {}
for k, o in prix.items():
    kwc = o["kWc"]; bat = o["bat"]
    groups.setdefault(kwc, {})[bat] = o["ht"]  # ht déjà ×50 (Rs) à l'étape PRIX_DATA
KWC_ORDER = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15, 18]
tbl = ["const PRIX_TTC_TABLE={"]
for kwc in KWC_ORDER:
    if kwc not in groups: continue
    inner = groups[kwc]
    parts = []
    for bat in sorted(inner.keys()):
        bkey = str(int(bat)) if float(bat).is_integer() else str(bat)
        parts.append(f"{bkey}:{fmt_num(inner[bat])}")
    kkey = str(int(kwc)) if float(kwc).is_integer() else str(kwc)
    tbl.append(f"  {kkey}: {{{', '.join(parts)}}},")
tbl[-1] = tbl[-1].rstrip(",")  # pas de virgule finale
tbl.append("};")
prix_ttc_js = "\n".join(tbl)
sub_re("PRIX_TTC_TABLE", r"const PRIX_TTC_TABLE=\{.*?\n\};", prix_ttc_js)

# batteryDelta x50
sub("batteryDelta", "  return 5346+(modules-1)*3850;", "  return 267300+(modules-1)*192500;")

# primeForm (remise Ecologreen Maurice) : 150000 Rs sans batterie / 225000 Rs avec batterie
sub("primeForm",
    "  const primeForm=bat>0?3000:1500; // 1500€ sans batterie / 3000€ avec batterie (formation)",
    "  const primeForm=bat>0?225000:150000; // 150 000 Rs sans batterie / 225 000 Rs avec batterie (remise Ecologreen Maurice)")

# ─────────────────────────────────────────────────────────────────────────────
# 4) MOTEUR CEB — grille tarifaire + fonctions facture
# ─────────────────────────────────────────────────────────────────────────────
CEB_BLOCK = r"""const TARIF_REVENTE_ZNI = 0.1742; // ≤ 9 kWc
function getDefaultTarifRevente(kWc){ return kWc<=9 ? 0.1742 : 0.0895; }

/* ── Grille tarifaire CEB (Central Electricity Board, Maurice) — en vigueur 1 fév. 2023 ──
   Prix de l'énergie par tranche MENSUELLE (Rs/kWh) + redevance minimale mensuelle (Rs).
   Domestique 110A (tarif social) ; 110 / 120 / 140 partagent les mêmes prix d'énergie mais
   des redevances minimales différentes. Commercial (215) / Industriel (315) : redevance
   minimale = tarif × puissance souscrite (kW). */
const CEB_SEUILS_DOM=[25,50,75,100,200,250,300,500,1000,1500,2000,Infinity];
const CEB_TARIFS={
  '110A':{seuils:CEB_SEUILS_DOM,prix:[2.18,3.04,3.28,5.45,6.15,7.02,7.90,10.46,10.68,10.91,11.13,11.36],minMois:31,label:'110A — domestique social'},
  '110' :{seuils:CEB_SEUILS_DOM,prix:[3.16,4.38,4.74,5.45,6.15,7.02,7.90,10.46,10.68,10.91,11.13,11.36],minMois:44,label:'110 — domestique'},
  '120' :{seuils:CEB_SEUILS_DOM,prix:[3.16,4.38,4.74,5.45,6.15,7.02,7.90,10.46,10.68,10.91,11.13,11.36],minMois:184,label:'120 — domestique'},
  '140' :{seuils:CEB_SEUILS_DOM,prix:[3.16,4.38,4.74,5.45,6.15,7.02,7.90,10.46,10.68,10.91,11.13,11.36],minMois:369,label:'140 — domestique'},
  'commercial':{seuils:[400,800,Infinity],prix:[10.01,10.65,11.16],minParKw:196,label:'Commercial (215)'},
  'industriel':{seuils:[500,1000,Infinity],prix:[5.75,6.17,6.44],minParKw:113,label:'Industriel (315)'}
};
function cebLabel(t){return (CEB_TARIFS[t]||CEB_TARIFS['110']).label;}
function cebRedevanceMinMois(t,kw){const g=CEB_TARIFS[t]||CEB_TARIFS['110'];return g.minParKw!==undefined?g.minParKw*(kw||0):g.minMois;}
function cebRedevanceMinAn(t,kw){return cebRedevanceMinMois(t,kw)*12;}
// Facture CEB pour une consommation MENSUELLE (kWh) — énergie par tranches, plancher = redevance minimale
function cebFactureMois(kwhMois,t,kw){
  const g=CEB_TARIFS[t]||CEB_TARIFS['110'];
  let reste=Math.max(0,kwhMois),bas=0,energie=0;
  for(let i=0;i<g.seuils.length;i++){
    const q=Math.min(reste,g.seuils[i]-bas);
    energie+=q*g.prix[i];reste-=q;bas=g.seuils[i];
    if(reste<=0)break;
  }
  return Math.max(energie,cebRedevanceMinMois(t,kw));
}
// Facture CEB ANNUELLE : conso répartie sur 12 mois (tranches mensuelles). Approximation mensuelle
// plate, cohérente avant/après — capture l'écrêtage des tranches hautes par l'autoconsommation solaire.
function cebFactureAn(kwhAn,t,kw){return cebFactureMois((kwhAn||0)/12,t,kw)*12;}

// ─ Option saisonnalité ─ Bilan mensuel : rejoue le modèle d'autoconsommation mois par mois
// (production PVGIS + profil de conso Maurice), pour que les tranches CEB reflètent les pics
// saisonniers (import réseau plus élevé en hiver austral → tranches plus chères).
function getBilanMensuel(){
  const r=getCalc();
  const prodAn=r.prodAn, conso=r.conso;
  const sumPF=PROD_MOIS_FACTORS.reduce((a,b)=>a+b,0);
  const sumCF=CONSO_MOIS_FACTORS.reduce((a,b)=>a+b,0);
  const jourFrac=S.jourPct/100, batCap=S.centrale.bat, batEff=0.92;
  const nd=[31,28,31,30,31,30,31,31,30,31,30,31];
  const consoM=[], edfM=[];
  for(let m=0;m<12;m++){
    const prodDay=(prodAn*PROD_MOIS_FACTORS[m]/sumPF)/nd[m];
    const consoDay=(conso*CONSO_MOIS_FACTORS[m]/sumCF)/nd[m];
    const consoJour=consoDay*jourFrac, consoNuit=consoDay*(1-jourFrac);
    const edfJour=Math.max(0,consoJour-prodDay);
    const surplusMidi=Math.max(0,prodDay-consoJour);
    const batCharge=Math.min(surplusMidi,batCap,consoNuit/batEff);
    const edfNuit=Math.max(0,consoNuit-batCharge*batEff);
    consoM.push(consoDay*nd[m]); edfM.push((edfJour+edfNuit)*nd[m]);
  }
  return {consoM, edfM};
}
// Facture CEB annuelle « avant » (respecte l'option saisonnalité).
function cebAvantAn(conso){
  if(!S.saison) return cebFactureAn(conso,S.meterType,S.connectedKw);
  const sumCF=CONSO_MOIS_FACTORS.reduce((a,b)=>a+b,0);
  let s=0; for(let m=0;m<12;m++) s+=cebFactureMois(conso*CONSO_MOIS_FACTORS[m]/sumCF,S.meterType,S.connectedKw); return s;
}
// Factures CEB annuelles avant / après solaire (respecte l'option saisonnalité).
function cebBillsAn(){
  const r=getCalc(), t=S.meterType, kw=S.connectedKw;
  if(!S.saison) return {avantAn:cebFactureAn(r.conso,t,kw), apresAn:cebFactureAn(r.edfKwh,t,kw)};
  const mb=getBilanMensuel();
  let a=0,p=0; for(let m=0;m<12;m++){a+=cebFactureMois(mb.consoM[m],t,kw);p+=cebFactureMois(mb.edfM[m],t,kw);} return {avantAn:a,apresAn:p};
}
function setSaison(){ const c=document.getElementById('saisonChk'); S.saison=!!(c&&c.checked); calcFact(); }"""
sub("CEB_BLOCK",
    "const TARIF_REVENTE_ZNI = 0.1742; // ≤ 9 kWc\nfunction getDefaultTarifRevente(kWc){ return kWc<=9 ? 0.1742 : 0.0895; }",
    CEB_BLOCK)

# ─────────────────────────────────────────────────────────────────────────────
# 5) ÉTAT : type de compteur CEB, puissance souscrite, pas de revente, freq mensuelle
# ─────────────────────────────────────────────────────────────────────────────
sub("state.freq/conso",
    "  page:0,compteur:'mono',freq:'bi',jourPct:60,\n  conso:0,factAn:0,abo:0,prixHT:0,",
    "  page:0,compteur:'mono',freq:'mois',jourPct:60,\n  conso:0,factAn:0,abo:0,prixHT:0,\n  meterType:'110',connectedKw:0,saison:false,")
sub("state.tarRev",
    "  finMode:'credit',apport:0,duree:180,taux:7.12,tarRev:TARIF_REVENTE_ZNI,",
    "  finMode:'credit',apport:0,duree:180,taux:7.12,tarRev:0,")

# prime EDF -> 0 (pas de prime à Maurice)
sub("getPrimeEDF",
    "function getPrimeEDF(kWc,periode){\n  return Math.round(kWc*getPrimeRate(kWc,periode));\n}",
    "function getPrimeEDF(kWc,periode){\n  return 0; // pas de prime à Maurice\n}")

def sub_opt(old, new):
    """Remplace toutes les occurrences si présentes, sans erreur si absent."""
    global html
    if old in html:
        html = html.replace(old, new)

# ─────────────────────────────────────────────────────────────────────────────
# 6) calcFact — facture dérivée de la grille CEB
# ─────────────────────────────────────────────────────────────────────────────
CALCFACT_OLD = """function calcFact(){
  // Item 9 : bloquer les valeurs négatives
  ['conso','factAn','abo','prixHT'].forEach(id=>{
    const el=document.getElementById(id);
    if(parseFloat(el.value)<0){el.value='';}
  });
  const conso=parseFloat(document.getElementById('conso').value)||0;
  const factAn=parseFloat(document.getElementById('factAn').value)||0;
  const abo=parseFloat(document.getElementById('abo').value)||0;
  const pHT=parseFloat(document.getElementById('prixHT').value)||0;
  S.conso=conso;S.factAn=factAn;S.abo=abo;S.prixHT=pHT;

  // Item 8 : surbrillance des champs requis vides
  const REQ_FIELDS=['conso','factAn','abo','prixHT'];
  REQ_FIELDS.forEach(id=>{
    const el=document.getElementById(id);
    const empty=el.value.trim()==='';
    el.classList.toggle('req-err',empty);
  });

  const div=S.freq==='bi'?6:10; // nombre de périodes par an
  const factPer=factAn/div;    // facture par période

  // Prix TTC = facture annuelle / consommation annuelle
  const pTTC=factAn>0&&conso>0?factAn/conso:0;
  // Part kWh HT annuelle
  const kwhPartAn=conso>0&&pHT>0?conso*pHT:0;
  const kwhPartPer=kwhPartAn/div;
  const aboPar=abo/div; // abonnement HT par période
  // Taxes = facture période - part kWh periode - abonnement période
  const taxPer=factPer-kwhPartPer-aboPar;

  document.getElementById('facturePeriodeLbl').textContent=S.freq==='bi'?'bimestrielle':'mensuelle';
  document.getElementById('mFacPer').textContent=factPer>0?factPer.toFixed(2):'—';
  document.getElementById('mPrixTTC').textContent=pTTC>0?pTTC.toFixed(4):'—';
  document.getElementById('mFacAn').textContent=factAn>0?factAn.toFixed(2):'—';
  document.getElementById('dKwh').textContent=kwhPartPer>0?kwhPartPer.toFixed(2)+' €':'—';
  document.getElementById('dTax').textContent=taxPer>0?taxPer.toFixed(2)+' €':'—';
  document.getElementById('dAbo').textContent=aboPar>0?aboPar.toFixed(2)+' €':'—';

  if(factPer>0&&kwhPartPer>0){
    const total=kwhPartPer+taxPer+aboPar;
    document.getElementById('dKwhPct').textContent=Math.round(kwhPartPer/total*100)+'%';
    document.getElementById('dTaxPct').textContent=Math.round(taxPer/total*100)+'%';
  }

  // Cohérence: facture annuelle déclarée vs conso*prixTTC
  const impliedAn=conso*pTTC;
  const delta=factAn>0?Math.abs(impliedAn-factAn)/factAn:0;
  const alertEl=document.getElementById('alertConso');
  if(delta>0.18&&factAn>0){
    alertEl.innerHTML=`<div class="alert aw"><div class="adot"></div>Incohérence détectée : facture déclarée ${factAn.toFixed(0)} € ≠ calcul ${impliedAn.toFixed(0)} €. Vérifiez vos données.</div>`;
  }else alertEl.innerHTML='';
  score();
  renderProd();
  renderChart();
}"""
CALCFACT_NEW = """function calcFact(){
  // Une facture CEB couvre 4 mois : l'utilisateur saisit 4 mois, on annualise par la moyenne ×12
  const moisIds=['mois1','mois2','mois3','mois4'];
  moisIds.concat(['connectedKw']).forEach(id=>{
    const el=document.getElementById(id);
    if(el&&parseFloat(el.value)<0){el.value='';}
  });
  const vals=moisIds.map(id=>parseFloat((document.getElementById(id)||{}).value)).filter(v=>!isNaN(v)&&v>=0);
  const moyMois=vals.length?vals.reduce((a,b)=>a+b,0)/vals.length:0;
  const conso=Math.round(moyMois*12);
  const kwEl=document.getElementById('connectedKw');
  const connectedKw=kwEl?(parseFloat(kwEl.value)||0):0;
  S.conso=conso;S.connectedKw=connectedKw;S.consoMois4=vals;

  // Rappel de l'annualisation retenue
  const _note=document.getElementById('consoAnnNote');
  if(_note)_note.textContent=vals.length?`Moyenne : ${Math.round(moyMois).toLocaleString('fr')} kWh/mois → consommation annuelle retenue : ${conso.toLocaleString('fr')} kWh/an`:'';

  // Facture CEB dérivée de la consommation annualisée et du type de compteur
  const factAn=conso>0?cebAvantAn(conso):0;
  const miniAn=cebRedevanceMinAn(S.meterType,connectedKw);
  S.factAn=factAn;
  S.prixHT=conso>0?factAn/conso:0;
  S.abo=miniAn;

  // Surbrillance des champs requis vides (4 mois ; puissance requise seulement en commercial/industriel)
  const comInd=(S.meterType==='commercial'||S.meterType==='industriel');
  const REQ=moisIds.concat(comInd?['connectedKw']:[]);
  REQ.forEach(id=>{const el=document.getElementById(id);if(el)el.classList.toggle('req-err',el.value.trim()==='');});

  const div=S.freq==='bi'?6:12; // CEB : 12 mensualités (ou 6 bimestres)
  const factPer=factAn/div;
  const pMoy=conso>0?factAn/conso:0;
  const energieAn=Math.max(0,factAn-miniAn);

  document.getElementById('facturePeriodeLbl').textContent=S.freq==='bi'?'bimestrielle':'mensuelle';
  document.getElementById('mFacPer').textContent=factPer>0?factPer.toFixed(2):'—';
  document.getElementById('mPrixTTC').textContent=pMoy>0?pMoy.toFixed(4):'—';
  document.getElementById('mFacAn').textContent=factAn>0?factAn.toFixed(2):'—';
  const dK=document.getElementById('dKwh');if(dK)dK.textContent=energieAn>0?(energieAn/div).toFixed(2)+' Rs':'—';
  const dT=document.getElementById('dTax');if(dT)dT.textContent='0,00 Rs';
  const dA=document.getElementById('dAbo');if(dA)dA.textContent=(miniAn/div).toFixed(2)+' Rs';
  if(factAn>0){
    const dKp=document.getElementById('dKwhPct');if(dKp)dKp.textContent=Math.round(energieAn/factAn*100)+'%';
    const dTp=document.getElementById('dTaxPct');if(dTp)dTp.textContent='0%';
  }

  const alertEl=document.getElementById('alertConso');
  if(alertEl){
    if(conso>0&&factAn>0){
      const fac4=factAn/3; // 3 factures de 4 mois par an
      alertEl.innerHTML=`<div class="alert aok"><div class="adot"></div>Facture CEB estimée : ${Math.round(factAn).toLocaleString('fr')} Rs/an (≈ ${Math.round(fac4).toLocaleString('fr')} Rs par facture de 4 mois) — compteur ${cebLabel(S.meterType)}, prix moyen ${pMoy.toFixed(2)} Rs/kWh.</div>`;
    }else alertEl.innerHTML='';
  }
  score();
  renderProd();
  renderChart();
}"""
sub("calcFact", CALCFACT_OLD, CALCFACT_NEW)

# setMeter — inséré après setFreq
sub("setMeter",
    "function setFreq(v){\n  S.freq=v;\n  document.getElementById('fMois').classList.toggle('on',v==='mois');\n  document.getElementById('fBi').classList.toggle('on',v==='bi');\n  calcFact();\n}",
    "function setFreq(v){\n  S.freq=v;\n  document.getElementById('fMois').classList.toggle('on',v==='mois');\n  document.getElementById('fBi').classList.toggle('on',v==='bi');\n  calcFact();\n}\nfunction setMeter(){\n  const sel=document.getElementById('meterType');\n  S.meterType=sel.value;\n  const comInd=(S.meterType==='commercial'||S.meterType==='industriel');\n  const fp=document.getElementById('flPuiss');\n  if(fp)fp.style.display=comInd?'':'none';\n  calcFact();\n}")

# go() : validation Maurice (conso + puissance si commercial/industriel)
sub("go.validation",
    "    const manquants=['conso','factAn','abo','prixHT'].filter(id=>document.getElementById(id).value.trim()==='');",
    "    const _lbl={mois1:'Mois 1',mois2:'Mois 2',mois3:'Mois 3',mois4:'Mois 4',connectedKw:'Puissance souscrite'};\n    const _ci=(S.meterType==='commercial'||S.meterType==='industriel');\n    const manquants=['mois1','mois2','mois3','mois4'].concat(_ci?['connectedKw']:[]).filter(id=>{const e=document.getElementById(id);return !e||e.value.trim()==='';}).map(id=>_lbl[id]||id);")

# ─────────────────────────────────────────────────────────────────────────────
# 7) getFactApres — facture résiduelle via grille CEB
# ─────────────────────────────────────────────────────────────────────────────
FACTAPRES_OLD = """  const r=getCalc();
  // EDF mensualise sur 10 échéances (régularisation du prorata au 12e mois) ou facture au bimestre (6/an)
  const div=S.freq==='bi'?6:10;
  const aboAn=S.abo||176;
  const prixHT=S.prixHT||0;
  const factAvantAn=S.factAn||2565;
  // Énergie résiduelle au prix HT uniquement (sans taxes, sans abonnement)
  const kwhResidAn=r.edfKwh*prixHT;
  // Ratio taxes calculé depuis la décomposition réelle de la facture client
  const taxRatio=factAvantAn>0&&S.conso>0
    ?(factAvantAn-S.conso*prixHT-aboAn)/factAvantAn:0.27;
  // Taxes appliquées uniquement sur l'énergie résiduelle
  const taxResidAn=Math.max(0,kwhResidAn*taxRatio/Math.max(0.0001,1-taxRatio));
  // Facture résiduelle = énergie HT + taxes + abonnement fixe (pas de double-comptage)
  const factApresAn=kwhResidAn+taxResidAn+aboAn;
  const factApres=factApresAn/div;
  const kwhPer=kwhResidAn/div;
  const taxPer=taxResidAn/div;
  const aboPer=aboAn/div;
  return{factApres,kwhPer,taxPer,aboPer,factApresAn,r};"""
FACTAPRES_NEW = """  const r=getCalc();
  // CEB : facture mensuelle (12 échéances) ou bimestrielle (6). Facture résiduelle = grille CEB
  // appliquée à l'import réseau résiduel (l'autoconsommation solaire écrête les tranches les plus chères).
  const div=S.freq==='bi'?6:12;
  const factApresAn=cebBillsAn().apresAn;
  const factApres=factApresAn/div;
  const miniAn=cebRedevanceMinAn(S.meterType,S.connectedKw);
  const kwhResidAn=Math.max(0,factApresAn-miniAn);
  const kwhPer=kwhResidAn/div;
  const taxPer=0;
  const aboPer=miniAn/div;
  return{factApres,kwhPer,taxPer,aboPer,factApresAn,r};"""
sub("getFactApres", FACTAPRES_OLD, FACTAPRES_NEW)

# renderFactCompare : détail sans taxes
sub("fDetail",
    '''  document.getElementById('fDetail').innerHTML=`<span style="color:var(--txt2)">kWh: ${fa.kwhPer.toFixed(2)} €</span><span style="color:var(--txt2)">Taxes≈ ${fa.taxPer.toFixed(2)} €</span><span style="color:var(--txt2)">Abo: ${fa.aboPer.toFixed(2)} €</span>`;''',
    '''  document.getElementById('fDetail').innerHTML=`<span style="color:var(--txt2)">Énergie: ${fa.kwhPer.toFixed(2)} €</span><span style="color:var(--txt2)">Redevance min: ${fa.aboPer.toFixed(2)} €</span>`;''')

# ─────────────────────────────────────────────────────────────────────────────
# 8) simulateRentability — économie = facture CEB avant − après (inflatée), sans revente ni prime
# ─────────────────────────────────────────────────────────────────────────────
sub("sim.tarRev", "const tarRev=S.tarRev||TARIF_REVENTE_ZNI;", "const tarRev=0;", 2)
sub("sim.base",
    "  const pTTC0=r.pTTC||0.206;\n  const autoKwh=r.autoKwh,surplusKwh=r.surplusKwh,edfKwh=r.edfKwh,conso=r.conso;",
    "  const autoKwh=r.autoKwh,surplusKwh=r.surplusKwh,edfKwh=r.edfKwh,conso=r.conso;\n  const _cb=cebBillsAn();\n  const factAvant0=_cb.avantAn;\n  const factApres0=_cb.apresAn;")
sub("sim.basePTTC.init", "  let basePTTC=pTTC0;", "  let infFactor=1;")
sub("sim.basePTTC.infl", "    if(y>2026)basePTTC*=(1+inf);", "    if(y>2026)infFactor*=(1+inf);")
sub("sim.econ",
    """    const econoAn=Math.round(autoKwh*basePTTC);
    const residAn=Math.round(edfKwh*basePTTC);
    const factureAn=Math.round(conso*basePTTC);
    const surplusAn=(y===2026)?0:Math.round(surplusKwh*tarRev);
    const primeAn=y===2027?sched.primeEDF:0;""",
    """    const factureAn=Math.round(factAvant0*infFactor);
    const residAn=Math.round(factApres0*infFactor);
    const econoAn=factureAn-residAn;
    const surplusAn=0;
    const primeAn=0;""")
# renderSeuil : économie de croisière via CEB
sub("renderSeuil.eco",
    "  const ecoAnCroisiere=r.autoKwh*r.pTTC+r.surplusKwh*tarRev;",
    "  const _cbS=cebBillsAn();\n  const ecoAnCroisiere=_cbS.avantAn-_cbS.apresAn;")
sub("renderSeuil.txt", "— souvent dès la 2e année grâce à la prime.", ".")

# ─────────────────────────────────────────────────────────────────────────────
# 9) calcFin — plus de revente
# ─────────────────────────────────────────────────────────────────────────────
sub("calcFin.tarRev",
    "  const tarRev=parseFloat(document.getElementById('tarRev').value)||TARIF_REVENTE_ZNI;",
    "  const tarRev=0; // pas de revente à Maurice")
# retrait input tarRev (page 4)
sub("input.tarRev",
    '''    <div class="g2">
      <div class="fl"><div class="fl-lbl">Taux annuel (%)</div><input type="number" class="mono" step="0.01" id="taux" value="7.12" oninput="calcFin()"></div>
      <div class="fl"><div class="fl-lbl">Tarif revente surplus (€/kWh)</div><input type="number" class="mono" step="0.001" id="tarRev" value="0.1742" oninput="calcFin()"></div>
    </div>''',
    '''    <div class="fl"><div class="fl-lbl">Taux annuel (%)</div><input type="number" class="mono" step="0.01" id="taux" value="7.12" oninput="calcFin()"></div>''')

# retrait lignes revente / prime du financement (fin2026 / fin2027)
sub_opt('          <div class="fin-row"><span class="fin-lbl">Revente surplus</span><span class="fin-v">0,00 €</span></div>\n', '')
sub_opt('          <div class="fin-row"><span class="fin-lbl">Revente mensuelle estimée</span><span class="fin-v pos">${reventeMens.toFixed(2)} €</span></div>\n', '')
sub_opt('          <div class="fin-row"><span class="fin-lbl">Prime EDF reçue</span><span class="fin-v pos">+${sched.primeEDF.toLocaleString(\'fr\')} €</span></div>\n', '')
sub_opt('          <div class="fin-row"><span class="fin-lbl">Prime EDF reçue</span><span class="fin-v pos">−${sched.primeEDF.toLocaleString(\'fr\')} €</span></div>\n', '')
sub_opt('          <div class="fin-row"><span class="fin-lbl">Capital après déduction prime</span><span class="fin-v">${Math.round(sched.capitalApresPrime).toLocaleString(\'fr\')} €</span></div>\n', '')
sub_opt("Montant financé (sans Prime EDF)", "Montant financé")

# sansInst (projection 2027) : sans décomposition taxes
sub("sansInst",
    '''    <div class="metrics" style="grid-template-columns:1fr 1fr 1fr 1fr">
      <div class="met" style="background:transparent;border-color:rgba(240,180,41,.2)"><div class="met-lbl">Facture annuelle</div><div class="met-val" style="color:var(--amb-l)">${f2027an.toFixed(0)}</div><div class="met-unit">€/an</div></div>
      <div class="met" style="background:transparent;border-color:rgba(240,180,41,.2)"><div class="met-lbl">Part kWh</div><div class="met-val" style="color:var(--amb-l)">${(f2027an*kwhRatioSI/div).toFixed(2)}</div><div class="met-unit">€/${div===6?'bimestre':'mois'}</div></div>
      <div class="met" style="background:transparent;border-color:rgba(240,180,41,.2)"><div class="met-lbl">Taxes</div><div class="met-val" style="color:var(--amb-l)">${(f2027an*taxRatioSI/div).toFixed(2)}</div><div class="met-unit">€/${div===6?'bimestre':'mois'}</div></div>
      <div class="met" style="background:transparent;border-color:rgba(240,180,41,.2)"><div class="met-lbl">Facture totale</div><div class="met-val" style="color:var(--amb-l)">${(f2027an/div).toFixed(2)}</div><div class="met-unit">€/${div===6?'bimestre':'mois'}</div></div>
    </div>`;''',
    '''    <div class="metrics" style="grid-template-columns:1fr 1fr">
      <div class="met" style="background:transparent;border-color:rgba(240,180,41,.2)"><div class="met-lbl">Facture annuelle</div><div class="met-val" style="color:var(--amb-l)">${f2027an.toFixed(0)}</div><div class="met-unit">Rs/an</div></div>
      <div class="met" style="background:transparent;border-color:rgba(240,180,41,.2)"><div class="met-lbl">Facture ${div===6?'bimestrielle':'mensuelle'}</div><div class="met-val" style="color:var(--amb-l)">${(f2027an/div).toFixed(2)}</div><div class="met-unit">Rs/${div===6?'bimestre':'mois'}</div></div>
    </div>`;''')

# ─────────────────────────────────────────────────────────────────────────────
# 10) Page 5 — récap projet (sans prime), tableau renta (retrait colonnes surplus/prime)
# ─────────────────────────────────────────────────────────────────────────────
sub("projetRec",
    '''  document.getElementById('projetRec').innerHTML=`<div class="metrics" style="grid-template-columns:repeat(5,1fr)">
    <div class="met"><div class="met-lbl">Prix TTC</div><div class="met-val" style="font-size:14px;text-decoration:line-through;color:var(--txt3)">${prixTTC.toLocaleString('fr')} €</div></div>
    <div class="met"><div class="met-lbl">−Remise</div><div class="met-val" style="font-size:14px;color:var(--grn-l)">−${primeForm.toLocaleString('fr')} €</div></div>
    <div class="met card-amb"><div class="met-lbl">Montant à investir</div><div class="met-val" style="color:var(--amb-l)">${(prixTTC-primeForm).toLocaleString('fr')} €</div></div>
    <div class="met card-grn"><div class="met-lbl">−Prime EDF (S24-ZNI)</div><div class="met-val" style="color:var(--grn-l)">−${primeEDF.toLocaleString('fr')} €</div></div>
    <div class="met card-grn"><div class="met-lbl">Coût réel du projet</div><div class="met-val" style="color:var(--grn-l)">${(prixTTC-primeForm-primeEDF).toLocaleString('fr')} €</div></div>
  </div>''',
    '''  document.getElementById('projetRec').innerHTML=`<div class="metrics" style="grid-template-columns:repeat(3,1fr)">
    <div class="met"><div class="met-lbl">Prix</div><div class="met-val" style="font-size:14px;text-decoration:line-through;color:var(--txt3)">${prixTTC.toLocaleString('fr')} €</div></div>
    <div class="met"><div class="met-lbl">−Remise</div><div class="met-val" style="font-size:14px;color:var(--grn-l)">−${primeForm.toLocaleString('fr')} €</div></div>
    <div class="met card-grn"><div class="met-lbl">Coût réel du projet</div><div class="met-val" style="color:var(--grn-l)">${(prixTTC-primeForm).toLocaleString('fr')} €</div></div>
  </div>''')

# tableau renta : en-tête (7 colonnes)
sub("renta.header",
    """        <th>Année</th><th>Investissement</th><th>Facture EDF</th><th>Économie auto.</th>
        <th>Résiduel facture</th><th>Revente surplus</th><th>Prime EDF</th>
        <th>Éco. annuelle</th><th>Cumul</th>""",
    """        <th>Année</th><th>Investissement</th><th>Facture CEB</th><th>Économie auto.</th>
        <th>Résiduel facture</th>
        <th>Éco. annuelle</th><th>Cumul</th>""")
# aujBody : retrait td surplus + prime
sub("renta.aujBody",
    """      <td style="border-bottom:2px solid rgba(240,180,41,.35)">0,00 €</td>
      <td style="border-bottom:2px solid rgba(240,180,41,.35)">—</td>
""", "")
# rows : retrait td surplus + prime
sub("renta.rows",
    """      <td>${row.surplusAn>0?row.surplusAn.toLocaleString('fr')+' €':'0,00 €'}</td>
      <td>${row.primeAn>0?row.primeAn.toLocaleString('fr')+' €':'—'}</td>
""", "")
# foot : retrait td totalSurplus + totalPrime
sub("renta.foot",
    """    <td style="color:var(--blu)">${Math.round(totalSurplus).toLocaleString('fr')} €</td>
    <td style="color:var(--grn-l)">${Math.round(totalPrime).toLocaleString('fr')} €</td>
""", "")

# ─────────────────────────────────────────────────────────────────────────────
# 11) Récap page 6 : retrait revente/prime, relabel
# ─────────────────────────────────────────────────────────────────────────────
sub_opt('''      <div class="rec-row"><span class="rec-l">Tarif revente ZNI</span><span class="rec-v">${(S.tarRev||TARIF_REVENTE_ZNI).toFixed(4)} €/kWh</span></div>\n''', '')
sub_opt('''      <div class="rec-row"><span class="rec-l">Prime EDF OA (S24-ZNI)</span><span class="rec-v grn">${sched.primeEDF.toLocaleString('fr')} €</span></div>\n''', '')
sub_opt('<span class="rec-l">Surplus revendu</span>', '<span class="rec-l">Surplus exporté</span>')
sub_opt('<span class="rec-l">Mensualité après prime</span>', '<span class="rec-l">Mensualité ajustée</span>')

# ─────────────────────────────────────────────────────────────────────────────
# 12) computeDevis — remise Maurice, TVA=0, repli ×50
# ─────────────────────────────────────────────────────────────────────────────
sub("devis.primary",
    """    const netHT=Math.round((P.ht-P.remise)*100)/100;
    return{lignes,totalHT:P.ht,remise:P.remise,netHT,tva:P.tva,ttc:P.ttc,nbPan,MO:P.mo};""",
    """    const netHT=Math.round((P.ht-c.primeForm)*100)/100;
    return{lignes,totalHT:P.ht,remise:c.primeForm,netHT,tva:0,ttc:netHT,nbPan,MO:P.mo};""")
sub("devis.MO", "  const MO=2.5*nbPan*135;", "  const MO=2.5*nbPan*6750;")
# nombre de micro-onduleurs : prix onduleur ×50 → diviseur unitaire 350€ ×50 = 17500 Rs
sub("devis.nbMicro",
    "      const nbMicro=Math.max(1,Math.round(P.onduleur/350));",
    "      const nbMicro=Math.max(1,Math.round(P.onduleur/17500));")
sub("devis.a", "  const a=0.021*MO;", "  const a=0; // pas de TVA à Maurice")
sub_opt(''',pu:3500,q:1});''', ''',pu:175000,q:1});''')
sub_opt(''',pu:2500,q:modules});''', ''',pu:125000,q:modules});''')
sub_opt(''',pu:1025,q:1});''', ''',pu:51250,q:1});''')
sub_opt(''',pu:750,q:1});''', ''',pu:37500,q:1});''')
sub_opt(''',pu:600,q:1});''', ''',pu:30000,q:1});''')
sub_opt("    F=3500+2500*modules+1025+750+600;", "    F=175000+125000*modules+51250+37500+30000;")
sub_opt(''',pu:350,q:nbMicro});''', ''',pu:17500,q:nbMicro});''')
sub_opt(''',pu:730,q:1});''', ''',pu:36500,q:1});''')
sub_opt("    F=350*nbMicro+730+750+600;", "    F=17500*nbMicro+36500+37500+30000;")
sub_opt(''',pu:135,q:2.5*nbPan,montant:MO});''', ''',pu:6750,q:2.5*nbPan,montant:MO});''')

# devis : retrait ligne TVA, "Net à payer", mentions
sub("devis.tvaLine",
    '''          <div class="tt-row"><span class="l">TVA 2,1 %</span><span class="v num">${eur(d.tva)}</span></div>\n''', "")
sub("devis.netTTC",
    '<div class="tt-ttc"><span class="l">Net à payer TTC</span>',
    '<div class="tt-ttc"><span class="l">Net à payer</span>')
sub("devis.mentions",
    '''<div class="mentions"><b>Conditions :</b> devis valable 1 mois à compter de la date d'émission · TVA 2,1 % applicable sur la main d'œuvre (DOM, art. 296 CGI).<br><b>Aides déduites ultérieurement :</b> la prime EDF OA S24-ZNI (${sched.primeEDF.toLocaleString('fr')} €) est versée directement au client 12 à 18 mois après la mise en service — elle n'apparaît pas sur ce devis.</div>''',
    '''<div class="mentions"><b>Conditions :</b> devis valable 1 mois à compter de la date d'émission · les installations solaires ne sont pas assujetties à la TVA à Maurice.</div>''')

# ─────────────────────────────────────────────────────────────────────────────
# 13) Page 1 — carte « Données CEB » (compteur CEB + puissance souscrite)
# ─────────────────────────────────────────────────────────────────────────────
CARD_OLD = '''  <div class="sec">Données EDF</div>
  <div class="card">
    <div class="g2" style="margin-bottom:14px">
      <div class="fl"><div class="fl-lbl">Consommation annuelle (kWh)</div><input type="number" class="mono" id="conso" placeholder="12426" oninput="calcFact()"></div>
      <div class="fl"><div class="fl-lbl">Facture EDF annuelle (€)</div><input type="number" class="mono" id="factAn" placeholder="2565" oninput="calcFact()"></div>
      <div class="fl"><div class="fl-lbl">Abonnement annuel HT (€)</div><input type="number" class="mono" id="abo" placeholder="176" oninput="calcFact()"></div>
      <div class="fl"><div class="fl-lbl">Prix kWh HT (€)</div><input type="number" class="mono" step="0.0001" id="prixHT" placeholder="0.1362" oninput="calcFact()"></div>
    </div>
    <div id="alertConso"></div>
    <div class="dv"></div>
    <div class="metrics" style="grid-template-columns:1fr 1fr 1fr;margin-bottom:12px">
      <div class="met card-amb"><div class="met-lbl">Facture <span id="facturePeriodeLbl">bimestrielle</span> TTC</div><div class="met-val" id="mFacPer">—</div><div class="met-unit">€</div></div>
      <div class="met"><div class="met-lbl">Prix kWh TTC</div><div class="met-val" id="mPrixTTC">—</div><div class="met-unit">€/kWh</div></div>
      <div class="met"><div class="met-lbl">Facture annuelle TTC</div><div class="met-val" id="mFacAn">—</div><div class="met-unit">€/an</div></div>
    </div>
    <div style="font-size:9px;color:var(--txt3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:7px">Détail de la facture (par période)</div>
    <div class="det-bar">
      <div class="det-cell"><div class="det-lbl">Part kWh</div><div class="det-v" id="dKwh">—</div><div class="det-pct" id="dKwhPct">—</div></div>
      <div class="det-cell"><div class="det-lbl">Taxes & acheminement</div><div class="det-v" id="dTax">—</div><div class="det-pct" id="dTaxPct">—</div></div>
      <div class="det-cell"><div class="det-lbl">Abonnement</div><div class="det-v" id="dAbo">—</div><div class="det-pct">7%</div></div>
    </div>
  </div>'''
CARD_NEW = '''  <div class="sec">Données CEB</div>
  <div class="card">
    <div style="font-size:11px;color:var(--txt3);margin-bottom:12px;line-height:1.5">Une facture CEB couvre 4 mois. Renseignez la consommation (kWh) de ces 4 mois — la moyenne est automatiquement annualisée pour l'étude.</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(115px,1fr));gap:10px;margin-bottom:8px">
      <div class="fl"><div class="fl-lbl">Mois 1 (kWh)</div><input type="number" class="mono" id="mois1" placeholder="400" oninput="calcFact()"></div>
      <div class="fl"><div class="fl-lbl">Mois 2 (kWh)</div><input type="number" class="mono" id="mois2" placeholder="400" oninput="calcFact()"></div>
      <div class="fl"><div class="fl-lbl">Mois 3 (kWh)</div><input type="number" class="mono" id="mois3" placeholder="400" oninput="calcFact()"></div>
      <div class="fl"><div class="fl-lbl">Mois 4 (kWh)</div><input type="number" class="mono" id="mois4" placeholder="400" oninput="calcFact()"></div>
    </div>
    <div id="consoAnnNote" style="font-size:11px;color:var(--grn-l);margin-bottom:14px;min-height:15px"></div>
    <div class="fl" style="margin-bottom:14px"><div class="fl-lbl">Type de compteur CEB</div>
      <select id="meterType" onchange="setMeter()">
        <option value="110A">110A — domestique social</option>
        <option value="110" selected>110 — domestique</option>
        <option value="120">120 — domestique</option>
        <option value="140">140 — domestique</option>
        <option value="commercial">Commercial (215)</option>
        <option value="industriel">Industriel (315)</option>
      </select>
    </div>
    <div class="fl" id="flPuiss" style="display:none;margin-bottom:14px"><div class="fl-lbl">Puissance souscrite (kW) — redevance minimale commerciale/industrielle</div><input type="number" class="mono" id="connectedKw" placeholder="30" oninput="calcFact()"></div>
    <label style="display:flex;align-items:flex-start;gap:9px;font-size:12px;color:var(--txt2);margin-bottom:14px;cursor:pointer;line-height:1.4"><input type="checkbox" id="saisonChk" onchange="setSaison()" style="width:15px;height:15px;margin-top:1px;accent-color:var(--grn);flex-shrink:0"><span>Tenir compte de la saisonnalité (répartit conso et production mois par mois ; sinon consommation lissée sur l'année)</span></label>
    <div id="alertConso"></div>
    <div class="dv"></div>
    <div class="metrics" style="grid-template-columns:1fr 1fr 1fr;margin-bottom:12px">
      <div class="met card-amb"><div class="met-lbl">Facture <span id="facturePeriodeLbl">mensuelle</span></div><div class="met-val" id="mFacPer">—</div><div class="met-unit">Rs</div></div>
      <div class="met"><div class="met-lbl">Prix kWh moyen</div><div class="met-val" id="mPrixTTC">—</div><div class="met-unit">Rs/kWh</div></div>
      <div class="met"><div class="met-lbl">Facture annuelle</div><div class="met-val" id="mFacAn">—</div><div class="met-unit">Rs/an</div></div>
    </div>
    <div style="font-size:9px;color:var(--txt3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:7px">Détail de la facture (par période)</div>
    <div class="det-bar">
      <div class="det-cell"><div class="det-lbl">Énergie (tranches)</div><div class="det-v" id="dKwh">—</div><div class="det-pct" id="dKwhPct">—</div></div>
      <div class="det-cell"><div class="det-lbl">Taxes</div><div class="det-v" id="dTax">0,00 Rs</div><div class="det-pct" id="dTaxPct">0%</div></div>
      <div class="det-cell"><div class="det-lbl">Redevance minimale</div><div class="det-v" id="dAbo">—</div><div class="det-pct">CEB</div></div>
    </div>
  </div>'''
sub("page1.card", CARD_OLD, CARD_NEW)

# facturation mensuelle uniquement à Maurice : on retire le choix Fréquence (mensuelle/bimestrielle)
sub("compteur.card",
    '''    <div class="g2" style="margin-bottom:14px">
      <div class="fl"><div class="fl-lbl">Type de compteur</div>
        <div class="tog"><div class="tog-btn on" id="tMono" onclick="setCompteur('mono')">Monophasé</div><div class="tog-btn" id="tTri" onclick="setCompteur('tri')">Triphasé</div></div>
      </div>
      <div class="fl"><div class="fl-lbl">Fréquence de facturation</div>
        <div class="tog"><div class="tog-btn" id="fMois" onclick="setFreq('mois')">Mensuelle</div><div class="tog-btn on" id="fBi" onclick="setFreq('bi')">Bimestrielle</div></div>
      </div>
    </div>''',
    '''    <div class="fl" style="margin-bottom:14px"><div class="fl-lbl">Type de compteur</div>
      <div class="tog"><div class="tog-btn on" id="tMono" onclick="setCompteur('mono')">Monophasé</div><div class="tog-btn" id="tTri" onclick="setCompteur('tri')">Triphasé</div></div>
    </div>''')

# période mensuelle = 12 (au lieu de 10 EDF) pour renderFactCompare / calcFin restants
sub_opt("const div=S.freq==='bi'?6:10;", "const div=S.freq==='bi'?6:12;")

# ─────────────────────────────────────────────────────────────────────────────
# 14) Branding Maurice + EDF→CEB (libellés visibles uniquement)
# ─────────────────────────────────────────────────────────────────────────────
sub("title", "<title>Étude Énergétique Solaire — Réunion 974</title>",
             "<title>Étude Énergétique Solaire — Île Maurice</title>")
sub("tilt.note", "Optimale à La Réunion : 20–23°", "Optimale à l'île Maurice : 20–23°")
sub("cgv.sub", "Installateur photovoltaïque — La Réunion (974)", "Installateur photovoltaïque — Île Maurice", 2)
sub("cgv.foot", "Document contractuel annexé au devis · La Réunion (974)",
                "Document contractuel annexé au devis · Île Maurice")
sub("devis.addr", "S.commune.name+', La Réunion'", "S.commune.name+', Île Maurice'")
sub("sidebar.sub", '<div class="s-sub">Réunion · 974</div>', '<div class="s-sub">Île Maurice</div>')
sub("devis.typeInstall", "Autoconsommation &amp; revente du surplus", "Autoconsommation")
sub("geo.label", "closest.name+', La Réunion'", "closest.name+', Île Maurice'")
sub("commet.reminder", " · La Réunion</span>", " · Île Maurice</span>")
sub_opt('placeholder="ex. 12 rue des Filaos, 97410 Saint-Pierre"', 'placeholder="ex. Royal Road, Grand-Baie"')
# sous-titre en-tête latéral (RÉUNION · 974 déjà traité via s-sub ; titre principal reste générique)
# EDF → CEB (uniquement dans les libellés ; les identifiants edfKwh/primeEDF restent intacts)
sub_opt("réseau (EDF)", "réseau (CEB)")
sub_opt("Réseau EDF", "Réseau CEB")
sub_opt("Facture résiduelle EDF", "Facture résiduelle CEB")
sub_opt("facture EDF", "facture CEB")
sub_opt("Facture EDF", "Facture CEB")

# ─────────────────────────────────────────────────────────────────────────────
# 14b) Retrait UI prime (page 3 : tableau S24-ZNI + aides ; page 4 : titre bilan 2027)
# ─────────────────────────────────────────────────────────────────────────────
sub("prime.section",
    '''  <div class="sec">Prime à l'autoconsommation S24-ZNI — EDF OA Réunion</div>
  <div class="card">
    <table class="ptbl"><thead><tr><th>Année</th><th>Prime totale</th><th>Variation</th></tr></thead>
    <tbody id="primeTbody"></tbody></table>
    <div style="font-size:10px;color:var(--txt3);margin-top:7px">Source : Open Data Commission de Régulation de l'Énergie (CRE) — tarif S24-ZNI Réunion</div>
    <div style="font-size:10px;color:var(--amb-l);margin-top:3px" id="primeNote"></div>
  </div>
''', "")
sub("renderPrimes.call", "  renderPrimes();\n", "")
sub("bilan2027", '<div class="sec">Bilan 2027 — après prime EDF (12 à 18 mois)</div>',
                 '<div class="sec">Bilan 2027 — deuxième année</div>')

RENDERAIDES_OLD = '''function renderAides(){
  const prime=getPrimeEDF(S.centrale.kWc,'N');
  const rate=Math.round(getPrimeRate(S.centrale.kWc,'N'));
  const form=S.centrale.primeForm;
  const total=prime+form;
  document.getElementById('aidesBlock').innerHTML=`
    <div style="display:flex;flex-direction:column;gap:0">
      <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--bdr)">
        <div><div style="font-size:13px;font-weight:500;color:var(--txt)">Prime EDF OA (S24-ZNI)</div><div style="font-size:10px;color:var(--txt3);margin-top:1px">Versement 12 à 18 mois après installation — ${S.centrale.kWc} kWc × ${rate} €/kWc</div></div>
        <div class="mono" style="font-size:20px;color:var(--grn-l)">${prime.toLocaleString('fr')} €</div>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--bdr)">
        <div><div style="font-size:13px;font-weight:500;color:var(--txt)">Remise</div><div style="font-size:10px;color:var(--txt3);margin-top:1px">${S.centrale.bat>0?'Installation avec batterie':'Installation sans batterie'}</div></div>
        <div class="mono" style="font-size:20px;color:var(--grn-l)">${form.toLocaleString('fr')} €</div>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0">
        <div style="font-size:14px;font-weight:500;color:var(--txt)">Total des aides</div>
        <div class="mono" style="font-size:24px;color:var(--amb-l);font-weight:500">${total.toLocaleString('fr')} €</div>
      </div>
    </div>`;
}'''
RENDERAIDES_NEW = '''function renderAides(){
  const form=S.centrale.primeForm;
  document.getElementById('aidesBlock').innerHTML=`
    <div style="display:flex;flex-direction:column;gap:0">
      <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0">
        <div><div style="font-size:13px;font-weight:500;color:var(--txt)">Remise Ecologreen</div><div style="font-size:10px;color:var(--txt3);margin-top:1px">${S.centrale.bat>0?'Installation avec batterie':'Installation sans batterie'} — déduite du prix du kit</div></div>
        <div class="mono" style="font-size:24px;color:var(--amb-l);font-weight:500">${form.toLocaleString('fr')} €</div>
      </div>
    </div>`;
}'''
sub("renderAides", RENDERAIDES_OLD, RENDERAIDES_NEW)

# libellé section « Aides disponibles » → « Remise »
sub("aides.sec", '<div class="sec">Aides disponibles</div>', '<div class="sec">Remise Ecologreen</div>')

# ─────────────────────────────────────────────────────────────────────────────
# 15) DEVISE : € → Rs (global — le caractère € n'apparaît que dans le code applicatif)
# ─────────────────────────────────────────────────────────────────────────────
euro_before = html.count("€")
html = html.replace("€", "Rs")
if euro_before == 0:
    errors.append("[€→Rs] aucun € trouvé (suspect)")

print("Étape données/CEB OK" if not errors else "ERREURS phase 1:")
for e in errors:
    print("  -", e)

with open(DST, "w", encoding="utf-8") as f:
    f.write(html)
print(f"\nÉcrit {DST} ({len(html)} octets). Erreurs: {len(errors)}")
sys.exit(1 if errors else 0)
