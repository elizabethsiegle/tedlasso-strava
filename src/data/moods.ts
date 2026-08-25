export interface Quote {
  text: string;
  character: string;
}

export type MediaKind = "gif" | "image" | "video";

/**
 * One piece of media attached to a mood. `kind` decides how it renders: a gif
 * or image goes inline in the hero, a video is offered as a link rather than an
 * embedded player — an iframe would put a third party in the read path and
 * out-shout the quote, which is meant to be the largest thing on the page.
 *
 * The catalogue currently ships no media at all: the quotes are Machiavelli,
 * and there is no honest stock of verified imagery to pair with them. Every
 * mood therefore renders the designed single-column hero. The type and the
 * rendering paths stay because a mood MAY carry media again — nothing here
 * needs re-deriving the day one does.
 */
export interface Media {
  kind: MediaKind;
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
  media: Media[];
  verifiedOn: string;
}

/** Il Principe, 1532. */
const PRINCE = "Machiavelli, The Prince";
/** Discorsi sopra la prima deca di Tito Livio, 1531. */
const DISCOURSES = "Machiavelli, Discourses on Livy";

/**
 * The ten moods, one per branch of `selectMood`. The ids are load-bearing:
 * the engine returns them and the snapshot stores them, so they are renamed
 * only alongside src/domain/mood.ts.
 *
 * Accents carry over unchanged from the previous catalogue — each one is
 * already checked against both newsprint stocks by test/data/moods.test.ts,
 * and the mood a colour belongs to changed its name here, not its temperature.
 */
