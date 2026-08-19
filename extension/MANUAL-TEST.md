# Manual test — v5 paste guard

Texts to paste into a real ChatGPT / Claude / Gemini / Copilot tab. Each one was
run through the bundled default ruleset, so the "expected" lists below are what
the engine actually produces, not a guess.

## Before you start

1. `npm run build` → load `dist/chrome` (Chrome) or `dist/firefox/manifest.json` (Firefox).
2. Open the popup: the version should read 5.0.0 and the switch be on.
3. **Paste each text with Ctrl/⌘+V** — typing it will not trigger anything, that
   is the whole point of v5.
4. The on-device name model is **on by default**. The very first paste downloads
   it (tens of MB) and will most likely hit the 3 s budget and fall back to the
   pattern rules. Paste twice, or switch it off in Settings, before judging speed.

---

## A. Main test — pseudonymisation

Realistic Belgian legal note. Triggers **21 findings across 15 rules**.

```
Bonjour,

Je prepare une note pour le dossier Dupont c. Immo Verhoeven SPRL, audience du 12 mars.

Notre cliente, Madame Sophie Lemaire, nee le 14/03/1978 a Namur, habite Rue de la Loi 42 a 1000 Bruxelles. Elle est joignable au +32 475 12 34 56 ou par mail a sophie.lemaire@lemaire-avocats.be. Son numero de registre national est 78.03.14-123.49 et son IBAN est BE68 5390 0754 7034.

La partie adverse est representee par Maitre Vincent Janssens (v.janssens@cabinet-exemple.be, tel. 02 512 34 56). La societe Immo Verhoeven SPRL est immatriculee a la TVA BE 0871.702.842.

Sa carte de paiement 4111 1111 1111 1111 a ete debitee a tort. L'indemnisation reclamee est de 12.500 EUR. Le dossier interne porte la reference client CLI-2024-0187.

Le serveur GED du cabinet repond sur 10.42.7.15 et sur https://ged.interne.cabinet.local.

Peux-tu me resumer les arguments juridiques principaux et me proposer un plan de plaidoirie ?
```

**Expected in the chat box** (placeholder digits will differ — they are salted per session):

```
Je prepare une note pour le [MATTER_xxxxxx], audience du 12 mars.

Notre cliente, [PERSON_xxxxxx], [DOB_xxxxxx] a Namur, habite [ADDRESS_xxxxxx] Bruxelles.
Elle est joignable au [PHONE_xxxxxx] ou par mail a [EMAIL_xxxxxx]. Son numero de registre
national est [NRN_xxxxxx] et son IBAN est [IBAN_xxxxxx].
…
```

**Expected panel:** "Pasted text pseudonymised — 21 values were replaced…", the
attribution line ("not from this website, and not from the AI"), a scrollable
list of the 21 substitutions with masked values, **Show originals**,
**Undo — paste my original**, **Got it**. The chat box flashes a blue outline.

Rules that should fire: `matter-name`, `person-title-fullname`, `birth-info`,
`address-street-first`, `phone-be` ×2, `email` ×2, `nrn-be`, `iban`,
`person-context-explicit`, `company-legal-form`, `vat-be`, `builtin-card`,
`case-financial-amount` ×2, `employee-or-client-id` ×3, `builtin-ip`,
`internal-host`.

### Then check, in order

- **Show originals** → the masked values become readable, the toggle flips to *Hide originals*.
- **Undo — paste my original** → the box goes back to the raw text, panel closes.
- Paste again, **send it**, and let the model answer — it will echo the
  placeholders. Open the popup → **Reveal real values**: the real values appear
  in the conversation, underlined. Click again to hide.
- Press **Escape** with the panel open → it closes. It also self-closes after 18 s.

---

## B. Quick smoke test (one line)

```
Merci d'appeler Madame Sophie Lemaire au +32 475 12 34 56 ou sur sophie.lemaire@lemaire-avocats.be, son IBAN est BE68 5390 0754 7034.
```

Expected: 4 replacements — `PERSON`, `PHONE`, `EMAIL`, `IBAN`.

---

## C. Block — nothing may land in the box

```
Voici la config du serveur: AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE et le mot de passe est Tr0ub4dor&3.
```

Expected: the chat box stays **empty**. Red panel, "Paste blocked — Nothing was
pasted. Your rules forbid sending this content to an AI service.", triggered
rules named, no undo button, and it does **not** auto-dismiss.

---

## D. Warn — pasted unchanged, with a warning

```
Le dossier medical du client mentionne une hospitalisation et une incapacite de travail. Il y a aussi une condamnation penale et un casier judiciaire au dossier. Ma strategie de defense reste couverte par le secret professionnel.
```

Expected: text appears **exactly as pasted**, amber panel "Sensitive data in
what you pasted", triggered rules: `special-category-data`, `criminal-data`,
`lawyer-confidentiality`.

> ⚠️ Write these keywords **without accents**. The bundled ruleset spells them
> unaccented and there is no accent folding, so `dossier médical` matches
> nothing while `dossier medical` does. See "Known quirks" below.

---

## E. Clean — the guard must stay out of the way

```
Peux-tu m'expliquer la difference entre une clause penale et des dommages et interets en droit belge ?
```

Expected: the text pastes normally (the browser's own paste), **no panel**, no
outline flash, nothing in the popup's activity list.

---

## F. Both composer shapes

The chat box is a rich `contenteditable` editor on **ChatGPT, Claude and
Gemini**, and a plain `<textarea>` on **Copilot and DeepSeek**. Run test B on one
of each — the insertion path differs (`execCommand` vs native value setter) and
this is where a site update would break things first.

Also worth a pass on each site:

- paste **into the middle** of text you already typed → only the pasted part is replaced, the caret ends after it;
- paste **over a selection** → the selection is replaced;
- paste with the **right-click menu** instead of the keyboard → identical behaviour.

---

## Known quirks (pre-existing ruleset behaviour, not v5 regressions)

These will show up in test A. They come from the rules, not the paste guard:

- **Context markers get swallowed.** `reference client CLI-2024-0187` becomes
  three placeholders including one for the words *"reference client"* itself;
  `L'indemnisation` is replaced by `[AMOUNT_…]`. The sentence loses the very
  context the model needs.
- **`address-street-first` is greedy**: it eats `Rue de la Loi 42 a 1000` and
  leaves a bare `Bruxelles` behind.
- **`phone-be` outranks `bce-dotted`**: a Belgian company number like
  `0403.199.702` is labelled `[PHONE_…]`.
- **No accent folding** (see test D).

The default whitelist no longer exempts `example.com` / `.org` / `.net`, so a
throwaway test address is pseudonymised like a real one. Only loopback and
well-known network constants stay exempt (`127.0.0.1`, `0.0.0.0`,
`255.255.255.0`, `8.8.8.8`, `1.1.1.1`, `192.168.0.1`, `192.168.1.1`,
`localhost`) — say the word if those should go too.
