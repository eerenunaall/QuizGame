# QUIZ PARTY — FULL GDD + PRODUCTION BIBLE
## Working Title / Version
Quiz Party — GDD v1.0
Status: Production-ready specification draft
Primary platforms: TV browser / Desktop browser / supported console browser + iOS/Android companion app
Primary launch language: Turkish
Architecture target: Web-first game client + native mobile controller + authoritative realtime backend

---

# 0. EXECUTIVE PRODUCT DEFINITION

Quiz Party is a social, TV-first multiplayer trivia game.

The television/display is the stage.
The mobile phone is the controller.
The server is the game master.
The question bank is a living content platform.
AI is the content factory and quality-control layer, not the live game master.

The core experience:

1. Host opens Quiz Party on a TV/display browser.
2. A large QR code and short room code appear.
3. Players scan the QR code.
4. If the companion app is installed, the URL opens the app through Universal Links/App Links.
5. If the app is not installed, the phone falls back to a browser controller.
6. Players enter the room without requiring the same Wi-Fi.
7. Host starts the game.
8. TV runs the complete game-show experience.
9. Phones are fast, tactile controllers with hidden decisions, jokers, risk and sabotage.
10. Server owns timer, answer locking, scoring, room state, entitlements and anti-cheat.
11. A single Host purchase unlocks the full game for the purchasing account.
12. Other players join for free.
13. The question bank continuously expands and is periodically audited.

The intended feeling is NOT:
“a quiz website.”

The intended feeling is:
“a polished party game being played on the TV, with phones as controllers.”

The game should feel closer to a premium console/party-game presentation than to a conventional HTML page, while remaining easy to launch from a TV browser.

---

# 1. PRODUCT NORTH STAR

## 1.1 One-sentence value proposition

“Open it on the TV, scan the QR, grab your phone, and turn a group of friends into a chaotic game show in seconds.”

## 1.2 Product promise

- No mandatory account for every player.
- No mandatory app for every player.
- No Bluetooth pairing.
- No same-network requirement.
- No manual IP entry.
- No visible technical setup.
- One host can own the game while everyone else joins free.
- The core game is purchased once, not subscription-gated at launch.
- The content pool keeps growing.
- Personalized and blind social quizzes create endless group-specific content.

## 1.3 Core emotional goals

The game should repeatedly create:

- anticipation
- “I know this!”
- panic
- risk/reward decisions
- suspicion
- laughter
- betrayal
- comeback moments
- surprise
- “no way you knew that”
- “how did I lose that?”
- “one more game”

## 1.4 Anti-goals

Do not become:

- a sterile quiz app
- an AI trivia dump
- a generic SaaS dashboard
- a heavily paywalled mobile app
- an ad-filled controller
- a game with arbitrary/unfair difficulty spikes
- a game where latency decides winners
- a game where clients can fabricate scores
- a game requiring all players to be on the same Wi-Fi
- a UI that looks like ordinary forms on a television

---

# 2. PLATFORM STRATEGY

## 2.1 Display client

The display client is a responsive web application.

Target surfaces:

- Smart TV browsers
- Android/Google TV browser environments where available
- desktop/laptop browsers used as a TV/display substitute
- supported console browser environments
- projector-connected computer browsers

Target baseline:

- 16:9
- 1280×720 minimum functional resolution
- 1920×1080 primary target
- 4K supported through responsive scaling
- landscape only for TV/display mode
- keyboard navigation supported
- remote/arrow navigation supported
- no hover-only core interactions

## 2.2 Mobile controller

Native app:

- iOS
- Android

Recommended implementation:

- React Native
- TypeScript
- Expo/EAS where compatible with the chosen native billing/deep-link stack
- production-safe native modules for haptics, deep links and IAP

Fallback:

- mobile web controller

The native app is preferred, never a hard requirement for joining.

## 2.3 Desktop browser

Desktop browser can act as:

- TV display
- host display
- development/debug display
- secondary game screen

Desktop browsers should support:

- Chrome
- Edge
- Firefox
- Safari
- current stable versions plus previous stable where reasonable

## 2.4 Console browsers

Console support is capability based, not assumption based.

The implementation must:

- detect browser capabilities
- use feature detection
- avoid unsupported APIs
- fail gracefully
- provide a browser compatibility screen
- never declare console support purely because desktop Chrome works

Xbox browser environments may be treated as a first-class QA target when available.

PlayStation devices should be treated as “best effort / verify on target hardware” unless a supported user-accessible browser surface exists.

## 2.5 Same-network requirement

NONE.

The architecture MUST support:

- TV on home Wi-Fi + Player A on same Wi-Fi
- TV on home Wi-Fi + Player B on 5G
- Player C on another Wi-Fi
- mixed IPv4/IPv6 paths
- NAT environments
- variable latency

All realtime communication goes through the internet-facing server.

---

# 3. EXPERIENCE ARCHITECTURE

System decomposition:

TV / Display Web App
        |
        | HTTPS + WSS
        |
Realtime Game Server
        |
        +---- PostgreSQL
        |
        +---- Redis (optional at small scale; recommended for multi-instance)
        |
        +---- Entitlement Service
        |
        +---- Question Service
        |
        +---- Analytics
        |
        +---- Admin / Moderation
        |
Mobile App
        |
        +---- IAP
        +---- Deep Links
        +---- Haptics
        +---- WebSocket / HTTPS
        |
Mobile Web Controller fallback

Core principles:

- Server authoritative.
- Clients render server state.
- No client owns score.
- No client owns timer.
- No client receives unrevealed correct answers.
- Clients cannot choose an outcome.
- Payment entitlement is server-side.
- Question selection is server-side.
- Sabotage legality is server-side.
- Game progression is server-side.

---

# 4. RECOMMENDED TECH STACK

## 4.1 Monorepo

Use:

- pnpm
- Turborepo
- TypeScript

Suggested repository:

