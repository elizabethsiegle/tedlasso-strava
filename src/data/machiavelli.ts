import type { Mood } from "./moods";

/**
 * The second voice: the same ten moods the engine already selects, spoken by
 * Machiavelli instead of Ted Lasso. Served at `/machiavelli` over the identical
 * layout, so the two pages are a straight A/B of tone against the same training
 * data, not a different product.
 *
 * The passages, citations, and portrait media were written for the
 * `feat/machiavelli-catalogue` branch, which pivots the site's single voice
 * wholesale. They are reused here verbatim rather than rewritten: cited
 * translations are exactly the kind of content that should exist once. See the
 * coordination note in that branch before editing either copy.
 *
 * Machiavelli is one of the most misquoted authors there is, so every entry is a
 * passage that can be pointed at in the text, from the public-domain
 * translations (Marriott, Ricci), with its chapter cited. The popular
 * fabrications stay out: "the ends justify the means" appears nowhere in The
 * Prince, and it is not going in this file either.
 *
 * The mood ids are load-bearing and must stay in lockstep with `MOODS` in
 * `./moods.ts`: the engine picks an id, and each catalogue answers in its own
 * voice. `test/data/machiavelli.test.ts` fails the build if one drifts from the
 * other. The names and accents are deliberately this catalogue's own, because a
 * Machiavelli passage under the heading "Biscuits" would read as a bug.
 */
