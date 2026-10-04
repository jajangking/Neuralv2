import { mutate, randomBrain, type Brain } from "./net";

export const POPULATION = 14;
export const GENERATIONS = 26;
export const STEPS = 1200;

/**
 * The next generation of candidates.
 *
 * Composition matters more than it looks. Elitism alone is a greedy hill-climb
 * and gets trapped: this fitness has a strong "crawl down the centreline at
 * 14 km/h" optimum that no small mutation escapes, because every faster brain
 * immediately runs wide. The wild jump and the two fresh random brains are what
 * let the search cross that gap — on a random brain roughly a third of the track
 * gets covered, which is enough of a foothold to build on.
 */
export function nextPopulation(champion: Brain | null, size = POPULATION): Brain[] {
  if (!champion) return Array.from({ length: size }, () => randomBrain());
  return [
    champion,
    ...Array.from({ length: Math.max(1, size - 4) }, () => mutate(champion, 0.14)),
    mutate(champion, 0.4, 1.8),
    ...Array.from({ length: 2 }, () => randomBrain()),
  ];
}