quiz-party/
  apps/
    web/
    realtime/
    mobile/
    admin/
  packages/
    shared/
    protocol/
    game-engine/
    question-schema/
    ui-tokens/
    validation/
    analytics/
  database/
    prisma/
  scripts/
    seed/
    question-audit/
    import/
    export/
  tests/
    unit/
    integration/
    websocket/
    e2e/
    mobile/
    red-team/
    compatibility/
  docs/
    GDD.md
    ARCHITECTURE.md
    PROTOCOL.md
    SECURITY.md
    QUESTION_QUALITY.md
    QA.md
    ADR/
  infra/
    deployment/
    monitoring/

## 4.2 Web

Recommended:

- Next.js
- React
- TypeScript
- CSS/Tailwind equivalent
- Motion/animation library
- WebSocket client
- Web Audio API for supported browsers
- SVG/CSS/canvas for effects where practical

Do not use Unity WebGL as the core client.

A lightweight web rendering approach gives:

- faster boot
- wider browser compatibility
- easier store/payment integration
- easier SEO/landing pages
- easier TV adaptation
- smaller footprint
- easier agent-generated codebase

Three.js/PixiJS/canvas can be introduced selectively if visual requirements need them.

## 4.3 Realtime

Dedicated Node runtime:

- Node.js
- WebSocket using ws or an equivalent stable WebSocket server
- typed protocol
- heartbeats
- connection registry
- session registry
- reconnect tokens

Do not place core realtime gameplay on a serverless-only architecture.

## 4.4 Database

PostgreSQL.

ORM:

- Prisma or equivalent mature TypeScript ORM.

Use PostgreSQL for durable state.

Use Redis when required for:

- multi-instance room coordination
- distributed locks
- rate limiting
- transient room/session data
- pub/sub
- scaling realtime instances

## 4.5 Authentication

Support two levels:

Anonymous player session:
- nickname
- generated session identity
- no full account required

Host account:
- email/social login or equivalent
- required for purchase ownership and persistent entitlement
- can later hold profile, stats and custom quizzes

Never force every player to register.

---

# 5. MOBILE APP STRATEGY

## 5.1 Mobile app positioning

The app is not “the game.”
It is the controller companion to the TV game.

Store listing message:

“Your phone is the controller. Your TV is the arena.”

## 5.2 App first-launch

Launch states:

A. Fresh install
B. Existing signed-in account
C. Deep-linked join
D. Browser fallback
E. Purchase result
F. Reconnect to active room

## 5.3 Join flow

TV shows:

QR
ROOM CODE: X7P4KQ

QR should resolve to:

https://quizparty.example/join/X7P4KQ

If the native app is installed:

- iOS Universal Link opens the app
- Android App Link opens the app

If app is not installed:

- normal browser opens the join landing page
- page offers App Store / Google Play
- “Continue in browser” remains available

Apple Associated Domains / Universal Links are designed specifically to bridge a website and native app, while users without the app can stay in the browser. Android App Links use verified HTTPS association and similarly route users directly into the app when installed, otherwise opening the website. [Source: Apple Developer associated domains / Universal Links; Android Developers App Links.]

## 5.4 Deferred join

If:

1. user scans QR
2. app is not installed
3. user installs app
4. app launches

the room code should be recoverable.

Implementation options:

- deferred deep-link provider
- short-lived pending join token stored by the web landing page and recovered after install where technically available
- fallback to six-character room code

Never block joining because deferred deep linking failed.

## 5.5 Mobile controller states

- Home
- Join
- Player identity
- Lobby
- Waiting
- Question action
- Joker selection
- Risk selection
- Sabotage selection
- Confirm choice
- Result feedback
- Intermission
- Final round
- Results
- Reconnect
- Purchase
- Profile
- Custom Quiz
- Blind Quiz responses

## 5.6 Controller design requirements

- one-handed use
- large hit targets
- minimal text during active question
- haptic response
- clear selected state
- clear locked state
- no accidental double tap
- no tiny controls
- high contrast
- one primary action per moment
- visual feedback within the same frame/interaction

---

# 6. PAYMENT AND ENTITLEMENT

## 6.1 Launch monetization philosophy

Primary purchase:

ONE-TIME FULL GAME UNLOCK.

Player model:

- Host owns the game.
- Other players join free.

The controller application itself should be free to download.

At launch, avoid requiring subscriptions to access the core game.

## 6.2 Free demo

Free experience should be sufficient to produce the “this is fun” moment.

Suggested free content:

- one rotating category
- limited game modes
- limited number of full sessions or a free starter playlist
- no intrusive ads in active gameplay
- no ads between questions
- no ad interruption of the TV presentation

The free tier exists to drive conversion, not to maximize ad inventory.

## 6.3 Full unlock

Working SKU:

QUIZPARTY_FULL_GAME

Concept:

- non-consumable / permanent unlock
- one purchase per account
- restores on new device
- usable across web TV and mobile app after server verification
- does not charge individual players in the same room

Suggested initial pricing hypothesis:

- test local-market equivalents around the €7.99–€9.99 full-game psychological range
- do not hardcode this into game code
- prices must come from store configuration
- run regional pricing experiments independently

## 6.4 iOS

For the iOS app, digital in-app functionality/full-game unlock should use Apple In-App Purchase / StoreKit unless a specific current storefront entitlement/exemption applies.

The application should:

1. fetch localized product metadata
2. show native purchase UI
3. complete StoreKit transaction
4. obtain transaction information
5. send signed transaction data to secure backend
6. backend validates
7. backend writes entitlement
8. app refreshes entitlement
9. active TV session receives entitlement update

Apple’s current review guidelines say features/functionality, premium content and full-version unlocks inside the app must use In-App Purchase; Apple also supports multiplatform apps allowing access to purchased features on other platforms, subject to the relevant requirements. [Apple App Review Guidelines 3.1.1 and 3.1.3(b).]

## 6.5 Android

Use Google Play Billing for the Android app.

Flow:

1. query ProductDetails
2. show localized price
3. launch billing flow
4. receive purchase token
5. send purchase token to backend
6. backend verifies with Google Play
7. backend grants entitlement
8. active room is notified

Google Play describes one-time products as single-charge purchases that can permanently unlock a digital benefit, and recommends secure backend verification of purchase tokens. [Android Developers Play Billing.]

## 6.6 Web purchases

Desktop/web purchasing can exist as a separate web checkout.

However:

