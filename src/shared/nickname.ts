// Fun, generated shopper nicknames (nobody types a name): "Maple Otter 42".
const ADJECTIVES = ['Maple', 'Lucky', 'Sunny', 'Cozy', 'Brave', 'Jolly', 'Snowy', 'Zippy', 'Mellow', 'Breezy', 'Peppy', 'Toasty'];
const ANIMALS = ['Otter', 'Moose', 'Beaver', 'Raccoon', 'Loon', 'Heron', 'Fox', 'Lynx', 'Puffin', 'Marmot', 'Owl', 'Bison'];

export function makeNickname(random: () => number = Math.random): string {
  const pick = <T,>(list: readonly T[]) => list[Math.floor(random() * list.length)]!;
  return `${pick(ADJECTIVES)} ${pick(ANIMALS)} ${10 + Math.floor(random() * 90)}`;
}
