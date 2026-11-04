"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// Mock browser globals
global.window = global;
global.window.addEventListener = () => {};
global.window.removeEventListener = () => {};
global.document = {
  getElementById: () => null,
  querySelectorAll: () => [],
  createElement: () => ({ className: "", textContent: "" })
};
global.showAppToast = () => {};
global.isVerifiedCommissioner = () => true;
global.pushCustomGamesToFirebase = () => {};
global.renderGames = () => {};
global.renderLiveScoreboardTab = () => {};
global.renderAll = () => {};
global.updateWeekBrandingUI = () => {};

// Load dependencies
const teamsSrc = fs.readFileSync(path.join(__dirname, "../../public/js/data/teams.js"), "utf8");
const fieldTrackerSrc = fs.readFileSync(path.join(__dirname, "../../public/js/render/field-tracker.js"), "utf8");

vm.runInThisContext(teamsSrc);
vm.runInThisContext(fieldTrackerSrc);

test("TEAM_RANKS authority maps 2026 CFP Committee rankings (Alabama #5, UCLA #8, Texas #7)", () => {
  assert.strictEqual(TEAM_RANKS["Alabama"], "#5", "Alabama must be #5 in official CFP rankings");
  assert.strictEqual(TEAM_RANKS["UCLA"], "#8", "UCLA must be #8 in official CFP rankings");
  assert.strictEqual(TEAM_RANKS["Texas"], "#7", "Texas must be #7 in official CFP rankings");
  assert.strictEqual(TEAM_RANKS["Utah"], "#3", "Utah must be #3 in official CFP rankings");
  assert.strictEqual(TEAM_RANKS["Indiana"], "#4", "Indiana must be #4 in official CFP rankings");
  assert.strictEqual(TEAM_RANKS["Kentucky"], "#6", "Kentucky must be #6 in official CFP rankings");
  assert.strictEqual(TEAM_RANKS["Notre Dame"], "#11", "Notre Dame must be #11 in official CFP rankings");
  assert.strictEqual(TEAM_RANKS["Ohio State"], "#12", "Ohio State must be #12 in official CFP rankings");
  assert.strictEqual(TEAM_RANKS["Tennessee"], "#13", "Tennessee must be #13 in official CFP rankings");
  assert.strictEqual(TEAM_RANKS["LSU"], "#14", "LSU must be #14 in official CFP rankings");
  assert.strictEqual(TEAM_RANKS["Texas Tech"], "#15", "Texas Tech must be #15 in official CFP rankings");
  assert.strictEqual(TEAM_RANKS["South Carolina"], "#21", "South Carolina must be #21 in official CFP rankings");
  assert.strictEqual(TEAM_RANKS["Oregon"], "#23", "Oregon must be #23 in official CFP rankings");
  assert.strictEqual(TEAM_RANKS["Florida"], "#24", "Florida must be #24 in official CFP rankings");
});

test("formatOppWithRank accurately formats teams using CFP rankings", () => {
  assert.strictEqual(formatOppWithRank("Alabama"), "#5 Alabama");
  assert.strictEqual(formatOppWithRank("UCLA"), "#8 UCLA");
  assert.strictEqual(formatOppWithRank("Notre Dame"), "#11 Notre Dame");
  assert.strictEqual(formatOppWithRank("Minnesota"), "Minnesota", "Unranked teams receive no prefix");
});