- do not make mobile storefront apps bypass required in-app billing
- do not place a prohibited “buy cheaper on our website” CTA inside iOS app storefronts
- app-store-specific external purchase/link rules must be rechecked at implementation/submission time

## 6.7 TV purchase flow

TV must not require entering card details.

TV:

“UNLOCK FULL GAME”

QR:
“Scan with your phone.”

Phone:

- opens account
- offers native purchase if in app
- after purchase backend updates entitlement
- TV receives `ENTITLEMENT_GRANTED`

No manual code entry required when the session can be securely linked.

## 6.8 Entitlement model

User owns:

entitlement:
  accountId
  product
  platform
  sourceTransactionId
  status
  grantedAt
  revokedAt
  metadata

Room checks entitlement through server.

Never trust:

localStorage
mobile client flags
TV client flags
store receipt without verification
URL parameters
QR contents

## 6.9 Restore purchase

Must work.

A user reinstalling the app should be able to restore the full-game purchase.

The backend should be idempotent.

---

# 7. GAME MODES

## 7.1 Classic Chaos

Default mode.

10 rounds.

Each round:

- reveal
- optional pre-question power action
- question
- answers
- lock
- reveal
- score animation

## 7.2 Speed Round

Shorter timer.

Correct answers gain more speed-sensitive points.

Late answers lose the opportunity.

## 7.3 Risk Round

Before or during answer commitment, player can choose a stake multiplier or risk tier.

Example:

Safe:
100 points

Risk:
200 points

High Risk:
300 points

Correct:
stake awarded

Wrong:
stake lost

The legal stake values come from server rules.

## 7.4 Double Down

A limited-use player power.

Player chooses before answering:

DOUBLE

Correct:
2× reward

Wrong:
penalty according to mode rules

This power should be visibly dramatic on TV.

## 7.5 50/50

Two incorrect options are removed.

To avoid becoming a simple “free advantage,” the game may attach a tradeoff:

- higher reward multiplier
- consumes a rare token
- or changes scoring state

Initial implementation should use the simplest version:

50/50:
- remove two incorrect choices
- correct answer reward becomes 2× the base question value
- incorrect answer does not receive an exploitative extra penalty beyond the current mode

The exact balance must be tuned via playtests.

## 7.6 Sabotage

Player receives limited sabotage tokens.

Possible actions:

- Jam: target player loses a small amount of answer time
- Shuffle: target player's options visually reshuffle once
- Fog: one option is hidden briefly
- Noise: target player's controller gets a misleading visual prompt
- Lockout: target player cannot use one joker on the next question
- Point Tax: limited percentage reduction on next gain

Sabotage constraints:

- cannot make a player unable to play for an entire round
- cannot permanently target one person repeatedly
- server controls frequency
- target has visible counterplay where appropriate
- accessibility mode can disable disorienting effects
- all sabotage is presentation/decision manipulation, never fraudulent answer/result manipulation

## 7.7 Crowd Question

All players answer.

The game reveals the distribution.

This enables:

- majority statistics
- bait options
- “everyone thought A”
- comeback narratives

## 7.8 Blind Quiz

Personal answer-driven content.

A target player answers hidden questions before the party.

Question author cannot see the answer unless explicitly allowed.

During game:
- everyone including target can answer
- target’s original answer is revealed after voting
- optional “who said this?” mechanics

## 7.9 Who Said It?

Collect statements/opinions/facts from players.

Show one statement.

All players guess the author.

Then reveal author and optionally the original wording.

## 7.10 Final Round

Last round changes the rules.

Example:

- score multipliers
- risk decisions
- fewer answers
- dramatic countdown
- comeback opportunities
- no safe lead

Final should feel different, not like “Question 10 again.”

---

# 8. CORE GAME LOOP

State machine:

WAITING
→ LOBBY
→ COUNTDOWN
→ ROUND_INTRO
→ QUESTION_PREP
→ QUESTION
→ ANSWERING
→ LOCKED
→ REVEAL
→ POWER_RESOLUTION
→ SCORE_UPDATE
→ MICRO_INTERMISSION
→ NEXT_ROUND
→ FINAL
→ RESULTS
→ REMATCH / LOBBY / ROOM_CLOSED

## 8.1 State ownership

Server owns every state transition.

TV and phones receive snapshots/events.

## 8.2 Timer authority

Server defines:

- `questionStartedAt`
- `answerDeadlineAt`

Clients calculate visual countdown locally using synchronized server timestamps.

Client submission includes:
- room/session
- questionId
- answerId
- clientSentAt (diagnostic only)

Server decides whether submission arrived before deadline using server time.

## 8.3 Race handling

When two actions arrive at nearly the same time:

- server processes deterministically
- first valid action wins where appropriate
- duplicate actions ignored
- late actions rejected
- event sequence number increments monotonically

No “last UI frame” determines result.

---

# 9. QUESTION BANK PHILOSOPHY

The bank is a first-class product asset.

Goal:

- launch with approximately 50,000 approved questions
- grow continuously
- maintain high editorial quality
- retire weak/outdated material
- never dump raw AI generations into production

## 9.1 Quality standard

A question should feel like it came from an experienced human trivia editor.

It must NOT feel:

- generic
- repetitive
- overexplained
- oddly worded
- overly formal
- structurally predictable
- stuffed with unnecessary qualifiers
- written by a chatbot

## 9.2 Example bad question

“What is the capital city of Turkey?”

It is valid but often low-value trivia.

## 9.3 Better example

“In 1923, which city was formally designated as the capital of the newly established Republic of Turkey?”

Still factual, but the wording is contextualized.

Question style must vary naturally by category.

## 9.4 Initial content target

Illustrative 50K launch mix:

General Knowledge — 4,000
History — 5,000
Geography — 3,500
Science — 4,500
Nature — 2,500
Technology — 3,000
Art & Culture — 3,000
Literature — 3,000
Cinema & TV — 4,000
Music — 3,500
Gaming — 3,000
Sports — 4,000
Food & Drink — 2,000
Mythology & Folklore — 2,500
Language & Words — 2,500
Business & Economy — 2,000
Math & Logic — 2,000

Total: 50,000

Current Events should be maintained as a separate rapidly expiring pool.

## 9.5 Question lifecycle

