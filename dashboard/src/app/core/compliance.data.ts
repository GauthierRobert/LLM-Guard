/**
 * Compliance knowledge base: GDPR + EU AI Act articles, finding-type mappings,
 * LLM provider jurisdictions, AI Act risk tiers.
 *
 * Everything in this file is static reference data. Computations live in
 * compliance.service.ts.
 */

export type Framework = 'GDPR' | 'AI_ACT';

export interface ComplianceArticle {
  id: string;
  framework: Framework;
  number: string;
  title: string;
  summary: string;
  fullText: string;
  url: string;
}

export const ARTICLES: Record<string, ComplianceArticle> = {
  // ---------- GDPR ----------
  'gdpr-4': {
    id: 'gdpr-4',
    framework: 'GDPR',
    number: 'Art. 4(1)',
    title: 'Définition de donnée à caractère personnel',
    summary: 'Toute information se rapportant à une personne physique identifiée ou identifiable.',
    fullText:
      'Constitue une donnée à caractère personnel toute information se rapportant à une personne physique identifiée ou identifiable, directement ou indirectement, notamment par référence à un identifiant tel qu\'un nom, un numéro d\'identification, des données de localisation, un identifiant en ligne, ou à un ou plusieurs éléments propres à son identité physique, physiologique, génétique, psychique, économique, culturelle ou sociale.',
    url: 'https://eur-lex.europa.eu/legal-content/FR/TXT/?uri=CELEX%3A32016R0679#d1e1489-1-1',
  },
  'gdpr-5-1-c': {
    id: 'gdpr-5-1-c',
    framework: 'GDPR',
    number: 'Art. 5(1)(c)',
    title: 'Minimisation des données',
    summary: 'Les données doivent être adéquates, pertinentes et limitées à ce qui est nécessaire.',
    fullText:
      'Les données à caractère personnel doivent être adéquates, pertinentes et limitées à ce qui est nécessaire au regard des finalités pour lesquelles elles sont traitées (« minimisation des données »).',
    url: 'https://eur-lex.europa.eu/eli/reg/2016/679/oj#d1e1833-1-1',
  },
  'gdpr-5-1-e': {
    id: 'gdpr-5-1-e',
    framework: 'GDPR',
    number: 'Art. 5(1)(e)',
    title: 'Limitation de la conservation',
    summary: 'Les données ne doivent pas être conservées plus longtemps que nécessaire.',
    fullText:
      'Les données à caractère personnel doivent être conservées sous une forme permettant l\'identification des personnes concernées pendant une durée n\'excédant pas celle nécessaire.',
    url: 'https://eur-lex.europa.eu/eli/reg/2016/679/oj',
  },
  'gdpr-9': {
    id: 'gdpr-9',
    framework: 'GDPR',
    number: 'Art. 9',
    title: 'Catégories particulières de données',
    summary: 'Traitement interdit par défaut pour santé, religion, origine, orientation, biométrie, etc.',
    fullText:
      'Le traitement des données à caractère personnel qui révèle l\'origine raciale ou ethnique, les opinions politiques, les convictions religieuses ou philosophiques ou l\'appartenance syndicale, ainsi que le traitement des données génétiques, des données biométriques aux fins d\'identifier une personne physique de manière unique, des données concernant la santé ou des données concernant la vie sexuelle ou l\'orientation sexuelle sont interdits.',
    url: 'https://eur-lex.europa.eu/eli/reg/2016/679/oj',
  },
  'gdpr-17': {
    id: 'gdpr-17',
    framework: 'GDPR',
    number: 'Art. 17',
    title: 'Droit à l\'effacement',
    summary: 'Droit à l\'oubli : suppression des données sur demande de la personne concernée.',
    fullText:
      'La personne concernée a le droit d\'obtenir du responsable du traitement l\'effacement, dans les meilleurs délais, de données à caractère personnel la concernant.',
    url: 'https://eur-lex.europa.eu/eli/reg/2016/679/oj',
  },
  'gdpr-30': {
    id: 'gdpr-30',
    framework: 'GDPR',
    number: 'Art. 30',
    title: 'Registre des activités de traitement',
    summary: 'Tenue d\'un RoPA listant les traitements effectués par le responsable.',
    fullText:
      'Chaque responsable du traitement tient un registre des activités de traitement effectuées sous sa responsabilité.',
    url: 'https://eur-lex.europa.eu/eli/reg/2016/679/oj',
  },
  'gdpr-33': {
    id: 'gdpr-33',
    framework: 'GDPR',
    number: 'Art. 33',
    title: 'Notification de violation (72 h)',
    summary: 'Violation de données à notifier à l\'autorité de contrôle dans les 72 heures.',
    fullText:
      'En cas de violation de données à caractère personnel, le responsable du traitement en notifie la violation à l\'autorité de contrôle compétente, dans la mesure du possible 72 heures au plus tard après en avoir pris connaissance.',
    url: 'https://eur-lex.europa.eu/eli/reg/2016/679/oj',
  },
  'gdpr-35': {
    id: 'gdpr-35',
    framework: 'GDPR',
    number: 'Art. 35',
    title: 'Analyse d\'impact (DPIA)',
    summary: 'AIPD obligatoire pour traitements à risque élevé pour les droits des personnes.',
    fullText:
      'Lorsqu\'un type de traitement est susceptible d\'engendrer un risque élevé pour les droits et libertés des personnes physiques, le responsable du traitement effectue, avant le traitement, une analyse de l\'impact des opérations de traitement envisagées sur la protection des données à caractère personnel.',
    url: 'https://eur-lex.europa.eu/eli/reg/2016/679/oj',
  },
  'gdpr-44': {
    id: 'gdpr-44',
    framework: 'GDPR',
    number: 'Chap. V (Art. 44+)',
    title: 'Transferts hors UE',
    summary: 'Transferts vers pays tiers soumis à garanties (décision d\'adéquation, SCC, BCR).',
    fullText:
      'Un transfert, vers un pays tiers ou à une organisation internationale, de données à caractère personnel qui font ou sont destinées à faire l\'objet d\'un traitement après ce transfert ne peut avoir lieu que si [...] les conditions définies dans le présent chapitre sont respectées.',
    url: 'https://eur-lex.europa.eu/eli/reg/2016/679/oj',
  },

  // ---------- EU AI Act ----------
  'aia-4': {
    id: 'aia-4',
    framework: 'AI_ACT',
    number: 'Art. 4',
    title: 'Maîtrise de l\'IA (AI literacy)',
    summary: 'Les fournisseurs et déployeurs doivent assurer un niveau suffisant de compétences IA de leur personnel.',
    fullText:
      'Les fournisseurs et les déployeurs de systèmes d\'IA prennent des mesures pour garantir, dans toute la mesure du possible, un niveau suffisant de maîtrise de l\'IA de leur personnel et des autres personnes s\'occupant pour leur compte du fonctionnement et de l\'utilisation des systèmes d\'IA.',
    url: 'https://eur-lex.europa.eu/eli/reg/2024/1689/oj',
  },
  'aia-5': {
    id: 'aia-5',
    framework: 'AI_ACT',
    number: 'Art. 5',
    title: 'Pratiques d\'IA interdites',
    summary: 'Notation sociale, manipulation subliminale, reconnaissance d\'émotions au travail/école, catégorisation biométrique sensible.',
    fullText:
      'Sont interdits : (a) les systèmes d\'IA ayant recours à des techniques subliminales ; (b) l\'exploitation des vulnérabilités ; (c) la notation sociale ; (d) l\'évaluation du risque d\'infractions pénales ; (e) le scraping massif d\'images faciales ; (f) la reconnaissance des émotions sur le lieu de travail et dans l\'enseignement ; (g) la catégorisation biométrique révélant race, opinions politiques, convictions religieuses, vie sexuelle ; (h) l\'identification biométrique à distance en temps réel dans l\'espace public.',
    url: 'https://eur-lex.europa.eu/eli/reg/2024/1689/oj',
  },
  'aia-annex-iii': {
    id: 'aia-annex-iii',
    framework: 'AI_ACT',
    number: 'Annexe III',
    title: 'Systèmes d\'IA à haut risque',
    summary: 'Emploi, crédit, éducation, migration, maintien de l\'ordre, infrastructures critiques, justice.',
    fullText:
      'Sont considérés comme à haut risque les systèmes d\'IA destinés à être utilisés dans : (1) la biométrie ; (2) les infrastructures critiques ; (3) l\'éducation et la formation ; (4) l\'emploi, la gestion des travailleurs et l\'accès à l\'emploi indépendant ; (5) l\'accès aux services privés essentiels et aux services publics ; (6) les activités répressives ; (7) la migration, l\'asile et les contrôles aux frontières ; (8) l\'administration de la justice et les processus démocratiques.',
    url: 'https://eur-lex.europa.eu/eli/reg/2024/1689/oj',
  },
  'aia-13': {
    id: 'aia-13',
    framework: 'AI_ACT',
    number: 'Art. 13',
    title: 'Transparence et information des utilisateurs',
    summary: 'Systèmes à haut risque : instructions claires et traçabilité de leur fonctionnement.',
    fullText:
      'Les systèmes d\'IA à haut risque sont conçus et développés de manière à garantir que leur fonctionnement soit suffisamment transparent pour permettre aux déployeurs d\'interpréter les résultats du système et de les utiliser de manière appropriée.',
    url: 'https://eur-lex.europa.eu/eli/reg/2024/1689/oj',
  },
  'aia-50': {
    id: 'aia-50',
    framework: 'AI_ACT',
    number: 'Art. 50',
    title: 'Transparence des contenus générés',
    summary: 'Obligation d\'étiqueter les contenus générés ou manipulés par IA (watermarking).',
    fullText:
      'Les fournisseurs de systèmes d\'IA générative veillent à ce que les sorties des systèmes soient marquées dans un format lisible par machine et détectables comme ayant été générées ou manipulées artificiellement.',
    url: 'https://eur-lex.europa.eu/eli/reg/2024/1689/oj',
  },
  'aia-53': {
    id: 'aia-53',
    framework: 'AI_ACT',
    number: 'Art. 53',
    title: 'Obligations des modèles à usage général (GPAI)',
    summary: 'Documentation technique, résumé des données d\'entraînement, respect du droit d\'auteur.',
    fullText:
      'Les fournisseurs de modèles d\'IA à usage général élaborent et tiennent à jour la documentation technique du modèle, y compris son processus d\'entraînement et d\'essai, mettent en œuvre une politique de conformité au droit d\'auteur, et publient un résumé suffisamment détaillé du contenu utilisé pour l\'entraînement.',
    url: 'https://eur-lex.europa.eu/eli/reg/2024/1689/oj',
  },
};

