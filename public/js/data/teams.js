var TEAM_LOGS = {
  "Ohio State": { rec: "5-1", l5: [
    { wk: "W6", wl: "W", loc: "vs", opp: "Maryland", score: "45-16" },
    { wk: "W5", wl: "W", loc: "at", opp: "Iowa", score: "35-7" },
    { wk: "W4", wl: "W", loc: "vs", opp: "Illinois", score: "35-8" },
    { wk: "W3", wl: "W", loc: "vs", opp: "Kent State", score: "59-3" },
    { wk: "W2", wl: "L", loc: "at", opp: "Texas", score: "23-24" }
  ]},
  "Indiana": { rec: "6-0", l5: [
    { wk: "W6", wl: "W", loc: "at", opp: "Nebraska", score: "20-17" },
    { wk: "W5", wl: "W", loc: "at", opp: "Rutgers", score: "31-17" },
    { wk: "W4", wl: "W", loc: "vs", opp: "Northwestern", score: "41-14" },
    { wk: "W3", wl: "W", loc: "vs", opp: "Western Kentucky", score: "38-17" },
    { wk: "W2", wl: "W", loc: "vs", opp: "Howard", score: "66-0" }
  ]},
  "Florida": { rec: "4-2", l5: [
    { wk: "W6", wl: "L", loc: "vs", opp: "South Carolina", score: "17-31" },
    { wk: "W5", wl: "W", loc: "at", opp: "Kentucky", score: "24-17" },
    { wk: "W4", wl: "W", loc: "vs", opp: "Ole Miss", score: "28-24" },
    { wk: "W3", wl: "L", loc: "at", opp: "Auburn", score: "17-24" },
    { wk: "W2", wl: "W", loc: "vs", opp: "Campbell", score: "45-7" }
  ]},
  "Texas": { rec: "4-1", l5: [
    { wk: "W6", wl: "L", loc: "vs", opp: "Oklahoma", score: "24-27" },
    { wk: "W4", wl: "W", loc: "at", opp: "Tennessee", score: "31-20" },
    { wk: "W3", wl: "W", loc: "vs", opp: "UTSA", score: "56-7" },
    { wk: "W2", wl: "W", loc: "vs", opp: "Ohio State", score: "24-23" },
    { wk: "W1", wl: "W", loc: "vs", opp: "Texas State", score: "52-10" }
  ]},
  "Mississippi State": { rec: "4-1", l5: [
    { wk: "W6", wl: "L", loc: "at", opp: "Alabama", score: "23-56" },
    { wk: "W5", wl: "W", loc: "vs", opp: "South Carolina", score: "27-17" },
    { wk: "W4", wl: "W", loc: "at", opp: "Minnesota", score: "31-24" },
    { wk: "W3", wl: "W", loc: "vs", opp: "Troy", score: "34-17" },
    { wk: "W2", wl: "W", loc: "vs", opp: "ULM", score: "41-10" }
  ]},
  "LSU": { rec: "4-2", l5: [
    { wk: "W6", wl: "L", loc: "at", opp: "Kentucky", score: "34-35 (OT)" },
    { wk: "W5", wl: "W", loc: "vs", opp: "Texas A&M", score: "31-24" },
    { wk: "W4", wl: "W", loc: "at", opp: "Auburn", score: "28-17" },
    { wk: "W3", wl: "L", loc: "at", opp: "Ole Miss", score: "28-31" },
    { wk: "W2", wl: "W", loc: "vs", opp: "McNeese", score: "49-10" }
  ]},
  "Virginia": { rec: "4-2", l5: [
    { wk: "W6", wl: "W", loc: "vs", opp: "Syracuse", score: "28-25" },
    { wk: "W5", wl: "W", loc: "vs", opp: "Boston College", score: "24-14" },
    { wk: "W4", wl: "W", loc: "at", opp: "Coastal Carolina", score: "43-24" },
    { wk: "W3", wl: "L", loc: "vs", opp: "Maryland", score: "13-27" },
    { wk: "W2", wl: "W", loc: "at", opp: "Wake Forest", score: "31-30" }
  ]},
  "SMU": { rec: "4-1", l5: [
    { wk: "W6", wl: "W", loc: "at", opp: "Louisville", score: "34-27" },
    { wk: "W5", wl: "W", loc: "vs", opp: "Florida State", score: "42-16" },
    { wk: "W4", wl: "W", loc: "vs", opp: "TCU", score: "66-42" },
    { wk: "W2", wl: "L", loc: "vs", opp: "BYU", score: "15-18" },
    { wk: "W1", wl: "W", loc: "vs", opp: "Houston Christian", score: "59-7" }
  ]},
  "Northwestern": { rec: "4-1", l5: [
    { wk: "W6", wl: "W", loc: "at", opp: "Maryland", score: "37-10" },
    { wk: "W5", wl: "W", loc: "vs", opp: "Colorado", score: "27-20" },
    { wk: "W4", wl: "L", loc: "at", opp: "Indiana", score: "14-41" },
    { wk: "W3", wl: "W", loc: "vs", opp: "Eastern Illinois", score: "31-7" },
    { wk: "W2", wl: "W", loc: "vs", opp: "Miami (OH)", score: "13-6" }
  ]},
  "Michigan State": { rec: "2-4", l5: [
    { wk: "W6", wl: "L", loc: "at", opp: "Wisconsin", score: "3-31" },
    { wk: "W5", wl: "L", loc: "at", opp: "Oregon", score: "10-31" },
    { wk: "W4", wl: "L", loc: "at", opp: "Boston College", score: "19-23" },
    { wk: "W3", wl: "W", loc: "vs", opp: "Prairie View", score: "40-0" },
    { wk: "W2", wl: "W", loc: "at", opp: "Maryland", score: "27-24" }
  ]},
  "Cincinnati": { rec: "4-1", l5: [
    { wk: "W6", wl: "W", loc: "at", opp: "UCF", score: "28-21" },
    { wk: "W5", wl: "L", loc: "at", opp: "Texas Tech", score: "41-44" },
    { wk: "W4", wl: "W", loc: "vs", opp: "Houston", score: "34-0" },
    { wk: "W3", wl: "W", loc: "at", opp: "Miami (OH)", score: "27-16" },
    { wk: "W2", wl: "W", loc: "vs", opp: "Pittsburgh", score: "28-27" }
  ]},
  "West Virginia": { rec: "3-3", l5: [
    { wk: "W6", wl: "L", loc: "vs", opp: "Arizona", score: "24-38" },
    { wk: "W5", wl: "L", loc: "at", opp: "Oklahoma State", score: "28-34" },
    { wk: "W4", wl: "L", loc: "vs", opp: "Kansas", score: "28-32" },
    { wk: "W3", wl: "W", loc: "at", opp: "Pittsburgh", score: "38-34" },
    { wk: "W2", wl: "W", loc: "vs", opp: "UAlbany", score: "49-14" }
  ]},
  "Kansas": { rec: "2-3", l5: [
    { wk: "W6", wl: "L", loc: "at", opp: "Utah", score: "24-41" },
    { wk: "W5", wl: "L", loc: "vs", opp: "TCU", score: "27-38" },
    { wk: "W4", wl: "W", loc: "at", opp: "West Virginia", score: "32-28" },
    { wk: "W3", wl: "L", loc: "vs", opp: "UNLV", score: "20-23" },
    { wk: "W1", wl: "W", loc: "vs", opp: "Lindenwood", score: "48-3" }
  ]},
  "Kansas State": { rec: "3-2", l5: [
    { wk: "W6", wl: "L", loc: "vs", opp: "Houston", score: "16-35" },
    { wk: "W5", wl: "W", loc: "vs", opp: "Oklahoma State", score: "42-20" },
    { wk: "W4", wl: "L", loc: "at", opp: "BYU", score: "9-38" },
    { wk: "W3", wl: "W", loc: "vs", opp: "Arizona", score: "31-7" },
    { wk: "W2", wl: "W", loc: "at", opp: "Tulane", score: "34-27" }
  ]},
  "Pittsburgh": { rec: "5-1", l5: [
    { wk: "W6", wl: "W", loc: "at", opp: "North Carolina", score: "34-24" },
    { wk: "W5", wl: "W", loc: "vs", opp: "California", score: "17-15" },
    { wk: "W4", wl: "W", loc: "vs", opp: "Youngstown State", score: "73-17" },
    { wk: "W3", wl: "L", loc: "vs", opp: "West Virginia", score: "34-38" },
    { wk: "W2", wl: "W", loc: "at", opp: "Cincinnati", score: "28-27" }
  ]},
  "Boston College": { rec: "2-3", l5: [
    { wk: "W6", wl: "L", loc: "at", opp: "Virginia", score: "14-24" },
    { wk: "W5", wl: "L", loc: "vs", opp: "Western Kentucky", score: "20-23" },
    { wk: "W4", wl: "W", loc: "vs", opp: "Michigan State", score: "23-19" },
    { wk: "W3", wl: "L", loc: "at", opp: "Missouri", score: "21-27" },
    { wk: "W1", wl: "W", loc: "at", opp: "Florida State", score: "28-13" }
  ]},
  "Alabama": { rec: "5-1", l5: [
    { wk: "W6", wl: "L", loc: "vs", opp: "Georgia", score: "17-20" },
    { wk: "W5", wl: "W", loc: "vs", opp: "Mississippi State", score: "56-23" },
    { wk: "W4", wl: "W", loc: "vs", opp: "South Carolina", score: "34-14" },
    { wk: "W3", wl: "W", loc: "vs", opp: "Florida State", score: "38-13" },
    { wk: "W2", wl: "W", loc: "at", opp: "Kentucky", score: "35-10" }
  ]},
  "Tennessee": { rec: "5-1", l5: [
    { wk: "W6", wl: "W", loc: "at", opp: "Arkansas", score: "24-17" },
    { wk: "W5", wl: "W", loc: "vs", opp: "Auburn", score: "31-14" },
    { wk: "W4", wl: "L", loc: "vs", opp: "Texas", score: "20-31" },
    { wk: "W3", wl: "W", loc: "vs", opp: "Furman", score: "63-7" },
    { wk: "W2", wl: "W", loc: "at", opp: "Georgia Tech", score: "38-21" }
  ]},
  "Missouri": { rec: "5-1", l5: [
    { wk: "W6", wl: "W", loc: "vs", opp: "Texas A&M", score: "27-6" },
    { wk: "W5", wl: "L", loc: "at", opp: "Oklahoma State", score: "24-31" },
    { wk: "W4", wl: "W", loc: "vs", opp: "Vanderbilt", score: "30-27 (OT)" },
    { wk: "W3", wl: "W", loc: "vs", opp: "Boston College", score: "27-21" },
    { wk: "W2", wl: "W", loc: "vs", opp: "Buffalo", score: "38-0" }
  ]},
  "Ole Miss": { rec: "4-1", l5: [
    { wk: "W6", wl: "W", loc: "at", opp: "Vanderbilt", score: "52-17" },
    { wk: "W4", wl: "L", loc: "at", opp: "Florida", score: "24-28" },
    { wk: "W3", wl: "W", loc: "vs", opp: "LSU", score: "31-28" },
    { wk: "W2", wl: "W", loc: "vs", opp: "Middle Tennessee", score: "52-3" },
    { wk: "W1", wl: "W", loc: "vs", opp: "Furman", score: "76-0" }
  ]},
  "Auburn": { rec: "3-2", l5: [
    { wk: "W5", wl: "L", loc: "at", opp: "Tennessee", score: "14-31" },
    { wk: "W4", wl: "L", loc: "vs", opp: "LSU", score: "17-28" },
    { wk: "W3", wl: "W", loc: "vs", opp: "Florida", score: "24-17" },
    { wk: "W2", wl: "W", loc: "vs", opp: "New Mexico", score: "45-19" },
    { wk: "W1", wl: "W", loc: "vs", opp: "Alabama A&M", score: "73-3" }
  ]},
  "Georgia": { rec: "6-0", l5: [
    { wk: "W6", wl: "W", loc: "at", opp: "Alabama", score: "20-17" },
    { wk: "W5", wl: "W", loc: "vs", opp: "Vanderbilt", score: "38-14" },
    { wk: "W4", wl: "W", loc: "vs", opp: "Oklahoma", score: "41-13" },
    { wk: "W3", wl: "W", loc: "at", opp: "Arkansas", score: "45-17" },
    { wk: "W2", wl: "W", loc: "vs", opp: "Western Kentucky", score: "70-20" }
  ]},
  "Arizona State": { rec: "3-2", l5: [
    { wk: "W6", wl: "W", loc: "vs", opp: "Hawaii", score: "30-12" },
    { wk: "W5", wl: "L", loc: "vs", opp: "Kansas", score: "21-28" },
    { wk: "W4", wl: "L", loc: "at", opp: "Texas Tech", score: "22-30" },
    { wk: "W3", wl: "W", loc: "at", opp: "Texas State", score: "31-28" },
    { wk: "W1", wl: "W", loc: "vs", opp: "Wyoming", score: "48-7" }
  ]},
  "Texas Tech": { rec: "5-0", l5: [
    { wk: "W6", wl: "W", loc: "at", opp: "Arizona", score: "28-22" },
    { wk: "W5", wl: "W", loc: "vs", opp: "Cincinnati", score: "44-41" },
    { wk: "W4", wl: "W", loc: "vs", opp: "Arizona State", score: "30-22" },
    { wk: "W3", wl: "W", loc: "vs", opp: "North Texas", score: "66-21" },
    { wk: "W1", wl: "W", loc: "vs", opp: "Abilene Christian", score: "52-51 (OT)" }
  ]},
  "Georgia Tech": { rec: "2-3", l5: [
    { wk: "W6", wl: "W", loc: "vs", opp: "Duke", score: "28-25" },
    { wk: "W4", wl: "L", loc: "at", opp: "Louisville", score: "19-31" },
    { wk: "W3", wl: "L", loc: "at", opp: "Syracuse", score: "28-31" },
    { wk: "W2", wl: "L", loc: "vs", opp: "Tennessee", score: "21-38" },
    { wk: "W1", wl: "W", loc: "vs", opp: "Florida State", score: "24-21" }
  ]},
  "Virginia Tech": { rec: "4-2", l5: [
    { wk: "W6", wl: "W", loc: "at", opp: "Stanford", score: "31-7" },
    { wk: "W5", wl: "L", loc: "at", opp: "Miami (FL)", score: "34-38" },
    { wk: "W4", wl: "W", loc: "vs", opp: "Rutgers", score: "26-23" },
    { wk: "W3", wl: "W", loc: "at", opp: "Old Dominion", score: "37-17" },
    { wk: "W2", wl: "W", loc: "vs", opp: "Marshall", score: "31-14" }
  ]},
  "North Carolina": { rec: "3-2", l5: [
    { wk: "W6", wl: "L", loc: "vs", opp: "Pittsburgh", score: "24-34" },
    { wk: "W4", wl: "L", loc: "vs", opp: "James Madison", score: "50-70" },
    { wk: "W3", wl: "W", loc: "vs", opp: "NC Central", score: "45-10" },
    { wk: "W2", wl: "W", loc: "vs", opp: "Charlotte", score: "38-20" },
    { wk: "W1", wl: "W", loc: "at", opp: "Minnesota", score: "19-17" }
  ]},
  "Duke": { rec: "4-1", l5: [
    { wk: "W6", wl: "L", loc: "at", opp: "Georgia Tech", score: "25-28" },
    { wk: "W4", wl: "W", loc: "at", opp: "Middle Tennessee", score: "45-17" },
    { wk: "W3", wl: "W", loc: "vs", opp: "UConn", score: "26-21" },
    { wk: "W2", wl: "W", loc: "at", opp: "Northwestern", score: "26-20 (OT)" },
    { wk: "W1", wl: "W", loc: "vs", opp: "Elon", score: "26-3" }
  ]},
  "Penn State": { rec: "3-3", l5: [
    { wk: "W6", wl: "L", loc: "at", opp: "USC", score: "23-31" },
    { wk: "W5", wl: "L", loc: "vs", opp: "UCLA", score: "17-24" },
    { wk: "W4", wl: "W", loc: "vs", opp: "Illinois", score: "21-7" },
    { wk: "W3", wl: "W", loc: "vs", opp: "Kent State", score: "56-0" },
    { wk: "W2", wl: "L", loc: "vs", opp: "Bowling Green", score: "24-27" }
  ]},
  "Michigan": { rec: "3-2", l5: [
    { wk: "W6", wl: "L", loc: "at", opp: "Washington", score: "17-27" },
    { wk: "W5", wl: "W", loc: "vs", opp: "Minnesota", score: "27-24" },
    { wk: "W4", wl: "W", loc: "vs", opp: "USC", score: "27-24" },
    { wk: "W3", wl: "W", loc: "vs", opp: "Oklahoma", score: "24-17" },
    { wk: "W2", wl: "L", loc: "vs", opp: "Texas", score: "12-31" }
  ]},
  "Florida State": { rec: "3-3", l5: [
    { wk: "W6", wl: "L", loc: "vs", opp: "Clemson", score: "13-29" },
    { wk: "W5", wl: "L", loc: "at", opp: "SMU", score: "16-42" },
    { wk: "W4", wl: "W", loc: "vs", opp: "California", score: "14-9" },
    { wk: "W3", wl: "L", loc: "at", opp: "Alabama", score: "13-38" },
    { wk: "W2", wl: "W", loc: "vs", opp: "Memphis", score: "20-12" }
  ]},
  "Miami (FL)": { rec: "5-0", l5: [
    { wk: "W6", wl: "W", loc: "at", opp: "California", score: "39-38" },
    { wk: "W5", wl: "W", loc: "vs", opp: "Virginia Tech", score: "38-34" },
    { wk: "W4", wl: "W", loc: "at", opp: "USF", score: "50-15" },
    { wk: "W3", wl: "W", loc: "vs", opp: "Ball State", score: "62-0" },
    { wk: "W2", wl: "W", loc: "vs", opp: "Florida A&M", score: "56-9" }
  ]},
  "Arkansas": { rec: "2-4", l5: [
    { wk: "W6", wl: "L", loc: "vs", opp: "Tennessee", score: "17-24" },
    { wk: "W5", wl: "L", loc: "vs", opp: "Texas A&M", score: "17-21" },
    { wk: "W4", wl: "W", loc: "at", opp: "Auburn", score: "24-14" },
    { wk: "W3", wl: "L", loc: "vs", opp: "Georgia", score: "17-45" },
    { wk: "W2", wl: "L", loc: "at", opp: "Oklahoma State", score: "31-39 (2OT)" }
  ]},
  "Vanderbilt": { rec: "3-3", l5: [
    { wk: "W6", wl: "L", loc: "vs", opp: "Ole Miss", score: "17-52" },
    { wk: "W5", wl: "L", loc: "at", opp: "Georgia", score: "14-38" },
    { wk: "W4", wl: "L", loc: "at", opp: "Missouri", score: "27-30 (OT)" },
    { wk: "W2", wl: "W", loc: "vs", opp: "Alcorn State", score: "55-0" },
    { wk: "W1", wl: "W", loc: "vs", opp: "Virginia Tech", score: "34-27 (OT)" }
  ]},
  "TCU": { rec: "2-3", l5: [
    { wk: "W6", wl: "L", loc: "vs", opp: "Houston", score: "19-30" },
    { wk: "W5", wl: "W", loc: "at", opp: "Kansas", score: "38-27" },
    { wk: "W4", wl: "L", loc: "at", opp: "SMU", score: "42-66" },
    { wk: "W3", wl: "L", loc: "vs", opp: "UCF", score: "34-35" },
    { wk: "W1", wl: "W", loc: "at", opp: "Stanford", score: "34-27" }
  ]},
  "Baylor": { rec: "4-1", l5: [
    { wk: "W6", wl: "W", loc: "at", opp: "Iowa State", score: "31-28" },
    { wk: "W5", wl: "L", loc: "vs", opp: "BYU", score: "28-34" },
    { wk: "W4", wl: "W", loc: "at", opp: "Colorado", score: "38-31" },
    { wk: "W3", wl: "W", loc: "vs", opp: "Air Force", score: "31-3" },
    { wk: "W1", wl: "W", loc: "vs", opp: "Tarleton State", score: "45-3" }
  ]},
  "Notre Dame": { rec: "6-0", l5: [
    { wk: "W6", wl: "W", loc: "vs", opp: "Stanford", score: "58-7" },
    { wk: "W5", wl: "W", loc: "vs", opp: "Louisville", score: "31-24" },
    { wk: "W4", wl: "W", loc: "vs", opp: "Miami (OH)", score: "28-3" },
    { wk: "W3", wl: "W", loc: "at", opp: "Purdue", score: "66-7" },
    { wk: "W1", wl: "W", loc: "at", opp: "Texas A&M", score: "23-13" }
  ]},
  "BYU": { rec: "5-0", l5: [
    { wk: "W6", wl: "W", loc: "vs", opp: "Iowa State", score: "24-10" },
    { wk: "W5", wl: "W", loc: "at", opp: "Baylor", score: "34-28" },
    { wk: "W4", wl: "W", loc: "vs", opp: "Kansas State", score: "38-9" },
    { wk: "W3", wl: "W", loc: "at", opp: "Wyoming", score: "34-14" },
    { wk: "W2", wl: "W", loc: "at", opp: "SMU", score: "18-15" }
  ]},
  "Oklahoma State": { rec: "4-1", l5: [
    { wk: "W6", wl: "W", loc: "vs", opp: "West Virginia", score: "34-28" },
    { wk: "W5", wl: "W", loc: "vs", opp: "Missouri", score: "31-24" },
    { wk: "W4", wl: "L", loc: "at", opp: "Kansas State", score: "20-42" },
    { wk: "W3", wl: "W", loc: "at", opp: "Tulsa", score: "45-10" },
    { wk: "W2", wl: "W", loc: "vs", opp: "Arkansas", score: "39-31 (2OT)" }
  ]},
  "Houston": { rec: "5-1", l5: [
    { wk: "W6", wl: "W", loc: "at", opp: "Kansas State", score: "35-16" },
    { wk: "W5", wl: "W", loc: "at", opp: "TCU", score: "30-19" },
    { wk: "W4", wl: "L", loc: "at", opp: "Cincinnati", score: "0-34" },
    { wk: "W3", wl: "W", loc: "vs", opp: "Rice", score: "33-7" },
    { wk: "W2", wl: "W", loc: "vs", opp: "UNLV", score: "27-20" }
  ]},
  "Wisconsin": { rec: "4-1", l5: [
    { wk: "W5", wl: "W", loc: "vs", opp: "Michigan State", score: "31-3" },
    { wk: "W4", wl: "W", loc: "at", opp: "USC", score: "27-24" },
    { wk: "W3", wl: "L", loc: "vs", opp: "Alabama", score: "10-42" },
    { wk: "W2", wl: "W", loc: "vs", opp: "South Dakota", score: "27-13" },
    { wk: "W1", wl: "W", loc: "vs", opp: "Western Michigan", score: "28-14" }
  ]},
  "UCLA": { rec: "5-0", l5: [
    { wk: "W6", wl: "W", loc: "vs", opp: "Oregon", score: "17-15" },
    { wk: "W5", wl: "W", loc: "at", opp: "Penn State", score: "24-17" },
    { wk: "W4", wl: "W", loc: "at", opp: "LSU", score: "27-24" },
    { wk: "W3", wl: "W", loc: "vs", opp: "Washington State", score: "24-20" },
    { wk: "W1", wl: "W", loc: "at", opp: "Hawaii", score: "16-13" }
  ]},
  "Kentucky": { rec: "5-1", l5: [
    { wk: "W6", wl: "W", loc: "vs", opp: "LSU", score: "35-34 (OT)" },
    { wk: "W5", wl: "W", loc: "at", opp: "South Carolina", score: "24-20" },
    { wk: "W4", wl: "W", loc: "vs", opp: "South Alabama", score: "38-10" },
    { wk: "W3", wl: "W", loc: "vs", opp: "Youngstown State", score: "42-7" },
    { wk: "W2", wl: "L", loc: "vs", opp: "Alabama", score: "10-35" }
  ]},
  "Oklahoma": { rec: "3-2", l5: [
    { wk: "W6", wl: "W", loc: "vs", opp: "Texas", score: "27-24" },
    { wk: "W4", wl: "L", loc: "at", opp: "Georgia", score: "13-41" },
    { wk: "W3", wl: "W", loc: "vs", opp: "New Mexico", score: "45-17" },
    { wk: "W2", wl: "L", loc: "at", opp: "Michigan", score: "17-24" },
    { wk: "W1", wl: "W", loc: "vs", opp: "UTEP", score: "42-10" }
  ]},
  "Louisville": { rec: "3-3", l5: [
    { wk: "W6", wl: "L", loc: "vs", opp: "SMU", score: "27-34" },
    { wk: "W5", wl: "L", loc: "at", opp: "Notre Dame", score: "24-31" },
    { wk: "W4", wl: "L", loc: "vs", opp: "Iowa", score: "17-20" },
    { wk: "W3", wl: "W", loc: "vs", opp: "Georgia Tech", score: "31-19" },
    { wk: "W2", wl: "W", loc: "vs", opp: "Jacksonville State", score: "49-14" }
  ]},
  "Syracuse": { rec: "2-3", l5: [
    { wk: "W6", wl: "L", loc: "at", opp: "Virginia", score: "25-28" },
    { wk: "W5", wl: "L", loc: "at", opp: "UNLV", score: "31-34" },
    { wk: "W4", wl: "L", loc: "vs", opp: "Stanford", score: "24-26" },
    { wk: "W2", wl: "W", loc: "vs", opp: "Georgia Tech", score: "31-28" },
    { wk: "W1", wl: "W", loc: "vs", opp: "Ohio", score: "38-22" }
  ]},
  "Utah": { rec: "5-0", l5: [
    { wk: "W6", wl: "W", loc: "vs", opp: "Kansas", score: "41-24" },
    { wk: "W5", wl: "W", loc: "vs", opp: "Arizona", score: "27-17" },
    { wk: "W4", wl: "W", loc: "at", opp: "Oklahoma State", score: "22-19" },
    { wk: "W3", wl: "W", loc: "at", opp: "Utah State", score: "38-21" },
    { wk: "W2", wl: "W", loc: "vs", opp: "Baylor", score: "23-12" }
  ]},
  "Colorado": { rec: "2-3", l5: [
    { wk: "W5", wl: "L", loc: "at", opp: "Northwestern", score: "20-27" },
    { wk: "W4", wl: "L", loc: "vs", opp: "Baylor", score: "31-38" },
    { wk: "W3", wl: "W", loc: "at", opp: "Colorado State", score: "28-9" },
    { wk: "W2", wl: "L", loc: "at", opp: "Nebraska", score: "10-28" },
    { wk: "W1", wl: "W", loc: "vs", opp: "North Dakota State", score: "31-26" }
  ]},
  "Wake Forest": { rec: "5-1", l5: [
    { wk: "W6", wl: "W", loc: "at", opp: "NC State", score: "34-30" },
    { wk: "W5", wl: "W", loc: "vs", opp: "Louisiana", score: "38-24" },
    { wk: "W4", wl: "W", loc: "at", opp: "UConn", score: "23-20" },
    { wk: "W3", wl: "W", loc: "vs", opp: "Ole Miss", score: "27-24" },
    { wk: "W2", wl: "L", loc: "vs", opp: "Virginia", score: "30-31" }
  ]},
  "California": { rec: "3-3", l5: [
    { wk: "W6", wl: "L", loc: "vs", opp: "Miami (FL)", score: "38-39" },
    { wk: "W5", wl: "L", loc: "at", opp: "Pittsburgh", score: "15-17" },
    { wk: "W4", wl: "L", loc: "at", opp: "Florida State", score: "9-14" },
    { wk: "W3", wl: "W", loc: "vs", opp: "San Diego State", score: "31-10" },
    { wk: "W2", wl: "W", loc: "at", opp: "Auburn", score: "21-14" }
  ]},
  "Nebraska": { rec: "5-1", l5: [
    { wk: "W6", wl: "L", loc: "vs", opp: "Indiana", score: "17-20" },
    { wk: "W5", wl: "W", loc: "vs", opp: "Rutgers", score: "14-7" },
    { wk: "W4", wl: "W", loc: "at", opp: "Purdue", score: "28-10" },
    { wk: "W3", wl: "W", loc: "vs", opp: "Illinois", score: "31-24" },
    { wk: "W2", wl: "W", loc: "vs", opp: "Colorado", score: "28-10" }
  ]},
  "Oregon": { rec: "3-2", l5: [
    { wk: "W6", wl: "L", loc: "at", opp: "UCLA", score: "15-17" },
    { wk: "W5", wl: "L", loc: "vs", opp: "USC", score: "21-24" },
    { wk: "W4", wl: "W", loc: "vs", opp: "Michigan State", score: "31-10" },
    { wk: "W3", wl: "W", loc: "at", opp: "Oregon State", score: "49-14" },
    { wk: "W2", wl: "W", loc: "vs", opp: "Boise State", score: "37-34" }
  ]},
  "Maryland": { rec: "3-3", l5: [
    { wk: "W6", wl: "L", loc: "at", opp: "Ohio State", score: "16-45" },
    { wk: "W5", wl: "L", loc: "vs", opp: "Northwestern", score: "10-37" },
    { wk: "W4", wl: "W", loc: "vs", opp: "Villanova", score: "38-20" },
    { wk: "W3", wl: "W", loc: "at", opp: "Virginia", score: "27-13" },
    { wk: "W2", wl: "L", loc: "vs", opp: "Michigan State", score: "24-27" }
  ]},
  "Iowa": { rec: "4-2", l5: [
    { wk: "W6", wl: "W", loc: "vs", opp: "Washington", score: "24-16" },
    { wk: "W5", wl: "L", loc: "vs", opp: "Ohio State", score: "7-35" },
    { wk: "W4", wl: "W", loc: "at", opp: "Louisville", score: "20-17" },
    { wk: "W3", wl: "W", loc: "vs", opp: "Troy", score: "38-21" },
    { wk: "W2", wl: "L", loc: "vs", opp: "Iowa State", score: "19-20" }
  ]},
  "South Carolina": { rec: "4-2", l5: [
    { wk: "W6", wl: "W", loc: "at", opp: "Florida", score: "31-17" },
    { wk: "W5", wl: "L", loc: "vs", opp: "Kentucky", score: "20-24" },
    { wk: "W4", wl: "L", loc: "at", opp: "Alabama", score: "14-34" },
    { wk: "W3", wl: "W", loc: "vs", opp: "Akron", score: "50-7" },
    { wk: "W2", wl: "W", loc: "at", opp: "Kentucky", score: "31-6" }
  ]},
  "USC": { rec: "4-2", l5: [
    { wk: "W6", wl: "W", loc: "vs", opp: "Penn State", score: "31-23" },
    { wk: "W5", wl: "W", loc: "at", opp: "Oregon", score: "24-21" },
    { wk: "W4", wl: "L", loc: "at", opp: "Michigan", score: "24-27" },
    { wk: "W3", wl: "W", loc: "vs", opp: "Utah State", score: "48-0" },
    { wk: "W1", wl: "W", loc: "vs", opp: "LSU", score: "27-20" }
  ]},
  "Texas A&M": { rec: "4-2", l5: [
    { wk: "W6", wl: "L", loc: "at", opp: "Missouri", score: "6-27" },
    { wk: "W5", wl: "W", loc: "vs", opp: "Arkansas", score: "21-17" },
    { wk: "W4", wl: "W", loc: "vs", opp: "Bowling Green", score: "26-20" },
    { wk: "W3", wl: "W", loc: "at", opp: "Florida", score: "33-20" },
    { wk: "W1", wl: "L", loc: "vs", opp: "Notre Dame", score: "13-23" }
  ]},
  "Iowa State": { rec: "4-2", l5: [
    { wk: "W6", wl: "L", loc: "at", opp: "BYU", score: "10-24" },
    { wk: "W5", wl: "L", loc: "vs", opp: "Baylor", score: "28-31" },
    { wk: "W4", wl: "W", loc: "at", opp: "Houston", score: "20-0" },
    { wk: "W3", wl: "W", loc: "vs", opp: "Arkansas State", score: "52-7" },
    { wk: "W2", wl: "W", loc: "at", opp: "Iowa", score: "20-19" }
  ]},
  "Clemson": { rec: "4-1", l5: [
    { wk: "W6", wl: "W", loc: "at", opp: "Florida State", score: "29-13" },
    { wk: "W5", wl: "W", loc: "vs", opp: "Stanford", score: "40-14" },
    { wk: "W4", wl: "W", loc: "vs", opp: "NC State", score: "59-35" },
    { wk: "W2", wl: "W", loc: "vs", opp: "App State", score: "66-20" },
    { wk: "W1", wl: "L", loc: "vs", opp: "Georgia", score: "3-34" }
  ]},
  "Arizona": { rec: "3-3", l5: [
    { wk: "W6", wl: "L", loc: "vs", opp: "Texas Tech", score: "22-28" },
    { wk: "W5", wl: "L", loc: "at", opp: "Utah", score: "17-27" },
    { wk: "W4", wl: "W", loc: "at", opp: "West Virginia", score: "38-24" },
    { wk: "W3", wl: "L", loc: "at", opp: "Kansas State", score: "7-31" },
    { wk: "W2", wl: "W", loc: "vs", opp: "Northern Arizona", score: "22-10" }
  ]}
};
var ESPN_TEAM_MAP = {};