DRAFT
→ GENERATED
→ NORMALIZED
→ DUPLICATE_CHECK
→ FACT_CHECK
→ ANSWER_CHECK
→ AMBIGUITY_CHECK
→ LANGUAGE_QA
→ DIFFICULTY_CALIBRATION
→ GAMEPLAY_REVIEW
→ APPROVED
→ ACTIVE
→ REVIEW
→ RETIRED

## 9.6 Data model

Question:

id
language
category
subcategory
topic
difficulty
question
answers[]
correctAnswerId
explanation
sourceUrl[]
sourceTitle[]
verifiedAt
verificationStatus
qualityScore
ambiguityScore
difficultyScore
gameplayScore
duplicateFingerprint
semanticFingerprint
authorType
createdAt
updatedAt
reviewStatus
lastUsedAt
usageCount
correctRate
averageAnswerTime
reportRate
skipRate

## 9.7 Multiple validation passes

Pass A — generator
Pass B — independent editor
Pass C — fact checker
Pass D — ambiguity critic
Pass E — language editor
Pass F — difficulty judge
Pass G — game designer/editor

A single model saying “approved” is not sufficient for high-value launch content.

## 9.8 Question generation requirements

The generator must:

- generate varied sentence structures
- vary answer-option patterns
- avoid obvious length clues
- avoid always making correct answer the most detailed
- avoid repeated “Which of the following…” wording
- avoid fake specificity
- avoid ambiguous temporal wording
- avoid double negatives
- avoid disputed facts unless the dispute itself is the question
- avoid trivia whose answer changes frequently unless tagged current
- avoid questions with multiple defensible answers
- avoid questions where the answer is embedded in the wording
- avoid source-text copying
- avoid near-duplicates

## 9.9 Duplicate detection

Use at least three approaches:

1. normalized lexical fingerprint
2. n-gram / MinHash style similarity
3. semantic embedding similarity

Duplicate review thresholds must be configurable.

## 9.10 Fact-checking

Store the source reference.

Do not store copyrighted source text unnecessarily.

For current or unstable facts:
- require recent verification date
- give the question an expiration/review date

## 9.11 Human review

Do not attempt to manually inspect all 50,000 questions.

Instead:

- fully review high-risk categories
- sample large sets per category
- manually inspect rejected/review queues
- manually review questions with ambiguity signals
- use player reports after launch
- audit the highest-impact questions

---

# 10. CONTINUOUS QUESTION MAINTENANCE

The question bank is a living system.

Every week/month:

- add new questions
- audit old questions
- detect performance anomalies
- detect outdated facts
- detect duplicated questions
- retire weak questions
- rebalance categories
- rebalance difficulty
- update current-events pool

## 10.1 Player telemetry for quality

For each question:

timesPlayed
correctRate
answerDistribution
averageAnswerTime
skipRate
reportRate
disputeRate
replayCorrelation

Example:

A question with:
- 42% correct
- 6 sec average time
- 0 reports
- balanced distractors

may be good.

A question with:
- 8% correct
- 70% choosing one wrong answer
- repeated reports

should enter review.

## 10.2 Question health score

Illustrative:

health =
  0.25 factualConfidence
+ 0.15 ambiguityConfidence
+ 0.15 languageQuality
+ 0.15 distractorQuality
+ 0.10 difficultyCalibration
+ 0.10 gameplayEngagement
+ 0.10 freshness

Never expose raw health score to players.

---

# 11. BLIND QUIZ / PERSONAL CONTENT SYSTEM

This is a signature feature.

## 11.1 Concept

A host can create a personal quiz about one or more people without knowing the answers in advance.

## 11.2 Target response flow

Example:

Ece receives:

“Answer these privately. The quiz author will not see your raw responses.”

Questions:
- What was your childhood dream job?
- What is a food you secretly dislike?
- What was your first concert?
- What is one harmless embarrassing story?
- What is a hobby most people do not expect you to have?

Responses are encrypted/access-controlled.

## 11.3 Author blindness

A blind session stores:

quizId
targetId
questionPrompt
targetAnswer
visibilityPolicy

The author receives:
- question status
- completion state

but not the response.

## 11.4 AI transformation

Target answer:
“My first car was a Peugeot 206.”

AI may generate:

“Which car model did Ece own first?”

Options:
A
B
C
D

The AI must not invent facts.

It may only transform the provided answer.

## 11.5 Who Said It

The system can gather statements from multiple players and turn them into authorship questions.

## 11.6 UGC safety

Personal content is user-generated content.

Required controls:

- report
- block
- moderation pipeline
- profanity filtering
- sexual content safeguards
- hate/harassment safeguards
- deletion
- retention controls
- clear consent

Do not ask users to provide highly sensitive personal data by default.

## 11.7 Privacy

Personal answers should:

- be encrypted in transit
- be access controlled
- have explicit deletion paths
- have short default retention for session-only content where possible
- not be exposed in analytics
- not be placed in public search indexes

---

# 12. GAME DIRECTOR / DYNAMIC DIFFICULTY

The game needs adaptive pacing without feeling rigged.

## 12.1 What the director can change

- question difficulty target
- question category mix
- risk intensity
- special event probability
- final-round pressure
- reward multiplier opportunities

## 12.2 What it cannot do

- target a specific player with a secretly impossible question
- leak answers
- alter correctness
- secretly change answers
- change score after submission
- guarantee a comeback
- guarantee a specific winner

## 12.3 Room performance signals

roomCorrectRate
recentFailureCount
streak
averageAnswerTime
questionDifficulty
riskMeter
categoryVariance

## 12.4 Chaos meter

The game has an internal visible/invisible pacing value.

Example behavior:

If 90%+ players answer correctly:
- reduce difficulty variance
- introduce harder questions

If 0% answer correctly:
- increase chaos/risk meter
- next selection enters a variance band
- may produce an intentionally surprising but calibrated question

If repeated failures occur:
- trigger a “comeback” or “wild” event
- never select random impossible questions

## 12.5 Difficulty buckets

EASY
MEDIUM
HARD
EXPERT

Use calibrated empirical values rather than only AI labels after enough play data exists.

## 12.6 Fairness rule

