const allowedAssetExtensions = [
  ".svg",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".ico"
];

export function isAllowedBrandAssetPath(path: string): boolean {
  const [pathWithoutQuery] = path.split(/[?#]/, 1);
  const lowerPath = (pathWithoutQuery ?? path).toLowerCase();

  return allowedAssetExtensions.some((extension) =>
    lowerPath.endsWith(extension)
  );
}
