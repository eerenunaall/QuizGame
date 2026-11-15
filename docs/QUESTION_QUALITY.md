# QUIZ PARTY — QUESTION QUALITY & AI AUDIT RUBRIC
Version: 1.0

## Goal

Every production question must feel human-authored, factually defensible, natural in Turkish, fun to answer, and suitable for a premium party game.

A question must not enter ACTIVE status solely because an LLM says it is correct.

---

# 1. HARD REJECT RULES

Immediate REJECT if any applies:

- two or more defensible correct answers
- incorrect official answer
- fabricated fact
- unsupported claim presented as fact
- answer is not among options
- duplicate/near-duplicate of an existing question
- question wording reveals answer
- answer length/grammar strongly reveals answer
- category mismatch
- broken Turkish
- nonsensical distractors
- source cannot support the claim for a source-required category
- current fact is stale
- copyrighted text copied from a source
- unsafe/defamatory/targeted personal content
- political/current-event claim without freshness controls
- question is essentially a trivial template repeated at scale

---

# 2. SCORING

Score each dimension 0–5.

Fact Accuracy
0 = false
1 = highly uncertain
2 = partly supported
3 = mostly supported
4 = strong
5 = verified and stable

Clarity
0 = unintelligible
1 = confusing
2 = awkward
3 = clear
4 = very clear
5 = effortless

Uniqueness
0 = duplicate
1 = near duplicate
2 = derivative
3 = distinct
4 = clearly distinct
5 = genuinely original angle

Distractor Quality
0 = nonsense
1 = giveaway
2 = weak
3 = plausible
4 = strong
5 = highly convincing

Language Quality
0 = broken
1 = unnatural
2 = awkward
3 = natural
4 = editor quality
5 = polished native copy

Difficulty Accuracy
0 = wildly misclassified
1 = very wrong
2 = somewhat wrong
3 = acceptable
4 = calibrated
5 = empirically calibrated

Gameplay Value
0 = boring
1 = filler
2 = acceptable
3 = good
4 = fun
5 = highly engaging

Answer Fairness
0 = multiple correct/invalid
1 = serious ambiguity
2 = questionable
3 = fair
4 = very fair
5 = unmistakably fair

Freshness
0 = obsolete
1 = likely stale
2 = uncertain
3 = current
4 = recently verified
5 = stable evergreen or current verified fact

AI-Slop Risk
0 = obviously bot-like
1 = strongly formulaic
2 = slightly formulaic
3 = acceptable
4 = natural
5 = indistinguishable from edited human trivia copy

---

# 3. REQUIRED MINIMUM

Automatic approval requires:

Fact Accuracy >= 4
Clarity >= 4
Distractor Quality >= 4
Language Quality >= 4
Answer Fairness >= 4
Gameplay Value >= 3
AI-Slop Risk >= 4

No hard-reject rule may be present.

---

# 4. STYLE RULES

Avoid:

- repeating the same opening syntax
- excessive “Aşağıdakilerden hangisi…”
- fake conversational filler
- unnecessary parenthetical explanations
- excessive historical padding
- robotic transitions
- repetitive sentence lengths
- obviously synthetic distractors
- distractors from unrelated categories

Vary:

- direct questions
- contextual questions
- chronological questions
- comparison questions
- clue-based questions
- “which one / which city / which person” forms
- cause/effect
- visual identification where supported
- terminology
- cultural knowledge

But variation must remain natural.

---

# 5. DISTRACTOR DESIGN

Good distractors should be:

- same semantic family
- same general scale
- plausible to a knowledgeable but rushed player
- clearly incorrect after reasoning or knowledge

Bad:

Correct: Ankara
A: Ankara
B: Banana
C: Tokyo
D: 17th century

Better:
A: Ankara
B: Istanbul
C: İzmir
D: Bursa

Do not make the correct answer:

- always longest
- always most detailed
- always grammatically unique
- always the only option with parentheses
- always option B

Correct-answer positions must be statistically balanced.

---

# 6. HUMAN EDITOR TEST

Ask:

“Would an experienced trivia editor put this exact question into a commercial party game?”

If hesitation is significant:
REVIEW.

Ask:

“Would a player naturally complain that this question is unfair?”

If yes:
REJECT or REWRITE.

Ask:

“Does this feel like it came from a language model?”

If yes:
REWRITE.

---

# 7. FINAL AUDIT OUTPUT

For every audited question output structured data:

{
  "questionId": "...",
  "status": "PASS|REVIEW|REJECT",
  "scores": {
    "factAccuracy": 0,
    "clarity": 0,
    "uniqueness": 0,
    "distractorQuality": 0,
    "languageQuality": 0,
    "difficultyAccuracy": 0,
    "gameplayValue": 0,
    "answerFairness": 0,
    "freshness": 0,
    "aiSlopRisk": 0
  },
  "hardRejectReasons": [],
  "reviewReasons": [],
  "suggestedRewrite": null
}

Never rewrite a rejected factual question by inventing facts.
A rewrite must preserve the supported fact.

---

# 8. MULTI-MODEL PIPELINE

Recommended:

Generator A
→ Generator B / alternate framing
→ Fact Checker
→ Ambiguity Critic
→ Language Editor
→ Difficulty Judge
→ Gameplay Judge
→ Final Arbiter

Use expensive reasoning where it produces the most value.

Do not spend premium model tokens equally on:

- obvious trivia
- high-risk disputed facts
- nuanced historical claims

Use risk-based routing.

---

# 9. PLAYER TELEMETRY FEEDBACK

Use production data to detect:

- suspiciously low/high correct rate
- one distractor overperforming
- high report rate
- high skip rate
- unusually long answer time
- repeated “dispute” feedback

Telemetry can move a question:

ACTIVE
→ REVIEW

Never silently change historical results.

---

# 10. HUMAN REVIEW QUEUE PRIORITY

Highest priority:

1. multiple answer disputes
2. high report rate
3. outdated/current events
4. high semantic duplicate score
5. large answer distribution anomaly
6. low AI-slop score
7. questionable source
8. category mismatch

---

# 11. QUESTION GENERATION BATCH CONTRACT

Every generated batch must include:

- requested category
- requested subcategory
- difficulty target
- language
- source requirements
- style constraints
- diversity constraints
- duplicate exclusion
- output schema

Never accept prose-only output for production import.

---

# 12. CONTINUOUS MAINTENANCE

Evergreen questions:

review periodically.

Current-event questions:

- mandatory expiration/review date
- explicit last-verified date
- automatic REVIEW when expired

Question bank maintenance is a live operation, not a one-time launch task.