The director should choose from a pool of questions matching the intended difficulty band.

It should never inspect:
“Göktuğ is winning, give Göktuğ a hard question.”

Instead:
“Room difficulty should increase from Medium to Hard.”

---

# 13. SCORING

Example base model:

Question base = 100 points.

Speed:
0–100 bonus based on remaining time.

Optional multiplier:
×1
×2
×3

Example:

FinalScore =
basePoints × stakeMultiplier
+ speedBonus
+ powerBonus
- penalty

Limits:

- score changes only server-side
- integer arithmetic
- capped multipliers
- no floating-point drift
- all score deltas logged

## 13.1 Risk

Safe:
100 potential gain

Risk:
200 potential gain

High:
300 potential gain

Wrong answers:
negative according to mode rules

## 13.2 Comeback design

Comeback should be based on player agency, not hidden rubber-banding.

Examples:

- late-game high-risk questions
- earned powers
- double-down
- final round
- sabotage windows

Do not directly inflate trailing players.

---

# 14. TV / DISPLAY UX

## 14.1 Visual identity

Direction:

- modern game-show
- arcade energy
- premium party game
- dark stage
- bright accent colors
- large typography
- 2D/2.5D depth
- animated panels
- expressive avatars
- particles/confetti
- dramatic countdown
- sound-driven transitions

Avoid:

- corporate SaaS card grids
- tiny text
- spreadsheet layouts
- dense navigation
- white-background admin aesthetics

## 14.2 Resolution rules

All important content must remain readable at 3–5 meters.

Minimum body text sizes should be designed from viewing distance, not desktop conventions.

No critical information should exist only in color.

## 14.3 Lobby

TV:

QUIZ PARTY

SCAN TO JOIN

QR

ROOM CODE
X7P4KQ

Players join and their avatars animate onto stage.

Host sees:
START GAME

## 14.4 Question screen

TV:

ROUND 04
100 PTS
QUESTION

Large centered text.

Four answer cards.

Timer.

Player status indicators.

Power/sabotage activity only when meaningful.

## 14.5 Reveal

Correct answer:

- screen pulse
- card animation
- sound cue
- score fly-up
- character reaction
- optional explanation

Incorrect:
- subdued feedback
- avoid embarrassing a player unless game mode intentionally does it

## 14.6 Scoreboard

Keep it fast.

Use:
- movement
- rank shifts
- streaks
- player colors
- avatars

Avoid stopping the game for a 20-second static leaderboard.

---

# 15. MOBILE UX

## 15.1 Active answer screen

One dominant interaction area.

Example:

A
B
C
D

Buttons large enough for one-thumb selection.

## 15.2 Selection

On tap:

- immediate highlight
- haptic
- local visual acknowledgement

Then server acknowledges lock.

The app must distinguish:

SELECTED
LOCKED
REJECTED
LATE
DISCONNECTED

## 15.3 Hidden information

The phone can reveal:

- private power choices
- sabotage target
- risk wager
- secret prompts
- blind responses

The TV should not leak these prematurely.

---

# 16. REALTIME PROTOCOL

Every message has:

type
protocolVersion
messageId
roomId
sessionId
sequence
timestamp

## 16.1 Server → TV

ROOM_STATE
PLAYER_JOINED
PLAYER_LEFT
COUNTDOWN
ROUND_STARTED
QUESTION_PRESENTED
ANSWER_LOCKED
QUESTION_CLOSED
REVEAL
SCORE_DELTA
SCOREBOARD
SABOTAGE_STARTED
POWER_RESOLVED
FINAL_STARTED
GAME_OVER
ENTITLEMENT_CHANGED
ERROR

## 16.2 Server → mobile

PLAYER_STATE
ROOM_JOINED
QUESTION
ANSWER_ACCEPTED
ANSWER_REJECTED
POWER_AVAILABLE
POWER_RESOLVED
SABOTAGE_AVAILABLE
SABOTAGE_RESULT
SCORE_RESULT
RECONNECT_STATE
ERROR

## 16.3 Client → server

JOIN_ROOM
RECONNECT
SET_NICKNAME
READY
SUBMIT_ANSWER
USE_POWER
SET_RISK
SABOTAGE
LEAVE_ROOM
REQUEST_STATE

All requests require schema validation.

---

# 17. RECONNECT

## 17.1 Mobile reconnect

If phone loses connection:

- keep local session identity
- reconnect WebSocket
- send session token
- server validates
- server sends current state snapshot
- app reconstructs UI
- if answer window still open, allow answer
- if closed, show result state

## 17.2 TV reconnect

If TV refreshes:

- restore host session
- fetch current room snapshot
- resume rendering
- do not reset match

## 17.3 Host disconnect

For short disconnect:

- room remains active
- grace period

For prolonged disconnect:

- host migration may happen

New host should be selected deterministically.

Purchasing entitlement remains owned by the original account; host control is separate from ownership.

---

# 18. ROOM MODEL

Room:

roomId
publicCode
status
hostSessionId
hostAccountId
gameId
currentRound
currentQuestionId
state
createdAt
lastActivityAt
maxPlayers

Short public room code:
- 6 characters
- human-readable
- no ambiguous characters where practical

Internal room ID:
- cryptographically unpredictable
- never exposed as an authority token

## 18.1 Session

Session:

sessionId
roomId
playerId
deviceIdHash
role
reconnectTokenHash
createdAt
lastSeenAt
status

Never put reusable secrets in QR payloads.

---

# 19. SECURITY

## 19.1 Threat model

Assume players will attempt to:

- inspect network messages
- alter client JavaScript
- change timers
- modify local storage
- replay messages
- duplicate answer requests
- fabricate scores
- hijack sessions
- impersonate host
- submit after timeout
- spam WebSocket events
- flood rooms
- brute-force room codes

## 19.2 Defensive rules

- HTTPS only
- WSS only
- strict origin checking
- rate limiting
- connection limits
- room code entropy
- session-bound authorization
- replay protection
- monotonic sequence numbers
- idempotency keys
- schema validation
- server-side scoring
- server-side timer
- secure token storage
- short-lived action tokens where useful

## 19.3 Never send

Before reveal:

