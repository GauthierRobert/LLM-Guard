import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, catchError, of, tap } from 'rxjs';

import { ApiService, TimeRange } from './api.service';
import { LLMGuardEvent, StatsResponse } from './schema.generated';
import {
  ARTICLES,
  ComplianceArticle,
  FINDING_TYPE_TO_ARTICLES,
  Framework,
  PROHIBITED_SIGNALS,
  PROVIDER_JURISDICTIONS,
  ProviderInfo,
  RISK_TIERS,
  RiskTier,
} from './compliance.data';

export interface ComplianceScoreBreakdown {
  score: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  anonymizationRate: number;
  blockRate: number;
  criticalExposure: number;
  transferRisk: number;
  details: { label: string; value: number; weight: number; note: string }[];
}

export interface ProhibitedAlert {
  type: string;
  reason: string;
  count: number;
  article: ComplianceArticle;
}

export interface BreachStatus {
  active: boolean;
  triggeredAt: Date | null;
  deadline: Date | null;
  remainingMs: number;
  triggerReason: string;
}

export interface LLMRiskRow {
  llm: string;
  usageCount: number;
  tier: RiskTier;
  reason: string;
  jurisdiction: ProviderInfo | null;
}

const DEMO_STATS: StatsResponse = {
  total: 1847,
  clean: 1203,
  flagged: 412,
  blocked: 28,
  anonymized: 644,
  by_llm: { ChatGPT: 912, Claude: 482, Gemini: 241, Copilot: 156, Mistral: 38, DeepSeek: 18 },
  by_type: {
    email: 284,
    phone: 178,
    name: 221,
    iban: 47,
    credit_card: 12,
    ip: 93,
    health: 31,
    address: 64,
    password: 8,
    biometric: 3,
    emotion_workplace: 2,
  },
};

@Injectable({ providedIn: 'root' })
export class ComplianceService {
  private readonly api = inject(ApiService);

  private readonly _stats = signal<StatsResponse | null>(null);
  private readonly _events = signal<LLMGuardEvent[]>([]);

  readonly stats = computed<StatsResponse>(() => this._stats() ?? DEMO_STATS);
  readonly events = this._events.asReadonly();

  loadStats(range: TimeRange = '30d'): Observable<StatsResponse> {
    return this.api.stats(range).pipe(
      tap((s) => this._stats.set(s)),
      catchError(() => of(DEMO_STATS).pipe(tap((s) => this._stats.set(s)))),
    );
  }

  loadRecentEvents(limit = 200): Observable<LLMGuardEvent[]> {
    return this.api.events({ limit }).pipe(
      tap((r) => this._events.set(r.items)),
      catchError(() => of({ items: [] as LLMGuardEvent[], limit: 0, offset: 0 }).pipe(tap((r) => this._events.set(r.items)))),
    ) as unknown as Observable<LLMGuardEvent[]>;
  }

  // ---------- Articles ----------

  getArticle(id: string): ComplianceArticle | undefined {
    return ARTICLES[id];
  }

  articlesByFramework(framework: Framework): ComplianceArticle[] {
    return Object.values(ARTICLES).filter((a) => a.framework === framework);
  }

  articlesForFinding(findingType: string): ComplianceArticle[] {
    const ids = FINDING_TYPE_TO_ARTICLES[findingType.toLowerCase()] ?? ['gdpr-4'];
    return ids.map((id) => ARTICLES[id]).filter(Boolean);
  }

  // ---------- Feature 10: Compliance score ----------