// Official 2026 AP Top 25 Rankings (Week 8)
var TEAM_RANKS = {
  "Miami": "#1",
  "Miami (FL)": "#1",
  "BYU": "#2",
  "Ohio State": "#3",
  "Notre Dame": "#4",
  "Georgia": "#5",
  "Indiana": "#6",
  "Ole Miss": "#7",
  "Texas Tech": "#8",
  "UCLA": "#9",
  "Utah": "#10",
  "Tennessee": "#11",
  "Kentucky": "#12",
  "Alabama": "#13",
  "Houston": "#14",
  "Iowa": "#15",
  "USC": "#16",
  "Wake Forest": "#17",
  "LSU": "#18",
  "Texas": "#19",
  "Florida": "#20",
  "Boise State": "#21",
  "Missouri": "#22",
  "SMU": "#23",
  "Northwestern": "#24",
  "Arizona": "#25"
};

function formatOppWithRank(oppName, customRank) {
  if (!oppName) return "";
  var cleanName = oppName.replace(/^#\d+\s*/, "").trim();
  var rk = TEAM_RANKS[cleanName] || TEAM_RANKS[oppName];
  return rk ? (rk + " " + cleanName) : cleanName;
}

var CFB_MASTER_INJURIES = {
  "Ohio State": [
    { p: "Austin Siereveld", pos: "OT1", st: "OUT", note: "Highest PFF run-blocking OL ruled OUT" },
    { p: "Ja'Kobi Jackson", pos: "RB2", st: "OUT", note: "Ruled OUT on Big Ten report" }
  ],
  "Indiana": [
    { p: "Lebron Bond", pos: "WR", st: "FULL", note: "Cleared off Big Ten injury report" },
    { p: "Carson Williams", pos: "CB1", st: "FULL", note: "Cleared off Big Ten injury report" }
  ],
  "Florida": [
    { p: "Aaron Philo", pos: "QB1", st: "QUESTIONABLE", note: "Shoulder injury late vs South Carolina" },
    { p: "Duke Clark", pos: "RB", st: "OUT", note: "Ruled OUT on SEC Availability Report" }
  ],
  "Texas": [
    { p: "Justus Terry", pos: "EDGE", st: "PROBABLE", note: "Expected to play Saturday" },
    { p: "Arch Manning", pos: "QB1", st: "FULL", note: "Full participant in practice" }
  ],
  "Mississippi State": [
    { p: "Kamario Taylor", pos: "QB1", st: "QUESTIONABLE", note: "Banged up vs Alabama; monitored in practice" }
  ],
  "LSU": [
    { p: "Sam Leavitt", pos: "QB1", st: "FULL", note: "314 total yds, 3 TDs last week" },
    { p: "Dilin Jones", pos: "RB1", st: "FULL", note: "140 total yards last week" }
  ],
  "Alabama": [
    { p: "Ryan Coleman-Williams", pos: "WR1", st: "OUT", note: "Ruled OUT on SEC availability report" },
    { p: "Lotzeir Brooks", pos: "WR", st: "FULL", note: "Stepping into WR1 reps" }
  ],
  "Tennessee": [
    { p: "Faizon Brandon", pos: "QB1", st: "QUESTIONABLE", note: "Banged up vs Arkansas; game-time decision" },
    { p: "Wendell Moe Jr.", pos: "OL1", st: "OUT", note: "Ruled OUT for season" },
    { p: "Ethan Davis", pos: "TE1", st: "OUT", note: "Ruled OUT on SEC report" },
    { p: "Joakim Dodson", pos: "WR", st: "OUT", note: "Ruled OUT" }
  ],
  "Ole Miss": [
    { p: "Edwin Joseph", pos: "CB1", st: "OUT", note: "Starting DB ruled OUT on SEC report" },
    { p: "Trinidad Chambliss", pos: "QB1", st: "FULL", note: "Accounted for 4 TDs vs Vanderbilt" }
  ],
  "Missouri": [
    { p: "Austin Simmons", pos: "QB1", st: "FULL", note: "Starting QB active" }
  ],
  "Georgia": [
    { p: "Gunner Stockton", pos: "QB1", st: "FULL", note: "Starting QB active" },
    { p: "Dwight Phillips Jr.", pos: "RB1", st: "FULL", note: "Starting RB active" }
  ],
  "Penn State": [
    { p: "Alex Tatsch", pos: "LB1", st: "OUT", note: "Out for season (practice injury)" },
    { p: "Tony Rojas", pos: "LB1", st: "FULL", note: "Leading tackler active" }
  ],
  "Michigan": [
    { p: "Bryce Underwood", pos: "QB1", st: "FULL", note: "Starting QB active" }
  ],
  "Miami": [
    { p: "Darian Mensah", pos: "QB1", st: "FULL", note: "#1 passer rating in FBS (212.3)" },
    { p: "Rueben Bain Jr.", pos: "DL1", st: "FULL", note: "Cleared to play" }
  ],
  "Miami (FL)": [
    { p: "Darian Mensah", pos: "QB1", st: "FULL", note: "#1 passer rating in FBS (212.3)" },
    { p: "Rueben Bain Jr.", pos: "DL1", st: "FULL", note: "Cleared to play" }
  ],
  "Wisconsin": [
    { p: "Abu Sama III", pos: "RB1", st: "PROBABLE", note: "Upgraded to PROBABLE after bye week" }
  ],
  "Kentucky": [
    { p: "CJ Baxter", pos: "RB1", st: "QUESTIONABLE", note: "Listed QUESTIONABLE on SEC availability report" }
  ],
  "Oklahoma": [
    { p: "Michael Fasusi", pos: "OL1", st: "QUESTIONABLE", note: "Questionable on SEC availability report" },
    { p: "Eddy Pierre-Louis", pos: "DL", st: "QUESTIONABLE", note: "Questionable on SEC availability report" },
    { p: "John Mateer", pos: "QB1", st: "FULL", note: "Starting QB active" }
  ],
  "Oregon": [
    { p: "Dante Moore", pos: "QB1", st: "OUT", note: "Officially ruled OUT (concussion protocol)" },
    { p: "Evan Stewart", pos: "WR1", st: "QUESTIONABLE", note: "Listed QUESTIONABLE on Big Ten report" },
    { p: "Aaron Flowers", pos: "S", st: "OUT", note: "Ruled OUT on Big Ten report" },
    { p: "Jeremiah McClellan", pos: "WR", st: "OUT", note: "Ruled OUT on Big Ten report" }
  ]
};

var STALE_2024_INJURY_NAMES = {
  "cam rising": true,
  "travis hunter": true,
  "jimmy horn jr.": true,
  "kurtis rourke": true,
  "tyler van dyke": true,
  "chez mellusi": true,
  "braedyn locke": true,
  "kyle mccord": true,
  "ethan garbers": true,
  "conner weigman": true,
  "dequan finn": true,
  "thomas castellanos": true,
  "will johnson": true,
  "jack tuttle / alex orji": true,
  "donovan edwards": true,
  "blake shapen": true,
  "michael van buren jr.": true,
  "bear alexander": true,
  "collin oliver": true,
  "nick martin": true,
  "tre harris": true,
  "princely umanmielen": true,
  "isaiah bond": true,
  "c.j. baxter jr.": true,
  "derek williams jr.": true,
  "maxwell hairston": true,
  "demie sumo-karngbaye": true,
  "nic anderson": true,
  "andrel anthony": true,
  "max johnson": true,
  "kj jefferson": true,
  "tahj brooks": true,
  "cam skattebo": true,
  "omarion hampton": true,
  "maalik murphy": true,
  "riley leonard": true,
  "jake retzlaff": true,
  "ollie gordon ii": true,
  "zeon chriss": true,
  "tyler shough": true,
  "shedeur sanders": true,
  "hank bachmeier": true,
  "eli holstein": true
};

function isStale2024InjuryPlayer(playerName) {
  if (!playerName) return false;
  var low = String(playerName).toLowerCase().trim();
  return !!STALE_2024_INJURY_NAMES[low];
}

function filterStale2024InjuryList(injList) {
  if (!Array.isArray(injList)) return [];
  var out = [];
  for (var i = 0; i < injList.length; i++) {
    var it = injList[i];
    if (!it || !it.p) continue;
    if (isStale2024InjuryPlayer(it.p)) continue;
    out.push(it);
  }
  return out;
}

function enrichGameInjuries(g) {
  if (!g) return false;
  var updated = false;
  if (Array.isArray(g.awayInj)) {
    var clnAw = filterStale2024InjuryList(g.awayInj);
    if (clnAw.length !== g.awayInj.length) {
      g.awayInj = clnAw;
      updated = true;
    }
  }
  if (Array.isArray(g.homeInj)) {
    var clnHm = filterStale2024InjuryList(g.homeInj);
    if (clnHm.length !== g.homeInj.length) {
      g.homeInj = clnHm;
      updated = true;
    }
  }
  if (CFB_MASTER_INJURIES[g.away] && (!g.awayInj || !g.awayInj.length || isPlaceholderText(g.awayInj[0].p))) {
    g.awayInj = JSON.parse(JSON.stringify(CFB_MASTER_INJURIES[g.away]));
    updated = true;
  }
  if (CFB_MASTER_INJURIES[g.home] && (!g.homeInj || !g.homeInj.length || isPlaceholderText(g.homeInj[0].p))) {
    g.homeInj = JSON.parse(JSON.stringify(CFB_MASTER_INJURIES[g.home]));
    updated = true;
  }
  var compHdr = computeKeyInjHeaderFromLists(g, true);
  if (compHdr !== (g.keyInjHeader || "")) {
    g.keyInjHeader = compHdr;
    updated = true;
  }
  return updated;
}