- correct answer
- hidden answer metadata
- authoritative future score
- unearned power results
- hidden sabotage data for other users

---

# 20. ANTI-CHEAT

Cheating is expected.

Threat:
Player opens devtools and reads all JSON.

Mitigation:
Do not send secrets.

Threat:
Player edits score in browser.

Mitigation:
Server computes score.

Threat:
Player submits twice.

Mitigation:
Idempotent action ID.

Threat:
Player submits after timer.

Mitigation:
Server deadline.

Threat:
Player opens two devices.

Mitigation:
Device/session policy and duplicate-session handling.

Threat:
Room hijack.

Mitigation:
Host session authorization.

Threat:
Brute-forcing rooms.

Mitigation:
rate limiting + room entropy + throttled failures.

---

# 21. ERROR HANDLING

Never dump technical stack traces to players.

TV messages:

“CONNECTION INTERRUPTED”
“TRYING TO RECONNECT…”

Phone:

“Reconnecting…”
“Game state restored.”

Recoverable errors:
- retry

Nonrecoverable:
- return to safe lobby state
- preserve results if possible

Server errors:
- log with correlation ID

---

# 22. AUDIO DESIGN

Sound is part of game feel.

Required sound classes:

- room join
- player join
- countdown
- final countdown
- answer tap
- lock
- reveal
- correct
- incorrect
- scoreboard
- rank change
- sabotage activation
- risk activation
- final round
- victory
- defeat
- chaos event

Support:

- mute
- TV volume respected
- phone haptics independent
- optional controller sounds

Do not rely on sound alone for critical information.

---

# 23. ACCESSIBILITY

TV:

- large type
- high contrast
- no color-only semantics
- reduced motion option
- readable answer labels

Phone:

- VoiceOver / TalkBack labels
- dynamic type where possible
- touch targets
- no required shaking
- no critical mechanic dependent on haptic

Reduced motion:

- disables screen shake
- reduces particles
- shortens animations without changing timing logic

---

# 24. ACCOUNTS AND IDENTITY

Anonymous player:

- nickname
- temporary session
- no mandatory email

Account:

- optional until purchase/persistence is needed
- required/encouraged for host ownership

Persistent profile:

- display name
- avatar
- owned content
- stats
- custom quizzes
- blind quiz participation

Avoid collecting unnecessary personal information.

---

# 25. ANALYTICS

Track only what is needed.

Core events:

app_opened
room_created
qr_shown
join_started
join_completed
player_joined
game_started
question_seen
answer_submitted
answer_locked
power_used
sabotage_used
risk_selected
question_revealed
game_finished
rematch_started
purchase_started
purchase_completed
purchase_restored
purchase_failed
disconnect
reconnect
question_reported

Privacy:
- pseudonymous IDs
- no raw personal answers in analytics
- no payment card data
- no hidden quiz answers in standard telemetry

---

# 26. ADMIN / LIVE OPS

Admin dashboard must manage:

- categories
- questions
- review queue
- retired questions
- difficulty
- sources
- current events
- reported questions
- personal content moderation
- users
- rooms
- bans
- entitlements
- purchase diagnostics
- incident logs

Question editor:
- preview
- test answers
- inspect distractors
- duplicate similarity
- source
- audit history

---

# 27. QUESTION AUDIT TOOL

Provide a standalone script/worker.

Input:

JSONL / CSV / DB query.

Output:

PASS
REVIEW
REJECT

Fields:

factCheck
ambiguity
grammar
style
distractorQuality
difficulty
duplication
freshness
gameplayValue
reason

The tool must be able to process batches.

Example:

500 questions
→ audit
→ 420 pass
→ 58 review
→ 22 reject

Do NOT require an LLM call for every gameplay question.

AI is used during content production/maintenance.

---

# 28. CHATGPT GO / MANUAL AUDIT WORKFLOW

ChatGPT Go currently offers expanded file uploads, data analysis and Projects relative to Free, but API usage is separate from the Go plan. Therefore:

- ChatGPT Go can be useful as a manual/batch audit workspace.
- Upload question batches and a fixed QA rubric.
- Ask the model to output a machine-readable review table.
- Use an API/automated batch worker for production-scale continuous auditing.
- Never design the live game to depend on a consumer ChatGPT session remaining open.

A practical manual audit loop:

Question export
→ split into manageable batches
→ upload into dedicated Project
→ apply QUESTION_AUDIT_RUBRIC.md
→ review flagged questions
→ export approved/rejected IDs
→ import to admin queue

Keep the production source of truth in the game's database, not in a ChatGPT conversation.

---

# 29. GAME FEEL RULES

The first 30 seconds must be spectacular.

Sequence:

TV opens
→ logo animation
→ QR appears
→ first player joins
→ avatar lands
→ second player joins
→ lobby fills
→ countdown
→ game show sting
→ first question

Target:
From opening TV page to first answer opportunity:
~20–60 seconds for a normal group.

The user must feel:

“This is a game.”

Not:

“I am filling out a website.”

## 29.1 Animation rules

- no gratuitous long animations
- every animation communicates state
- skip/accelerate between rounds
- never block player input for unnecessary animation

## 29.2 Timing

Animation can be dramatic.

Input cannot wait unnecessarily.

---

# 30. HOST EXPERIENCE

Host does not become an administrator.

Host actions:

- create room
- start game
- choose category/mode
- kick player
- restart lobby
- rematch
- end room

Host cannot:

- set score
- reveal answer
- edit timer
- inject arbitrary question
- alter purchase entitlement

---

# 31. CUSTOM QUIZ

Host creates:

Title
Description
Theme
Questions

AI may assist:

- wording
- distractor generation
- difficulty suggestion
- grammar
- formatting

But:
- host must approve generated content
- no factual claims without verification for fact-based questions
- no auto-publishing unsafe content

Custom quiz can be:
- private
- shared by code
- group-only
- public in future with moderation

---

# 32. PERSONALIZATION

Future profile features:

- favorite categories
- play history
- favorite modes
- achievements
- player stats

Do not use personal stats to rig live questions in ways players cannot understand.

Personalization may influence:
- suggested categories
- optional playlists
- cosmetic recommendations

Not:
- hidden difficulty punishment

---

