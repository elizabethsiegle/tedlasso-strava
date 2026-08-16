export interface Quote {
  text: string;
  character: string;
}

export interface Gif {
  url: string;
  alt: string;
  source: string;
  verifiedOn: string;
}

export interface Mood {
  id: string;
  name: string;
  accent: string;
  quotes: Quote[];
  gifs: Gif[];
  verifiedOn: string;
}

// The literal set of ids the engine can produce. Task 7 (`src/domain/mood.ts`)
// returns exactly these strings, and Task 12 (`src/app/refresh.ts`) looks
// moods up by them, so every id here is load-bearing.
export type MOOD_IDS =
  | "preseason"
  | "whered-you-go"
  | "believe"
  | "roy-kent"
  | "comeback-szn"
  | "football-is-life"
  | "gaffer-mode"
  | "hopeful"
  | "biscuits";

export const MOODS: Mood[] = [
  {
    id: "preseason",
    name: "Preseason",
    accent: "#6B7A8F",
    verifiedOn: "2026-08-14",
    quotes: [
      { text: "I believe in hope. I believe in believe.", character: "Ted Lasso" },
      {
        text: "Taking on a challenge is a lot like riding a horse. If you're comfortable while you're doing it, you're probably doing it wrong.",
        character: "Ted Lasso",
      },
      { text: "There's two buttons I never like to hit: panic and snooze.", character: "Ted Lasso" },
    ],
    // GIFs are sourced and verified in a separate follow-up pass. See
    // test/data/moods.test.ts for the temporary zero-GIF assertion.
    gifs: [],
  },
  {
    id: "whered-you-go",
    name: "Where'd You Go",
    accent: "#8C6239",
    verifiedOn: "2026-08-14",
    quotes: [
      {
        text: "I feel like we fell out of the lucky tree and hit every branch on the way down.",
        character: "Ted Lasso",
      },
      {
        text: "You know what the happiest animal in the world is? It's a goldfish. It's got a ten-second memory. Be a goldfish.",
        character: "Ted Lasso",
      },
      {
        text: "I promise you there is something worse out there than being sad, and that's being alone and being sad.",
        character: "Ted Lasso",
      },
    ],
    gifs: [],
  },
  {
    id: "believe",
    name: "Believe",
    accent: "#F2C14E",
    verifiedOn: "2026-08-14",
    quotes: [
      { text: "Believe.", character: "AFC Richmond locker room" },
      {
        text: "It's the lack of hope that comes and gets you. I believe in hope.",
        character: "Ted Lasso",
      },
      { text: "Doing the right thing is never the wrong thing.", character: "Ted Lasso" },
    ],
    gifs: [],
  },
  {
    id: "roy-kent",
    name: "Roy Kent",
    accent: "#B03A2E",
    verifiedOn: "2026-08-14",
    quotes: [
      {
        text: "He's here, he's there, he's every-bleeping-where.",
        character: "Richmond supporters",
      },
      { text: "I don't want to be lucky. I want to be good.", character: "Roy Kent" },
      { text: "Be curious, not judgmental.", character: "Ted Lasso" },
    ],
    gifs: [],
  },
  {
    id: "comeback-szn",
    name: "Comeback Szn",
    accent: "#2E7D6B",
    verifiedOn: "2026-08-14",
    quotes: [
      { text: "Be a goldfish.", character: "Ted Lasso" },
      // Corrected from the brief: this is Rebecca Welton quoting a Johan
      // Cruyff line to Ted before the Man City match (S1E10, "The Hope
      // That Kills You"); Ted's reply is "Ooh, I like that," not the line
      // itself.
      { text: "Every disadvantage has its advantage.", character: "Rebecca Welton" },
      {
        text: "A good mentor hopes you will move on. A great mentor knows you will.",
        character: "Leslie Higgins",
      },
    ],
    gifs: [],
  },
  {
    id: "football-is-life",
    name: "Football Is Life",
    accent: "#1F7A3D",
    verifiedOn: "2026-08-14",
    quotes: [
      { text: "Football is life!", character: "Dani Rojas" },
      {
        text: "I think that you might be so sure that you're one in a million that sometimes you forget that out there you're just one of eleven.",
        character: "Ted Lasso",
      },
      // Corrected from the brief: this line is written by journalist Trent
      // Crimm in his newspaper column (S1E3, "Trent Crimm: The
      // Independent"), not spoken by Ted.
      {
        text: "If the Lasso way is wrong, it's hard to imagine being right.",
        character: "Trent Crimm",
      },
    ],
    gifs: [],
  },
  {
    id: "gaffer-mode",
    name: "Gaffer Mode",
    accent: "#34495E",
    verifiedOn: "2026-08-14",
    quotes: [
      {
        text: "Success is not about the wins and losses. It's about helping these young fellas be the best versions of themselves.",
        character: "Ted Lasso",
      },
      {
        text: "I think things come into our lives to help us get from one place to a better one.",
        character: "Ted Lasso",
      },
      { text: "The harder you work, the luckier you get.", character: "Ted Lasso" },
    ],
    gifs: [],
  },
  {
    id: "hopeful",
    name: "Hopeful",
    accent: "#C77DBB",
    verifiedOn: "2026-08-14",
    quotes: [
      { text: "I believe in hope. I believe in believe.", character: "Ted Lasso" },
      {
        text: "You beating yourself up is like Woody Allen playing the clarinet. I don't wanna hear it.",
        character: "Ted Lasso",
      },
      // Unverified: could not confirm this exact phrasing via search within
      // the time-box (a related but distinct line, "small acts of kindness
      // make a championship team," turned up instead). Kept as the brief
      // specifies pending a fan/transcript check.
      { text: "Small acts of kindness never go unnoticed.", character: "Ted Lasso" },
    ],
    gifs: [],
  },
  {
    id: "biscuits",
    name: "Biscuits",
    accent: "#D98B5F",
    verifiedOn: "2026-08-14",
    quotes: [
      { text: "Biscuits with the boss.", character: "Ted Lasso" },
      {
        text: "I always figured that tea was gonna taste like hot brown water. And you know what? I was right.",
        character: "Ted Lasso",
      },
      // Unverified: could not confirm this exact phrasing via search within
      // the time-box. Kept as the brief specifies pending a fan/transcript
      // check.
      { text: "Taking a break is not the same as giving up.", character: "Ted Lasso" },
    ],
    gifs: [],
  },
];

export function getMood(id: string): Mood | undefined {
  return MOODS.find((m) => m.id === id);
}