test("fetchLiveCollegeFootballRankings prioritizes Playoff Committee Rankings over AP Poll", async () => {
  const mockEspnPayload = {
    rankings: [
      {
        name: "Playoff Committee Rankings",
        type: "cfp",
        shortName: "CFP Rankings",
        ranks: [
          { current: 1, team: { location: "Miami", name: "Hurricanes" } },
          { current: 2, team: { location: "Georgia", name: "Bulldogs" } },
          { current: 3, team: { location: "Utah", name: "Utes" } },
          { current: 4, team: { location: "Indiana", name: "Hoosiers" } },
          { current: 5, team: { location: "Alabama", name: "Crimson Tide" } },
          { current: 6, team: { location: "Kentucky", name: "Wildcats" } },
          { current: 7, team: { location: "Texas", name: "Longhorns" } },
          { current: 8, team: { location: "UCLA", name: "Bruins" } },
          { current: 9, team: { location: "BYU", name: "Cougars" } },
          { current: 10, team: { location: "Ole Miss", name: "Rebels" } },
          { current: 11, team: { location: "Notre Dame", name: "Fighting Irish" } },
          { current: 12, team: { location: "Ohio State", name: "Buckeyes" } },
          { current: 13, team: { location: "Tennessee", name: "Volunteers" } },
          { current: 14, team: { location: "LSU", name: "Tigers" } },
          { current: 15, team: { location: "Texas Tech", name: "Red Raiders" } },
          { current: 16, team: { location: "Wake Forest", name: "Demon Deacons" } },
          { current: 17, team: { location: "Houston", name: "Cougars" } },
          { current: 18, team: { location: "Missouri", name: "Tigers" } },
          { current: 19, team: { location: "Iowa", name: "Hawkeyes" } },
          { current: 20, team: { location: "USC", name: "Trojans" } }
        ]
      },
      {
        name: "AP Top 25",
        type: "ap",
        shortName: "AP Poll",
        ranks: [
          { current: 1, team: { location: "Miami", name: "Hurricanes" } },
          { current: 2, team: { location: "Georgia", name: "Bulldogs" } },
          { current: 3, team: { location: "Utah", name: "Utes" } },
          { current: 4, team: { location: "Notre Dame", name: "Fighting Irish" } },
          { current: 5, team: { location: "UCLA", name: "Bruins" } }
        ]
      }
    ]
  };

  global.fetchJsonSafe = async () => mockEspnPayload;
  global.GAMES = [
    { id: 3, away: "UCLA", awayRec: "#5 • 8-0", home: "Minnesota", homeRec: "5-3" },
    { id: 12, away: "Alabama", awayRec: "#9 • 6-2", home: "LSU", homeRec: "#15 • 6-2" },
    { id: 19, away: "Miami", awayRec: "#1 • 8-0", home: "Notre Dame", homeRec: "#4 • 7-1" }
  ];

  const updated = await fetchLiveCollegeFootballRankings(true);
  assert.strictEqual(updated, true, "fetchLiveCollegeFootballRankings should return true");
  assert.strictEqual(CFB_RANKINGS_POLL_NAME, "Playoff Committee Rankings");
  assert.strictEqual(TEAM_RANKS["Alabama"], "#5");
  assert.strictEqual(TEAM_RANKS["UCLA"], "#8");
  assert.strictEqual(TEAM_RANKS["Notre Dame"], "#11");

  // Verify game records were updated with new CFP ranks
  assert.strictEqual(GAMES[0].awayRec, "#8 • 8-0", "UCLA should be re-ranked to #8");
  assert.strictEqual(GAMES[1].awayRec, "#5 • 6-2", "Alabama should be re-ranked to #5");
  assert.strictEqual(GAMES[1].homeRec, "#14 • 6-2", "LSU should be re-ranked to #14");
  assert.strictEqual(GAMES[2].homeRec, "#11 • 7-1", "Notre Dame should be re-ranked to #11");
});

test("fetchLiveCollegeFootballRankings falls back to AP Top 25 when CFP rankings are absent", async () => {
  const mockPreNovPayload = {
    rankings: [
      {
        name: "AP Top 25",
        type: "ap",
        shortName: "AP Poll",
        ranks: [
          { current: 1, team: { location: "Miami", name: "Hurricanes" } },
          { current: 2, team: { location: "Georgia", name: "Bulldogs" } },
          { current: 3, team: { location: "Utah", name: "Utes" } },
          { current: 4, team: { location: "Notre Dame", name: "Fighting Irish" } },
          { current: 5, team: { location: "UCLA", name: "Bruins" } },
          { current: 6, team: { location: "Indiana", name: "Hoosiers" } },
          { current: 7, team: { location: "BYU", name: "Cougars" } },
          { current: 8, team: { location: "Kentucky", name: "Wildcats" } },
          { current: 9, team: { location: "Alabama", name: "Crimson Tide" } },
          { current: 10, team: { location: "Texas", name: "Longhorns" } },
          { current: 11, team: { location: "Ohio State", name: "Buckeyes" } },
          { current: 12, team: { location: "Ole Miss", name: "Rebels" } },
          { current: 13, team: { location: "Texas Tech", name: "Red Raiders" } },
          { current: 14, team: { location: "Wake Forest", name: "Demon Deacons" } },
          { current: 15, team: { location: "LSU", name: "Tigers" } },
          { current: 16, team: { location: "Tennessee", name: "Volunteers" } },
          { current: 17, team: { location: "Houston", name: "Cougars" } },
          { current: 18, team: { location: "USC", name: "Trojans" } },
          { current: 19, team: { location: "Missouri", name: "Tigers" } },
          { current: 20, team: { location: "Boise State", name: "Broncos" } }
        ]
      }
    ]
  };

  global.fetchJsonSafe = async () => mockPreNovPayload;
  const updated = await fetchLiveCollegeFootballRankings(true);
  assert.strictEqual(updated, true);
  assert.strictEqual(CFB_RANKINGS_POLL_NAME, "AP Top 25");
  assert.strictEqual(TEAM_RANKS["UCLA"], "#5");
  assert.strictEqual(TEAM_RANKS["Alabama"], "#9");
});
