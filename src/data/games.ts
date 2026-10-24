export interface Game {
  slug: string;
  name: string;
  /** Codes jeu acceptés, lus à l'offset 0x0C de l'en-tête .nds. */
  codes: string[];
  size: string;
}

export interface Category {
  id: string;
  name: string;
  games: Game[];
}

export const categories: Category[] = [
  {
    id: 'pokemon',
    name: 'Pokémon',
    games: [{ slug: 'pokemon-heartgold', name: 'Pokémon Or HeartGold', codes: ['IPKF'], size: '128 Mo' }],
  },
  {
    id: 'mario',
    name: 'Mario',
    games: [{ slug: 'mario-kart-ds', name: 'Mario Kart DS', codes: ['AMCF'], size: '32 Mo' }],
  },
];

export const allGames = categories.flatMap((category) =>
  category.games.map((game) => ({ ...game, category })),
);