  computeScore(): ComplianceScoreBreakdown {
    const s = this.stats();
    const total = Math.max(1, s.total);
    const sensitive = s.total - s.clean;
    const anonRate = sensitive > 0 ? s.anonymized / sensitive : 1;
    const blockRate = sensitive > 0 ? s.blocked / sensitive : 0;
    const critical = (s.by_type['health'] ?? 0) + (s.by_type['biometric'] ?? 0) + (s.by_type['ssn'] ?? 0) + (s.by_type['credit_card'] ?? 0) + (s.by_type['password'] ?? 0);
    const criticalRate = critical / total;

    const nonAdequateUsage = Object.entries(s.by_llm).reduce((sum, [llm, count]) => {
      const j = PROVIDER_JURISDICTIONS[llm];
      if (!j) return sum;
      if (j.adequacy === 'no_adequate') return sum + count * 1.0;
      if (j.adequacy === 'scc_required') return sum + count * 0.5;
      if (j.adequacy === 'dpf') return sum + count * 0.2;
      return sum;
    }, 0);
    const transferRisk = nonAdequateUsage / total;

    const coverage = Math.min(1, anonRate + blockRate);
    const coverageScore = coverage * 45;
    const criticalScore = (1 - Math.min(1, criticalRate * 20)) * 25;
    const transferScore = (1 - Math.min(1, transferRisk)) * 20;
    const hygieneScore = (s.clean / total) * 10;

    const score = Math.round(coverageScore + criticalScore + transferScore + hygieneScore);
    const grade: ComplianceScoreBreakdown['grade'] =
      score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 60 ? 'C' : score >= 45 ? 'D' : 'F';

    return {
      score,
      grade,
      anonymizationRate: anonRate,
      blockRate,
      criticalExposure: criticalRate,
      transferRisk,
      details: [
        { label: 'Couverture anonymisation / blocage', value: Math.round(coverageScore), weight: 45, note: `${Math.round(anonRate * 100)}% anonymisés, ${Math.round(blockRate * 100)}% bloqués` },
        { label: 'Exposition de données critiques', value: Math.round(criticalScore), weight: 25, note: `${critical} détections santé/biométrie/SSN/CB/mdp` },
        { label: 'Risque de transfert hors UE', value: Math.round(transferScore), weight: 20, note: `${Math.round(transferRisk * 100)}% du trafic vers juridictions non-adéquates` },
        { label: 'Hygiène globale', value: Math.round(hygieneScore), weight: 10, note: `${Math.round((s.clean / total) * 100)}% de prompts propres` },
      ],
    };
  }

  // ---------- Feature 3: Prohibited practices ----------

  prohibitedAlerts(): ProhibitedAlert[] {
    const s = this.stats();
    const alerts: ProhibitedAlert[] = [];
    for (const [type, count] of Object.entries(s.by_type)) {
      const reason = PROHIBITED_SIGNALS[type];
      if (reason && count > 0) {
        alerts.push({
          type,
          reason,
          count,
          article: ARTICLES['aia-5'],
        });
      }
    }
    return alerts.sort((a, b) => b.count - a.count);
  }

  // ---------- Feature 5: 72h breach timer ----------

  breachStatus(): BreachStatus {
    const s = this.stats();
    const critical = (s.by_type['health'] ?? 0) + (s.by_type['biometric'] ?? 0) + (s.by_type['ssn'] ?? 0) + (s.by_type['credit_card'] ?? 0);
    const threshold = 20;

    if (critical < threshold) {
      return { active: false, triggeredAt: null, deadline: null, remainingMs: 0, triggerReason: '' };
    }

    const now = Date.now();
    // Simulate breach trigger 6h ago for demo; in prod this would be stored server-side.
    const triggeredAt = new Date(now - 6 * 3600 * 1000);
    const deadline = new Date(triggeredAt.getTime() + 72 * 3600 * 1000);
    return {
      active: true,
      triggeredAt,
      deadline,
      remainingMs: Math.max(0, deadline.getTime() - now),
      triggerReason: `${critical} détections de catégories particulières (Art. 9 RGPD) dépassant le seuil de ${threshold}`,
    };
  }

  // ---------- Feature 4: Risk tier per LLM ----------