export const MOODS: Mood[] = [
  {
    // Nothing in 90 days: no campaign has been fought yet, so the reading is
    // peacetime — which Machiavelli treats as training time, not rest.
    id: "peacetime",
    name: "Peacetime",
    accent: "#6B7A8F",
    verifiedOn: "2026-08-25",
    quotes: [
      {
        text: "A prince must have no other object, nor any other thought, nor take anything else as his art, but the art of war.",
        character: PRINCE,
      },
      {
        text: "He ought never to let his thoughts stray from the exercise of war, and in peace he should train for it more diligently than in war itself.",
        character: PRINCE,
      },
      {
        text: "A prudent man should always follow the paths beaten by great men, and imitate those who have been supreme.",
        character: PRINCE,
      },
      { text: "All the armed prophets conquered, and the unarmed ones were destroyed.", character: PRINCE },
    ],
    media: [],
  },
  {
    // Ten days dormant. Machiavelli's word for it is ozio — the idleness that
    // loses princes their states while the weather is still fair.
    id: "idleness",
    name: "Idleness",
    accent: "#8C6239",
    verifiedOn: "2026-08-25",
    quotes: [
      {
        text: "It is a common failing of mankind never to anticipate a storm while the sea is calm.",
        character: PRINCE,
      },
      {
        text: "Our princes, having held their positions for many years, may not blame fortune for having lost them, but rather their own indolence.",
        character: PRINCE,
      },
      {
        text: "The Romans never allowed a trouble spot to remain simply to avoid going to war over it, because they knew that war is not avoided, only postponed to the advantage of others.",
        character: PRINCE,
      },
    ],
    media: [],
  },
  {
    // A fresh 90-day best: virtù, the prowess that is yours rather than
    // fortune's. The one mood the engine will only give you for evidence.
    id: "virtu",
    name: "Virtù",
    accent: "#9A700B",
    verifiedOn: "2026-08-25",
    quotes: [
      {
        text: "Those who become princes by their own prowess acquire their principality with difficulty, but they hold it with ease.",
        character: PRINCE,
      },
      {
        text: "The only sound, sure and enduring methods of defence are those based on your own actions and your own prowess.",
        character: PRINCE,
      },
      { text: "Truly great men are always the same in every fortune.", character: DISCOURSES },
      { text: "It is not titles that honour men, but men that honour titles.", character: DISCOURSES },
    ],
    media: [],
  },
  {
    // Five days in a row and still going: the beast half of chapter 18, the
    // half that frightens wolves.
    id: "the-lion",
    name: "The Lion",
    accent: "#B03A2E",
    verifiedOn: "2026-08-25",
    quotes: [
      {
        text: "One must be a fox in order to recognise traps, and a lion to frighten wolves.",
        character: PRINCE,
      },
      { text: "It is far better to be feared than loved, if you cannot be both.", character: PRINCE },
      {
        text: "Men rise from one ambition to another: first they seek to secure themselves against attack, and then they attack others.",
        character: DISCOURSES,
      },
    ],
    media: [],
  },
  {
    // Back within two days of a week or more off. Fortune's wheel has come
    // round; chapter 25 is about what you do with the half she leaves you.
    id: "fortuna",
    name: "Fortuna",
    accent: "#2E7D6B",
    verifiedOn: "2026-08-25",
    quotes: [
      {
        text: "Fortune is the arbiter of one half of our actions, but she still leaves the direction of the other half to us.",
        character: PRINCE,
      },
      {
        text: "Fortune is like one of those raging rivers; yet when it is quiet, men may make provision against her with dykes and banks.",
        character: PRINCE,
      },
      {
        text: "There is nothing more difficult to take in hand, more perilous to conduct, or more uncertain in its success, than to take the lead in the introduction of a new order of things.",
        character: PRINCE,
      },
      {
        text: "To ensure a long existence to states, it is necessary to bring them frequently back to their first principles.",
        character: DISCOURSES,
      },
    ],
    media: [],
  },
  {
    // The middle band on both axes: nothing to crow about, nothing to fix.
    // Chapter 23 is the one about listening to people who will tell you so.
    id: "good-counsel",
    name: "Good Counsel",
    accent: "#8A7B4F",
    verifiedOn: "2026-08-25",
    quotes: [
      {
        text: "Good counsel, from whomever it comes, depends on the prudence of the prince, and not the prudence of the prince on good counsel.",
        character: PRINCE,
      },
      {
        text: "There is no other way of guarding oneself against flattery than by letting men understand that to tell you the truth will not offend you.",
        character: PRINCE,
      },
      {
        text: "A prince ought to ask about everything, listen to their opinions, and afterwards form his own conclusions.",
        character: PRINCE,
      },
    ],
    media: [],
  },
  {
    // High on both axes. Chapters 12 and 13: the state that rests on borrowed
    // arms rests on nothing, and yours are showing.
    id: "arms-of-your-own",
    name: "Arms of Your Own",
    accent: "#1F7A3D",
    verifiedOn: "2026-08-25",
    quotes: [
      { text: "There cannot be good laws where there are not good arms.", character: PRINCE },
      { text: "Mercenaries and auxiliaries are useless and dangerous.", character: PRINCE },
      {
        text: "Without arms of its own no principality is secure; rather it is wholly dependent on fortune.",
        character: PRINCE,
      },
    ],
    media: [],
  },
  {
    // Consistent but unhurried: chapter 10's prince, provisioned and walled,
    // who is not attacked because attacking him would plainly be work.
    id: "fortified-city",
    name: "The Fortified City",
    accent: "#56799C",
    verifiedOn: "2026-08-25",
    quotes: [
      {
        text: "A prince who has a strong city, and has not made himself hated, cannot be attacked.",
        character: PRINCE,
      },
      {
        text: "Cities that are well fortified and well provisioned are never attacked without great difficulty.",
        character: PRINCE,
      },
      { text: "Men are always adverse to enterprises where difficulties can be seen.", character: PRINCE },
    ],
    media: [],
  },
  {
    // Charged but scattered: all the boldness of chapter 25 and none of the
    // dykes and banks. Machiavelli is, on balance, in favour.
    id: "the-impetuous",
    name: "The Impetuous",
    accent: "#B24DA2",
    verifiedOn: "2026-08-25",
    quotes: [
      {
        text: "It is better to be impetuous than cautious, for fortune is more often subdued by those who act boldly than by those who proceed coldly.",
        character: PRINCE,
      },
      {
        text: "She is a friend to the young, because they are less cautious, more fierce, and command her with more audacity.",
        character: PRINCE,
      },
      {
        text: "The man who adapts his course of action to the nature of the times will succeed.",
        character: PRINCE,
      },
      { text: "Whoever desires constant success must change his conduct with the times.", character: DISCOURSES },
    ],
    media: [],
  },
  {
    // The fallback: quiet on both axes, no rule fired. Chapters 3 and 21 —
    // time is the one thing still moving, and it moves either way.
    id: "benefit-of-time",
    name: "The Benefit of Time",
    accent: "#B95F2C",
    verifiedOn: "2026-08-25",
    quotes: [
      {
        text: "Time drives everything before it, and is able to bring with it good as well as evil, and evil as well as good.",
        character: PRINCE,
      },
      {
        text: "Let no state believe that it can always choose safe courses; rather let it think that all are doubtful.",
        character: PRINCE,
      },
      {
        text: "Prudence consists in knowing how to distinguish degrees of disadvantage, and in accepting the lesser as good.",
        character: PRINCE,
      },
      {
        text: "Whoever considers the past and the present will find that all cities and all peoples are animated by the same desires.",
        character: DISCOURSES,
      },
    ],
    media: [],
  },
];

export function getMood(id: string): Mood | undefined {
  return MOODS.find((m) => m.id === id);
}