/**
 * Maps detection outputs (PII types from rules/pii-patterns.js + categorized
 * keywords) to the compliance articles they implicate.
 */
export const FINDING_TYPE_TO_ARTICLES: Record<string, string[]> = {
  email: ['gdpr-4', 'gdpr-5-1-c'],
  phone: ['gdpr-4', 'gdpr-5-1-c'],
  phone_fr: ['gdpr-4', 'gdpr-5-1-c'],
  iban: ['gdpr-4', 'gdpr-5-1-c'],
  credit_card: ['gdpr-4', 'gdpr-5-1-c'],
  ssn: ['gdpr-4', 'gdpr-9'],
  nir: ['gdpr-4', 'gdpr-9'],
  ip: ['gdpr-4'],
  ipv4: ['gdpr-4'],
  ipv6: ['gdpr-4'],
  date: ['gdpr-4'],
  domain: ['gdpr-4'],
  password: ['gdpr-4', 'gdpr-5-1-c'],
  name: ['gdpr-4'],
  address: ['gdpr-4'],
  health: ['gdpr-9'],
  medical: ['gdpr-9'],
  religion: ['gdpr-9'],
  ethnicity: ['gdpr-9'],
  biometric: ['gdpr-9', 'aia-5'],
  political: ['gdpr-9'],
  sexual_orientation: ['gdpr-9'],
  trade_union: ['gdpr-9'],
  evaluation_person: ['gdpr-9', 'aia-annex-iii'],
  financial_person: ['gdpr-4', 'aia-annex-iii'],
  indirect_id: ['gdpr-4'],
  emotion: ['aia-5'],
  emotion_workplace: ['aia-5'],
  social_scoring: ['aia-5'],
  predictive_policing: ['aia-5'],
};

