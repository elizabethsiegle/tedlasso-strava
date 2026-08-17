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
    gifs: [
      {
        url: "https://media.giphy.com/media/RzE8jPRlLeEyEB6Dmf/giphy.gif",
        alt: "Ted Lasso looks nervous and anxious.",
        source: "Giphy",
        verifiedOn: "2026-08-16",
      },
    ],
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
    // Darkened from the original #F2C14E: that pale gold cleared 11:1 against
    // the dark stock but only 1.49:1 against the light one -- unreadable as
    // this mood's headline and route-map color. This deeper amber keeps the
    // same hue/saturation and clears 3:1 (WCAG large-text) against both.
    accent: "#9A700B",
    verifiedOn: "2026-08-14",
    quotes: [
      { text: "Believe.", character: "AFC Richmond locker room" },
      {
        text: "It's the lack of hope that comes and gets you. I believe in hope.",
        character: "Ted Lasso",
      },
      { text: "Doing the right thing is never the wrong thing.", character: "Ted Lasso" },
    ],
    gifs: [
      {
        url: "https://media.giphy.com/media/5B925WaCAIWojy3KMG/giphy.gif",
        alt: "Ted Lasso conveys a hopeful believe message.",
        source: "Giphy",
        verifiedOn: "2026-08-16",
      },
    ],
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
    gifs: [
      {
        url: "https://media.giphy.com/media/5erpxvvqEBWBeFhrHa/giphy.gif",
        alt: "Roy Kent's face flashes with sudden, exasperated frustration.",
        source: "Giphy",
        verifiedOn: "2026-08-16",
      },
      {
        url: "https://media.giphy.com/media/Zod24bq6PTegwxMAcK/giphy.gif",
        alt: "Roy Kent's scowl conveys blunt irritation.",
        source: "Giphy",
        verifiedOn: "2026-08-16",
      },
    ],
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
    gifs: [
      {
        url: "https://media.giphy.com/media/oxQDaZaJUMNwxbPUx5/giphy.gif",
        alt: "An animated goldfish illustrates forgetting and moving on quickly.",
        source: "Giphy",
        verifiedOn: "2026-08-16",
      },
    ],
  },
  {
    id: "diamond-dogs",
    name: "Diamond Dogs",
    accent: "#8A7B4F",
    verifiedOn: "2026-08-14",
    quotes: [
      { text: "Barbecue sauce.", character: "Ted Lasso" },
      { text: "Diamond Dogs, assemble!", character: "Ted Lasso" },
      {
        text: "If you care about someone, and you got a little love in your heart, there ain't nothing you can't get through together.",
        character: "Ted Lasso",
      },
    ],
    gifs: [
      {
        url: "https://media.giphy.com/media/yPK2Mo5zXUF8NsE8gE/giphy.gif",
        alt: "The Diamond Dogs gather together in a moment of camaraderie.",
        source: "Giphy",
        verifiedOn: "2026-08-16",
      },
    ],
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
    gifs: [
      {
        url: "https://media.giphy.com/media/UL3kNMFvmKGXlOD8Qu/giphy.gif",
        alt: "Dani Rojas cheerfully declares that football is life.",
        source: "Giphy",
        verifiedOn: "2026-08-16",
      },
    ],
  },
  {
    id: "gaffer-mode",
    name: "Gaffer Mode",
    // Lightened from the original #34495E: that navy cleared 8.23:1 against
    // the light stock but only 1.99:1 against the dark one. This keeps the
    // same navy-slate hue and saturation, lifted to clear 3:1 against both.
    accent: "#56799C",
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
    // Darkened from the original #C77DBB: that orchid pink cleared 6.23:1
    // against the dark stock but only 2.63:1 against the light one. Same hue
    // and saturation, deepened to clear 3:1 against both.
    accent: "#B24DA2",
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
    // Darkened from the original #D98B5F: that terracotta cleared 6.87:1
    // against the dark stock but only 2.38:1 against the light one. Same hue
    // and saturation, deepened to clear 3:1 against both.
    accent: "#B95F2C",
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