# 33. VISUAL ASSET SYSTEM

Use a tokenized design system.

Tokens:

background
surface
text
mutedText
accentA
accentB
success
danger
warning
player1…player8

Do not hardcode visual values repeatedly.

Use shared:
- typography
- spacing
- corner radius
- shadows
- animation durations
- elevation

TV UI and mobile UI share brand tokens but have different layout systems.

---

# 34. PERFORMANCE

## TV

Target:
- smooth animation
- fast first paint
- minimal memory use
- no giant JS payload if avoidable

Rules:
- lazy load nonessential assets
- preload the next round's essential assets
- cache static assets
- use compressed audio
- avoid full-page React re-renders on every tick

## Mobile

- stable 60fps interaction target on common midrange devices
- avoid battery-heavy loops
- websocket heartbeat reasonable
- suspend animation when app backgrounded

## Server

- timer logic independent of UI rendering
- database writes batched when safe
- avoid one DB write per frame
- use structured logging

---

# 35. DATABASE ENTITIES

Core:

User
Account
PlayerProfile
Room
RoomSession
Game
GamePlayer
Round
Question
QuestionOption
QuestionAudit
QuestionSource
QuestionUsage
QuestionReport
Entitlement
PurchaseTransaction
CustomQuiz
CustomQuizQuestion
BlindQuizSession
BlindResponse
ModerationCase
TelemetryEvent
Ban
FeatureFlag

---

# 36. TEST PYRAMID

## Unit

- scoring
- timer
- question selection
- difficulty director
- risk
- powers
- sabotage legality
- room state transitions
- entitlement logic

## Integration

- database
- purchase verification adapter
- question import
- moderation
- WebSocket

## E2E

- TV creates room
- phone joins
- several players answer
- score
- next round
- final
- rematch

## Device

iOS:
- current supported baseline + one older supported version

Android:
- common flagship + midrange device

TV:
- supported Smart TV/browser targets
- Chrome desktop
- Edge
- Safari
- Firefox

Console:
- tested target browsers only

---

# 37. RED TEAM QA — MANDATORY

“Code exists” is not “feature complete.”

A feature is complete only when:

- implemented
- connected to real backend
- validated
- tested
- failure mode handled
- security reviewed
- UI polished
- telemetry included where useful

## 37.1 Network Red Team

Test:

- different Wi-Fi networks
- TV Wi-Fi + phone 5G
- packet loss
- high latency
- temporary offline
- reconnect
- WebSocket restart
- server restart
- DNS failure
- stale session

## 37.2 Timing Red Team

Test:

- answer exactly at deadline
- 1 ms before deadline
- 1 ms after deadline
- duplicate answer
- multiple answer submissions
- phone clock wrong
- TV clock wrong
- reconnect during question
- reconnect after answer
- reconnect during reveal

## 37.3 Session Red Team

Test:

- duplicate device
- stolen reconnect token
- invalid token
- expired token
- wrong room
- room closed
- host replaced
- player rejoining with same nickname

## 37.4 Client tampering

Try:

- modify score
- modify timer
- modify answer
- call hidden API
- forge admin event
- forge host event
- replay power
- replay purchase confirmation

Expected:
server rejects all unauthorized mutations.

## 37.5 Payment Red Team

Test:

- canceled purchase
- failed purchase
- duplicate purchase callback
- replayed transaction
- fake receipt
- restored purchase
- purchase on iOS then play on web
- purchase on Android then play on web
- refund/revocation
- network drop during purchase
- app killed during purchase
- TV waiting while entitlement arrives

## 37.6 Question Red Team

Detect:

- duplicate
- ambiguous answer
- two correct answers
- outdated fact
- misleading distractor
- malformed Turkish
- accidental clue
- answer appears in question
- answer length gives clue
- category mismatch

## 37.7 Mobile Red Team

Test:

- app background
- screen lock
- incoming phone call
- low battery mode
- network change Wi-Fi↔5G
- app kill
- app restore
- old deep link
- malformed deep link
- purchase interruption
- accessibility mode
- one-handed use

## 37.8 TV Red Team

Test:

- browser refresh
- back button
- inactivity
- sleep/wake
- remote navigation
- 720p
- 1080p
- 4K
- browser zoom
- safe area
- audio blocked until user interaction
- fullscreen exit

## 37.9 Abuse Red Team

Test:

- spam room creation
- room code brute force
- nickname spam
- WebSocket flood
- repeated answer messages
- repeated sabotage
- profanity
- harassment in personal quizzes
- malicious links in custom quiz content

---

# 38. ACCEPTANCE CRITERIA

The MVP is NOT accepted until all of the following work:

A. TV opens without install.
B. QR appears.
C. Phone can join.
D. Different networks work.
E. Native app deep link works.
F. Browser fallback works.
G. Room lobby is realtime.
H. Host starts game.
I. Server owns timer.
J. Answers lock correctly.
K. Correct answer remains hidden until reveal.
L. Score is server-owned.
M. Power system works.
N. Risk system works.
O. Sabotage system works.
P. Game director works.
Q. Reconnect works.
R. Host disconnect recovery works.
S. Final round works.
T. Results/rematch work.
U. Native purchase can be verified.
V. Purchase grants account entitlement.
W. TV sees entitlement without refresh.
X. Restore purchase works.
Y. Question bank imports.
Z. Question audit queue works.
AA. Blind Quiz works.
AB. Personal answer remains hidden from creator.
AC. Report/moderation controls work.
AD. Red Team suite runs.
AE. No core TODO placeholder remains.

---

# 39. MVP SCOPE

Must have:

- TV browser client
- mobile web fallback
- native iOS/Android companion app skeleton
- room creation
- QR join
- player identity
- realtime lobby
- classic mode
- question bank
- score
- timer
- 50/50
- risk
- sabotage
- final round
- reconnect
- purchase entitlement architecture
- one-time full-game purchase
- question admin
- question audit
- Red Team tests

Nice-to-have after first playable:

- profiles
- achievements
- advanced statistics
- cosmetics
- theme packs
- public custom quizzes
- friend groups
- seasonal events
- push notifications
- remote spectator mode

---

# 40. PHASING

## Phase 0 — Repository and architecture

