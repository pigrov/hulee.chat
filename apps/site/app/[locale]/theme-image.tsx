import Image from "next/image";
import type { ImageProps } from "next/image";

type ThemeImageProps = Omit<ImageProps, "src"> & {
  src: ImageProps["src"];
  darkSrc?: ImageProps["src"];
  darkPriority?: ImageProps["priority"];
};

function joinClassNames(
  ...classNames: Array<string | false | null | undefined>
): string | undefined {
  const className = classNames.filter(Boolean).join(" ");

  return className.length > 0 ? className : undefined;
}

export function ThemeImage({
  src,
  darkSrc,
  darkPriority = false,
  className,
  priority,
  ...props
}: ThemeImageProps) {
  if (!darkSrc) {
    return (
      <Image {...props} className={className} priority={priority} src={src} />
    );
  }

  return (
    <>
      <Image
        {...props}
        className={joinClassNames(className, "theme-image--light")}
        priority={priority}
        src={src}
      />
      <Image
        {...props}
        className={joinClassNames(className, "theme-image--dark")}
        priority={darkPriority}
        src={darkSrc}
      />
    </>
  );
}