  riskTiers(): LLMRiskRow[] {
    const s = this.stats();
    const proh = new Set(this.prohibitedAlerts().map((a) => a.type));
    const hasProhibited = proh.size > 0;
    const criticalTypes = new Set(['health', 'biometric', 'ssn']);
    const hasCritical = Object.keys(s.by_type).some((t) => criticalTypes.has(t));

    return Object.entries(s.by_llm).map(([llm, usageCount]) => {
      const jurisdiction = PROVIDER_JURISDICTIONS[llm] ?? null;
      let tier: RiskTier;
      let reason: string;

      if (hasProhibited && usageCount > 50) {
        tier = 'unacceptable';
        reason = 'Usage intensif couplé à des signaux de pratiques interdites.';
      } else if (hasCritical && usageCount > 100) {
        tier = 'high';
        reason = 'Flux important avec données Art. 9 RGPD (santé/biométrie).';
      } else if (jurisdiction?.adequacy === 'no_adequate') {
        tier = 'high';
        reason = 'Transfert vers juridiction sans décision d\'adéquation.';
      } else if (usageCount > 50) {
        tier = 'limited';
        reason = 'Usage courant — obligations de transparence applicables.';
      } else {
        tier = 'minimal';
        reason = 'Faible volume, aucun signal de risque élevé.';
      }

      return { llm, usageCount, tier, reason, jurisdiction };
    }).sort((a, b) => b.usageCount - a.usageCount);
  }

  riskTierInfo(tier: RiskTier) {
    return RISK_TIERS[tier];
  }

  // ---------- Feature 7: Transfers ----------

  transferRows(): (ProviderInfo & { usageCount: number; share: number })[] {
    const s = this.stats();
    const total = Math.max(1, s.total);
    const rows = Object.entries(s.by_llm).map(([llm, count]) => {
      const j = PROVIDER_JURISDICTIONS[llm];
      if (!j) {
        return {
          llm,
          company: llm,
          country: 'Inconnu',
          countryCode: '??',
          region: 'Other' as const,
          adequacy: 'scc_required' as const,
          basis: 'Juridiction non identifiée — à documenter.',
          lat: 0,
          lng: 0,
          usageCount: count,
          share: count / total,
        };
      }
      return { ...j, usageCount: count, share: count / total };
    });
    return rows.sort((a, b) => b.usageCount - a.usageCount);
  }

  // ---------- Feature 2: DPIA / RoPA generation ----------