// ---------- LLM provider jurisdictions (Feature 7) ----------

export interface ProviderInfo {
  llm: string;
  company: string;
  country: string;
  countryCode: string;
  region: 'EU' | 'EEA' | 'UK' | 'US' | 'CN' | 'Other';
  adequacy: 'adequate' | 'dpf' | 'scc_required' | 'no_adequate';
  basis: string;
  lat: number;
  lng: number;
}

export const PROVIDER_JURISDICTIONS: Record<string, ProviderInfo> = {
  ChatGPT: {
    llm: 'ChatGPT',
    company: 'OpenAI',
    country: 'United States',
    countryCode: 'US',
    region: 'US',
    adequacy: 'dpf',
    basis: 'EU-US Data Privacy Framework (depuis juillet 2023) — statut surveillé suite à Schrems II.',
    lat: 37.77,
    lng: -122.42,
  },
  Claude: {
    llm: 'Claude',
    company: 'Anthropic',
    country: 'United States',
    countryCode: 'US',
    region: 'US',
    adequacy: 'dpf',
    basis: 'EU-US Data Privacy Framework — Anthropic certifié DPF.',
    lat: 37.77,
    lng: -122.42,
  },
  Gemini: {
    llm: 'Gemini',
    company: 'Google',
    country: 'United States',
    countryCode: 'US',
    region: 'US',
    adequacy: 'dpf',
    basis: 'EU-US Data Privacy Framework — Google LLC certifié DPF.',
    lat: 37.42,
    lng: -122.08,
  },
  Copilot: {
    llm: 'Copilot',
    company: 'Microsoft',
    country: 'United States',
    countryCode: 'US',
    region: 'US',
    adequacy: 'dpf',
    basis: 'EU-US Data Privacy Framework + SCC. Régions EU disponibles selon abonnement.',
    lat: 47.64,
    lng: -122.13,
  },
  Mistral: {
    llm: 'Mistral',
    company: 'Mistral AI',
    country: 'France',
    countryCode: 'FR',
    region: 'EU',
    adequacy: 'adequate',
    basis: 'Traitement intra-UE, aucun transfert hors EEE requis.',
    lat: 48.85,
    lng: 2.35,
  },
  Perplexity: {
    llm: 'Perplexity',
    company: 'Perplexity AI',
    country: 'United States',
    countryCode: 'US',
    region: 'US',
    adequacy: 'scc_required',
    basis: 'Clauses contractuelles types requises — pas de certification DPF confirmée.',
    lat: 37.77,
    lng: -122.42,
  },
  DeepSeek: {
    llm: 'DeepSeek',
    company: 'DeepSeek',
    country: 'China',
    countryCode: 'CN',
    region: 'CN',
    adequacy: 'no_adequate',
    basis: 'Aucune décision d\'adéquation. Transfert déconseillé — loi PIPL et accès gouvernemental.',
    lat: 39.9,
    lng: 116.4,
  },
  Grok: {
    llm: 'Grok',
    company: 'xAI',
    country: 'United States',
    countryCode: 'US',
    region: 'US',
    adequacy: 'scc_required',
    basis: 'Clauses contractuelles types requises — certification DPF non confirmée à ce jour.',
    lat: 37.77,
    lng: -122.42,
  },
};

