# Feature Parity Checklist — UI Redesign

Status: **Approved 2026-10-27.** Step 1 (tokens + shell) built; awaiting screenshot review.

## Decisions (2026-10-27)

1. Work happens on `claude/sat-ui-redesign-ogkerh`. After each approved step a PR into `main` is
   opened for the owner to merge (merging deploys).
2. Team logos come from ESPN's CDN using the ESPN team ids the app already fetches; a team-code
   circle is the fallback.
3. A new **Missing** chip (your unpicked games) is added to the Picks filters.
4. **Submit X of Y** calls the existing `saveAndSendPickConfirmationReceipt()`. Lock Picks stays separate.
5. **New Week Reset** moves into the Commissioner console only, behind a red confirm step. (It was
   already hidden from non-commissioners by `syncCommissionerVisibilityDOM()`, which hides the
   whole Standings toolbar.)

6. **Accent is red** (#d22b2b, text #ff5c5c dark / #b3141f light) instead of gold; picked teams are solid
   red with white text. Layout follows the owner's mockups (Pickem_App_Redesign.pdf): no top header
   bar, each screen has its own page head, the sidebar More group is plain text.

Found during step 2:
- `pickSide()` never clears a pick (tapping the picked team re-saves it). "Tap again to clear" would
  change how picks are saved, so it is **not** implemented; switching teams works as before.
- `hardResetToDefaults()` ("Reset Optimal Picks") overwrites the built-in Michael and Kinyion
  profiles, not the viewer's picks, so it stays in Import Hub › Cloud & Reset only (commissioner).

Found during step 1: **Past weeks** (the archive select and Season archive box) has always been
commissioner-only, so the new "Past weeks" entry keeps that rule.

Source of truth: `public/index.html` + `public/js/**` on `Week8` @ `00bf24e`. Every row was
found in the code, either in the static markup or in an HTML string that a render function
builds. The `Handler / ID` column is what has to keep working after the redesign. `Today`
says where the control lives now, and `New home` says where it moves.

Legend for **New home**
- **P** = Picks screen · **PH** = Picks header · **QP** = "Quick picks" menu (Picks header)
- **DS** = Game detail sheet (bottom sheet on phone / side panel on desktop)
- **L** = Live screen · **GC** = GameCast & Drive Theater (opens from a Live card)
- **S** = Standings screen
- **M›x** = More (phone tab) / sidebar "More" group (desktop) → section *x*
  (Past weeks, Simulator, Export, Account, Settings, Commissioner)
- **RR** = Desktop right rail
- **ADV** = Advanced mode only (same rule as today, `body.simple-ui-mode` hides it)
- **CM** = Commissioner only (same rule as today, `.commish-only-hidden` / role check)

Step column: which build step will touch it (1 shell · 2 Picks · 3 Detail sheet · 4 Advanced ·
5 Live+GameCast · 6 Standings · 7 More/Settings/Account · 8 Commissioner). A ☐ becomes ☑ once
the item is verified at 390px and 1280px after that step.

---

## A. Shell, modes & navigation

| ☐ | Feature | Handler / ID | Today | New home | Step |
|---|---|---|---|---|---|
| ☑ | Simple (default) / Advanced toggle | `toggleSimpleUiMode()` · `#btn-simple-mode-toggle` · localStorage `sat_simple_ui_mode_v16` (unchanged key, `"0"` = Advanced, anything else = Simple) | Top bar | PH toggle + M›Settings | 1/4 |
| ☑ | Body class driving simple/advanced visibility | `applySimpleUiModeDOM()` → `body.simple-ui-mode` | — | Kept; new CSS hooks onto the same class | 1 |
| ☑ | Main view switching | `switchMainView('cards'\|'condensed'\|'live'\|'standings')` (incl. the V16.6 override wrapper in `commissioner-admin.js`) | Top tabs `#tab-mode-*` | Bottom tabs (phone) / sidebar (desktop). Old `#tab-mode-*` IDs kept on the new sidebar buttons | 1 |
| ☑ | Mobile bottom nav | `handleMobileNavClick()` · `#mnav-cards/-condensed/-live/-standings/-drawer` | 5 tabs | 4 tabs: Picks · Live · Standings · More. `#mnav-condensed` becomes the Cards/Table toggle inside Picks; `#mnav-drawer` becomes "More" | 1 |
| ☑ | Simple-mode tab highlighting | `syncSimpleModeTabHighlights()` | — | Must keep working against the renamed buttons | 1 |
| ☐ | Menu / Settings drawer | `openSettingsDrawer()` / `closeSettingsDrawer()` / `renderSettingsDrawerBody()` · `#settings-drawer-backdrop`, `#settings-drawer-body` | ☰ Menu | Becomes the **More** screen (phone) / More group (desktop). Function names kept as aliases | 7 |
| ☑ | Desktop rail collapse | `toggleDesktopSidebarCollapse()` · `#btn-toggle-desktop-rail` | Top bar "◀ Rail" | Right-rail collapse button (desktop) | 1 |
| ☑ | Mobile sidebar drawer | `toggleMobileSidebar()` · `#main-sidebar.mobile-drawer-open` | Menu | Old sidebar contents get redistributed (see §H); function kept as a no-op-safe helper | 1 |
| ☑ | Commissioner announcement banner + Dismiss | `renderCommishAnnouncementBanner()` · `dismissCommishBanner()` · `#commish-announcement-banner/-text` | Above top bar | Thin bar under the sticky header | 1 |
| ☑ | App toast | `showAppToast()` · `#app-toast-banner` | Overlay | Restyled toast above the bottom tabs | 1 |
| ☑ | Week title | `#sheet-title-brand` | Top bar | Sidebar app name + "Week N Picks" header | 1/2 |
| ☑ | Profile pill (name + instance tag) | `#top-profile-pill`, `#top-profile-name`, `#top-profile-instance-tag` | Top bar | Header avatar button → M›Account | 1 |
| ☑ | Bot status pill (CM) | `#bot-sync-pill` | Top bar | Header (CM only) + M›Commissioner | 1 |
| ☐ | Live sync badge (tap = sync) | `syncAllLiveTrackingData(true)` · `#live-sync-badge` | Top bar | Live header "Synced Ns ago" indicator (tap = sync) | 5 |
| ☐ | Risk meter (1x/2x/3x/Max/EV) | `#top-risk-meter`, `#rm-chalk/-2x/-3x`, `#top-ceiling`, `#top-ev` | Top bar (ADV) | PH second line (ADV) | 4 |
| ☑ | Hidden cloud status text | `#cloud-status-text` | Hidden | Kept hidden | 1 |

## B. Picks screen — game list

| ☐ | Feature | Handler / ID | Today | New home | Step |
|---|---|---|---|---|---|
| ☑ | Game cards render | `renderGames()` · `#games-container` | Cards view | P: one card per game (time + network, then away and home buttons) | 2 |
| ☑ | Pick away / home | `pickSide(id, side)` | Card buttons | Team buttons (tap = pick, tap again = clear, `aria-pressed`) | 2 |
| ☐ | Pick for any profile (table) | `pickSideForProfile(prof, id, side)` | Condensed table | Table view (ADV) | 4 |
| ☑ | Simple layout style: Condensed vs "Cards + Injuries/L5" | `setSimpleCardLayoutStyle('condensed'\|'detailed')` · `#btn-simple-style-condensed/-detailed` · localStorage `sat_simple_card_style_v16` | Simple bar | New card is the default. "Cards + Injuries/L5" becomes a "Show details inline" switch in PH ⋯ and Settings; the same data is always one tap away in DS | 2/3 |
| ☑ | Condensed view (simple) | `switchMainView('condensed')` in simple mode → cards + condensed style | Tab | Same as the row above (the clean list *is* the condensed view) | 2 |
| ☑ | Team search | `#team-search` · `renderGames()` · `clearSearch()` | Controls bar | Search icon in PH → inline search field | 2 |
| ☐ | Expand all Insights (ADV) | `toggleAllSubpanels('ins')` · `#btn-toggle-all-ins` | Controls bar | PH ⋯ menu (ADV) | 4 |
| ☑ | Expand all Last 5 | `toggleAllSubpanels('l5')` · `#btn-toggle-all-l5` | Controls bar | PH ⋯ menu | 2 |
| ☑ | Expand all Injuries | `toggleAllSubpanels('inj')` · `#btn-toggle-all-inj` | Controls bar | PH ⋯ menu | 2 |
| ☑ | Per-card Insights / Last 5 / Injuries toggles | `toggleCardIdx(idx, type)` | Card | DS sections (and inline when "Show details inline" is on) | 3 |
| ☐ | Team / opponent details popup | `openOppModal()` / `closeOppModal()` · `#opp-modal-backdrop`, `#modal-team-title`, `#modal-team-body` | Tap opponent name | Opens as a sheet; IDs kept | 3 |
| ☐ | Opponent hover tooltip | `#opp-tooltip` | Hover | Kept (desktop hover only) | 3 |
| ☑ | Focus / scroll to a game | `focusGame(id)` | Sway feed, sim swing badges | Kept; scrolls to the card and highlights it | 2 |
| ☑ | Game detail | (new wrapper over existing panels) | — | DS: Injuries/Outs, Last 5, H2H info, Insights (ADV), GameCast entry | 3 |
| ☑ | Commissioner lock per game respected | `isGameLockedByCommissioner()` | Card disabled state | Locked team buttons show a lock icon and "Locked" | 2 |

## C. Pick filters (chip row above the list)

| ☐ | Filter | Handler / ID | Today | New home | Step |
|---|---|---|---|---|---|
| ☑ | All | `setFilter('all')` · `#flt-all` | Filter row | Chip | 2 |
| ☑ | 2x Dogs (+7.5–14) | `setFilter('2x')` · `#flt-2x` | Filter row | Chip | 2 |
| ☑ | 3x Dogs (+14.5+) | `setFilter('3x')` · `#flt-3x` | Filter row | Chip | 2 |
| ☑ | Injuries / Outs | `setFilter('inj')` · `#flt-inj` | Filter row | Chip | 2 |
| ☐ | +EV / Best Value | `setFilter('plusev')` · `#flt-plusev` | ADV | Chip (ADV) | 4 |
| ☐ | Best Leverage | `setFilter('leverage')` · `#flt-leverage` | ADV | Chip (ADV) | 4 |
| ☐ | Sways | `setFilter('sway')` · `#flt-sway` | ADV | Chip (ADV) | 4 |
| ☐ | H2H Diffs | `setFilter('diffs')` · `#flt-diffs` (also the sidebar "⚔️ Diffs" button) | ADV | Chip (ADV) | 4 |
| ☐ | `ev` filter key | listed in `setFilter`'s list, no button today | — | No change (no button) | — |
| ☑ | **Missing** (new) | `setFilter('missing')` · `#flt-missing` | — | Chip (both modes) | 2 |
| ☐ | Live: All N Games | `setLiveTabFilter('all')` · `#lflt-all` | Live toolbar | L chip | 5 |
| ☐ | Live: In Progress Only | `setLiveTabFilter('active')` · `#lflt-active` | Live toolbar | L chip | 5 |
| ☐ | Live: 4Q / Red-Zone Sweats | `setLiveTabFilter('sweat')` · `#lflt-sweat` | Live toolbar | L chip | 5 |
| ☐ | Live: H2H Swing Games | `setLiveTabFilter('diff')` · `#lflt-diff` | Live toolbar | L chip (ADV) | 5 |

## D. Pick strategies (→ "Quick picks" menu)

| ☐ | Feature | Handler | Today | New home | Step |
|---|---|---|---|---|---|
| ☑ | ★ Optimal EV (both label variants) | `applyPreset('optimal')` | Sidebar + EV drawer | QP + Simulator | 2 |
| ☑ | Safe Core (Max Win %) | `applyPreset('safe')` | Sidebar + EV drawer | QP + Simulator | 2 |
| ☑ | Chaser (BYU + GT 2x / Live 2x/3x Dogs) | `applyPreset('aggressive')` | Sidebar + EV drawer | QP + Simulator | 2 |
| ☑ | All Sheet Favorites | `applyPreset('chalk')` | Sidebar + EV drawer | QP + Simulator | 2 |
| ☐ | Reset Optimal Picks | `hardResetToDefaults()` | Import Hub › Cloud & Reset | Stays in Import Hub only (resets the built-in profiles, see Decisions) | 8 |
| ☐ | Commish: Optimal EV / All Favorites / Underdog Chaser / Auto-Pick for a player | `commishAutoSelectPlayerPicks(key, 'optimal'\|'chalk'\|'aggressive')` | Commish edit bar + submissions | Commish edit bar + console (CM) | 8 |
| ☐ | Commish: Auto-Fill Missing | `commishAutoFillMissingPlayers('chalk')` | Console › Submissions | Console › Submissions (CM) | 8 |

## E. Pick actions, tie-breaker & review

| ☐ | Feature | Handler / ID | Today | New home | Step |
|---|---|---|---|---|---|
| ☑ | Progress "X of Y picked" | `#top-review-count` (kept) + new progress bar | Top "Review (n/N)" | PH | 2 |
| ☑ | Lock time / status text | `#simple-lock-deadline-pill`, `#simple-receipt-status-text` | Simple bar | PH subtitle | 2 |
| ☑ | **Submit picks** (Save & Receipt) | `saveAndSendPickConfirmationReceipt()` | Simple bar "💾 Save & Receipt" | Sticky "Submit X of Y" (phone bottom / desktop header), see **Question 4** | 2 |
| ☐ | Save & Email Receipt | `closeReviewChecklistModal(); saveAndSendPickConfirmationReceipt()` | Review checklist | Review sheet | 2 |
| ☐ | Send Email Receipt to custom address | `sendReceiptToCustomEmail()` · `#receipt-email-input` | Receipt modal | Receipt sheet | 2 |
| ☑ | Copy Picks / Copy List / Copy Receipt Text | `copyPicksToClipboard()` · `#copy-status` | Sidebar, review, receipt | QP "Copy picks" + review + receipt | 2 |
| ☑ | Lock Picks / Unlock | `toggleManualUserPickLock()` · `#btn-simple-manual-lock` | Simple bar + review | PH ⋯ menu + review sheet ("Lock picks" / "Unlock picks to edit") | 2 |
| ☑ | Review Checklist (official N-game) | `openReviewChecklistModal()` / `closeReviewChecklistModal()` · `#btn-open-review-checklist`, `#review-checklist-*` | Top bar + simple bar | PH "Review" button → full sheet | 2 |
| ☐ | Flip / Pick from review | `flipPickFromReviewChecklist(id)` | Review checklist | Review sheet | 2 |
| ☑ | Tie-breaker score | `#tiebreaker-input`, `#simple-tiebreaker-input`, `syncSimpleTiebreakerInput()`, `saveCurrentState()` | Sidebar + simple bar + review | Card at the bottom of the Picks list + review sheet | 2 |
| ☐ | Tie-breaker game select | `setTiebreakerGame()` · `#tiebreaker-game-select`, `#tiebreaker-box-title` | Sidebar | Tie-breaker card (P) | 2 |
| ☐ | Vegas implied score calculator + Apply | `recalcImpliedTiebreaker()`, `applyCalculatedTiebreaker()` · `#calc-ou`, `#calc-spread`, `#calc-result-text` | Sidebar | Tie-breaker card, collapsible "Calculator" | 2 |
| ☐ | Make an Account & Keep My Picks (guest) | `openAuthModalCarryingGuestPicks()` | Receipt + guest strip | Same | 2 |
| ☐ | Delete Picks (commish, per player) | `commishDeletePlayerPicks(key)` | Commish | CM, red confirm step | 8 |
| ☐ | Import N Picks (from confirmation email) | `parseConfirmationEmailPicks()` · `#email-import-target` | Import Hub › Email | Import Hub (M›Commissioner / Account) | 8 |

## F. Profiles, privacy & head-to-head

| ☐ | Feature | Handler / ID | Today | New home | Step |
|---|---|---|---|---|---|
| ☐ | My Official Picks / My Sandbox Sim switch | `switchProfile(getMyInstanceProfileKey())` / `switchProfile('test')` · `#tab-michael`, `#tab-test`, `#dynamic-profile-tabs`, `#prof-sub-*` | Sidebar, auth, drawer | PH profile switcher ("My picks ▾ / Sandbox"). Sandbox shows a clear "Sandbox — not submitted" banner | 2 |
| ☐ | Multi-buy-in entry switcher | `switchLinkedBuyInEntry()` · `#multi-buyin-entry-strip` | Simple bar + drawer | Same PH switcher (lists each entry) | 2 |
| ☐ | Add Buy-In | `addLinkedBuyInEntryFromInput()` · `#inline-buyin-entry-input`, `#drawer-new-buyin-input` | Drawer | M›Account | 7 |
| ☐ | Copy other profile's picks | `copyOtherProfile()` | Sidebar | QP (ADV) | 4 |
| ☐ | Hide My Picks (quick lock) | `toggleQuickLockActiveProfile()` · `#btn-quick-hide-active`, `#active-privacy-status-pill` | Sidebar + drawer | M›Settings › Privacy | 7 |
| ☐ | Blind mode / Spy Shield (same function) | `toggleBlindMode()` · `#btn-sidebar-blind`, `#btn-blind-mode` | Sidebar + drawer | M›Settings › Privacy | 7 |
| ☐ | Pick Privacy / Full Pick Privacy & H2H Settings | `openUserAndPrivacyModal()` | Sidebar, drawer, guest strip | M›Settings › Privacy (opens the existing modal content) | 7 |
| ☐ | Privacy options: reveal at kickoff / auto-unhide on sheet / auto-unhide Friday night | `toggleProfilePrivacyOption()` | Privacy modal | Same modal | 7 |
| ☐ | Toggle Privacy (account modal) | `toggleQuickLockActiveProfile(); openAuthModal()` | Auth modal | Same | 7 |
| ☐ | Compare vs (H2H target), 4 selects | `setCompareTarget()` · `#sidebar-compare-select`, `#live-compare-select`, `#cond-compare-select`, `#standings-compare-select` · localStorage `sat_device_compare_target_v16` | Sidebar, Live, Condensed, Standings | One "Compare with ▾" control per screen (ADV); all four IDs kept | 4/5/6 |
| ☐ | Compare H2H (from leaderboard row) | `setCompareTarget(name)` | Standings rows | Standings row action | 6 |
| ☐ | H2H table (Ceiling / EV / Live / Final per profile) | `#h2h-dynamic-tbody`, `#h2h-m-*`, `#h2h-k-*`, `#h2h-t-*`, `#h2h-row-test` | Sidebar | ADV: "Head-to-head" block at top of Table view + RR (desktop) | 4 |
| ☐ | H2H diff count | `#h2h-diffs`, `#h2h-diffs-label` | Sidebar | ADV chip badge on "Diffs" | 4 |
| ☐ | Open Side-by-Side Comparison | `switchMainView('condensed')` | Sidebar + privacy modal | ADV: Picks › Table toggle | 4 |
| ☐ | Link profile to leaderboard name | `linkUserProfileToLeaderboard()` | Privacy modal | Same | 7 |

## G. Advanced: Condensed / Table / matrix

| ☐ | Feature | Handler / ID | Today | New home | Step |
|---|---|---|---|---|---|
| ☐ | Condensed master pick sheet | `renderCondensedTable()` · `#condensed-view-container`, `#condensed-mobile-list`, `#condensed-tbody`, `#condensed-thead-row` | Tab | Picks › Cards/Table toggle (ADV). Table scrolls inside its own box | 4 |
| ☐ | Mobile Cards / Full Table | `setCondensedLayoutMode('cards'\|'table')` · `#btn-cond-layout-cards/-table`, `#btn-cond-col-scope` | Condensed toolbar | Segmented control inside Table view | 4 |
| ☐ | Diff Only | `#chk-cond-diff-only` | Condensed toolbar | Switch in Table view | 4 |
| ☐ | Watchlist rival pick toggles | `toggleWatchlistPick()` | Condensed table | Table view | 4 |
| ☐ | Print Sheet / Print | `printCheckmarkSheet()` · `#print-sheet-area` | Condensed + sidebar | M›Export + Table view header | 4/7 |

## H. Old left sidebar ("Sticky Command Rail"): where each block goes

| ☐ | Block | IDs | New home | Step |
|---|---|---|---|---|
| ☐ | Instance banner | `#sidebar-instance-banner` | M›Account | 7 |
| ☐ | Pool Member Watchlist summary (3 rivals) | `#sidebar-watchlist-summary` | RR (desktop) + Standings › Watchlist (phone) | 6 |
| ☐ | Live Outright Scoreboard: Max Ceiling, Expected EV, Hit Target Odds, Likely Range | `#stat-ceiling`, `#stat-dogs-sub`, `#stat-ev`, `#stat-target-prob`, `#stat-target-label`, `#stat-range` | Simulator (ADV) | 4 |
| ☐ | Target weekly score slider + distribution chart | `updateTargetSlider()` · `#target-slider`, `#slider-val`, `#dist-chart` | Simulator (ADV) | 4 |
| ☐ | Quick Strategy Presets | `applyPreset()` | QP | 2 |
| ☐ | Official Tie-Breaker box | see §E | Picks tie-breaker card | 2 |
| ☐ | Sheet Sway & Injury Radar feed | `#sway-feed-list`, `#sway-count-badge`, `focusGame()` | ADV: "Sways" chip shows count; feed in RR (desktop) / Simulator › Insights (phone) | 4 |

## I. Live & GameCast / Drive Theater

| ☐ | Feature | Handler / ID | Today | New home | Step |
|---|---|---|---|---|---|
| ☐ | Live scoreboard | `renderLiveScoreboardTab()` · `#live-tracker-view-container`, `#live-scoreboard-groups` | Live tab | L | 5 |
| ☐ | Summary tiles (my pts, rival pts, in progress, completed, last sync) | `#live-tab-m-card/-label/-pts/-rec`, `#live-tab-k-*`, `#live-tab-inprog`, `#live-tab-final`, `#live-tab-clock` | Live | L tiles: Your record · Games in play · Pool rank. Rival tile in ADV. All IDs kept | 5 |
| ☐ | Sync Live ESPN | `syncAllLiveTrackingData(true)` | Drawer + badge | L header sync button + M›Settings | 5 |
| ☐ | Live polling | `pollLiveSaturdayScores()` | — | Unchanged | 5 |
| ☐ | 60s Auto-Poll | `toggleAutoPoll()` · `#chk-auto-poll` | Drawer | M›Settings › Live | 7 |
| ☐ | Force Firebase Pull | `pullFromFirebaseCloud()` | Import Hub › Cloud | M›Settings › Data (and Import Hub) | 7 |
| ☐ | Open GameCast & Drive Theater (Big View) | `openFieldTheaterModal(id)` / `closeFieldTheaterModal()` · `#field-theater-*`, `#theater-modal-*` | Card "Big View ⛶" | Tap live card → GC (sheet / side panel) | 5 |
| ☐ | Field tracker render + accordion (Hide Field) | `toggleFieldTrackerAccordion()` | Live cards | GC | 5 |
| ☐ | Drive view: Live Drive / Final Drive / Last Scoring Drive / Interactive (Test) Demo Sim | `setGameDriveViewMode(id, mode)` | Cards + theater | GC segmented control | 5 |
| ☐ | Load drive summary ("Tap to load") | `fetchGameDriveSummary()` | Cards | GC | 5 |
| ☐ | Simulate Next Play / Red Zone (Jump to Red Zone) / TD Play (Trigger TD Play) / Flip Possession (New Drive) | `simulateNextDemoPlay(id, kind)` | Cards + theater | GC sim controls | 5 |
| ☐ | Auto-Sim loop | `toggleDemoAutoLoop()` | Cards + theater | GC | 5 |
| ☐ | Field Sim toggle | `toggleDemoFieldPreview()` · `#btn-demo-field-toggle` | Drawer (ADV) | M›Settings › Live (ADV) | 7 |
| ☐ | Pick from live card | `pickSide()` | Live cards | Kept where it is today (only while the game is unlocked) | 5 |
| ☐ | Live card Insights / Last 5 / Injuries | `toggleCardIdx()` | Live cards | GC tabs | 5 |

## J. EV & 5,000-trial simulator

| ☐ | Feature | Handler / ID | Today | New home | Step |
|---|---|---|---|---|---|
| ☐ | EV Sim drawer | `openEvSimulatorDrawer()` / `closeEvSimulatorDrawer()` / `renderEvSimulatorDrawerBody()` · `#ev-sim-drawer-backdrop`, `#ev-sim-drawer-body`, `#btn-open-ev-sim-drawer` | Top bar, sidebar, drawer | M›Simulator (+ ADV entry in PH) | 4 |
| ☐ | Monte Carlo pool sim | `runMonteCarloPoolSimulation(5000, true)` · `#monte-carlo-sim-container` | Standings | S (ADV) + Simulator | 6 |
| ☐ | Weekly Finish Odds / Season Standings Odds | `setMonteCarloSimMode()` | Standings | S segmented (ADV) | 6 |
| ☐ | Re-Run 5,000 Sims | `runMonteCarloPoolSimulation()` | Standings | S | 6 |
| ☐ | Insights | `toggleAllSubpanels('ins')`, card insights | Cards (ADV) | DS + PH ⋯ (ADV) | 4 |
| ☑ | Sandbox sim | `switchProfile('test')` | Sidebar/drawer/auth | PH profile switcher + M›Simulator | 2 |
| ☐ | Interactive / Test Demo Sim | `setGameDriveViewMode(id,'demo')` | Cards/theater | GC | 5 |

## K. Standings & exports

| ☐ | Feature | Handler / ID | Today | New home | Step |
|---|---|---|---|---|---|
| ☐ | Standings / grading view | `renderStandingsAndGradingView()` · `#standings-view-container` | Tab | S | 6 |
| ☐ | Weekly grading cards | `#automated-grading-cards` | Standings | S › Week (ADV) | 6 |
| ☐ | Top 5 weekly winners podium | `#top5-weekly-winners-container` | Standings (both modes) | S › Week top block | 6 |
| ☐ | Leaderboard table + search | `#pool-leaderboard-table`, `#pool-leaderboard-tbody`, `#leaderboard-search-input`, `#leaderboard-count-label` | Standings | S rows (rank, name, W–L, GB; "You" tag) + search icon. Prior/Live/Final/Total/multiplier columns stay in ADV and in the row detail | 6 |
| ☐ | Week / Season | — | Columns in one table | S segmented control | 6 |
| ☐ | Watchlist editor (rename / meta) | `updateWatchlistMeta()` · `#standings-watchlist-box`, `#watchlist-editor-grid` | Standings | S › "Watchlist" section (ADV) | 6 |
| ☐ | Set Picks in Table → | `switchMainView('condensed')` | Watchlist box | Same | 6 |
| ☐ | Season archive hub | `#season-archive-hub-container` | Standings | M›Past weeks (the container is moved, not duplicated) | 7 |
| ☐ | Past weeks select | `switchWeekArchive()` · `#week-archive-select`, `#drawer-week-archive-select` | Drawer | M›Past weeks | 7 |
| ☐ | Load archived week slate & grades | `switchWeekArchive(id)` | Archive hub | M›Past weeks | 7 |
| ☐ | Snapshot Current Week / Update Snapshot in Firestore / Archive Week (CM) | `saveCurrentWeekToArchive(true)` · `#btn-top-archive-wk` | Archive hub + drawer | M›Past weeks (CM) + Console | 7/8 |
| ☐ | New Week Reset (Clear Pool Picks) | `resetPoolPicksForNewWeek(true)` | Standings toolbar | Console only, red confirm step. **Question 5** | 8 |
| ☐ | Import Pool Data / Bot | `openUnifiedImportModal('csv'\|'bot'\|…)` · `#btn-top-import-bot` | Standings + drawer | S header (CM) + Console | 6/8 |
| ☐ | Import Standings | `parseStandingsEmailText()` | Import Hub › Email | Import Hub (S header link) | 8 |
| ☐ | Copy Recap & Standings Post | `copyCommishRecapPost()` | Console › Comms | Console + S (CM) | 6/8 |
| ☐ | Download Master .CSV | `exportOfficialMasterCsv()` | Console › Master grid | M›Export (CM) + Console | 7/8 |
| ☐ | Sat Reveal & Export CSV / Trigger Sat Morning Reveal & Master CSV | `triggerSaturdayMorningMasterSheetBroadcast()` | Console | Console | 8 |
| ☐ | PDF Slate / CSV / Excel upload | `handlePdfFileSelect()`, `triggerFileInputClick()`, `handleMasterCsvFileUpload()`, `parseAndStoreMasterPoolCsv()` · `#pdf-file-input`, `#csv-master-file-input` | Import Hub | Import Hub | 8 |

## L. Account

| ☐ | Feature | Handler / ID | Today | New home | Step |
|---|---|---|---|---|---|
| ☐ | Account modal | `openAuthModal()` / `closeAuthModal()` · `#auth-modal-*`, `#btn-auth-account` | Sidebar, drawer, pill | M›Account (opens the same modal as a sheet) | 7 |
| ☐ | Sign In / Create Account mode | `setAuthModalMode('signin'\|'signup')` | Auth modal | Same | 7 |
| ☐ | Continue with Google / Mobile Redirect | `signInWithGoogleAccount(false\|true)` | Auth modal | Same | 7 |
| ☐ | Email + password submit | `submitEmailPasswordAuth()` · `#auth-email-input`, `#auth-password-input`, `#auth-name-input` | Auth modal | Same | 7 |
| ☐ | Forgot Password | `sendEmailPasswordReset()` | Auth modal | Same | 7 |
| ☐ | Pick pool member at signup | `handleAuthMemberSelectChange()` · `#auth-link-member-select` · localStorage `sat_pending_oauth_member_v16` | Auth modal | Same | 7 |
| ☐ | Edit display name / prior pts + Save | `saveCustomInstanceDisplayName()` · `#auth-edit-display-name`, `#auth-edit-prior-pts` | Auth modal | Same | 7 |
| ☐ | Sign Out of Instance | `signOutAccountInstance()` | Auth modal | M›Account (red confirm) | 7 |
| ☐ | Profile PIN modal | `submitPinModal()` / `closePinModal()` / `unlockProfileWithPrompt()` · `#pin-modal-*` | Modal | Same, restyled | 7 |
| ☑ | Guest strip: Continue as Guest / Login / Make an Account (Keep My N Picks) / My Account / Switch / Pick Privacy | `renderSimpleGuestAccountBar()`, `startGuestPickingMode()`, `openAuthModalCarryingGuestPicks()` · `#simple-guest-account-strip` | Above picks | Slim banner above the Picks list | 2 |
| ☐ | Commish Login | `quickSignInAsVerifiedCommissioner()` | Drawer | M›Account | 7 |
| ☐ | Admin instance override (CM) | `toggleAdminInstanceOverride()` | Auth modal | Same (CM) | 7 |
| ☐ | Reset Player Password (CM) | `commissionerResetPlayerPassword()` · `#commish-reset-email-input` | Auth modal | Same + Console › Roster | 7/8 |
| ☐ | Session persistence | localStorage `sat_auth_session_v16`, `sat_device_active_profile_v16`, `sat_device_test_sim_v16`, `sat_week7_official_v14` | — | Unchanged | — |

## M. Settings (new screen, everything here already exists except Theme)

| ☐ | Feature | Handler | New home | Step |
|---|---|---|---|---|
| ☑ | **Theme: Dark (default) / Light** | **NEW**: `setAppTheme()` · localStorage `sat_theme_v1` · `html[data-theme]` | M›Settings | 1/7 |
| ☐ | Advanced mode | `toggleSimpleUiMode()` | M›Settings | 7 |
| ☐ | Show details inline (Cards + Injuries/L5) | `setSimpleCardLayoutStyle()` | M›Settings | 7 |
| ☐ | Privacy: Hide my picks · Spy Shield/Blind · Full privacy & H2H settings | see §F | M›Settings | 7 |
| ☐ | Live: Auto-poll · Field Sim (ADV) · Sync now · Force Firebase pull | see §I | M›Settings | 7 |

## N. Commissioner Command Console (CM)

Opens with `openCommissionerModal(tab)` / `closeCommissionerModal()`; tabs switch with
`switchCommissionerTab()` and render through `renderCommissionerModalBody()` into
`#commish-modal-body`. Both `simple-mode-commissioner.js` and `commissioner-admin.js` define
the submissions renderer. The later one (`commissioner-admin.js`) wins at runtime, and both are
left as they are. Entry points: `#btn-commish-console` (top bar), drawer "Commish Console",
"Master Sheet Grid". New entry: M›Commissioner (CM) + header crown (CM).

| ☐ | Section / control | Handler / ID | Step |
|---|---|---|---|
| ☐ | Tabs 1–7 | `#cm-tab-submissions/-mastersheet/-slate/-locks/-roster/-comms/-admin` | 8 |
| ☐ | Mode pill | `#commish-mode-pill` | 8 |
| ☐ | **1 Submissions**: Saved/Missing KPIs; filter All/Saved/Missing | `setCommishSubFilter('all'\|'submitted'\|'missing')` | 8 |
| ☐ | 1: Send Wed/Thu Nudge (copies missing list) | `triggerWedThuAutomatedNudge()`, `copyMissingPlayersList()` | 8 |
| ☐ | 1: Auto-Fill Missing | `commishAutoFillMissingPlayers('chalk')` | 8 |
| ☐ | 1: Edit Picks / Enter/Edit Picks / ✏️ | `commishQuickImpersonate(key)` | 8 |
| ☐ | 1: Auto-Pick / Delete Picks per row | `commishAutoSelectPlayerPicks()`, `commishDeletePlayerPicks()` (red confirm) | 8 |
| ☐ | 1: Sat Reveal & Export CSV | `triggerSaturdayMorningMasterSheetBroadcast()` | 8 |
| ☐ | Commish active edit bar (player select, Optimal / Favorites / Chaser, Delete, Done) | `#commish-active-edit-bar`, `commissionerSwitchToMember()`, `exitCommissionerImpersonateMode()` | 8 |
| ☐ | **2 Master Spreadsheet Grid**: search, grid, Download Master .CSV | `MASTER_SHEET_SEARCH_Q`, `exportOfficialMasterCsv()` | 8 |
| ☐ | 2: Build Sheet + Sync to Firebase Cloud | `importStrictSheetText()` | 8 |
| ☐ | **3 ESPN Slate Builder**: week input, Pull Automated ESPN Game List | `commishFetchEspnCandidateGames()` · `#commish-espn-wk-input` | 8 |
| ☐ | 3: Publish Checked Games as Active Slate | `commishPublishSelectedEspnSlate()` | 8 |
| ☐ | 3: Save Slate to Cloud | `pushCustomGamesToFirebase()` | 8 |
| ☐ | 3: Per-game swap / custom swap / spread / kickoff / tie-breaker game | `commishSwapIndividualGame()`, `applyCustomGameSwapInline()` (`#custom-swap-away-N`, `#custom-swap-home-N`), `commishUpdateGameSpread()`, `commishUpdateGameKick()`, `setTiebreakerGame()` | 8 |
| ☐ | **4 Locks & Rules**: lock mode (Fri 9 PM CST / rolling kickoff / global locked / open) | `setCommishLockMode()` | 8 |
| ☐ | 4: Scraping mode (hybrid / standalone) | `setCommishScrapingMode()` | 8 |
| ☐ | 4: Copy Rules | `navigator.clipboard.writeText(PRODUCTION_FIRESTORE_SECURITY_RULES)` | 8 |
| ☐ | **5 Roster & Dues**: prior pts adjust, Paid/Unpaid toggle, Edit Picks | `commishAdjustPlayerPriorPts()`, `commishToggleDuesPaid()`, `commishQuickImpersonate()` | 8 |
| ☐ | 5: Add Player to Pool | `commishAddPoolMember()` · `#commish-new-player-name`, `#commish-new-player-pts` | 8 |
| ☐ | 5: Entry fee | `state.commissionerConfig.entryFeeDollars` input | 8 |
| ☐ | 5: Add Buy-In / Reset Player Password | `addLinkedBuyInEntryFromInput()`, `commissionerResetPlayerPassword()` | 8 |
| ☐ | **6 Banner & Recap**: Publish Banner / Clear | `commishSaveBanner()` · `#commish-banner-input` | 8 |
| ☐ | 6: Copy Recap & Standings Post | `copyCommishRecapPost()` | 8 |
| ☐ | **7 Multi-Commish & Admin Email**: Update Primary Email | `commishUpdatePrimaryEmail()` · `#commish-primary-email-input` | 8 |
| ☐ | 7: Grant Role (text + member select) | `commishGrantRole()` · `#commish-new-role-input` | 8 |
| ☐ | 7: Enable / Disable role | `commishToggleRoleEnabled()` | 8 |
| ☐ | 7: Revoke | `commishRevokeRole()` (red confirm) | 8 |
| ☐ | **Import / Bot Hub** tabs: Gmail .XLSX Bot · CSV / Excel · PDF Slate · Email / Standings · Cloud & Reset | `openUnifiedImportModal()`, `switchImportHubTab()` · `#hub-btn-bot/-csv/-pdf/-email/-cloud` | 8 |
| ☐ | Bot: Sync All N picks to Firebase | `syncCurrentLoadedSheetToFirebase()` | 8 |
| ☐ | Bot: Apps Script URL + Run Gmail Bot | `triggerAppsScriptGmailScraper()` · `#gas-webapp-url-input` | 8 |
| ☐ | Bot: Copy Code.gs | `copyUpgradedCodeGs()` | 8 |
| ☐ | CSV: Parse & Sync Full Pool to Firebase | `parseAndStoreMasterPoolCsv()` | 8 |
| ☐ | Email: Import N Picks / Import Standings | `parseConfirmationEmailPicks()`, `parseStandingsEmailText()` | 8 |
| ☐ | Cloud & Reset: Force Firebase Pull / Reset Optimal Picks | `pullFromFirebaseCloud()`, `hardResetToDefaults()` | 8 |
| ☐ | Archive Week / Snapshot / Update Snapshot | `saveCurrentWeekToArchive(true)` | 8 |
| ☐ | New Week Reset (Clear Pool Picks) | `resetPoolPicksForNewWeek(true)` (red confirm) | 8 |
| ☐ | Bot health pill | `#bot-sync-pill` | 8 |

---

# Screen-by-screen plan

**Approach.** This is a reskin. Render functions keep their names, signatures and data flow.
Where a function builds HTML strings, only class names and markup change, never the
`onclick` it wires. Static elements that JS looks up by ID keep their IDs, even when they
move. Where an old element no longer has a visible home (for example `#tab-mode-condensed`),
it stays in the DOM as a hidden element so that `getElementById(...).className = …` never
throws.

**CSS.** New `public/css/tokens.css` (the palette exactly as specified, plus
`[data-theme="light"]` overrides) and `public/css/app.css` (shell + components, using only
`var(--…)`). The four existing stylesheets are then pruned of gradients, glows, shadows,
blur and Tailwind colours, step by step, until they're deleted. Inline `style="…"` colours in
JS strings get swapped for classes as each screen is redone. Theme is applied before first
paint by a 3-line inline snippet in `<head>` that reads `sat_theme_v1`.

**Libraries.** Google Fonts (Barlow, Barlow Condensed); Lucide pinned
(`unpkg.com/lucide@<exact version>/dist/umd/lucide.min.js`) with `lucide.createIcons()`
called after each render through one `refreshIcons()` helper.

**Logos.** No logo data exists today. `espn.js` already builds `ESPN_TEAM_MAP`
(abbreviation → ESPN team id), so logos will be
`https://a.espncdn.com/i/teamlogos/ncaa/500/<id>.png`. If a team has no id, the fallback is a
neutral circle with the team code. 1px light ring via `outline`.

**Shell (step 1).** Phone: sticky header (week + profile button + crown for CM) with bottom
tabs Picks · Live · Standings · More. Desktop ≥900px: 220px left sidebar (app name; Picks,
Live, Standings; More group: Past weeks, Simulator, Export, Account, Settings, Commissioner),
center column max 1120px, right rail 300px (season top 5, last week summary, watchlist, sway
feed in ADV) that collapses with the existing `toggleDesktopSidebarCollapse()`.

**Picks (2).** Header "Week N Picks", lock time, "X of Y picked" + 3px gold bar, Review
button, Quick picks menu, ⋯ menu (expand-alls, lock, details inline). Chip row. 2-column grid
on desktop. Tie-breaker card at the end. Sticky Submit.

**Detail sheet (3).** One `openGameDetail(id)` that composes the existing injuries / L5 /
insights / H2H renderers and links to GameCast. Bottom sheet below 900px, right side panel at
900px and up. Escape and backdrop close it, and focus returns to the card.

**Advanced (4).** Second line on each card (EV · own% · leverage · sway), ADV chips, Cards/Table
toggle (existing condensed renderer restyled), H2H block, simulator entry.

**Live (5).** Header + "Synced Ns ago" dot (green under 2 min, amber 2–5 min, red over 5 min; the
timestamp is recorded at the end of `syncAllLiveTrackingData` / `pollLiveSaturdayScores`
without changing their logic), three tiles, one card per game, tap → GameCast.

**Standings (6).** Week/Season segmented control; rank (gold for 1–3, "T" for ties), name, W–L,
GB; current user on `--raised` with gold "You". ADV/CM extras below.

**More / Settings / Account (7).** List screen; each item opens the existing modal/drawer content
restyled as a sheet.

**Commissioner (8).** Phone: list of 7 sections + Import/Bot hub, tap to drill in. Desktop:
tabs. Destructive actions go through one shared `confirmDanger(message, onConfirm)` dialog in
`--loss`.

**Verification after every step.** Playwright run at 390×844 and 1280×800 (screenshots of each
screen, plus a console-error capture), and the existing `tests/client/smoke.js` and
`scenarios.js` must still pass. Then this checklist gets ticked.