  generateDpia(orgId = 'demo-org'): string {
    const s = this.stats();
    const score = this.computeScore();
    const prohibited = this.prohibitedAlerts();
    const tiers = this.riskTiers();
    const transfers = this.transferRows();
    const now = new Date().toISOString().slice(0, 10);

    const sensitiveByType = Object.entries(s.by_type).sort((a, b) => b[1] - a[1]).slice(0, 10);
    const nonAdequate = transfers.filter((t) => t.adequacy === 'no_adequate' || t.adequacy === 'scc_required');

    return [
      `# Analyse d'impact relative à la protection des données (AIPD)`,
      ``,
      `**Organisation :** ${orgId}`,
      `**Date de génération :** ${now}`,
      `**Source :** LLM Guard — télémétrie des 30 derniers jours`,
      `**Score de conformité global :** ${score.score}/100 (${score.grade})`,
      ``,
      `## 1. Description des traitements`,
      ``,
      `Les collaborateurs de l'organisation interagissent avec des services d'IA générative tiers (ChatGPT, Claude, Gemini, Copilot, Mistral). L'extension LLM Guard intercepte ces interactions pour détecter, anonymiser ou bloquer les données à caractère personnel avant transmission.`,
      ``,
      `- **Volume observé :** ${s.total} invites analysées.`,
      `- **Propres (aucune donnée détectée) :** ${s.clean} (${Math.round((s.clean / Math.max(1, s.total)) * 100)}%).`,
      `- **Anonymisées avant envoi :** ${s.anonymized}.`,
      `- **Bloquées :** ${s.blocked}.`,
      `- **Détections sans action :** ${s.flagged}.`,
      ``,
      `## 2. Finalités`,
      ``,
      `- Assistance à la rédaction, à la synthèse et à la génération de code.`,
      `- Protection des données à caractère personnel par détection et anonymisation préalable.`,
      ``,
      `## 3. Catégories de données concernées`,
      ``,
      ...sensitiveByType.map(([t, c]) => {
        const arts = this.articlesForFinding(t).map((a) => a.number).join(', ');
        return `- **${t}** : ${c} occurrences — articles implicitement concernés : ${arts}.`;
      }),
      ``,
      `## 4. Destinataires et transferts (Chap. V RGPD)`,
      ``,
      ...transfers.map((t) => `- **${t.llm}** (${t.company}, ${t.country}) — ${t.usageCount} invites — base : ${t.basis}`),
      ``,
      nonAdequate.length > 0
        ? `> ⚠ **Transferts hors UE identifiés** (${nonAdequate.length}) : ${nonAdequate.map((t) => t.llm).join(', ')}. Des garanties appropriées (SCC, DPF, BCR) doivent être documentées.`
        : `> Aucun transfert hors UE sans garantie identifié.`,
      ``,
      `## 5. Évaluation des risques (EU AI Act)`,
      ``,
      ...tiers.map((r) => `- **${r.llm}** → ${RISK_TIERS[r.tier].label} : ${r.reason}`),
      ``,
      prohibited.length > 0
        ? `## 6. Pratiques interdites potentielles (Art. 5 IA Act)\n\n${prohibited.map((p) => `- **${p.type}** (${p.count}) : ${p.reason}`).join('\n')}\n`
        : `## 6. Pratiques interdites (Art. 5 IA Act)\n\nAucun signal de pratique interdite détecté sur la période.\n`,
      `## 7. Mesures techniques et organisationnelles`,
      ``,
      `- **Technique :** détection 4 couches (regex, fuzzy, contextuelle, LLM), anonymisation par jetons typés, dé-anonymisation des réponses.`,
      `- **Organisationnelle :** journalisation centralisée (cette plateforme), supervision humaine via dashboard SOC, formation (Art. 4 IA Act).`,
      `- **Minimisation (Art. 5(1)(c) RGPD) :** seul le contenu anonymisé est transmis aux LLM ; les prévisualisations journalisées sont nettoyées côté navigateur.`,
      ``,
      `## 8. Conclusion`,
      ``,
      `Risque résiduel évalué : **${score.grade === 'A' || score.grade === 'B' ? 'acceptable' : score.grade === 'C' ? 'modéré — plan d\'action recommandé' : 'élevé — mesures correctives requises'}**.`,
      ``,
      `Le présent document est régénéré automatiquement par LLM Guard. Il constitue un support d'AIPD au sens de l'article 35 RGPD et doit être validé par le DPO.`,
    ].join('\n');
  }

  generateRopaCsv(orgId = 'demo-org'): string {
    const s = this.stats();
    const now = new Date().toISOString().slice(0, 10);
    const header = ['Responsable', 'Finalité', 'Catégorie de données', 'Destinataire', 'Transfert hors UE', 'Base légale', 'Durée de conservation', 'Mesures de sécurité', 'Articles'];
    const rows: string[][] = [];
    for (const [llm, count] of Object.entries(s.by_llm)) {
      const j = PROVIDER_JURISDICTIONS[llm];
      const transfer = j && j.region !== 'EU' ? `${j.country} — ${j.basis}` : 'Non';
      for (const [type, c] of Object.entries(s.by_type)) {
        const arts = this.articlesForFinding(type).map((a) => a.number).join('; ');
        rows.push([
          orgId,
          `Assistance IA (${llm})`,
          `${type} (${c} occurrences)`,
          `${llm} — ${j?.company ?? 'inconnu'}`,
          transfer,
          'Intérêt légitime (Art. 6(1)(f))',
          '30 jours (télémétrie)',
          'Anonymisation LLM Guard',
          arts,
        ]);
      }
      if (Object.keys(s.by_type).length === 0) {
        rows.push([orgId, `Assistance IA (${llm})`, `Volume : ${count}`, `${llm}`, transfer, 'Intérêt légitime', '30 jours', 'Anonymisation LLM Guard', '']);
      }
    }
    const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
    return [`# RoPA LLM Guard — ${orgId} — ${now}`, header.map(escape).join(','), ...rows.map((r) => r.map(escape).join(','))].join('\n');
  }
}