// ---------- AI Act risk tiers (Feature 4) ----------

export type RiskTier = 'minimal' | 'limited' | 'high' | 'unacceptable';

export interface RiskTierInfo {
  tier: RiskTier;
  label: string;
  color: string;
  description: string;
  obligations: string;
}

export const RISK_TIERS: Record<RiskTier, RiskTierInfo> = {
  minimal: {
    tier: 'minimal',
    label: 'Risque minimal',
    color: '#5DCAA5',
    description: 'Usage général sans exposition de données personnelles ou sensibles.',
    obligations: 'Recommandation : code de conduite volontaire (Art. 95).',
  },
  limited: {
    tier: 'limited',
    label: 'Risque limité',
    color: '#85B7EB',
    description: 'Génération ou assistance avec données personnelles basiques.',
    obligations: 'Transparence (Art. 50) : informer les utilisateurs qu\'une IA est en jeu, watermarking des sorties.',
  },
  high: {
    tier: 'high',
    label: 'Haut risque',
    color: '#EF9F27',
    description: 'Usage dans emploi, crédit, éducation, justice, migration (Annexe III).',
    obligations: 'Système de gestion des risques, documentation, journalisation, supervision humaine, DPIA (Art. 8-17).',
  },
  unacceptable: {
    tier: 'unacceptable',
    label: 'Inacceptable',
    color: '#E24B4A',
    description: 'Pratiques interdites : notation sociale, reconnaissance d\'émotions au travail, manipulation.',
    obligations: 'Interdit (Art. 5) — usage à bloquer immédiatement.',
  },
};

/**
 * Heuristic signals that trigger a prohibited-practice alert (Feature 3).
 * Key = finding type or keyword fragment; value = short reason.
 */
export const PROHIBITED_SIGNALS: Record<string, string> = {
  emotion_workplace: 'Reconnaissance d\'émotions en contexte professionnel',
  emotion: 'Analyse d\'émotions détectée — vérifier le contexte (interdit si travail/école)',
  social_scoring: 'Notation sociale — pratique interdite (Art. 5(1)(c))',
  predictive_policing: 'Évaluation du risque d\'infraction — pratique interdite (Art. 5(1)(d))',
  biometric: 'Catégorisation biométrique sensible — interdite si pour déduire opinions/orientation',
};