Output:
- monorepo
- docs
- CI
- env system
- DB
- code standards
- protocol schemas

## Phase 1 — Room engine

Output:
- room
- lobby
- QR
- join
- realtime
- reconnect

## Phase 2 — Core game

Output:
- question
- timer
- answer
- score
- reveal
- rematch

## Phase 3 — Party mechanics

Output:
- 50/50
- risk
- sabotage
- final round
- game director

## Phase 4 — Native app

Output:
- iOS
- Android
- deep links
- haptics
- fallback flow

## Phase 5 — Payments

Output:
- StoreKit
- Play Billing
- backend verification
- entitlements
- restore
- web entitlement access

## Phase 6 — Content factory

Output:
- import
- audit
- duplicate detection
- question admin
- review queue

## Phase 7 — Blind Quiz

Output:
- private response collection
- AI transform
- blind author mode
- Who Said It

## Phase 8 — Polish

Output:
- animation
- sound
- accessibility
- loading
- error UX

## Phase 9 — Red Team

Output:
- all mandatory test suites
- bug fixes
- load tests
- browser/device test matrix

## Phase 10 — Release candidate

Output:
- production deployment
- app-store build
- store metadata
- review account/demo mode
- privacy/legal pages
- monitoring
- backups
- rollback plan

---

# 41. DEPLOYMENT

Web:
- CDN/static edge where appropriate

Realtime:
- persistent Node runtime

Database:
- managed PostgreSQL

Redis:
- managed when scaling requires it

Object storage:
- avatars
- audio
- question images
- user-created assets

Observability:
- error monitoring
- structured logs
- latency metrics
- websocket connection metrics
- purchase success metrics
- question quality metrics

Environment secrets:
never commit.

---

# 42. DISASTER RECOVERY

Must have:

- database backups
- migration strategy
- rollback strategy
- feature flags
- kill switch for broken question packs
- ability to disable a game mode
- ability to retire a question immediately

Question release should support:
- staged activation
- rollback

---

# 43. FEATURE FLAGS

Examples:

classicMode
riskMode
sabotage
blindQuiz
customQuiz
currentEvents
nativePurchase
webPurchase
newQuestionDirector
newAnimationPack

Flags controlled server-side.

---

# 44. LIVE OPS

No app update should be required to:

- add questions
- remove questions
- rebalance questions
- change question categories
- enable/disable playlists
- disable a broken mode
- tune scoring parameters where safely server-controlled

Native app update should not be required for server-authoritative game balance.

---

# 45. PRODUCT GROWTH LOOP

Launch:

50K approved questions

Players create:
- usage data
- reports
- answer distributions
- custom quizzes

System learns:

- what is too easy
- what is too hard
- what is confusing
- what players enjoy

Editors/AI generate:

- new questions
- replacement questions
- seasonal questions
- special category packs

Result:

Better game
→ more play
→ more telemetry
→ better content
→ better retention

---

# 46. DESIGN PRINCIPLES FOR THE AI CODING AGENT

The agent must follow these rules:

1. Never stop at mockups.
2. Never replace backend logic with fake local state.
3. Never mark a feature complete because a button exists.
4. Never trust client state.
5. Never hardcode secrets.
6. Never expose correct answers before reveal.
7. Never bypass purchase verification.
8. Never make same-network assumptions.
9. Never silently degrade critical functions.
10. Every major subsystem must have tests.
11. Every red-team failure must become a regression test.
12. Prefer simple architecture over unnecessary abstractions.
13. Keep shared protocol schemas typed.
14. Document architecture decisions.
15. Run the tests after every major phase.
16. Fix failures before progressing where they affect acceptance criteria.
17. Use real data flow for the first end-to-end path.
18. Use feature flags for unfinished optional features.
19. Remove placeholder/demo code from production paths.
20. Treat existing code as evidence, not proof, of completion.

---

# 47. LAUNCH QUALITY BAR

The game is launch-ready only when:

- first-time user can understand it without instructions
- first game starts quickly
- connection works across different networks
- phone feels like a controller
- TV feels like a game show
- purchase is trustworthy
- no intrusive ads
- questions feel human-written
- no obvious AI slop
- no obvious broken difficulty
- reconnect is graceful
- sabotage is fun, not abusive
- risk feels strategic
- the last round feels exciting
- users naturally want a rematch

---

# 48. LEGAL / STORE / TRUST NOTES

At implementation time, re-check current:

- Apple App Review Guidelines
- Google Play Billing policies
- privacy requirements
- GDPR/KVKK requirements as applicable
- age-rating requirements
- UGC moderation requirements
- payment/tax requirements
- regional storefront rules

Apple currently requires in-app purchase for digital features/full unlocks within the app, while multiplatform apps may allow users to access features acquired on other platforms under the applicable rules. [Apple current App Review Guidelines.]

Android currently documents one-time products and backend verification through Play Billing. [Android Developers current Play Billing documentation.]

All store policy assumptions must be revalidated immediately before submission.

---

# 49. RELEASE CHECKLIST

Product:
- positioning
- screenshots
- trailer
- landing page
- pricing

Web:
- domain
- HTTPS
- WSS
- CDN
- error handling

Mobile:
- iOS build
- Android build
- deep link association
- IAP products
- restore

Backend:
- migrations
- secrets
- monitoring
- backups
- rate limiting

Content:
- launch question pool
- audit
- category balance
- current-events freshness

QA:
- e2e
- device
- browser
- network
- payment
- security
- accessibility

Support:
- privacy
- terms
- support email
- account deletion
- purchase restore instructions

---

# 50. FINAL PRODUCT MODEL

Quiz Party should become:

TV:
THE STAGE

Phone:
THE CONTROLLER

Server:
THE GAME MASTER

Question Bank:
THE CONTENT ENGINE

AI:
THE FACTORY + EDITORIAL ASSISTANT

Host Purchase:
THE FULL GAME KEY

Blind Quiz:
THE SOCIAL SECRET WEAPON

Game Director:
THE PACING ENGINE

Red Team:
THE QUALITY GATE

The product must be built so that the first version is already a real game, while the backend architecture allows content, modes and social features to grow for years without rewriting the core room/game protocol.