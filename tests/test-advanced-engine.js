/**
 * LLM Guard — Tests du moteur de détection avancé
 * 
 * Démontre ce que chaque couche attrape que les précédentes ratent.
 * Usage : node tests/test-advanced-engine.js
 */

const { levenshtein, normalize } = require("../utils.js");
const {
  scanRegex,
  scanFuzzy,
  detectObfuscation,
  scanContextual,
} = require("../advanced-engine.js");

let passed = 0, failed = 0, total = 0;
function test(name, fn) {
  total++;
  try { fn(); passed++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
  catch (e) { failed++; console.log(`  \x1b[31m✗\x1b[0m ${name}\n    \x1b[31m${e.message}\x1b[0m`); }
}
function assert(c, m) { if (!c) throw new Error(m || "Assertion failed"); }

// ═══════════════════════════════════════════════════════════════
// COUCHE 1 — Tests Regex (rappel)
// ═══════════════════════════════════════════════════════════════

console.log("\n\x1b[1m\x1b[36m━━━ COUCHE 1 : Regex ━━━\x1b[0m");
console.log("\x1b[2mDétecte les formes exactes de PII\x1b[0m\n");

test("Email standard", () => {
  const f = scanRegex("Contacte jean@test.fr");
  assert(f.some(x => x.type === "Email"), "Email non détecté");
});

test("IBAN", () => {
  const f = scanRegex("Virement sur FR76 3000 6000 0112 3456 789");
  assert(f.some(x => x.type === "IBAN"), "IBAN non détecté");
});

console.log("\n\x1b[33m  ⚠ Ce que la couche 1 RATE :\x1b[0m");

test("Email épelé → RATÉ par regex", () => {
  const f = scanRegex("Écris à sophie point martin arobase gmail point com");
  assert(f.length === 0, "Regex ne devrait PAS capter un email épelé");
});

test("Mot-clé avec faute → RATÉ par regex", () => {
  const f = scanRegex("Voici le salaure de l'employé");
  assert(f.length === 0, "Regex ne devrait PAS capter une faute d'ortho");
});

test("Données médicales contextuelles → RATÉ par regex", () => {
  const f = scanRegex("Le patient a subi une opération du genou mardi");
  assert(f.length === 0, "Regex ne voit pas le contexte médical");
});


// ═══════════════════════════════════════════════════════════════
// COUCHE 2 — Tests Fuzzy Matching
// ═══════════════════════════════════════════════════════════════

console.log("\n\x1b[1m\x1b[36m━━━ COUCHE 2 : Fuzzy Matching ━━━\x1b[0m");
console.log("\x1b[2mDétecte les fautes, l'obfuscation, les variantes\x1b[0m\n");

// --- Levenshtein ---
test("Levenshtein : identique = 0", () => {
  assert(levenshtein("salaire", "salaire") === 0, "Devrait être 0");
});

test("Levenshtein : 1 lettre changée = 1", () => {
  assert(levenshtein("salaire", "salaure") === 1, "Devrait être 1");
});

test("Levenshtein : 2 lettres changées = 2", () => {
  assert(levenshtein("salaire", "saluere") === 2, `Obtenu: ${levenshtein("salaire", "saluere")}`);
});

// --- Normalisation ---
test("Normalise le leetspeak : s4l41r3 → salaire", () => {
  assert(normalize("s4l41r3") === "salaire", `Obtenu: ${normalize("s4l41r3")}`);
});

test("Normalise les séparateurs : s.a.l.a.i.r.e → salaire", () => {
  assert(normalize("s.a.l.a.i.r.e") === "salaire", `Obtenu: ${normalize("s.a.l.a.i.r.e")}`);
});

test("Normalise espaces + casse : S A L A I R E → salaire", () => {
  assert(normalize("S A L A I R E") === "salaire", `Obtenu: ${normalize("S A L A I R E")}`);
});

// --- Fuzzy keywords ---
test("Mot-clé exact : 'salaire' détecté", () => {
  const f = scanFuzzy("Le salaire est trop bas");
  assert(f.some(x => x.matchType === "exact"), "Devrait matcher exactement");
});

test("Mot-clé avec faute de frappe : 'salaure' détecté", () => {
  const f = scanFuzzy("Le salaure de l'employé est confidentiel");
  assert(f.some(x => x.matchType === "levenshtein"), `Résultats: ${JSON.stringify(f.map(x => x.type))}`);
});

test("Mot-clé avec faute : 'diagnostik' détecté", () => {
  const f = scanFuzzy("Le diagnostik du médecin est inquiétant");
  assert(f.some(x => x.matchType === "levenshtein"), "Devrait matcher par Levenshtein");
});

test("Groupe de mots dispersé : 'bulletin ... de ... paie' détecté", () => {
  const f = scanFuzzy("Envoie le bulletin mensuel de la paie de mars");
  assert(f.some(x => x.matchType === "dispersed"), `Résultats: ${JSON.stringify(f.map(x => x.type))}`);
});

// --- Obfuscation ---
test("Obfuscation par points : 'c.o.n.f.i.d.e.n.t.i.e.l'", () => {
  const f = detectObfuscation("Ce document est c.o.n.f.i.d.e.n.t.i.e.l");
  assert(f.some(x => x.matchType === "obfuscation"), `Résultats: ${JSON.stringify(f.map(x => x.type))}`);
});

test("Obfuscation par espaces : 's a l a i r e'", () => {
  const f = detectObfuscation("Le s a l a i r e de Pierre est de 50k");
  assert(f.some(x => x.matchType === "obfuscation"), "Devrait détecter l'obfuscation");
});

test("Email épelé : 'sophie point martin arobase gmail point com'", () => {
  const f = detectObfuscation("Écris à sophie point martin arobase gmail point com");
  assert(f.some(x => x.matchType === "spelled-email"), `Résultats: ${JSON.stringify(f.map(x => x.type))}`);
});

test("Téléphone en lettres : 'zéro six douze...'", () => {
  const f = detectObfuscation("Appelle le zéro six douze trente-quatre cinquante-six soixante-dix-huit");
  assert(f.some(x => x.matchType === "spelled-phone"), `Résultats: ${JSON.stringify(f.map(x => x.type))}`);
});

console.log("\n\x1b[33m  ⚠ Ce que la couche 2 RATE :\x1b[0m");

test("Données médicales implicites → RATÉ par fuzzy", () => {
  const f = scanFuzzy("L'employée a été hospitalisée après son opération");
  const f2 = detectObfuscation("L'employée a été hospitalisée après son opération");
  assert(f.length === 0 && f2.length === 0, "Fuzzy ne voit pas le contexte");
});


// ═══════════════════════════════════════════════════════════════
// COUCHE 3 — Tests Règles Contextuelles
// ═══════════════════════════════════════════════════════════════

console.log("\n\x1b[1m\x1b[36m━━━ COUCHE 3 : Règles contextuelles ━━━\x1b[0m");
console.log("\x1b[2mDétecte les combinaisons de mots suspectes\x1b[0m\n");

test("Données médicales implicites (personne + terme médical)", () => {
  const f = scanContextual("L'employée a subi une opération du genou la semaine dernière");
  assert(f.some(x => x.type === "Données médicales implicites"), `Résultats: ${JSON.stringify(f.map(x => x.type))}`);
});

test("Données médicales : 'le patient a un cancer'", () => {
  const f = scanContextual("Le patient a été diagnostiqué avec un cancer");
  assert(f.some(x => x.type === "Données médicales implicites"), "Devrait détecter");
});

test("Données financières implicites (personne + montant)", () => {
  const f = scanContextual("Le directeur financier gagne 120k€ par an");
  assert(f.some(x => x.type === "Données financières implicites"), `Résultats: ${JSON.stringify(f.map(x => x.type))}`);
});

test("Évaluation personnelle (personne + jugement)", () => {
  const f = scanContextual("L'employé est incompétent, on devrait le licencier");
  assert(f.some(x => x.type === "Évaluation personnelle"), "Devrait détecter l'évaluation");
});

test("Évaluation personnelle : 'entretien disciplinaire du salarié'", () => {
  const f = scanContextual("Le salarié a un entretien disciplinaire vendredi");
  assert(f.some(x => x.type === "Évaluation personnelle"), "Devrait détecter");
});

test("Localisation personnelle : 'Mme Dupont habite à...'", () => {
  const f = scanContextual("Mme Dupont habite à Marseille");
  // Note: "Mme" match personIndicators of both medical and localisation rules
  assert(f.some(x => x.category === "Données de localisation"), `Résultats: ${JSON.stringify(f.map(x => x.category))}`);
});

test("PAS de faux positif : question générique sur les salaires", () => {
  const f = scanContextual("Quel est le salaire moyen en France pour un développeur ?");
  assert(f.length === 0, `Faux positif : ${JSON.stringify(f.map(x => x.type))}`);
});

test("PAS de faux positif : question générique médicale", () => {
  const f = scanContextual("Comment fonctionne une opération de la cataracte ?");
  assert(f.length === 0, `Faux positif : ${JSON.stringify(f.map(x => x.type))}`);
});

console.log("\n\x1b[33m  ⚠ Ce que la couche 3 RATE :\x1b[0m");

test("Contexte très indirect → RATÉ par les règles", () => {
  const f = scanContextual("La personne que j'ai rencontrée hier au bureau avait l'air malade, je me demande si son problème de dos s'est aggravé");
  assert(f.length === 0, "Trop indirect pour les règles contextuelles");
});


// ═══════════════════════════════════════════════════════════════
// COUCHE 4 — Tests LLM (simulation)
// ═══════════════════════════════════════════════════════════════

console.log("\n\x1b[1m\x1b[36m━━━ COUCHE 4 : Classification LLM ━━━\x1b[0m");
console.log("\x1b[2mCe que seul un LLM peut comprendre\x1b[0m\n");

// On ne peut pas tester l'API ici, mais on documente les cas
const LLM_ONLY_CASES = [
  {
    prompt: "La personne que j'ai croisée hier au bureau, tu sais celle qui boite depuis son accident de ski, elle m'a dit qu'elle prenait du Doliprane tous les jours",
    why: "Aucun mot-clé médical classique, mais c'est clairement une donnée de santé sur une personne identifiable dans le contexte de la conversation",
  },
  {
    prompt: "Tu sais le gars du 3ème qui a le bureau près de la fenêtre ? Apparemment il vote extrême droite, ça se voit à ses discussions à la machine à café",
    why: "Opinion politique d'une personne identifiable par son emplacement (quasi-identifiant), sans aucun nom ni mot-clé RGPD exact",
  },
  {
    prompt: "Mon collègue m'a confié qu'il consulte un psy depuis 3 mois à cause de son divorce",
    why: "Données de santé mentale + situation familiale, compréhensible uniquement par le sens de la phrase",
  },
  {
    prompt: "Marie de la compta a pris un avocat, je crois qu'elle veut attaquer la boîte pour discrimination",
    why: "Donnée judiciaire potentielle + identification par prénom + service, nécessite la compréhension du contexte juridique",
  },
];

for (const c of LLM_ONLY_CASES) {
  test(`LLM nécessaire : "${c.prompt.slice(0, 60)}..."`, () => {
    const r = scanRegex(c.prompt);
    const f = scanFuzzy(c.prompt);
    const o = detectObfuscation(c.prompt);
    const ctx = scanContextual(c.prompt);
    const allLocal = [...r, ...f, ...o, ...ctx];

    // Ces cas devraient idéalement être détectés, mais seul un LLM peut le faire
    console.log(`    \x1b[33m↳ Local: ${allLocal.length} findings | Raison LLM: ${c.why}\x1b[0m`);
    // Le test passe toujours — c'est informatif
    assert(true);
  });
}


// ═══════════════════════════════════════════════════════════════
// TESTS COMBINÉS — Cascade des couches
// ═══════════════════════════════════════════════════════════════

console.log("\n\x1b[1m\x1b[36m━━━ TESTS COMBINÉS ━━━\x1b[0m\n");

test("Un email standard → capté par couche 1 seule", () => {
  const text = "Envoie un mail à jean@test.fr";
  const r = scanRegex(text);
  const f = scanFuzzy(text);
  const c = scanContextual(text);
  assert(r.length > 0, "Regex devrait capter");
  // Fuzzy peut aussi capter, c'est OK
  console.log(`    \x1b[2m  Regex: ${r.length}, Fuzzy: ${f.length}, Contextuel: ${c.length}\x1b[0m`);
});

test("'salaure' avec faute → capté par couche 2 seule", () => {
  const text = "Le salaure est de 45000 euros";
  const r = scanRegex(text);
  const f = scanFuzzy(text);
  assert(r.length === 0, "Regex ne devrait PAS capter");
  assert(f.length > 0, "Fuzzy DEVRAIT capter");
});

test("Données médicales implicites → capté par couche 3 seule", () => {
  const text = "Le patient a une allergie sévère au gluten";
  const r = scanRegex(text);
  const f = scanFuzzy(text);
  const c = scanContextual(text);
  assert(r.length === 0, "Regex ne devrait PAS capter");
  // Fuzzy might catch "allergie" near "diagnostic" but probably not
  assert(c.length > 0, "Contextuel DEVRAIT capter");
  console.log(`    \x1b[2m  Regex: ${r.length}, Fuzzy: ${f.length}, Contextuel: ${c.length}\x1b[0m`);
});

test("Multi-couches : email + mot-clé obfusqué + contexte médical", () => {
  const text = "Envoie le d.o.s.s.i.e.r de jean@hopital.fr, le patient a subi une chirurgie";
  const r = scanRegex(text);
  const f = scanFuzzy(text);
  const o = detectObfuscation(text);
  const c = scanContextual(text);
  console.log(`    \x1b[2m  Regex: ${r.length}, Fuzzy: ${f.length}, Obfusc: ${o.length}, Contextuel: ${c.length}\x1b[0m`);
  const totalLayers = [r, f, o, c].filter(l => l.length > 0).length;
  assert(totalLayers >= 2, `Au moins 2 couches devraient détecter, obtenu: ${totalLayers}`);
});


// ═══════════════════════════════════════════════════════════════
// Résumé
// ═══════════════════════════════════════════════════════════════

console.log("\n" + "═".repeat(50));
if (failed === 0) {
  console.log(`\x1b[32m\x1b[1m  ✓ ${passed}/${total} tests réussis\x1b[0m`);
} else {
  console.log(`\x1b[31m\x1b[1m  ✗ ${failed} échoué(s) sur ${total}\x1b[0m`);
}
console.log("═".repeat(50));

console.log(`
\x1b[1mRésumé des couches :\x1b[0m
  Couche 1 (Regex)       → PII structurées (email, tel, IBAN, CB, NSS)
  Couche 2 (Fuzzy)       → Fautes de frappe, leetspeak, obfuscation, emails épelés
  Couche 3 (Contextuel)  → Combinaisons suspectes (personne + médical, personne + montant)
  Couche 4 (LLM)         → Compréhension sémantique profonde (nécessite API)
`);

process.exit(failed > 0 ? 1 : 0);
