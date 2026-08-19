/**
 * Paste guard (MAIN world) — the primary protection in v5.
 *
 * Instead of waiting for the prompt to be sent and rewriting the outgoing
 * request, AvoPseudo now steps in at the moment sensitive text *enters* the
 * page: the paste. Ctrl/⌘+V, the right-click "Paste" menu item and the on-screen
 * paste buttons all raise the same `paste` event, so one capture-phase listener
 * covers them.
 *
 * The flow:
 *
 *   paste → read text/plain → evaluate(text, rules) [+ optional NER]
 *         → block: insert nothing
 *         → anonymize: insert the pseudonymised text, list every substitution
 *         → warn: insert the original, warn
 *         → nothing found: let the browser paste natively (best fidelity)
 *
 * The user is *always* told when we changed what they pasted, by a branded
 * panel that cannot be confused with the site or with the AI (see
 * `ui/paste-notice.ts`).
 */

import { evaluate } from "@/core/rules/engine";
import { mergeNerFindings } from "@/core/ner/merge";
import type { NerEntity } from "@/core/ner/types";
import type { CompiledRules, RuleFinding } from "@/core/rules/types";
import type { GuardConfig, DetectionAction } from "@/shared/messages";
import type { IAnonymizer } from "@/shared/types";
import {
  findComposer,
  insertText,
  replaceInComposer,
  restoreSelection,
  snapshotSelection,
  type Composer,
} from "@/content/composer";
import { planPaste, type PastePlan } from "@/content/paste-plan";
import { showBanner } from "@/ui/banner";
import {
  hidePastePending,
  pulseComposer,
  showPasteNotice,
  showPastePending,
} from "@/ui/paste-notice";

/**
 * Above this size we stay out of the way: the paste is almost certainly a file
 * dump rather than a prompt, and rewriting it would cost more than it protects.
 */
const MAX_PASTE_CHARS = 200_000;

/**
 * The model gets much less time than on the send path — a paste must feel
 * instant. On timeout we fall back to the regex findings alone.
 */
const NER_PASTE_TIMEOUT_MS = 3000;

/** Below this length, waiting on the model is not worth the delay. */
const NER_MIN_CHARS = 12;

export interface PasteGuardDeps {
  getConfig(): GuardConfig;
  getRules(): CompiledRules;
  anonymizer: IAnonymizer;
  /** Ask the ISOLATED bridge to run the on-device NER model. */
  requestNer(text: string, timeoutMs: number): Promise<NerEntity[]>;
  /** Record what happened, for the badge / popup activity feed. */
  emit(action: DetectionAction, findings: RuleFinding[]): void;
}

/** Map a plan outcome onto the action vocabulary used by the activity log. */
const OUTCOME_ACTION: Record<PastePlan["outcome"], DetectionAction> = {
  clean: "clean",
  pseudonymised: "anonymized",
  warned: "warned",
  blocked: "blocked",
};

/**
 * Apply a plan to the composer and tell the user what we did.
 * `restore` re-establishes the caret first when the decision took a detour
 * through the async NER pass.
 */
function applyPlan(deps: PasteGuardDeps, composer: Composer, plan: PastePlan): void {
  if (plan.outcome === "blocked") {
    showPasteNotice({
      outcome: "blocked",
      replacements: [],
      ruleIds: plan.ruleIds,
      anchor: composer,
    });
    pulseComposer(composer, "blocked");
    deps.emit(OUTCOME_ACTION.blocked, plan.findings);
    return;
  }

  const inserted = insertText(composer, plan.text);

  if (plan.outcome === "pseudonymised") {
    pulseComposer(composer, "pseudonymised");
    showPasteNotice({
      outcome: "pseudonymised",
      replacements: plan.replacements,
      ruleIds: plan.ruleIds,
      anchor: composer,
      // Only offer the undo when we actually managed to write the text.
      onUndo: inserted
        ? () => {
            if (!replaceInComposer(composer, plan.text, plan.original)) {
              showBanner({
                message: "Could not restore your original text — the box has changed too much.",
                tone: "warn",
              });
            }
          }
        : undefined,
    });
  } else if (plan.outcome === "warned") {
    showPasteNotice({
      outcome: "warned",
      replacements: [],
      ruleIds: plan.ruleIds,
      anchor: composer,
    });
    pulseComposer(composer, "warned");
  }

  if (plan.outcome !== "clean") deps.emit(OUTCOME_ACTION[plan.outcome], plan.findings);
}

/**
 * Install the capture-phase paste listener. Idempotent per page: a second call
 * replaces nothing, so callers should invoke it once.
 */
export function installPasteGuard(deps: PasteGuardDeps): void {
  document.addEventListener(
    "paste",
    (event: ClipboardEvent) => {
      try {
        const config = deps.getConfig();
        if (!config.enabled || !config.pasteGuard) return;

        const composer = findComposer(event.target);
        if (!composer) return;

        const data = event.clipboardData;
        if (!data) return;
        const text = data.getData("text/plain");
        if (!text || text.trim().length === 0) return;
        if (text.length > MAX_PASTE_CHARS) return;

        const rules = deps.getRules();
        const base = evaluate(text, rules);
        const useNer = Boolean(config.ner?.enabled) && text.length >= NER_MIN_CHARS;

        if (!useNer) {
          // Nothing to change → let the browser do its own, higher-fidelity
          // paste (keeps rich content, the editor's own undo stack, etc.).
          if (base.findings.length === 0 || base.decision === null) return;

          // We take over: stop the page's own paste handling so the text is
          // never inserted twice (ProseMirror & friends handle paste too).
          event.preventDefault();
          event.stopImmediatePropagation();
          applyPlan(deps, composer, planPaste(text, base, deps.anonymizer));
          return;
        }

        // The model answers asynchronously, so we must claim the paste before
        // we know whether anything will be found.
        event.preventDefault();
        event.stopImmediatePropagation();
        const selection = snapshotSelection(composer);
        showPastePending(composer);

        void (async () => {
          let result = base;
          try {
            const entities = await deps.requestNer(text, NER_PASTE_TIMEOUT_MS);
            result = mergeNerFindings(text, base, entities, config.ner, rules.whitelist);
          } catch {
            /* fall back to the regex findings */
          }
          hidePastePending();
          restoreSelection(composer, selection);
          applyPlan(deps, composer, planPaste(text, result, deps.anonymizer));
        })();
      } catch {
        // Any failure here must leave the page exactly as it was.
        hidePastePending();
      }
    },
    true,
  );
}
