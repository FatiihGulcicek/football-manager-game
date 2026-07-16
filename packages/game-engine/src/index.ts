export function simulateMatch(homeScore: number, awayScore: number) {
  return {
    homeScore,
    awayScore,
    result: homeScore > awayScore ? 'home' : homeScore < awayScore ? 'away' : 'draw'
  } as const;
}
