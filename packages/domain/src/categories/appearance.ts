/** Category appearance is stored data, independent of the selected screen theme. */
export const categoryColors = ['#168A65', '#2878C8', '#168AA3', '#6D5BD0', '#8B4FB3', '#C94F83', '#C74747', '#D66A2C', '#A96F00', '#668F2D', '#815B45', '#596579'] as const;
export const defaultCategoryColors: Readonly<Record<string, string>> = {
  groceries: '#168A65', dining: '#D66A2C', transport: '#2878C8', housing: '#815B45',
  utilities: '#A96F00', health: '#C74747', entertainment: '#6D5BD0', shopping: '#C94F83',
  salary: '#668F2D', other_income: '#168AA3',
};

export function categoryAppearance(category?: { id: string; systemKey: string | null; colorToken: string | null; iconColor: string | null } | null) {
  const validColor = (color: string | null | undefined) => Boolean(color && /^#[a-f\d]{6}$/i.test(color));
  const fallbackIndex = [...(category?.id ?? 'uncategorized')].reduce((hash, letter) => (hash * 31 + letter.charCodeAt(0)) >>> 0, 0) % categoryColors.length;
  return {
    background: validColor(category?.colorToken) ? category!.colorToken! : defaultCategoryColors[category?.systemKey ?? ''] ?? categoryColors[fallbackIndex]!,
    foreground: validColor(category?.iconColor) ? category!.iconColor! : '#FFFFFF',
  };
}
