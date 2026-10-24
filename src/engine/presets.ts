// Topic presets: starter term lists users can apply, review, and edit.
// Presets are suggestions, not policy — every term lands as an ordinary
// editable rule tagged with the preset's group id.

import type { MatchType } from "./prefs";

export interface PresetTerm {
  term: string;
  matchType?: MatchType; // default "word"
}

export interface Preset {
  id: string;
  name: string;
  description: string;
  terms: PresetTerm[];
}

export const PRESETS: Preset[] = [
  {
    id: "gambling",
    name: "Gambling",
    description: "Betting tips, casino content, odds and promotions.",
    terms: [
      { term: "bet" },
      { term: "bets" },
      { term: "betting" },
      { term: "casino" },
      { term: "slots" },
      { term: "slot machine", matchType: "phrase" },
      { term: "poker" },
      { term: "blackjack" },
      { term: "roulette" },
      { term: "jackpot" },
      { term: "odds" },
      { term: "wager" },
      { term: "sportsbook" },
      { term: "bookmaker" },
      { term: "gambling" },
      { term: "parlay" },
    ],
  },
  {
    id: "alcohol",
    name: "Alcohol",
    description: "Drinks promotions and alcohol-centred content.",
    terms: [
      { term: "alcohol" },
      { term: "beer" },
      { term: "wine" },
      { term: "vodka" },
      { term: "whiskey" },
      { term: "whisky" },
      { term: "tequila" },
      { term: "cocktail" },
      { term: "cocktails" },
      { term: "booze" },
      { term: "brewery" },
      { term: "happy hour", matchType: "phrase" },
      { term: "drinking game", matchType: "phrase" },
    ],
  },
  {
    id: "shopping",
    name: "Shopping prompts",
    description: "Sales pressure, hauls, deals and purchase temptations.",
    terms: [
      { term: "sale" },
      { term: "discount" },
      { term: "% off", matchType: "substring" },
      { term: "buy now", matchType: "phrase" },
      { term: "limited time", matchType: "phrase" },
      { term: "flash deal", matchType: "phrase" },
      { term: "promo code", matchType: "phrase" },
      { term: "coupon" },
      { term: "unboxing" },
      { term: "haul" },
      { term: "giveaway" },
      { term: "black friday", matchType: "phrase" },
      { term: "cyber monday", matchType: "phrase" },
    ],
  },
  {
    id: "distressing-news",
    name: "Distressing news",
    description: "Violent or distressing news topics. Review before applying.",
    terms: [
      { term: "shooting" },
      { term: "murder" },
      { term: "stabbing" },
      { term: "death toll", matchType: "phrase" },
      { term: "massacre" },
      { term: "terror attack", matchType: "phrase" },
      { term: "war crime", matchType: "phrase" },
      { term: "air strike", matchType: "phrase" },
      { term: "airstrike" },
      { term: "hostage" },
      { term: "fatal" },
      { term: "body found", matchType: "phrase" },
    ],
  },
  {
    id: "phobias",
    name: "Common phobias",
    description: "Spiders, snakes, insects and similar. Keep what applies to you.",
    terms: [
      { term: "spider" },
      { term: "spiders" },
      { term: "tarantula" },
      { term: "arachnid" },
      { term: "snake" },
      { term: "snakes" },
      { term: "cockroach" },
      { term: "wasp" },
      { term: "maggot" },
      { term: "leech" },
    ],
  },
];