export const MACHIAVELLI_MOODS: Mood[] = [
  {
    id: "preseason",
    name: "Peacetime",
    accent: "#6B7A8F",
    verifiedOn: "2026-08-20",
    quotes: [
      {
        text: "A wise prince ought never to lift his thoughts from the exercise of war, and in peace he should occupy himself with it more than in war itself.",
        character: "The Prince, ch. XIV",
      },
      {
        text: "The Romans did what all wise princes ought to do: they looked not only to present troubles but also to future ones, and provided against them with all diligence.",
        character: "The Prince, ch. III",
      },
      {
        text: "There is nothing more difficult to take in hand, more perilous to conduct, or more uncertain in its success, than to take the lead in the introduction of a new order of things.",
        character: "The Prince, ch. VI",
      },
    ],
    media: [
      {
        kind: "image",
        url: "https://upload.wikimedia.org/wikipedia/commons/7/77/Machiavelli_Principe_Cover_Page.jpg",
        alt: "The title page of an early printed edition of Il Principe.",
        source: "Wikimedia Commons, public domain",
        verifiedOn: "2026-08-20",
      },
    ],
  },
  {
    id: "whered-you-go",
    name: "Neglect",
    accent: "#8C6239",
    verifiedOn: "2026-08-20",
    quotes: [
      {
        text: "The chief cause of the loss of states is the contempt of this art, and the way to acquire them is to be well versed in it.",
        character: "The Prince, ch. XIV",
      },
      {
        text: "States that rise quickly, like all things in nature that are born and grow rapidly, cannot have roots and branches, so that the first storm destroys them.",
        character: "The Prince, ch. VII",
      },
      {
        text: "He who abandons what is done for what ought to be done sooner brings about his ruin than his preservation.",
        character: "The Prince, ch. XV",
      },
    ],
    media: [
      {
        kind: "image",
        url: "https://upload.wikimedia.org/wikipedia/commons/e/e7/La_morte_di_Niccol%C3%B2_Machiavelli.jpg",
        alt: "A nineteenth-century painting of the death of Machiavelli.",
        source: "Wikimedia Commons, public domain",
        verifiedOn: "2026-08-20",
      },
    ],
  },
  {
    id: "believe",
    name: "Occasione",
    accent: "#9A700B",
    verifiedOn: "2026-08-20",
    quotes: [
      {
        text: "Without opportunity their powers of mind would have been extinguished, and without those powers the opportunity would have come in vain.",
        character: "The Prince, ch. VI",
      },
      {
        text: "It is better to be impetuous than cautious, for fortune yields sooner to those who press her than to those who proceed coldly.",
        character: "The Prince, ch. XXV",
      },
      {
        text: "God is not willing to do everything, and thus take away our free will and that share of the glory which belongs to us.",
        character: "The Prince, ch. XXVI",
      },
    ],
    media: [
      {
        kind: "image",
        url: "https://upload.wikimedia.org/wikipedia/commons/d/d9/Federico_Faruffini_-_Borgia_e_Machiavelli.jpg",
        alt: "Faruffini's painting of Machiavelli in conference with Cesare Borgia.",
        source: "Wikimedia Commons, public domain",
        verifiedOn: "2026-08-20",
      },
    ],
  },
  {
    id: "roy-kent",
    name: "Discipline",
    accent: "#B03A2E",
    verifiedOn: "2026-08-20",
    quotes: [
      {
        text: "The lion cannot protect himself from traps, and the fox cannot defend himself from wolves. One must therefore be a fox to recognise traps, and a lion to frighten wolves.",
        character: "The Prince, ch. XVIII",
      },
      {
        text: "Nothing causes a prince to be so much esteemed as great enterprises and setting a fine example.",
        character: "The Prince, ch. XXI",
      },
      {
        text: "Whoever wishes constant success must change his conduct with the times.",
        character: "Discourses on Livy, bk. III, ch. 9",
      },
    ],
    media: [
      {
        kind: "image",
        url: "https://upload.wikimedia.org/wikipedia/commons/thumb/0/0a/Machiavelli_-_Mentzel%2C_Johann_Georg.jpg/960px-Machiavelli_-_Mentzel%2C_Johann_Georg.jpg",
        alt: "An engraved portrait of Machiavelli by Johann Georg Mentzel.",
        source: "Wikimedia Commons, public domain",
        verifiedOn: "2026-08-20",
      },
    ],
  },
  {
    id: "comeback-szn",
    name: "Reconquest",
    accent: "#2E7D6B",
    verifiedOn: "2026-08-20",
    quotes: [
      {
        text: "Provinces that have rebelled and are afterwards recovered are less apt to be lost again, for the ruler takes occasion from the rebellion to secure himself.",
        character: "The Prince, ch. III",
      },
      {
        text: "Men never do good unless necessity drives them to it.",
        character: "Discourses on Livy, bk. I, ch. 3",
      },
      {
        text: "Men are much more taken by present things than by those that are past.",
        character: "The Prince, ch. XXIV",
      },
    ],
    media: [
      {
        kind: "image",
        url: "https://upload.wikimedia.org/wikipedia/commons/thumb/4/46/Eugenio_Agneni_-_Le_ombre_dei_grandi_uomini_fiorentini_che_protestano_contro_il_dominio_straniero.jpg/960px-Eugenio_Agneni_-_Le_ombre_dei_grandi_uomini_fiorentini_che_protestano_contro_il_dominio_straniero.jpg",
        alt: "Agneni's painting of the shades of great Florentines rising in protest.",
        source: "Wikimedia Commons, public domain",
        verifiedOn: "2026-08-20",
      },
    ],
  },
  {
    id: "diamond-dogs",
    name: "The Middle Way",
    accent: "#8A7B4F",
    verifiedOn: "2026-08-20",
    quotes: [
      {
        text: "Very rarely do men know how to be either entirely good or entirely bad.",
        character: "Discourses on Livy, bk. I, ch. 27",
      },
      {
        text: "In the affairs of state one should never adopt a middle course, for it holds neither the advantages of the one nor the safety of the other.",
        character: "Discourses on Livy, bk. II, ch. 23",
      },
      {
        text: "Many have imagined republics and principalities that have never been seen or known to exist in reality.",
        character: "The Prince, ch. XV",
      },
    ],
    media: [
      {
        kind: "image",
        url: "https://upload.wikimedia.org/wikipedia/commons/thumb/3/3a/Opere_di_Machiavelli_01.jpg/960px-Opere_di_Machiavelli_01.jpg",
        alt: "The title page of a collected edition of Machiavelli's works.",
        source: "Wikimedia Commons, public domain",
        verifiedOn: "2026-08-20",
      },
    ],
  },
  {
    id: "football-is-life",
    name: "Virtù",
    accent: "#1F7A3D",
    verifiedOn: "2026-08-20",
    quotes: [
      {
        text: "Those who become princes by their own ability acquire their dominion with difficulty, but they keep it with ease.",
        character: "The Prince, ch. VI",
      },
      {
        text: "He who has relied least upon fortune is established the strongest.",
        character: "The Prince, ch. VI",
      },
      {
        text: "A prince ought to have no other aim or thought, nor take up any other thing for his study, but war and its organisation and discipline.",
        character: "The Prince, ch. XIV",
      },
    ],
    media: [
      {
        kind: "image",
        url: "https://upload.wikimedia.org/wikipedia/commons/thumb/e/e2/Portrait_of_Niccol%C3%B2_Machiavelli_by_Santi_di_Tito.jpg/960px-Portrait_of_Niccol%C3%B2_Machiavelli_by_Santi_di_Tito.jpg",
        alt: "Santi di Tito's portrait of Machiavelli, the canonical likeness.",
        source: "Wikimedia Commons, public domain",
        verifiedOn: "2026-08-20",
      },
    ],
  },
  {
    id: "gaffer-mode",
    name: "The Fortress",
    accent: "#56799C",
    verifiedOn: "2026-08-20",
    quotes: [
      {
        text: "It is much safer to be feared than loved, if one of the two must be wanting.",
        character: "The Prince, ch. XVII",
      },
      {
        text: "The best fortress that exists is to avoid being hated by the people, for though you hold fortresses, they will not save you if the people hate you.",
        character: "The Prince, ch. XX",
      },
      {
        text: "A prince who has a strong city and does not make himself hated cannot be attacked, and anyone who attempts it will be driven off with disgrace.",
        character: "The Prince, ch. X",
      },
    ],
    media: [
      {
        kind: "image",
        url: "https://upload.wikimedia.org/wikipedia/commons/thumb/d/df/Antonio_Maria_Crespi_Castoldi_-_Portrait_of_Niccol%C3%B2_Machiavelli.jpg/960px-Antonio_Maria_Crespi_Castoldi_-_Portrait_of_Niccol%C3%B2_Machiavelli.jpg",
        alt: "Crespi Castoldi's portrait of Machiavelli.",
        source: "Wikimedia Commons, public domain",
        verifiedOn: "2026-08-20",
      },
    ],
  },
  {
    id: "hopeful",
    name: "Fortuna",
    accent: "#B24DA2",
    verifiedOn: "2026-08-20",
    quotes: [
      {
        text: "Fortune is the arbiter of one half of our actions, and she leaves the other half, or nearly so, to be governed by us.",
        character: "The Prince, ch. XXV",
      },
      {
        text: "When rivers are in flood they carry all before them, yet in quiet times men can make provision with dykes and embankments, so that when the waters rise they are neither so unrestrained nor so damaging.",
        character: "The Prince, ch. XXV",
      },
      {
        text: "Those who rise by fortune alone have little trouble in rising and much in maintaining themselves, for they have no roots.",
        character: "The Prince, ch. VII",
      },
    ],
    media: [
      {
        kind: "image",
        url: "https://upload.wikimedia.org/wikipedia/commons/0/0b/Coloured_engraving_after_Stefano_Ussi%27s_Portrait_of_Niccolo_Machiavelli%2C_1894.jpg",
        alt: "An 1894 coloured engraving after Stefano Ussi's portrait of Machiavelli.",
        source: "Wikimedia Commons, public domain",
        verifiedOn: "2026-08-20",
      },
    ],
  },
  {
    id: "biscuits",
    name: "Ozio",
    accent: "#B95F2C",
    verifiedOn: "2026-08-20",
    quotes: [
      {
        text: "Our princes should not blame fortune for the loss of their states, but their own indolence.",
        character: "The Prince, ch. XXIV",
      },
      {
        text: "When a man is content to go on as he has always gone, and the times change against him, he is ruined.",
        character: "The Prince, ch. XXV",
      },
      {
        text: "Men are always averse to any enterprise in which they foresee difficulty, and no enterprise can be called easy where the outcome is doubtful.",
        character: "The Prince, ch. VI",
      },
    ],
    media: [
      {
        kind: "image",
        url: "https://upload.wikimedia.org/wikipedia/commons/thumb/3/35/Machiavelli_caricature.jpg/960px-Machiavelli_caricature.jpg",
        alt: "A caricature of Machiavelli.",
        source: "Wikimedia Commons, public domain",
        verifiedOn: "2026-08-20",
      },
    ],
  },
];

/** Mirrors `getMood`, over the other catalogue. */
export function getMachiavelliMood(id: string): Mood | undefined {
  return MACHIAVELLI_MOODS.find((mood) => mood.id === id);
}
